import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { paths } from "./config";
import type {
  Conversation, Message, AttachmentMeta, Role,
  CaseGraph, GraphCaseInfo, GraphNode, GraphEdge,
} from "../shared/types";

// ── on-disk shapes (path kept server-side, never sent to the renderer) ───────
interface AttachmentRow { id: string; messageId: string; name: string; mimeType: string; path: string; bytes: number; createdAt: number; }
interface MessageRow { id: string; conversationId: string; role: Role; content: string; createdAt: number; costUsd: number | null; }
interface NodeRow { caseId: string; key: string; type: string; label: string; value: string | null; status: string; confidence: string | null; notes: string | null; source: string | null; image: string | null; createdAt: number; updatedAt: number; }
interface EdgeRow { caseId: string; source: string; target: string; label: string | null; confidence: string | null; createdAt: number; }
interface CaseRow { id: string; name: string; createdAt: number; updatedAt: number; }

interface Db {
  conversations: Conversation[];
  messages: MessageRow[];
  attachments: AttachmentRow[];
  cases: CaseRow[];
  nodes: NodeRow[];
  edges: EdgeRow[];
}

export interface NewAttachment { name: string; mimeType: string; path: string; bytes: number; }
export interface StoredAttachment extends AttachmentRow {}

export interface GraphNodeInput { key: string; type: string; label?: string; value?: string; status?: string; confidence?: string; notes?: string; source?: string; image?: string; }
export interface GraphEdgeInput { source: string; target: string; label?: string; confidence?: string; }
export interface GraphWriteResult {
  caseId: string; name: string; nodesWritten: number; edgesWritten: number;
  stubbedKeys: string[]; nodeCount: number; edgeCount: number; pendingCount: number;
}

const empty = (): Db => ({ conversations: [], messages: [], attachments: [], cases: [], nodes: [], edges: [] });

function deriveTitle(first: string): string {
  const cleaned = first.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New conversation";
  return cleaned.length <= 60 ? cleaned : cleaned.slice(0, 57) + "…";
}

/** A later upsert only ever enriches — an omitted field keeps the prior value. */
const merged = (next: string | undefined, prior: string | null): string | null => {
  const t = next?.trim();
  return t ? t : prior;
};

class Store {
  private db: Db = empty();

  constructor() {
    try {
      if (existsSync(paths.storeFile)) {
        this.db = { ...empty(), ...JSON.parse(readFileSync(paths.storeFile, "utf8")) };
      }
    } catch (e) {
      console.error("[aether] store load failed, starting fresh:", e);
      this.db = empty();
    }
  }

