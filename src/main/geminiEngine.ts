// ─────────────────────────────────────────────────────────────────────────────
// Gemini turn runner. Talks to the Gemini Developer API
// (generativelanguage.googleapis.com) with an AI Studio API key, in Gemini's
// NATIVE content format — contents/parts, functionCall/functionResponse,
// streamGenerateContent — which is different from the OpenAI shape
// chatEngine.ts speaks.
//
// It used to talk to Google's Code Assist API through gemini-cli's OAuth
// client. Google stopped serving that path for personal accounts on
// 2026-06-18 and states that third-party reuse of that OAuth client violates
// its terms, so it is gone: the key path is the supported one, has a free
// tier, and speaks the same wire format.
//
// It reuses the exact same in-process tools as every other engine (each SDK
// tool's zod shape → a Gemini functionDeclaration), runs them through the same
// access policy, and emits the same AgentEvent stream, so the UI can't tell
// which brain ran the turn.
// ─────────────────────────────────────────────────────────────────────────────
import { systemPrompt } from "./prompt";
import { buildToolList } from "./tools";
import { runtime } from "./config";
import { secrets, GEMINI_KEY } from "./secrets";
import { gatedTools, jsonSchemaFor, titleFor, isAbortError, CANCELLED, MAX_ROUNDS, MAX_TOOL_CHARS, type SdkTool } from "./engineShared";
import type { ToolContext } from "./tools/context";
import type { AetherSettings, AgentEvent, Message, ToolActivity } from "../shared/types";

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ── Gemini part / content shapes (only the fields we touch) ──────────────────
interface GeminiFunctionCall { name: string; args?: Record<string, unknown>; id?: string; }
interface GeminiPart {
  text?: string;
  thought?: boolean;
  /** Gemini 3 signs its reasoning into the parts it emits and refuses (400) a
   *  replayed turn whose first functionCall lost the signature. Parts are kept
   *  exactly as received so nothing is lost on the way back. */
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}
interface GeminiContent { role: "user" | "model"; parts: GeminiPart[]; }

/** What gemini-cli stamps on an unsigned first functionCall so the server's
 *  signature validation lets the turn through. */
const SYNTHETIC_SIGNATURE = "skip_thought_signature_validator";

/** Strip everything Gemini's Schema (an OpenAPI 3.0 subset) rejects. Sending
 *  `$schema` / `additionalProperties` is the top cause of a 400 here. */
