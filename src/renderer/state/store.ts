import { create } from "zustand";
import type {
  AetherSettings, AuthStatus, Conversation, Message, ToolActivity,
  GraphCaseInfo, CaseGraph, OutboundImage, ModuleConfig,
} from "../../shared/types";
import type { ChatEventEnvelope } from "../../shared/ipc";

export type View = "chat" | "graph" | "settings";

export interface StreamState {
  turnId: string;
  conversationId: string;
  text: string;
  thinking: string;
  tools: ToolActivity[];
  error: string | null;
}

interface Store {
  view: View;
  settings: AetherSettings | null;
  auth: AuthStatus | null;
  dismissedAuthGate: boolean;

  conversations: Conversation[];
  activeId: string | null;
  messages: Message[];
  stream: StreamState | null;
  turnError: string | null;

  cases: GraphCaseInfo[];
  activeCaseId: string | null;
  graph: CaseGraph | null;

  modules: ModuleConfig[];

  init(): Promise<void>;
  setView(v: View): void;
  dismissAuthGate(): void;
  refreshAuth(): Promise<void>;
  saveSettings(patch: Partial<AetherSettings>): Promise<void>;

  refreshModules(): Promise<void>;
  saveModule(mod: ModuleConfig): Promise<void>;
  deleteModule(id: string): Promise<void>;
  toggleModule(id: string, enabled: boolean): Promise<void>;

  refreshConversations(): Promise<void>;
  reloadActiveMessages(): Promise<void>;
  newConversation(): void;
  selectConversation(id: string): Promise<void>;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  send(text: string, images: OutboundImage[]): Promise<void>;
  cancel(): Promise<void>;
  handleChatEvent(env: ChatEventEnvelope): void;

  refreshCases(): Promise<void>;
  selectCase(id: string): Promise<void>;
  refreshActiveGraph(): Promise<void>;
  deleteCase(id: string): Promise<void>;
}

const A = window.aether;

export const useStore = create<Store>((set, get) => ({
  view: "chat",
  settings: null,
  auth: null,
  dismissedAuthGate: false,
  conversations: [],
  activeId: null,
  messages: [],
  stream: null,
  turnError: null,
  cases: [],
  activeCaseId: null,
  graph: null,
  modules: [],

  async init() {
    const [settings, auth, conversations, cases, modules] = await Promise.all([
      A.getSettings(), A.authStatus(), A.listConversations(), A.listGraphCases(), A.listModules(),
    ]);
    set({ settings, auth, conversations, cases, modules });
  },

  setView(v) { set({ view: v }); },
  dismissAuthGate() { set({ dismissedAuthGate: true }); },
  async refreshAuth() { set({ auth: await A.authStatus() }); },
  async saveSettings(patch) { set({ settings: await A.setSettings(patch) }); },

  async refreshModules() { set({ modules: await A.listModules() }); },
  async saveModule(mod) { set({ modules: await A.saveModule(mod) }); },
  async deleteModule(id) { set({ modules: await A.deleteModule(id) }); },
  async toggleModule(id, enabled) { set({ modules: await A.toggleModule(id, enabled) }); },

  async refreshConversations() { set({ conversations: await A.listConversations() }); },

  async reloadActiveMessages() {
    const { activeId, stream } = get();
    if (!activeId || stream) return; // never disturb an in-flight stream
    const d = await A.getConversation(activeId);
    if (d && get().activeId === activeId && !get().stream) set({ messages: d.messages });
  },

  newConversation() { set({ activeId: null, messages: [], stream: null, turnError: null, view: "chat" }); },

  async selectConversation(id) {
    set({ activeId: id, view: "chat", turnError: null, stream: get().stream?.conversationId === id ? get().stream : null });
    const detail = await A.getConversation(id);
    if (detail && get().activeId === id) set({ messages: detail.messages });
  },

  async renameConversation(id, title) { await A.renameConversation(id, title); await get().refreshConversations(); },

  async deleteConversation(id) {
    await A.deleteConversation(id);
    const wasActive = get().activeId === id;
    await get().refreshConversations();
    if (wasActive) get().newConversation();
  },

  async send(text, images) {
    if (get().stream) return; // one turn at a time in this window
    const turnId = crypto.randomUUID();
    const activeId = get().activeId;
    // Optimistic user bubble.
    const optimistic: Message = {
      id: "tmp-" + turnId, conversationId: activeId ?? "", role: "user",
      content: text, createdAt: Date.now(), costUsd: null,
      attachments: images.map((im, i) => ({ id: "tmp-a" + i, name: im.name, mimeType: im.mimeType })),
    };
    set({ messages: [...get().messages, optimistic], stream: { turnId, conversationId: activeId ?? "", text: "", thinking: "", tools: [], error: null }, turnError: null, view: "chat" });
    try {
      const { conversationId } = await A.sendChat({ turnId, message: text, conversationId: activeId, images });
      // Adopt the real conversation id (first turn creates it).
      if (!activeId) {
        set((s) => ({ activeId: conversationId, stream: s.stream ? { ...s.stream, conversationId } : null }));
        await get().refreshConversations();
      }
    } catch (e) {
      set({ stream: null, turnError: e instanceof Error ? e.message : String(e) });
    }
  },

  async cancel() {
    const s = get().stream;
    if (s) await A.cancelChat(s.turnId);
  },

  handleChatEvent({ turnId, event }) {
    const s = get().stream;
    if (!s || s.turnId !== turnId) return;
    switch (event.type) {
      case "delta": set({ stream: { ...s, text: s.text + event.text } }); break;
      case "thinking": set({ stream: { ...s, thinking: s.thinking + event.text } }); break;
      case "tool_start": set({ stream: { ...s, tools: [...s.tools, event.tool] } }); break;
      case "tool_end":
        set({ stream: { ...s, tools: s.tools.map((t) => t.id === event.id ? { ...t, status: event.status, detail: event.detail, endedAt: Date.now() } : t) } });
        break;
      case "graph_touched":
        // Keep the graph view fresh if it's showing this case.
        if (get().activeCaseId) void get().refreshActiveGraph();
        void get().refreshCases();
        break;
      case "done": {
        const final: Message = {
          id: "final-" + turnId, conversationId: s.conversationId, role: "assistant",
          content: event.text, createdAt: Date.now(), costUsd: event.costUsd, attachments: [],
        };
        set({ messages: [...get().messages, final], stream: null });
        void get().refreshConversations();
        void get().refreshCases();
        break;
      }
      case "error": set({ stream: null, turnError: event.message }); break;
    }
  },

  async refreshCases() { set({ cases: await A.listGraphCases() }); },

  async selectCase(id) {
    set({ activeCaseId: id, view: "graph" });
    const graph = await A.getGraph(id);
    if (get().activeCaseId === id) set({ graph });
  },

  async refreshActiveGraph() {
    const id = get().activeCaseId;
    if (!id) return;
    const graph = await A.getGraph(id);
    if (get().activeCaseId === id) set({ graph });
  },

  async deleteCase(id) {
    await A.deleteGraph(id);
    const wasActive = get().activeCaseId === id;
    await get().refreshCases();
    if (wasActive) set({ activeCaseId: null, graph: null });
  },
}));
