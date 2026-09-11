import { create } from "zustand";
import type {
  AetherSettings, AuthStatus, Conversation, Message, ToolActivity,
  GraphCaseInfo, CaseGraph, OutboundImage, ModuleConfig, ModuleTestResult, ProviderStatus, Provider, UpdateStatus,
  ToolStatus, InstallProgress, PermissionRequest,
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
  /** A line handed to the composer from elsewhere (an empty-state suggestion).
   *  The composer takes it and clears it — it is a hand-off slot, not a mirror
   *  of what is typed. */
  draft: string;

  cases: GraphCaseInfo[];
  activeCaseId: string | null;
  graph: CaseGraph | null;

  modules: ModuleConfig[];
  providerStatus: ProviderStatus | null;
  updateStatus: UpdateStatus | null;

  /** Command-line tools the bundled modules wrap. */
  tools: ToolStatus[];
  /** Rolling installer output, newest last. Capped — this is a progress view,
   *  not a log file. */
  installLog: string[];
  /** True while an "install all" run is walking the catalog. */
  installingAll: boolean;

  /** Decisions Aether is waiting on. A queue, not a single slot — a turn can
   *  reach two gated calls before either is answered. */
  permissions: PermissionRequest[];

  init(): Promise<void>;
  setView(v: View): void;
  dismissAuthGate(): void;
  refreshAuth(): Promise<void>;
  saveSettings(patch: Partial<AetherSettings>): Promise<void>;

  /** `force` skips the two-second reuse window — for an explicit Re-scan. */
  refreshProviderStatus(force?: boolean): Promise<void>;
  setProviderKey(provider: Provider, key: string): Promise<void>;

  refreshUpdateStatus(): Promise<void>;
  checkForUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  setUpdateStatus(s: UpdateStatus): void;

  pushPermission(req: PermissionRequest): void;
  answerPermission(id: string, decision: "allow" | "deny", remember?: boolean): void;

  refreshTools(): Promise<void>;
  installTool(moduleId: string): Promise<void>;
  installAllTools(): Promise<void>;
  cancelInstall(moduleId?: string): Promise<void>;
  handleInstallProgress(p: InstallProgress): void;

  refreshModules(): Promise<void>;
  saveModule(mod: ModuleConfig): Promise<void>;
  deleteModule(id: string): Promise<void>;
  toggleModule(id: string, enabled: boolean): Promise<void>;
  testModule(mod: ModuleConfig, sample: string): Promise<ModuleTestResult>;

  refreshConversations(): Promise<void>;
  reloadActiveMessages(): Promise<void>;
  newConversation(): void;
  selectConversation(id: string): Promise<void>;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  send(text: string, images: OutboundImage[]): Promise<void>;
  setDraft(text: string): void;
  cancel(): Promise<void>;
  handleChatEvent(env: ChatEventEnvelope): void;

  refreshCases(): Promise<void>;
  selectCase(id: string): Promise<void>;
  refreshActiveGraph(): Promise<void>;
  deleteCase(id: string): Promise<void>;
}

const A = window.aether;

/** Provider-status dedup: the promise in flight, when the last one landed, and
 *  a generation that is bumped whenever the settings a listing depends on
 *  change — a result that started under the old provider or URL is discarded
 *  rather than shown as the new one's. */
