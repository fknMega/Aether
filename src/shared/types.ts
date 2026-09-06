// ─────────────────────────────────────────────────────────────────────────────
// Shared data model — the single source of truth for both the Electron main
// process and the React renderer. Nothing platform-specific lives here.
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "user" | "assistant";

export interface AttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: number;
  costUsd: number | null;
  attachments: AttachmentMeta[];
  /** The tool calls this turn made, kept with the message. The transcript
   *  numbers them (`02.1`, `02.2`) so a finding can be cited later — which only
   *  works if the log survives the turn that produced it. Absent on older
   *  messages written before the field existed. */
  tools?: ToolActivity[];
}

export interface Conversation {
  id: string;
  title: string;
  claudeSessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

// ── Case graph ───────────────────────────────────────────────────────────────

/** Selector kinds the graph colours by. `note` is the catch-all. */
export const NODE_TYPES = [
  "target", "person", "name", "email", "phone", "username", "photo",
  "account", "employer", "address", "location", "breach", "document",
  "domain", "host", "service", "note",
] as const;
export type NodeType = (typeof NODE_TYPES)[number] | (string & {});

/** Where a node stands. The graph rings nodes by this. */
export const NODE_STATUSES = ["pending", "searched", "confirmed", "candidate", "dead"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export type Confidence = "high" | "medium" | "low";

export interface GraphNode {
  key: string;
  type: NodeType;
  label: string;
  value: string | null;
  status: NodeStatus | string;
  confidence: Confidence | string | null;
  notes: string | null;
  source: string | null;
  /** Optional thumbnail/portrait for this node — a data: URL (local photo, cached
   *  favicon/avatar) or a remote image URL. Rendered inside the node on the canvas
   *  and enlarged in the detail panel. */
  image: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string | null;
  confidence: Confidence | string | null;
}

export interface GraphCaseInfo {
  id: string;
  name: string;
  nodeCount: number;
  edgeCount: number;
  pendingCount: number;
  updatedAt: number;
}

export interface CaseGraph {
  case: GraphCaseInfo;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Agent streaming events (main -> renderer, per turn) ──────────────────────

/** A single tool invocation, tracked start→finish so the UI can animate it. */
export interface ToolActivity {
  id: string;
  name: string;
  /** Friendly one-liner describing the call, e.g. `username_search "janedoe"`. */
  title: string;
  status: "running" | "ok" | "error";
  detail?: string;
  startedAt: number;
  endedAt?: number;
}

export type AgentEvent =
  | { type: "start"; turnId: string; conversationId: string }
  | { type: "session"; claudeSessionId: string }
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; tool: ToolActivity }
  | { type: "tool_end"; id: string; status: "ok" | "error"; detail?: string }
  | { type: "graph_touched"; caseName: string }
  | { type: "done"; text: string; costUsd: number | null }
  | { type: "error"; message: string };

// ── Settings ─────────────────────────────────────────────────────────────────

/** Which brain runs the turn. `claude` uses the Agent SDK; `openai` and `ollama`
 *  both speak the OpenAI-compatible /chat/completions API with tool calling;
 *  `gemini` signs in with a Google account (OAuth) and talks to Google's Code
 *  Assist API in Gemini's native content format. */
export type Provider = "claude" | "openai" | "ollama" | "gemini";

export interface AetherSettings {
  ownerName: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  personaVoice: "flirty" | "professional";
  autonomy: boolean;

  provider: Provider;
  /** OpenAI-compatible endpoint + model (ChatGPT, or any compatible gateway). */
  openaiBaseUrl: string;
  openaiModel: string;
  /** Local Ollama endpoint + model. */
  ollamaBaseUrl: string;
  ollamaModel: string;
  /** Gemini model used over the Google Code Assist API (OAuth sign-in). */
  geminiModel: string;

  /** Check for app updates on launch. */
  autoUpdate: boolean;

  /** Which palette the app paints in. `system` follows the OS appearance. */
  theme: ThemePref;
}

/** The three states of the appearance control. */
export type ThemePref = "system" | "light" | "dark";

/** Live state of the auto-updater, surfaced in Settings. */
export interface UpdateStatus {
  state: "disabled" | "idle" | "checking" | "not-available" | "available" | "downloading" | "downloaded" | "error";
  currentVersion: string;
  newVersion?: string;
  percent?: number;
  message?: string;
}

/** Whether a provider is ready to run (key present / endpoint reachable). */
export interface ProviderStatus {
  provider: Provider;
  /** True when an API key is stored for this provider (value never leaves main). */
  hasKey: boolean;
  /** Models discovered from the provider, when it can be listed (Ollama). */
  models: string[];
  detail?: string;
}

export interface AuthStatus {
  loggedIn: boolean;
  authMethod: string | null;
  detail?: string;
}

// ── Modules ──────────────────────────────────────────────────────────────────
// A "module" is a capability Aether can reach for. Built-in modules map to the
// native tool groups (username search, recon, EXIF, reverse-image) and can be
// toggled. Custom modules are user-authored: a local COMMAND, or an HTTP API
// called with the user's own keys — each becomes a tool the agent can call.
// "connector" rows are read-only mirrors of loaded private code connectors.

export type ModuleKind = "builtin" | "command" | "http" | "connector";

/** A key/secret for a module. The renderer only ever learns whether a value is
 *  `set` — the plaintext lives (encrypted at rest) in the main process. On save
 *  the renderer sends `value`; a secret with `set:true` and no `value` is kept. */
export interface ModuleSecret {
  name: string;
  set: boolean;
  /** renderer → main only, on save; never sent back to the renderer. */
  value?: string;
  /** renderer → main only: explicitly clear a stored value. */
  clear?: boolean;
}

export interface ModuleHeader { name: string; value: string; }

export interface ModuleConfig {
  id: string;
  name: string;
  /** What this is and WHEN Aether should use it — becomes the tool description. */
  description: string;
  kind: ModuleKind;
  enabled: boolean;
  /** Built-in group or code connector: core fields are locked in the UI. */
  builtin: boolean;
  /** Shipped as a bundled default (editable + toggleable, but not deletable). */
  default?: boolean;
  /** Which native tool group a built-in maps to. */
  builtinKey?: "username" | "recon" | "exif" | "reverse_image";
  /** What Aether should pass as the free-form `input` argument. */
  inputLabel?: string;
  // command kind:
  command?: string;
  // http kind:
  method?: "GET" | "POST";
  url?: string;
  headers?: ModuleHeader[];
  body?: string;
  // both custom kinds:
  secrets?: ModuleSecret[];
}

// ── Chat request ─────────────────────────────────────────────────────────────

export interface OutboundImage {
  name: string;
  mimeType: string;
  /** base64, no data: prefix required (a stray one is tolerated). */
  data: string;
}

export interface ChatRequest {
  turnId: string;
  message: string;
  conversationId: string | null;
  images?: OutboundImage[];
}

/** What Aether will not read, whatever the autonomy setting says. Shared so the
 *  Settings pane states exactly what main/permissions.ts enforces, rather than
 *  the two drifting apart. */
export const SENSITIVE_SUMMARY = [
  "SSH, GPG, AWS, gcloud, Kubernetes and Docker credentials",
  "Browser profiles, cookie stores and saved logins",
  "Shell history and .env files",
  "Aether's own settings, module keys and sign-in tokens",
] as const;