function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (!node || typeof node !== "object") return node;
  // Keys Gemini's OpenAPI-3.0 Schema subset doesn't accept — sending any of them
  // is a common 400.
  const drop = new Set([
    "$schema", "additionalProperties", "$ref", "$defs", "definitions", "oneOf", "allOf", "not",
    "const", "patternProperties", "$id", "$comment", "propertyNames", "unevaluatedProperties",
    "dependentSchemas", "dependentRequired", "if", "then", "else", "contains", "prefixItems", "examples",
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (drop.has(k)) continue;
    if (k === "type" && Array.isArray(v)) {
      // JSON Schema `type: ["string","null"]` -> a single type + `nullable`.
      const nonNull = (v as unknown[]).filter((t) => t !== "null");
      out.type = nonNull[0] ?? "string";
      if ((v as unknown[]).includes("null")) out.nullable = true;
    } else if (k === "format" && typeof v === "string" && v !== "enum" && v !== "date-time") {
      // Gemini only honours enum/date-time string formats; others 400.
      continue;
    } else if (k === "properties" && v && typeof v === "object") {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = sanitizeSchema(pv);
      out[k] = props;
    } else if (k === "items" || k === "anyOf") {
      out[k] = sanitizeSchema(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** SDK tools → Gemini functionDeclarations, plus the declared name → real tool
 *  name (Gemini restricts names to [A-Za-z0-9_]; ours already comply, but the
 *  mapping keeps a sanitised name from silently missing its handler). */
function toGeminiTools(tools: SdkTool[]): { decls: Array<{ name: string; description: string; parameters?: unknown }>; realName: Map<string, string> } {
  const decls: Array<{ name: string; description: string; parameters?: unknown }> = [];
  const realName = new Map<string, string>();
  for (const t of tools) {
    const name = t.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const raw = jsonSchemaFor(t);
    if (!raw) continue; // a schema we can't express — skip that tool
    const schema = sanitizeSchema(raw) as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, unknown>;
    const decl: { name: string; description: string; parameters?: unknown } = { name, description: (t.description || "").slice(0, 4000) };
    // Gemini wants an object schema or no parameters at all — omit when empty.
    if (Object.keys(props).length) decl.parameters = schema;
    decls.push(decl);
    realName.set(name, t.name);
  }
  return { decls, realName };
}

/**
 * How hard the model should think, in the vocabulary of its generation.
 * Gemini 3 takes `thinkingLevel`; Gemini 2.5 takes a token `thinkingBudget`.
 * Sending both in one request is a 400, so exactly one is chosen. LOW / MEDIUM
 * / HIGH are accepted by every served Gemini 3 text model; MINIMAL is not
 * (3.1 Pro and 3.8 Flash reject it), so it is never sent.
 */
export function thinkingConfigFor(model: string, effort: AetherSettings["effort"]): Record<string, unknown> {
  const includeThoughts = effort !== "low";
  if (/^gemini-2(\.|-|$)/i.test(model)) {
    const budget = effort === "low" ? 1024 : effort === "medium" ? 8192 : effort === "high" ? 16384 : 24576;
    return { includeThoughts, thinkingBudget: budget };
  }
  const level = effort === "low" ? "LOW" : effort === "medium" ? "MEDIUM" : "HIGH";
  return { includeThoughts, thinkingLevel: level };
}

/** Turn an HTTP failure into a sentence that says what to do next. */
function explainHttp(status: number, body: string, model: string): string {
  let msg = "";
  try { msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ""; } catch { msg = body; }
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) return "Google rejected the Gemini API key. Check it in Settings → Model.";
  if (status === 401 || status === 403) return `Google refused the request (HTTP ${status}). ${msg || "Check the API key in Settings → Model."}`;
  if (status === 404) return `Gemini does not know the model "${model}" (HTTP 404). Pick another in the model picker under the chat.`;
  if (status === 429) return `Gemini is rate-limiting or out of quota (HTTP 429). ${/free/i.test(msg) ? "The free tier is per-day; " : ""}Wait a moment, or pick a Flash model.`;
  return `Gemini returned HTTP ${status}. ${msg.slice(0, 300)}`;
}

export async function* runGeminiTurn(
  prompt: string,
  history: Message[],
  settings: AetherSettings,
  ctx: ToolContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const key = secrets.get(GEMINI_KEY);
  if (!key) {
    yield { type: "error", message: "No Gemini API key set. Add one in Settings → Model (free from Google AI Studio), or switch provider." };
    return;
  }

  const model = settings.geminiModel || runtime.defaults.geminiModel;
  // Abort the turn on the caller's signal OR after the turn timeout — a stalled
  // stream must not hang forever. The same signal stops the tool loop.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => ac.abort(), runtime.turnTimeoutMs);

  const { tools } = await buildToolList(ctx);
  const { decls, realName } = toGeminiTools(tools as unknown as SdkTool[]);
  const { run } = gatedTools(ctx, tools as unknown as SdkTool[], ac.signal);

  // Build the conversation. No "system"/"assistant"/"tool" roles natively:
  // assistant → "model", and tool results ride a "user" turn.
  const contents: GeminiContent[] = [];
  for (const m of history.slice(-30)) {
    if (m.content?.trim()) contents.push({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const headers = { "x-goog-api-key": key, "Content-Type": "application/json" };
  let assembled = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const body = JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemPrompt(settings) }] },
        ...(decls.length ? { tools: [{ functionDeclarations: decls }] } : {}),
        generationConfig: { thinkingConfig: thinkingConfigFor(model, settings.effort) },
      });

      let res: Response;
      try {
        res = await fetch(url, { method: "POST", headers, body, signal: ac.signal });
      } catch (e) {
        if (isAbortError(e) || ac.signal.aborted) throw e; // the outer catch says "cancelled"
        yield { type: "error", message: `Could not reach Gemini: ${e instanceof Error ? e.message : String(e)}` };
        return;
      }
      if (!res.ok || !res.body) {
        const detail = (await res.text().catch(() => "")).slice(0, 600);
        yield { type: "error", message: explainHttp(res.status, detail, model) };
        return;
      }

      // ── stream this round (SSE: accumulate `data:` lines, flush on blank line)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let dataBuf = "";
      let roundText = "";
      // The model's turn, kept part-for-part as it arrived (minus thought
      // summaries) so signatures ride back exactly where they were.
      const modelParts: GeminiPart[] = [];
      const calls: Array<{ call: GeminiFunctionCall }> = [];
      let finish = "";

      const process = (raw: string): AgentEvent[] => {
        const events: AgentEvent[] = [];
        let json: { candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>; error?: { message?: string } };
        try { json = JSON.parse(raw); } catch { return events; }
        if (json.error?.message) { events.push({ type: "error", message: `Gemini: ${json.error.message}` }); return events; }
        const cand = json.candidates?.[0];
        if (!cand) return events;
        if (cand.finishReason) finish = cand.finishReason;
        for (const part of cand.content?.parts ?? []) {
          if (part.thought) {
            if (typeof part.text === "string" && part.text) events.push({ type: "thinking", text: part.text });
            continue;
          }
          if (part.functionCall?.name) {
            calls.push({ call: part.functionCall });
            modelParts.push({ functionCall: part.functionCall, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) });
            continue;
          }
          if (typeof part.text === "string") {
            if (part.text) { roundText += part.text; assembled += part.text; events.push({ type: "delta", text: part.text }); }
            // Merge unsigned text fragments; a signed one stays its own part.
            const last = modelParts[modelParts.length - 1];
            if (!part.thoughtSignature && last && typeof last.text === "string" && !last.thoughtSignature && !last.functionCall) last.text += part.text;
            else modelParts.push({ text: part.text, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) });
          }
        }
        return events;
      };

      let streamError = false;
      readLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data:")) { dataBuf += line.slice(5).trimStart(); continue; }
          if (line.trim() === "" && dataBuf) {
            if (dataBuf === "[DONE]") { dataBuf = ""; break readLoop; }
            for (const ev of process(dataBuf)) { yield ev; if (ev.type === "error") streamError = true; }
            dataBuf = "";
            if (streamError) return;
          }
        }
      }
      // Flush a trailing event that arrived without a final blank line: the last
      // partial line is still sitting in `buf`, not `dataBuf`.
      const tail = buf.trim();
      if (tail.startsWith("data:")) dataBuf += tail.slice(5).trimStart();
      if (dataBuf && dataBuf !== "[DONE]") { for (const ev of process(dataBuf)) { yield ev; if (ev.type === "error") return; } }

      if (!calls.length) {
        const final = assembled.trim();
        if (final) yield { type: "done", text: final, costUsd: null };
        else yield { type: "error", message: `Gemini ended the turn without a reply${finish ? ` (${finish})` : ""}.` };
        return;
      }

      // ── record the model's turn, run the tools, feed results back ──────────
      // Gemini 3 requires the first functionCall of a model step to be signed;
      // when the server did not sign it (older models), stamp the marker the
      // reference CLI uses so validation does not refuse the replay.
      const firstCall = modelParts.find((p) => p.functionCall);
      if (firstCall && !firstCall.thoughtSignature) firstCall.thoughtSignature = SYNTHETIC_SIGNATURE;
      contents.push({ role: "model", parts: modelParts.filter((p) => p.functionCall || (typeof p.text === "string" && (p.text || p.thoughtSignature))) });

      const responseParts: GeminiPart[] = [];
      for (const { call } of calls) {
        if (ac.signal.aborted) { yield { type: "error", message: CANCELLED }; return; }
        const args = (call.args ?? {}) as Record<string, unknown>;
        const activity: ToolActivity = {
          id: call.id || `${call.name}-${round}-${responseParts.length}`, name: call.name,
          title: titleFor(call.name, args), status: "running", startedAt: Date.now(),
        };
        yield { type: "tool_start", tool: activity };
        if (call.name === "graph_upsert" && typeof args.caseName === "string") {
          yield { type: "graph_touched", caseName: args.caseName };
        }

        const { out, isError } = await run(realName.get(call.name) ?? call.name, args);
        yield { type: "tool_end", id: activity.id, status: isError ? "error" : "ok", detail: out.slice(0, 240) };
        responseParts.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: isError ? { error: out.slice(0, MAX_TOOL_CHARS) } : { result: out.slice(0, MAX_TOOL_CHARS) } } });
      }
      contents.push({ role: "user", parts: responseParts });
    }

    const final = assembled.trim();
    if (final) yield { type: "done", text: final, costUsd: null };
    else yield { type: "error", message: "Hit the tool-call limit for one turn. Try narrowing the request." };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    yield { type: "error", message: isAbortError(error) || ac.signal.aborted ? CANCELLED : msg };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}
