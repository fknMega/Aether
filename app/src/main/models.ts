// ─────────────────────────────────────────────────────────────────────────────
// Asking a provider what it can run.
//
// Ollama tells us everything: which models are pulled (/api/tags), which are
// loaded right now (/api/ps), and per model whether it does tool calling or
// thinking and how much context it was built for (/api/show). An OpenAI-
// compatible endpoint tells us ids and little else (GET /models). Claude and
// Gemini are static tables in shared/models.ts. Whatever the source, the
// renderer gets one shape — ModelInfo — and one picker draws all four.
//
// Everything here is best-effort and bounded: short timeouts, a cap on how
// many models are inspected, and an empty list (never a throw) when the
// server is down. A model picker must not be the thing that hangs the app.
// ─────────────────────────────────────────────────────────────────────────────
import type { ModelInfo } from "../shared/types";

/** How long any one discovery request may take. Ollama is local; a gateway
 *  listing is one small GET. Anything slower is treated as unreachable. */
const TIMEOUT_MS = 5000;
/** /api/show is one request per model; a machine with sixty pulled models
 *  should not fan out sixty requests every time a picker opens. */
const MAX_INSPECT = 32;

/** The Ollama server root from whatever the settings hold — the OpenAI-compat
 *  base (`…/v1`) or the bare origin. */
export function ollamaRoot(baseUrl: string): string {
  return (baseUrl || "http://localhost:11434/v1").trim().replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

interface OllamaTag { name?: string; model?: string; size?: number; details?: { parameter_size?: string; family?: string } }
interface OllamaPs { name?: string; model?: string; context_length?: number; size_vram?: number; expires_at?: string }
interface OllamaShow {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
  /** The Modelfile's parameters as text, one per line: `num_ctx  65536`. */
  parameters?: string;
}

/** One model's capabilities and sizing from /api/show, folded with what /api/ps
 *  says about it if it is loaded. Never throws; a model the server cannot
 *  describe comes back with only its id. */
async function inspect(root: string, id: string, size: number | undefined, live: OllamaPs | undefined): Promise<ModelInfo> {
  const show = await getJson<OllamaShow>(`${root}/api/show`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: id }),
  });
  const caps = show?.capabilities;
  const info: ModelInfo = { id, ...(size ? { sizeBytes: size } : {}), running: !!live };
  if (Array.isArray(caps)) {
    info.tools = caps.includes("tools");
    info.thinking = caps.includes("thinking");
    info.vision = caps.includes("vision");
  }
  // model_info keys are namespaced by architecture: `llama.context_length`,
  // `gemma4.context_length`, … — take whichever one is present.
  for (const [k, v] of Object.entries(show?.model_info ?? {})) {
    if (k.endsWith(".context_length") && typeof v === "number") { info.contextLength = v; break; }
  }
  const baked = Number(show?.parameters?.match(/^num_ctx\s+(\d+)/m)?.[1]);
  if (Number.isFinite(baked) && baked > 0) info.bakedNumCtx = baked;
  if (typeof live?.context_length === "number") info.numCtx = live.context_length;
  else if (info.bakedNumCtx) info.numCtx = info.bakedNumCtx;
  return info;
}

/** The chosen model alone — what a turn needs to size its request. Resolves
 *  `name` against `name:latest`. Undefined when the server is unreachable or
 *  the model is not pulled (the turn itself will then say so). */
export async function ollamaModelInfo(baseUrl: string, model: string): Promise<ModelInfo | undefined> {
  const root = ollamaRoot(baseUrl);
  const ps = await getJson<{ models?: OllamaPs[] }>(`${root}/api/ps`);
  if (!ps) return undefined;
  const live = (ps.models ?? []).find((m) => m.name === model || m.model === model || m.name === `${model}:latest`);
  const info = await inspect(root, model, undefined, live);
  // `tools` is only set when /api/show answered; without it there is nothing
  // to size by, and the caller's defaults are better than a half-empty record.
  return info.tools === undefined && !info.contextLength ? undefined : info;
}

/** Everything a local Ollama can run, richest first: loaded models, then
 *  tool-capable ones, then the rest, each alphabetical. */
export async function ollamaModels(baseUrl: string): Promise<{ reachable: boolean; models: ModelInfo[] }> {
  const root = ollamaRoot(baseUrl);
  const tags = await getJson<{ models?: OllamaTag[] }>(`${root}/api/tags`);
  if (!tags) return { reachable: false, models: [] };
  const pulled = (tags.models ?? []).map((m) => ({ id: m.name || m.model || "", size: m.size })).filter((m) => m.id);

  const ps = await getJson<{ models?: OllamaPs[] }>(`${root}/api/ps`);
  const loaded = new Map<string, OllamaPs>();
  for (const m of ps?.models ?? []) { const k = m.name || m.model; if (k) loaded.set(k, m); }

  const inspected = await Promise.all(pulled.slice(0, MAX_INSPECT).map(({ id, size }) => inspect(root, id, size, loaded.get(id))));
  // Anything past the inspection cap is still listed, just without detail.
  for (const { id, size } of pulled.slice(MAX_INSPECT)) inspected.push({ id, sizeBytes: size, running: loaded.has(id) });

  const rank = (m: ModelInfo) => (m.running ? 0 : m.tools ? 1 : m.tools === false ? 3 : 2);
  inspected.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  return { reachable: true, models: inspected };
}

/** `llama3.1` and `llama3.1:latest` are the same model to Ollama, but only one
 *  of them appears in the listing. Map a stored name onto the listed one so the
 *  picker highlights it rather than offering it twice. */
