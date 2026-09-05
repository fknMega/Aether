// ─────────────────────────────────────────────────────────────────────────────
// Gemini turn runner. Talks to Google's Code Assist API (the free-tier surface
// behind "Sign in with Google") in Gemini's NATIVE content format —
// contents/parts, functionCall/functionResponse, streamGenerateContent — which
// is different from the OpenAI shape chatEngine.ts speaks.
//
// It reuses the exact same in-process tools as every other engine (each SDK
// tool's zod shape → a Gemini functionDeclaration) and emits the same
// AgentEvent stream, so the UI can't tell which brain ran the turn.
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { systemPrompt } from "./prompt";
import { buildToolList } from "./tools";
import { runtime } from "./config";
import { getGeminiAuth, newPromptId } from "./geminiAuth";
import type { ToolContext } from "./tools/context";
import type { AetherSettings, AgentEvent, Message, ToolActivity } from "../shared/types";

type SdkTool = { name: string; description: string; inputSchema: Record<string, unknown>; handler: (args: unknown, extra: unknown) => Promise<{ content?: Array<{ type?: string; text?: string }>; isError?: boolean }> };

const CA_BASE = "https://cloudcode-pa.googleapis.com";
const CA_VERSION = "v1internal";
const UA = "GeminiCLI/aether (electron)";
const MAX_ROUNDS = 12;
const MAX_TOOL_CHARS = 8000;

// ── Gemini part / content shapes (only the fields we touch) ──────────────────
interface GeminiFunctionCall { name: string; args?: Record<string, unknown>; id?: string; }
interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}
interface GeminiContent { role: "user" | "model"; parts: GeminiPart[]; }

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

/** SDK tools → Gemini functionDeclarations, plus a name→tool lookup. */
function toGeminiTools(tools: SdkTool[]): { decls: Array<{ name: string; description: string; parameters?: unknown }>; byName: Map<string, SdkTool> } {
  const decls: Array<{ name: string; description: string; parameters?: unknown }> = [];
  const byName = new Map<string, SdkTool>();
  for (const t of tools) {
    const name = t.name.replace(/[^a-zA-Z0-9_]/g, "_");
    try {
      const schema = sanitizeSchema(z.toJSONSchema(z.object((t.inputSchema ?? {}) as never), { io: "input" })) as Record<string, unknown>;
      const props = (schema.properties ?? {}) as Record<string, unknown>;
      const decl: { name: string; description: string; parameters?: unknown } = { name, description: (t.description || "").slice(0, 1024) };
      // Gemini wants an object schema or no parameters at all — omit when empty.
      if (Object.keys(props).length) decl.parameters = schema;
      decls.push(decl);
      byName.set(name, t);
    } catch { /* a schema we can't express — skip that tool */ }
  }
  return { decls, byName };
}

const textOf = (r: { content?: Array<{ type?: string; text?: string }> } | undefined): string =>
  (r?.content ?? []).map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n").trim();

/** A short, human title for the activity card (mirrors the other engines). */
function titleFor(name: string, input: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
  switch (name) {
    case "username_search": return `Hunting @${s(input.username)} across platforms`;
    case "graph_upsert": return `Updating graph "${s(input.caseName)}"`;
    case "graph_get": return `Reading graph "${s(input.caseName)}"`;
    case "dns_lookup": return `DNS ${s(input.domain)}`;
    case "whois": return `WHOIS ${s(input.query)}`;
    case "http_probe": return `Fetching ${s(input.url)}`;
    case "exif_read": return "Reading EXIF";
    default: return name.replace(/_/g, " ") + (input.input ? ` "${s(input.input)}"` : "");
  }
}

