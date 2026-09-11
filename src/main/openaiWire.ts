// ─────────────────────────────────────────────────────────────────────────────
// OpenAI protocol details as pure functions — which parameters which model
// family accepts, which transport to use, and an SSE splitter. Free of
// Electron and of the tool layer so they can be unit-tested with plain Node.
// ─────────────────────────────────────────────────────────────────────────────
import type { AetherSettings } from "../shared/types";

/** The families that differ in what they accept (September 2026). */
export type OpenAiFamily = "gpt6" | "gpt56" | "gpt55" | "gpt54" | "gpt52" | "gpt51" | "gpt5" | "o" | "gpt-oss" | "plain";

export function openAiFamily(model: string): OpenAiFamily {
  const m = model.toLowerCase().replace(/^openai\//, "");
  if (/^gpt-6/.test(m)) return "gpt6";
  if (/^gpt-5\.6/.test(m)) return "gpt56";
  if (/^gpt-5\.5/.test(m)) return "gpt55";
  if (/^gpt-5\.4/.test(m)) return "gpt54";
  if (/^gpt-5\.[23]/.test(m)) return "gpt52";
  if (/^gpt-5\.1/.test(m)) return "gpt51";
  if (/^gpt-5(-|$)/.test(m)) return "gpt5";
  if (/^o[1-9](-|$)/.test(m)) return "o";
  if (/^gpt-oss/.test(m)) return "gpt-oss";
  return "plain";
}

/** Does this model reason at all — i.e. take an effort parameter? A model that
 *  does not returns 400 for the parameter rather than ignoring it. */
export const isReasoningModel = (model: string): boolean => openAiFamily(model) !== "plain";

type Effort = AetherSettings["effort"];

/**
 * Aether's effort → the `reasoning.effort` a family accepts on the Responses
 * API. Each family has its own ceiling; asking above it is a 400, so the value
 * is clamped rather than passed through.
 */
export function responsesEffortFor(model: string, effort: Effort): string | undefined {
  const fam = openAiFamily(model);
  if (fam === "plain") return undefined;
  const ceiling: Record<Exclude<OpenAiFamily, "plain">, Effort> = {
    gpt6: "max", gpt56: "max",
    gpt55: "xhigh", gpt54: "xhigh", gpt52: "xhigh",
    gpt51: "high", gpt5: "high", o: "high", "gpt-oss": "high",
  };
  const order: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  const cap = order.indexOf(ceiling[fam]);
  return order[Math.min(order.indexOf(effort), cap)];
}

/**
 * The same for Chat Completions, which is stricter: from GPT-5.4 on, OpenAI's
 * own endpoint refuses function tools unless reasoning_effort is `none`, so
 * with tools those families get `none`. Gateways that route the same ids may
 * be more lenient, and the runner also retries on the exact refusal.
 */
export function chatEffortFor(model: string, effort: Effort, hasTools: boolean): string | undefined {
  const fam = openAiFamily(model);
  if (fam === "plain") return undefined;
  if (hasTools && (fam === "gpt6" || fam === "gpt56" || fam === "gpt55" || fam === "gpt54")) return "none";
  return responsesEffortFor(model, effort);
}

/** OpenAI's own API: use the Responses API (tools + reasoning, and the only
 *  place GPT-6 takes tools). Everything else gets Chat Completions, which is
 *  what compatible gateways implement. */
export const isNativeOpenAi = (baseUrl: string): boolean => /^https?:\/\/api\.openai\.com(\/|$)/i.test(baseUrl.trim());

/** One parsed SSE event: the `event:` name if present, and the `data:` payload
 *  (lines joined with newlines, as the spec says). */
export interface SseEvent { event?: string; data: string; }

/** Split an SSE buffer into complete events and the unfinished tail. Events
 *  are separated by a blank line; a `data: [DONE]` sentinel is passed through. */
export function drainSse(buf: string): { events: SseEvent[]; rest: string } {
  const normalized = buf.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length) events.push({ ...(event ? { event } : {}), data: data.join("\n") });
  }
  return { events, rest };
}