let statusInflight: Promise<void> | null = null;
let statusAt = 0;
let statusGen = 0;

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
  draft: "",
  cases: [],
  activeCaseId: null,
  graph: null,
  modules: [],
  tools: [],
  installLog: [],
  installingAll: false,
  permissions: [],
  providerStatus: null,
  updateStatus: null,

  async init() {
    const [settings, auth, conversations, cases, modules] = await Promise.all([
      A.getSettings(), A.authStatus(), A.listConversations(), A.listGraphCases(), A.listModules(),
    ]);
    set({ settings, auth, conversations, cases, modules });
    void get().refreshProviderStatus();
    void get().refreshUpdateStatus();
    // Probing PATH for two dozen binaries takes a moment; never block the boot.
    void get().refreshTools();
  },

  setView(v) { set({ view: v }); },
  dismissAuthGate() { set({ dismissedAuthGate: true }); },
  async refreshAuth() { set({ auth: await A.authStatus() }); },
  async saveSettings(patch) {
    set({ settings: await A.setSettings(patch) });
    // A provider, endpoint or model change invalidates the listing and the
    // selection warning: anything in flight now describes the old settings,
    // so it is abandoned and the next refresh starts fresh.
    if ("provider" in patch || "ollamaBaseUrl" in patch || "openaiBaseUrl" in patch || "ollamaModel" in patch || "openaiModel" in patch || "geminiModel" in patch) {
      statusAt = 0;
      statusGen++;
      statusInflight = null;
      if ("provider" in patch || "ollamaModel" in patch) void get().refreshProviderStatus();
    }
  },

  async refreshProviderStatus(force = false) {
    // The composer asks on every picker open (focus and mousedown both fire),
    // and a listing is a round of network calls — so one in flight is shared,
    // and a result younger than two seconds is reused.
    const now = Date.now();
    if (statusInflight) return statusInflight;
    if (!force && now - statusAt < 2000 && get().providerStatus) return;
    const gen = statusGen;
    let p: Promise<void> | null = null;
    p = (async () => {
      try {
        const st = await A.providerStatus();
        if (gen !== statusGen) return; // superseded while listing
        set({ providerStatus: st });
        statusAt = Date.now();
      } finally {
        if (statusInflight === p) statusInflight = null;
      }
    })();
    statusInflight = p;
    return p;
  },
  async setProviderKey(provider, key) { set({ providerStatus: await A.setProviderKey(provider, key) }); },

  async refreshUpdateStatus() { set({ updateStatus: await A.updateStatusGet() }); },
  async checkForUpdate() { set({ updateStatus: await A.checkForUpdate() }); },
  async installUpdate() { await A.installUpdate(); },
  setUpdateStatus(s) { set({ updateStatus: s }); },

  pushPermission(req) { set({ permissions: [...get().permissions, req] }); },

  answerPermission(id, decision, remember) {
    A.answerPermission({ id, decision, remember });
    set({ permissions: get().permissions.filter((p) => p.id !== id) });
  },

  async refreshTools() { set({ tools: await A.toolStatuses() }); },

  async installTool(moduleId) {
    // Optimistic: the first progress event confirms it, and a failure overwrites
    // it — but the row must react on click, not two seconds later.
    set({ tools: get().tools.map((t) => (t.moduleId === moduleId ? { ...t, state: "installing" } : t)) });
    await A.installTool(moduleId);
    void get().refreshTools();
  },

  async installAllTools() {
    set({ installingAll: true, installLog: [] });
    try { await A.installAllTools(); }
    finally { set({ installingAll: false }); void get().refreshTools(); }
  },

  async cancelInstall(moduleId) {
    await A.cancelInstall(moduleId);
    set({ installingAll: false });
    void get().refreshTools();
  },

  handleInstallProgress(p) {
    const s = get();
    if (p.summary) { set({ installingAll: false }); return; }
    const tools = p.moduleId
      ? s.tools.map((t) => (t.moduleId === p.moduleId ? { ...t, state: p.state, error: p.error ?? t.error } : t))
      : s.tools;
    const log = p.line ? [...s.installLog, p.line].slice(-200) : s.installLog;
    set({ tools, installLog: log });
  },

  async refreshModules() { set({ modules: await A.listModules() }); },
  async saveModule(mod) { set({ modules: await A.saveModule(mod) }); },
  async deleteModule(id) { set({ modules: await A.deleteModule(id) }); },
  async toggleModule(id, enabled) { set({ modules: await A.toggleModule(id, enabled) }); },
  testModule(mod, sample) { return A.testModule(mod, sample); },

  setDraft(text) { set({ draft: text }); },

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
          // Keep the evidence log on the finished turn. Main persists the same
          // records, so the reload that follows returns an identical message.
          tools: s.tools,
        };
        set({ messages: [...get().messages, final], stream: null });
        void get().refreshConversations();
        void get().refreshCases();
        break;
      }
      case "error": {
        // Freeze whatever the turn produced into a visible message instead of
        // dropping it. Nulling the stream threw away every completed tool row
        // and any partial prose — while the banner told the user the case had
        // kept what was written. Nothing is persisted by main on a failed turn,
        // so this record lives for the session only, which is the truth.
        const partial = s.text.trim();
        const salvage: Message[] = (partial || s.tools.length > 0)
          ? [{
              id: "failed-" + turnId, conversationId: s.conversationId, role: "assistant",
              content: partial, createdAt: Date.now(), costUsd: null, attachments: [],
              tools: s.tools,
            }]
          : [];
        set({ stream: null, turnError: event.message, messages: [...get().messages, ...salvage] });
        break;
      }
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