export function resolveOllamaModel(selected: string, models: ModelInfo[]): string {
  if (!selected) return selected;
  if (models.some((m) => m.id === selected)) return selected;
  const tagged = `${selected}:latest`;
  if (models.some((m) => m.id === tagged)) return tagged;
  if (selected.endsWith(":latest")) {
    const bare = selected.slice(0, -":latest".length);
    if (models.some((m) => m.id === bare)) return bare;
  }
  return selected;
}

/** Roughly what the brief plus the tool schemas cost before the operator has
 *  typed a word. A model that cannot hold this cannot see its own tools. */
const MIN_USEFUL_CTX = 12_000;

/** One sentence about the selected local model that the operator should hear
 *  before the next turn, or nothing. A model merely LOADED too small is not
 *  warned about — the native runner asks for a larger context and Ollama
 *  reloads it; only a model whose architecture cannot hold the brief is. */
export function ollamaWarning(selected: string, models: ModelInfo[]): string | undefined {
  if (!models.length) return undefined;
  const id = resolveOllamaModel(selected, models);
  const m = models.find((x) => x.id === id);
  if (!m) return `${selected} is not pulled on this Ollama. Run \`ollama pull ${selected}\`, or pick one of the models it has.`;
  if (m.tools === false) return `${m.id} does not advertise tool calling, so Aether can chat but cannot search or write the graph. Pick a tool-capable model.`;
  if (m.contextLength && m.contextLength < MIN_USEFUL_CTX) {
    return `${m.id} only supports ${m.contextLength.toLocaleString()} tokens of context, too small for Aether's brief and tools. Pick a model with a larger context window.`;
  }
  return undefined;
}

// ── OpenAI-compatible ───────────────────────────────────────────────────────

/** Ids that are plainly not chat models, on any endpoint. Deliberately narrow:
 *  a local gateway's chat models are called things like `qwen2.5-7b-instruct`,
 *  so nothing that a gateway might legitimately serve as chat is in here. */
const NOT_CHAT = /(embed|whisper|tts|dall-e|moderation|realtime|transcri|image|audio|-search-|computer-use|codex-mini|sora|deep-research)/i;
/** OpenAI's own catalogue: an allow-list of chat prefixes, minus the legacy
 *  completions-era ids it still lists under them and the o-series "pro"
 *  models, which cannot stream and so fail every turn here. */
const OPENAI_CHAT = /^(gpt-|o[1-9](-|$)|chatgpt-)/i;
const OPENAI_NOT_CHAT = /(-instruct|babbage|davinci|^text-|^o[1-9]-pro(-|$))/i;

/** What an OpenAI-compatible endpoint says it can serve, filtered to models a
 *  chat turn can use. `reachable:false` means the listing itself failed —
 *  distinct from an empty catalogue. */
export async function openAiModels(baseUrl: string, apiKey: string | undefined): Promise<{ reachable: boolean; models: ModelInfo[] }> {
  const base = (baseUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const j = await getJson<{ data?: Array<{ id?: string; created?: number; name?: string; context_length?: number }> }>(`${base}/models`, { headers });
  if (!j || !Array.isArray(j.data)) return { reachable: false, models: [] };
  const isOpenAi = /api\.openai\.com/i.test(base);
  const rows = j.data
    .filter((m): m is { id: string; created?: number; name?: string; context_length?: number } => typeof m.id === "string" && !!m.id)
    .filter((m) => !NOT_CHAT.test(m.id))
    .filter((m) => !isOpenAi || (OPENAI_CHAT.test(m.id) && !OPENAI_NOT_CHAT.test(m.id)))
    // OpenAI lists every dated snapshot next to its alias; the alias is the one
    // to offer, and the snapshot is still typeable by hand.
    .filter((m) => !isOpenAi || !/-\d{4}-\d{2}-\d{2}$/.test(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id));
  return {
    reachable: true,
    models: rows.map((m) => ({ id: m.id, ...(m.name && m.name !== m.id ? { label: m.name } : {}), ...(m.context_length ? { contextLength: m.context_length } : {}) })),
  };
}

// ── Gemini Developer API ────────────────────────────────────────────────────

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Model families on the Gemini API that are not chat models. */
const GEMINI_NOT_CHAT = /(embedding|-tts|-image|imagen|veo|-live|-audio|native-audio|aqa|learnlm|-robotics|-computer-use|deep-research)/i;

/** What the Gemini API will serve this key: every `gemini-*` model that
 *  supports generateContent, newest generation first. */
export async function geminiModels(apiKey: string | undefined): Promise<{ reachable: boolean; models: ModelInfo[] }> {
  if (!apiKey) return { reachable: false, models: [] };
  const j = await getJson<{ models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number }> }>(
    `${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey } },
  );
  if (!j || !Array.isArray(j.models)) return { reachable: false, models: [] };
  const version = (id: string) => Number(id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const rows = j.models
    .map((m) => ({ id: (m.name ?? "").replace(/^models\//, ""), label: m.displayName, methods: m.supportedGenerationMethods ?? [], ctx: m.inputTokenLimit }))
    .filter((m) => /^gemini-/.test(m.id) && !GEMINI_NOT_CHAT.test(m.id) && m.methods.includes("generateContent"))
    // The API lists dated snapshots and `-latest` aliases beside the plain id;
    // the plain id is the one to offer.
    .filter((m) => !/-\d{3,}$/.test(m.id) && !/-latest$/.test(m.id))
    .sort((a, b) => version(b.id) - version(a.id) || a.id.localeCompare(b.id));
  return {
    reachable: true,
    models: rows.map((m) => ({ id: m.id, ...(m.label ? { label: m.label } : {}), tools: true, ...(m.ctx ? { contextLength: m.ctx } : {}) })),
  };
}
