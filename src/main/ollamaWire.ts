// ─────────────────────────────────────────────────────────────────────────────
// The Ollama native chat protocol, as pure functions.
//
// Everything here is free of Electron and of the tool layer so it can be
// unit-tested — and tested against a real local server — with plain Node. The
// runner in ollamaEngine.ts is the glue: it builds a request with these,
// streams it, and hands each tool call to the shared gated runner.
// ─────────────────────────────────────────────────────────────────────────────
import type { AetherSettings, ModelInfo } from "../shared/types";

export interface OllamaToolCall {
  /** Present on 0.9+ servers (`call_xxxxxxxx`); absent on older ones. */
  id?: string;
  function: { index?: number; name: string; arguments: Record<string, unknown> };
}

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** A thinking model's reasoning for this assistant turn; sent back so the
   *  model can see what it already worked out. */
  thinking?: string;
  tool_calls?: OllamaToolCall[];
  /** On a `tool` message: which function this result answers. */
  tool_name?: string;
  tool_call_id?: string;
}

/** One NDJSON line of a streamed /api/chat response, the fields we read. */
export interface OllamaChunk {
  message?: { role?: string; content?: string; thinking?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  done_reason?: string;
  /** Set on the final chunk: how many tokens the prompt and the reply took. */
  prompt_eval_count?: number;
  eval_count?: number;
  /** A server-side failure mid-stream arrives as a line with only this. */
  error?: string;
}

export type ThinkValue = boolean | "low" | "medium" | "high";

/** Ollama's own guidance for agentic work is 64k; this is the floor Aether
 *  asks for, and what a model gets when nothing says otherwise. Overridable
 *  with OLLAMA_NUM_CTX for machines that cannot spare the memory. */
export const DEFAULT_NUM_CTX = 32_768;

/**
 * The context to request for a model. Three rules, in order:
 *   · never below what Aether needs (DEFAULT_NUM_CTX, or the override), and
 *     never above what the model architecture supports;
 *   · never below a `num_ctx` the operator baked into the Modelfile — that is
 *     their choice for this model;
 *   · if the model is already loaded with at least that much, keep exactly the
 *     loaded size — a different number forces Ollama to reload it for nothing.
 * A model loaded SMALLER than the floor is reloaded larger; that is the point.
 */
export function numCtxFor(info: ModelInfo | undefined, override?: string): number {
  const wanted = Number(override);
  let n = Number.isFinite(wanted) && wanted >= 2048 ? Math.floor(wanted) : DEFAULT_NUM_CTX;
  if (info?.contextLength && info.contextLength > 0) n = Math.min(n, info.contextLength);
  if (info?.bakedNumCtx && info.bakedNumCtx > n) n = info.bakedNumCtx;
  if (info?.numCtx && info.numCtx >= n) n = info.numCtx;
  return n;
}

/**
 * What to send as `think` for a model at an effort level, or undefined to
 * leave it out entirely. A model that does not think rejects the field, so it
 * is only sent when the model is known to think (or unknown, and the runner
 * retries without on refusal). gpt-oss takes a level string and ignores a
 * boolean; everything else takes a boolean, and low effort turns it off.
 */
export function thinkFor(model: string, effort: AetherSettings["effort"], info: ModelInfo | undefined): ThinkValue | undefined {
  if (info && info.thinking === false) return undefined;
  if (/gpt-oss/i.test(model)) return effort === "low" ? "low" : effort === "medium" ? "medium" : "high";
  if (!info || info.thinking === undefined) return effort === "low" ? undefined : true;
  return effort !== "low";
}

/** Ollama's function-tool definition is OpenAI's, minus the `strict` field. */
export interface OllamaToolDef { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }

export function toOllamaTools(tools: Array<{ name: string; description: string; schema: Record<string, unknown> | null }>): OllamaToolDef[] {
  const out: OllamaToolDef[] = [];
  for (const t of tools) {
    if (!t.schema) continue;
    out.push({ type: "function", function: { name: t.name, description: (t.description || "").slice(0, 4000), parameters: t.schema } });
  }
  return out;
}

export interface OllamaChatBody {
  model: string;
  messages: OllamaMessage[];
  stream: true;
  tools?: OllamaToolDef[];
  think?: ThinkValue;
  options: { num_ctx: number };
  keep_alive: string;
}

export function buildChatBody(
  model: string,
  messages: OllamaMessage[],
  tools: OllamaToolDef[],
  think: ThinkValue | undefined,
  numCtx: number,
): OllamaChatBody {
  return {
    model, messages, stream: true,
    ...(tools.length ? { tools } : {}),
    ...(think !== undefined ? { think } : {}),
    options: { num_ctx: numCtx },
    // Keep the model warm between the tool rounds of one turn and across a
    // conversation; Ollama's own default is five minutes.
    keep_alive: "10m",
  };
}

/** Split an NDJSON buffer into complete parsed lines and the unfinished tail. */
export function drainNdjson(buf: string): { chunks: OllamaChunk[]; rest: string } {
  const lines = buf.split("\n");
  const rest = lines.pop() ?? "";
  const chunks: OllamaChunk[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try { chunks.push(JSON.parse(t) as OllamaChunk); } catch { /* a torn line — ignore */ }
  }
  return { chunks, rest };
}

/** The tool result message for one call. Both `tool_name` (what the docs
 *  show) and `tool_call_id` (what the struct accepts) are set, so either
 *  matching strategy on the server side finds it. */
export function toolResultMessage(call: OllamaToolCall, content: string): OllamaMessage {
  return { role: "tool", content, tool_name: call.function.name, ...(call.id ? { tool_call_id: call.id } : {}) };
}

/** Turn an HTTP failure from /api/chat into a sentence with a next step. */
export function explainOllamaHttp(status: number, body: string, model: string): string {
  let msg = "";
  try { msg = (JSON.parse(body) as { error?: string }).error ?? ""; } catch { msg = body; }
  if (status === 404 || /not found/i.test(msg)) return `Ollama does not have "${model}". Run \`ollama pull ${model}\`, or pick one of the models it has from the picker under the chat.`;
  if (/does not support tools/i.test(msg)) return `${model} does not support tool calling, so it cannot run an investigation. Pick a tool-capable model (qwen3, gemma4, gpt-oss, llama3.1).`;
  if (/does not support thinking/i.test(msg)) return `${model} does not support thinking.`;
  if (/context length|exceeds/i.test(msg)) return `The conversation no longer fits ${model}'s context. Start a new conversation, or start Ollama with a larger OLLAMA_CONTEXT_LENGTH.`;
  if (/memory|out of memory|insufficient/i.test(msg)) return `Ollama could not load ${model}: not enough memory. Pick a smaller model, or lower OLLAMA_NUM_CTX.`;
  return `Ollama returned HTTP ${status}. ${msg.slice(0, 300)}`;
}