  /** Atomic: write a temp file then rename over the target. */
  private persist(): void {
    const tmp = paths.storeFile + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.db), "utf8");
    renameSync(tmp, paths.storeFile);
  }

  // ── conversations ──────────────────────────────────────────────────────────
  createConversation(firstMessage: string): Conversation {
    const now = Date.now();
    const c: Conversation = { id: randomUUID(), title: deriveTitle(firstMessage), claudeSessionId: null, createdAt: now, updatedAt: now };
    this.db.conversations.push(c);
    this.persist();
    return c;
  }

  getConversation(id: string): Conversation | null {
    return this.db.conversations.find((c) => c.id === id) ?? null;
  }

  listConversations(): Conversation[] {
    return [...this.db.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  deleteConversation(id: string): boolean {
    const before = this.db.conversations.length;
    const msgIds = new Set(this.db.messages.filter((m) => m.conversationId === id).map((m) => m.id));
    this.db.conversations = this.db.conversations.filter((c) => c.id !== id);
    this.db.messages = this.db.messages.filter((m) => m.conversationId !== id);
    this.db.attachments = this.db.attachments.filter((a) => !msgIds.has(a.messageId));
    if (this.db.conversations.length !== before) { this.persist(); return true; }
    return false;
  }

  renameConversation(id: string, title: string): boolean {
    const c = this.getConversation(id);
    if (!c) return false;
    c.title = title;
    c.updatedAt = Date.now();
    this.persist();
    return true;
  }

  setClaudeSessionId(conversationId: string, sessionId: string): void {
    const c = this.getConversation(conversationId);
    if (!c) return;
    c.claudeSessionId = sessionId;
    this.persist();
  }

  addMessage(conversationId: string, role: Role, content: string, costUsd: number | null = null, attachments: NewAttachment[] = []): Message {
    const now = Date.now();
    const id = randomUUID();
    this.db.messages.push({ id, conversationId, role, content, createdAt: now, costUsd });
    const stored: AttachmentMeta[] = [];
    for (const a of attachments) {
      const aid = randomUUID();
      this.db.attachments.push({ id: aid, messageId: id, name: a.name, mimeType: a.mimeType, path: a.path, bytes: a.bytes, createdAt: now });
      stored.push({ id: aid, name: a.name, mimeType: a.mimeType });
    }
    const c = this.getConversation(conversationId);
    if (c) c.updatedAt = now;
    this.persist();
    return { id, conversationId, role, content, createdAt: now, costUsd, attachments: stored };
  }

  listMessages(conversationId: string): Message[] {
    const byMsg = new Map<string, AttachmentMeta[]>();
    for (const a of this.db.attachments) {
      const meta: AttachmentMeta = { id: a.id, name: a.name, mimeType: a.mimeType };
      const arr = byMsg.get(a.messageId);
      if (arr) arr.push(meta); else byMsg.set(a.messageId, [meta]);
    }
    return this.db.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((m) => ({ id: m.id, conversationId: m.conversationId, role: m.role, content: m.content, createdAt: m.createdAt, costUsd: m.costUsd, attachments: byMsg.get(m.id) ?? [] }));
  }

  getAttachment(id: string): StoredAttachment | null {
    return this.db.attachments.find((a) => a.id === id) ?? null;
  }

  // ── case graph ───────────────────────────────────────────────────────────
  private caseInfo(row: CaseRow): GraphCaseInfo {
    const nodes = this.db.nodes.filter((n) => n.caseId === row.id);
    return {
      id: row.id, name: row.name, updatedAt: row.updatedAt,
      nodeCount: nodes.length,
      edgeCount: this.db.edges.filter((e) => e.caseId === row.id).length,
      pendingCount: nodes.filter((n) => n.status === "pending").length,
    };
  }

  upsertGraph(caseName: string, nodes: GraphNodeInput[] = [], edges: GraphEdgeInput[] = []): GraphWriteResult {
    const name = caseName.trim();
    const now = Date.now();
    let row = this.db.cases.find((c) => c.name === name);
    if (!row) { row = { id: randomUUID(), name, createdAt: now, updatedAt: now }; this.db.cases.push(row); }
    const caseId = row.id;

    let nodesWritten = 0;
    for (const node of nodes) {
      const key = node.key.trim();
      if (!key) continue;
      const prior = this.db.nodes.find((n) => n.caseId === caseId && n.key === key);
      if (prior) {
        prior.type = node.type?.trim().toLowerCase() || prior.type;
        prior.label = node.label?.trim() || prior.label;
        prior.value = merged(node.value, prior.value);
        prior.status = node.status?.trim() || prior.status;
        prior.confidence = merged(node.confidence, prior.confidence);
        prior.notes = merged(node.notes, prior.notes);
        prior.source = merged(node.source, prior.source);
        prior.image = merged(node.image, prior.image);
        prior.updatedAt = now;
      } else {
        this.db.nodes.push({
          caseId, key, type: node.type.trim().toLowerCase(), label: node.label?.trim() || key,
          value: merged(node.value, null), status: node.status?.trim() || "pending",
          confidence: merged(node.confidence, null), notes: merged(node.notes, null),
          source: merged(node.source, null), image: merged(node.image, null), createdAt: now, updatedAt: now,
        });
      }
      nodesWritten++;
    }

    let edgesWritten = 0;
    const stubbedKeys: string[] = [];
    for (const edge of edges) {
      const source = edge.source.trim();
      const target = edge.target.trim();
      if (!source || !target || source === target) continue;
      for (const key of [source, target]) {
        if (!this.db.nodes.some((n) => n.caseId === caseId && n.key === key)) {
          this.db.nodes.push({ caseId, key, type: "note", label: key, value: null, status: "pending", confidence: null, notes: null, source: null, image: null, createdAt: now, updatedAt: now });
          stubbedKeys.push(key);
        }
      }
      const label = merged(edge.label, null);
      // Collapse label-less duplicates onto an existing link (and upgrade a
      // previously label-less edge when a label finally arrives), while still
      // allowing two genuinely different labelled relations between a pair.
      const existing = this.db.edges.find((e) =>
        e.caseId === caseId && e.source === source && e.target === target &&
        (e.label === label || e.label === null || label === null));
      if (existing) {
        if (label && !existing.label) existing.label = label;
        continue;
      }
      this.db.edges.push({ caseId, source, target, label, confidence: merged(edge.confidence, null), createdAt: now });
      edgesWritten++;
    }

    row.updatedAt = now;
    this.persist();
    const info = this.caseInfo(row);
    return { caseId, name, nodesWritten, edgesWritten, stubbedKeys, nodeCount: info.nodeCount, edgeCount: info.edgeCount, pendingCount: info.pendingCount };
  }

  listGraphCases(): GraphCaseInfo[] {
    return this.db.cases.map((c) => this.caseInfo(c)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getGraph(caseId: string): CaseGraph | null {
    const row = this.db.cases.find((c) => c.id === caseId);
    if (!row) return null;
    const nodes: GraphNode[] = this.db.nodes.filter((n) => n.caseId === caseId).sort((a, b) => a.createdAt - b.createdAt)
      .map((n) => ({ key: n.key, type: n.type, label: n.label, value: n.value, status: n.status, confidence: n.confidence, notes: n.notes, source: n.source, image: n.image ?? null }));
    const edges: GraphEdge[] = this.db.edges.filter((e) => e.caseId === caseId).sort((a, b) => a.createdAt - b.createdAt)
      .map((e) => ({ source: e.source, target: e.target, label: e.label, confidence: e.confidence }));
    return { case: this.caseInfo(row), nodes, edges };
  }

  getGraphByName(name: string): CaseGraph | null {
    const row = this.db.cases.find((c) => c.name === name.trim());
    return row ? this.getGraph(row.id) : null;
  }

  deleteGraphCase(caseId: string): boolean {
    const before = this.db.cases.length;
    this.db.cases = this.db.cases.filter((c) => c.id !== caseId);
    this.db.nodes = this.db.nodes.filter((n) => n.caseId !== caseId);
    this.db.edges = this.db.edges.filter((e) => e.caseId !== caseId);
    if (this.db.cases.length !== before) { this.persist(); return true; }
    return false;
  }
}

export const store = new Store();