export async function* runGeminiTurn(
  prompt: string,
  history: Message[],
  settings: AetherSettings,
  ctx: ToolContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  let token: string, projectId: string;
  try {
    ({ token, projectId } = await getGeminiAuth());
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : String(e) };
    return;
  }

  const model = settings.geminiModel || "gemini-2.5-pro";
  const { tools } = await buildToolList(ctx);
  const { decls, byName } = toGeminiTools(tools as unknown as SdkTool[]);

  // Build the conversation. No "system"/"assistant"/"tool" roles natively:
  // assistant → "model", and tool results ride a "user" turn.
  const contents: GeminiContent[] = [];
  for (const m of history.slice(-30)) {
    if (m.content?.trim()) contents.push({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const includeThoughts = settings.effort !== "low";
  const url = `${CA_BASE}/${CA_VERSION}:streamGenerateContent?alt=sse`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": UA };
  // Abort the turn on the caller's signal OR after the turn timeout — a stalled
  // Code Assist stream must not hang forever.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => ac.abort(), runtime.turnTimeoutMs);
  let assembled = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const body = JSON.stringify({
        model,
        project: projectId || undefined,
        user_prompt_id: newPromptId(),
        request: {
          contents,
          systemInstruction: { role: "user", parts: [{ text: systemPrompt(settings) }] },
          ...(decls.length ? { tools: [{ functionDeclarations: decls }] } : {}),
          generationConfig: { thinkingConfig: { includeThoughts } },
        },
      });

      let res: Response;
      try {
        res = await fetch(url, { method: "POST", headers, body, signal: ac.signal });
      } catch (e) {
        yield { type: "error", message: `Could not reach Gemini (Code Assist): ${e instanceof Error ? e.message : String(e)}` };
        return;
      }
      if (!res.ok || !res.body) {
        const detail = (await res.text().catch(() => "")).slice(0, 400);
        if (res.status === 401 || res.status === 403) { yield { type: "error", message: "Google rejected the request — try signing in again in Settings." }; return; }
        yield { type: "error", message: `Gemini returned HTTP ${res.status}. ${detail}` };
        return;
      }

      // ── stream this round (SSE: accumulate `data:` lines, flush on blank line)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let dataBuf = "";
      let roundText = "";
      const calls: GeminiFunctionCall[] = [];
      const callSignatures: (string | undefined)[] = [];
      let finish = "";

      const process = (raw: string): AgentEvent[] => {
        const events: AgentEvent[] = [];
        let json: { response?: { candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }> } };
        try { json = JSON.parse(raw); } catch { return events; }
        const cand = json.response?.candidates?.[0];
        if (!cand) return events;
        if (cand.finishReason) finish = cand.finishReason;
        for (const part of cand.content?.parts ?? []) {
          if (part.functionCall?.name) { calls.push(part.functionCall); callSignatures.push(part.thoughtSignature); continue; }
          if (typeof part.text === "string" && part.text) {
            if (part.thought) events.push({ type: "thinking", text: part.text });
            else { roundText += part.text; assembled += part.text; events.push({ type: "delta", text: part.text }); }
          }
        }
        return events;
      };

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
            for (const ev of process(dataBuf)) yield ev;
            dataBuf = "";
          }
        }
      }
      // Flush a trailing event that arrived without a final blank line: the last
      // partial line is still sitting in `buf`, not `dataBuf`.
      const tail = buf.trim();
      if (tail.startsWith("data:")) dataBuf += tail.slice(5).trimStart();
      if (dataBuf && dataBuf !== "[DONE]") { for (const ev of process(dataBuf)) yield ev; }

      if (!calls.length) {
        const final = assembled.trim();
        if (final) yield { type: "done", text: final, costUsd: null };
        else yield { type: "error", message: `Gemini ended the turn without a reply${finish ? ` (${finish})` : ""}.` };
        return;
      }

      // ── record the model's turn, run the tools, feed results back ──────────
      const modelParts: GeminiPart[] = [];
      if (roundText) modelParts.push({ text: roundText });
      calls.forEach((c, i) => modelParts.push({ functionCall: c, ...(callSignatures[i] ? { thoughtSignature: callSignatures[i] } : {}) }));
      contents.push({ role: "model", parts: modelParts });

      const responseParts: GeminiPart[] = [];
      for (const call of calls) {
        const args = (call.args ?? {}) as Record<string, unknown>;
        const activity: ToolActivity = {
          id: call.id || `${call.name}-${round}`, name: call.name,
          title: titleFor(call.name, args), status: "running", startedAt: Date.now(),
        };
        yield { type: "tool_start", tool: activity };
        if (call.name === "graph_upsert" && typeof args.caseName === "string") {
          yield { type: "graph_touched", caseName: args.caseName };
        }

        const tool = byName.get(call.name);
        let out = "";
        let isError = false;
        if (!tool) { out = `No such tool: ${call.name}`; isError = true; }
        else {
          try {
            const r = await tool.handler(args, {});
            out = textOf(r) || "(no output)";
            isError = !!r?.isError;
          } catch (e) { out = `Tool failed: ${e instanceof Error ? e.message : String(e)}`; isError = true; }
        }
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
    yield { type: "error", message: /abort/i.test(msg) ? "That request was cancelled." : msg };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}
