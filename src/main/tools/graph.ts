import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { store } from "../store";
import type { ToolContext } from "./context";
import { text } from "./context";
import { faviconFor, thumbFromUrl, thumbFromPath } from "../nodeImages";
import { NODE_TYPES, NODE_STATUSES } from "../../shared/types";

/** Node kinds whose picture is the site's own favicon. */
const FAVICON_TYPES = new Set(["account", "domain", "host", "service"]);

function hostFrom(...cands: (string | null | undefined)[]): string | null {
  for (const c of cands) {
    const m = c?.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
    if (m) return m[0];
  }
  return null;
}

/**
 * Best-effort, fire-and-forget: give the just-written nodes a picture the
 * renderer can actually show (a `data:` URL — remote images are CSP-blocked
 * there). A remote image the agent supplied is inlined; a local workspace path
 * is thumbnailed; an account/domain/host/service with no image gets its favicon.
 * Patches node.image and re-notifies so pics pop in as they resolve. Never throws.
 */
async function resolveNodeImages(caseName: string, keys: string[], ctx: ToolContext): Promise<void> {
  const graph = store.getGraphByName(caseName);
  if (!graph) return;
  const want = new Set(keys.map((k) => k.trim()).filter(Boolean));
  let changed = false;
  for (const n of graph.nodes) {
    if (!want.has(n.key)) continue;
    const img = n.image;
    let dataUrl: string | null = null;
    try {
      if (img && /^https?:\/\//i.test(img)) dataUrl = await thumbFromUrl(img, FAVICON_TYPES.has(n.type) ? 64 : 96);
      else if (img && !img.startsWith("data:") && (img.startsWith("/") || /^[a-z]:[\\/]/i.test(img))) dataUrl = thumbFromPath(img);
      else if (!img && FAVICON_TYPES.has(n.type)) { const h = hostFrom(n.value, n.key); if (h) dataUrl = await faviconFor(h); }
    } catch { dataUrl = null; }
    if (dataUrl && dataUrl !== n.image) {
      store.upsertGraph(caseName, [{ key: n.key, type: n.type, image: dataUrl }], []);
      changed = true;
    }
  }
  if (changed) ctx.notifyGraphChanged(caseName);
}

const TYPE_LIST = NODE_TYPES.join(", ");
const STATUS_LIST = NODE_STATUSES.join(", ");

const nodeSchema = z.object({
  key: z.string().min(1).max(200).describe(
    "Stable identifier for this node, and what edges reference. Use the selector itself, lowercased — the email, the phone, the username, the host. Re-sending the same key enriches that node instead of duplicating it.",
  ),
  type: z.string().min(1).max(40).describe(`What kind of node this is. One of: ${TYPE_LIST}. The graph colours nodes off these exact strings — use 'note' for anything that doesn't fit.`),
  label: z.string().max(200).optional().describe("Short display text. Defaults to the key."),
  value: z.string().max(2000).optional().describe("The full value when the key abbreviates it (e.g. a full URL)."),
  status: z.enum(NODE_STATUSES).optional().describe(
    "pending = discovered, not yet worked (the frontier). searched = run, nothing yet. confirmed = tied to the target by a linking selector. candidate = plausible but not yet linked. dead = affirmatively excluded. Defaults to pending.",
  ),
  confidence: z.enum(["high", "medium", "low"]).optional().describe("How sure you are of this node."),
  notes: z.string().max(3000).optional().describe("A line or two of what this node is and what it produced."),
  source: z.string().max(600).optional().describe("Provenance: the breach/file name, the URL, or the platform and flow it came from."),
  image: z.string().max(200000).optional().describe(
    "Optional picture for this node, shown inside the node on the graph and enlarged in its detail panel. " +
    "Give the https URL of a real image you actually found — a profile avatar, an og:image, a logo — or the " +
    "local path of a workspace file (e.g. a photo you read for EXIF); Aether inlines and thumbnails it for you. " +
    "You do NOT need to set this for account/domain/host/service nodes — their favicon is fetched automatically " +
    "from the site's own origin. Don't guess or fabricate an image URL.",
  ),
});

const edgeSchema = z.object({
  source: z.string().min(1).max(200).describe("The key of the node the link starts at."),
  target: z.string().min(1).max(200).describe("The key of the node the link ends at."),
  label: z.string().max(160).optional().describe("The relation, e.g. 'registered with', 'same breach', 'reverse-image match'."),
  confidence: z.enum(["high", "medium", "low"]).optional().describe("How sure you are of the link."),
});

export function graphTools(ctx: ToolContext) {
  const graphUpsert = tool(
    "graph_upsert",
    [
      "Write the case's knowledge graph — the node/edge map of the target and everything linked to",
      "them. THIS GRAPH IS YOUR PRIMARY WORKSPACE, not end-of-case bookkeeping. Open the case with it",
      "the instant work starts (at least the target node), and call it AGAIN every single time a",
      "selector is discovered, confirmed, ruled out, or changes status — the operator watches this",
      "graph live, so write the node the moment it surfaces, before you go search it.",
      "",
      "Upserts are idempotent and keyed on (caseName, node key), so calling it constantly is correct",
      "and cheap. Send only what changed: a node re-sent with new fields is enriched, an omitted field",
      "keeps its earlier value. Flipping pending → confirmed/dead is a one-node call. Use one caseName",
      "for the whole investigation — the target's name is the natural choice.",
      "",
      `node.type vocabulary: ${TYPE_LIST}.`,
      `node.status vocabulary: ${STATUS_LIST}.`,
      "'pending' marks the frontier — a case is exhausted only when no node is still pending, so keep",
      "statuses honest. Edges reference node keys; an edge to an undeclared key gets a stub node so the",
      "link still renders (give that key a real type on a later call).",
    ].join("\n"),
    {
      caseName: z.string().min(1).max(120).describe("The case this graph belongs to — usually the target's name. Reuse it for the whole investigation."),
      nodes: z.array(nodeSchema).max(200).optional().describe("Nodes to create or enrich (max 200 per call)."),
      edges: z.array(edgeSchema).max(200).optional().describe("Links between node keys (max 200 per call)."),
    },
    async ({ caseName, nodes, edges }) => {
      const r = store.upsertGraph(caseName, nodes ?? [], edges ?? []);
      ctx.notifyGraphChanged(r.name);
      // Give the new nodes pictures the renderer can show (favicons / inlined
      // remote images / local thumbs). Fire-and-forget — the graph renders now,
      // pics pop in as they resolve.
      if (nodes?.length) void resolveNodeImages(r.name, nodes.map((n) => n.key), ctx).catch(() => {});
      const parts = [
        `Graph "${r.name}": wrote ${r.nodesWritten} node(s), ${r.edgesWritten} new edge(s).`,
        `Case now holds ${r.nodeCount} nodes and ${r.edgeCount} edges.`,
      ];
      if (r.stubbedKeys.length) parts.push(`Stubbed missing edge endpoints (give them a real type): ${r.stubbedKeys.join(", ")}.`);
      parts.push(r.pendingCount > 0
        ? `${r.pendingCount} node(s) still pending — the frontier is not empty, keep working.`
        : "No pending nodes left — the frontier is empty.");
      return text(parts.join(" "));
    },
  );

  const graphGet = tool(
    "graph_get",
    [
      "Read back the current knowledge graph for a case as JSON — every node with its type, status,",
      "value, notes and provenance, plus every edge and the keys still pending.",
      "",
      "Call this whenever you RESUME a case, before anything else, so you don't re-run selectors you",
      "already worked. Call it before you report exhaustion — the case is finished only when no node is",
      "'pending', and this is how you verify that rather than guessing.",
    ].join("\n"),
    { caseName: z.string().min(1).max(120).describe("The case name used with graph_upsert.") },
    async ({ caseName }) => {
      const graph = store.getGraphByName(caseName);
      if (!graph) {
        const known = store.listGraphCases().map((c) => c.name);
        return text(known.length
          ? `No graph named "${caseName}". Existing cases: ${known.join(", ")}. Open a new one with graph_upsert.`
          : `No graph named "${caseName}", and no cases exist yet. Open one with graph_upsert.`);
      }
      const pendingKeys = graph.nodes.filter((n) => n.status === "pending").map((n) => n.key);
      return text(JSON.stringify({ ...graph, pendingKeys }));
    },
  );

  return [graphUpsert, graphGet];
}
