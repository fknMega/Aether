// ─────────────────────────────────────────────────────────────────────────────
// The model lists Aether knows about without asking anyone.
//
// Claude has no model-listing call on a claude.ai subscription, so its picker
// is this table. ChatGPT-compatible endpoints, Gemini and Ollama are listed
// live by main/models.ts, and their entries here are only the suggestions
// shown before a listing arrives or when it fails. Keep ids exact — a picker
// that offers a model the provider has never heard of is a turn that fails
// on send.
// ─────────────────────────────────────────────────────────────────────────────
import type { ModelInfo, Provider } from "./types";

export const CLAUDE_MODELS: ReadonlyArray<ModelInfo> = [
  { id: "claude-fable-5-1", label: "Fable 5.1 — most capable", tools: true, thinking: true, vision: true, contextLength: 1_000_000 },
  { id: "claude-opus-5",    label: "Opus 5 — default",         tools: true, thinking: true, vision: true, contextLength: 1_000_000 },
  { id: "claude-sonnet-5",  label: "Sonnet 5 — balanced",      tools: true, thinking: true, vision: true, contextLength: 1_000_000 },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 — fastest",      tools: true, thinking: true, vision: true, contextLength: 200_000 },
];

/** Ids that older settings files may still carry, mapped to the entry above
 *  that is the SAME model under another name — so an upgrade does not leave a
 *  duplicate option hanging in the picker. Only true aliases belong here; a
 *  different generation is a different model and is shown as itself. */
export const CLAUDE_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};

/** Gemini Developer API models (September 2026). Replaced by the key's own
 *  listing once one is connected; this is the offer before that. */
export const GEMINI_MODELS: ReadonlyArray<ModelInfo> = [
  { id: "gemini-3.8-flash",       label: "Gemini 3.8 Flash — default",       tools: true, thinking: true, vision: true, contextLength: 1_048_576 },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro — most capable",    tools: true, thinking: true, vision: true, contextLength: 1_048_576 },
  { id: "gemini-3.5-flash-lite",  label: "Gemini 3.5 Flash-Lite — cheapest", tools: true, thinking: true, vision: true, contextLength: 1_048_576 },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash — free tier",       tools: true, thinking: true, vision: true, contextLength: 1_048_576 },
  { id: "gemini-2.5-pro",         label: "Gemini 2.5 Pro",                   tools: true, thinking: true, vision: true, contextLength: 1_048_576 },
  { id: "gemini-2.5-flash",       label: "Gemini 2.5 Flash",                 tools: true, thinking: true, vision: true, contextLength: 1_048_576 },
];

/** OpenAI models worth suggesting before the endpoint's own list is read
 *  (September 2026). Any id the endpoint accepts can still be typed. */
export const OPENAI_SUGGESTED: ReadonlyArray<ModelInfo> = [
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra — default",     tools: true, thinking: true, contextLength: 1_050_000 },
  { id: "gpt-5.6-sol",   label: "GPT-5.6 Sol — most capable",  tools: true, thinking: true, contextLength: 1_050_000 },
  { id: "gpt-5.6-luna",  label: "GPT-5.6 Luna — cheapest",     tools: true, thinking: true, contextLength: 1_050_000 },
  { id: "gpt-6-astra",   label: "GPT-6 Astra — frontier",      tools: true, thinking: true, contextLength: 1_050_000 },
  { id: "gpt-5.4-mini",  label: "GPT-5.4 mini",                tools: true, thinking: true, contextLength: 400_000 },
  { id: "gpt-5.2",       label: "GPT-5.2",                     tools: true, thinking: true, contextLength: 400_000 },
  { id: "gpt-4.1",       label: "GPT-4.1 — no reasoning",      tools: true, thinking: false, contextLength: 1_047_576 },
];

/** Local models worth naming in UI copy: tool-capable on Ollama today, most
 *  of them with thinking. gemma3 and llava are the common ones that are NOT. */
export const OLLAMA_RECOMMENDED: ReadonlyArray<string> = ["qwen3", "qwen3.5", "gemma4", "gpt-oss", "llama3.1", "mistral-small3.2"];

export const PROVIDER_LABEL: Readonly<Record<Provider, string>> = {
  claude: "Claude", openai: "ChatGPT", gemini: "Gemini", ollama: "Ollama",
};

/** The static list for a provider, or none when it is listed live. */
export function staticModels(provider: Provider): ReadonlyArray<ModelInfo> {
  return provider === "claude" ? CLAUDE_MODELS
    : provider === "gemini" ? GEMINI_MODELS
    : provider === "openai" ? OPENAI_SUGGESTED
    : [];
}

/** Resolve a stored Claude model id through the alias table. */
export const canonicalClaudeModel = (id: string): string => CLAUDE_MODEL_ALIASES[id] ?? id;
