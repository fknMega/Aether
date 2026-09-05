// ─────────────────────────────────────────────────────────────────────────────
// IPC contract. Channel names live here so main and preload can't drift, and
// `AetherApi` is the exact surface exposed to the renderer as `window.aether`.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  AetherSettings, AuthStatus, ChatRequest, Conversation, Message,
  CaseGraph, GraphCaseInfo, AgentEvent, ModuleConfig, ProviderStatus, Provider, UpdateStatus,
} from "./types";

export const IPC = {
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  authStatus: "auth:status",
  authLogin: "auth:login",

  updateGet: "update:get",
  updateCheck: "update:check",
  updateInstall: "update:install",

  providerStatus: "provider:status",
  providerSetKey: "provider:setKey",
  providerLogin: "provider:login",
  providerLogout: "provider:logout",

  modulesList: "modules:list",
  moduleSave: "modules:save",
  moduleDelete: "modules:delete",
  moduleToggle: "modules:toggle",

  conversationsList: "conversations:list",
  conversationGet: "conversations:get",
  conversationRename: "conversation:rename",
  conversationDelete: "conversation:delete",
  attachmentGet: "attachment:get",

  graphCases: "graph:cases",
  graphGet: "graph:get",
  graphGetByName: "graph:getByName",
  graphDelete: "graph:delete",

  chatSend: "chat:send",
  chatCancel: "chat:cancel",

  // main -> renderer broadcasts
  chatEvent: "chat:event",
  graphChanged: "graph:changed",
  conversationsChanged: "conversations:changed",
  modulesChanged: "modules:changed",
  updateStatus: "update:status",
} as const;

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
}

export interface AttachmentPayload {
  mimeType: string;
  /** A ready-to-use `data:` URL for an <img src>. */
  dataUrl: string;
}

/** Wrapper the renderer receives for every streamed agent event. */
export interface ChatEventEnvelope {
  turnId: string;
  event: AgentEvent;
}

/** The typed bridge exposed on `window.aether`. */
export interface AetherApi {
  /** The host OS, so the renderer can adapt window chrome (win32/darwin/linux). */
  platform: string;

  getSettings(): Promise<AetherSettings>;
  setSettings(patch: Partial<AetherSettings>): Promise<AetherSettings>;

  authStatus(): Promise<AuthStatus>;
  authLogin(): Promise<{ ok: boolean; message: string }>;

  /** App auto-update. */
  updateStatusGet(): Promise<UpdateStatus>;
  checkForUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;

  /** Provider readiness: whether a key/sign-in is present, and any listable models. */
  providerStatus(): Promise<ProviderStatus>;
  /** Store (or clear, with "") an API key for a provider. Never read back. */
  setProviderKey(provider: Provider, key: string): Promise<ProviderStatus>;
  /** Start a browser OAuth sign-in for a provider (Gemini). Resolves when done. */
  providerLogin(provider: Provider): Promise<{ ok: boolean; message: string }>;
  /** Sign out of an OAuth provider (clears stored tokens). */
  providerLogout(provider: Provider): Promise<ProviderStatus>;

  /** Modules (secrets redacted — values never leave the main process). */
  listModules(): Promise<ModuleConfig[]>;
  saveModule(mod: ModuleConfig): Promise<ModuleConfig[]>;
  deleteModule(id: string): Promise<ModuleConfig[]>;
  toggleModule(id: string, enabled: boolean): Promise<ModuleConfig[]>;

  listConversations(): Promise<Conversation[]>;
  getConversation(id: string): Promise<ConversationDetail | null>;
  renameConversation(id: string, title: string): Promise<boolean>;
  deleteConversation(id: string): Promise<boolean>;
  getAttachment(id: string): Promise<AttachmentPayload | null>;

  listGraphCases(): Promise<GraphCaseInfo[]>;
  getGraph(caseId: string): Promise<CaseGraph | null>;
  getGraphByName(name: string): Promise<CaseGraph | null>;
  deleteGraph(caseId: string): Promise<boolean>;

  sendChat(req: ChatRequest): Promise<{ conversationId: string }>;
  cancelChat(turnId: string): Promise<void>;

  // subscriptions — each returns an unsubscribe fn
  onChatEvent(cb: (env: ChatEventEnvelope) => void): () => void;
  onGraphChanged(cb: (payload: { caseName: string }) => void): () => void;
  onConversationsChanged(cb: () => void): () => void;
  onModulesChanged(cb: () => void): () => void;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
}
