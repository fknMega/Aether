// ─────────────────────────────────────────────────────────────────────────────
// OpenAI-compatible turn runner. Drives ChatGPT (api.openai.com) and any
// OpenAI-compatible server — OpenRouter, Azure, LM Studio, vLLM, or Ollama's
// /v1 — over POST /chat/completions with streaming + tool calling.
//
// It reuses the exact same in-process tools as the Claude path: each SDK tool's
// zod shape is converted to JSON Schema for the `tools` array, and its handler is
// invoked — through the same access policy — when the model calls it. Emits the
// same AgentEvent stream as the Claude runner, so the UI can't tell which brain
// is behind a turn.
// ─────────────────────────────────────────────────────────────────────────────
import { systemPrompt } from "./prompt";
import { buildToolList } from "./tools";
import { secrets, OPENAI_KEY } from "./secrets";
import { runtime } from "./config";
import { gatedTools, jsonSchemaFor, titleFor, isAbortError, CANCELLED, MAX_ROUNDS, MAX_TOOL_CHARS, type SdkTool } from "./engineShared";
import { chatEffortFor, isNativeOpenAi } from "./openaiWire";
import { runResponsesTurn } from "./openaiResponsesEngine";
import type { ToolContext } from "./tools/context";
import type { AetherSettings, AgentEvent, Message, ToolActivity } from "../shared/types";

interface OaiToolCall { id: string; name: string; args: string; }
interface OaiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/** One streamed chunk, as much of it as we read. `reasoning` is where
 *  OpenRouter and Ollama put a thinking model's reasoning; `reasoning_content`
 *  is DeepSeek's spelling. OpenAI itself sends neither on this endpoint. */
interface OaiChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string;
  }>;
  error?: { message?: string };
}

/** Where to send the request, and how to authenticate. */
function endpointFor(settings: AetherSettings): { url: string; model: string; headers: Record<string, string>; label: string } {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const base = (settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const key = secrets.get(OPENAI_KEY);
  if (key) headers.Authorization = `Bearer ${key}`;
  return { url: `${base}/chat/completions`, model: settings.openaiModel || runtime.defaults.openaiModel, headers, label: "ChatGPT" };
}

/** SDK tools -> OpenAI function-tool definitions (zod shape -> JSON Schema). */
function toOpenAiTools(tools: SdkTool[]) {
  const out: Array<{ type: "function"; function: { name: string; description: string; parameters: unknown } }> = [];
  for (const t of tools) {
    const parameters = jsonSchemaFor(t);
    if (!parameters) continue; // a schema we can't express as JSON Schema — skip that tool
    out.push({ type: "function", function: { name: t.name, description: (t.description || "").slice(0, 4000), parameters } });
  }
  return out;
}

/** The ChatGPT provider's entry point. OpenAI's own endpoint gets the
 *  Responses API — the only place its current models take tools together
 *  with reasoning; any other base URL gets Chat Completions below. */
export function runChatTurn(
  prompt: string,
  history: Message[],
  settings: AetherSettings,
  ctx: ToolContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const transport = process.env.AETHER_OPENAI_TRANSPORT;
  const useResponses = transport === "responses" || (transport !== "chat" && isNativeOpenAi(settings.openaiBaseUrl || "https://api.openai.com/v1"));
  return useResponses ? runResponsesTurn(prompt, history, settings, ctx, signal) : runCompletionsTurn(prompt, history, settings, ctx, signal);
}

export async function* runCompletionsTurn(
  prompt: string,
  history: Message[],
  settings: AetherSettings,
  ctx: ToolContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const { url, model, headers, label } = endpointFor(settings);
  if (!secrets.get(OPENAI_KEY)) {
    yield { type: "error", message: "No OpenAI API key set. Add one in Settings → Model, or switch provider." };
    return;
  }

  // Abort on the caller's signal OR after the turn timeout — a stalled stream
  // from a gateway must not hang the turn forever. (The Claude runner gets the
  // same ceiling from its own timer; this is the equivalent for this path.)
  // The same signal stops the tool loop: a Stop mid-round runs nothing more.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => ac.abort(), runtime.turnTimeoutMs);

  const { tools } = await buildToolList(ctx);
  const { run } = gatedTools(ctx, tools as unknown as SdkTool[], ac.signal);
  const toolDefs = toOpenAiTools(tools as unknown as SdkTool[]);
  // Only sent when the model is known to accept it; adjusted for the rest of
  // the turn if the server rejects it anyway.
  let reasoningEffort: string | undefined = chatEffortFor(model, settings.effort, toolDefs.length > 0);

  const messages: OaiMessage[] = [{ role: "system", content: systemPrompt(settings) }];
  for (const m of history.slice(-30)) {
    if (m.content?.trim()) messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.content });
  }
  messages.push({ role: "user", content: prompt });
  let assembled = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let body: ReadableStream<Uint8Array> | null = null;
      // One retry: a gateway that does not know `reasoning_effort` answers 400
      // naming it, and the fix is simply to stop sending it.
      while (!body) {
        const payload = JSON.stringify({
          model, messages, stream: true,
          ...(toolDefs.length ? { tools: toolDefs } : {}),
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        });
        let res: Response;
        try {
          res = await fetch(url, { method: "POST", headers, body: payload, signal: ac.signal });
        } catch (e) {
          if (isAbortError(e) || ac.signal.aborted) throw e; // the outer catch says "cancelled"
          yield { type: "error", message: `Could not reach ${label} at ${url}: ${e instanceof Error ? e.message : String(e)}` };
          return;
        }
        if (res.ok && res.body) { body = res.body; break; }
        const detail = (await res.text().catch(() => "")).slice(0, 400);
        if (res.status === 400 && reasoningEffort && /reasoning_effort|reasoning\.effort/i.test(detail)) {
          // Two known refusals: "function tools with reasoning_effort are not
          // supported … set reasoning_effort to 'none'" (newer OpenAI models
          // behind a gateway) and "unsupported/unrecognized parameter" (a
          // model or gateway that does not reason). The first wants `none`,
          // the second wants the field gone.
          reasoningEffort = /tools/i.test(detail) && reasoningEffort !== "none" ? "none" : undefined;
          continue;
        }
        yield { type: "error", message: explainHttp(label, res.status, detail) };
        return;
      }

      // ── stream this round ──────────────────────────────────────────────────
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let roundText = "";
      const calls = new Map<number, OaiToolCall>();
      let finish = "";

      readLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "[DONE]") break readLoop;
            let json: OaiChunk;
            try { json = JSON.parse(payload); } catch { continue; }
            // Some servers report a mid-stream failure as an `error` chunk on
            // a 200 response rather than closing the socket.
            if (json.error?.message) { yield { type: "error", message: `${label}: ${json.error.message}` }; return; }
            const choice = json.choices?.[0];
            if (!choice) continue;
            const thought = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
            if (thought) yield { type: "thinking", text: thought };
            const dc = choice.delta?.content;
            if (dc) { roundText += dc; assembled += dc; yield { type: "delta", text: dc }; }
            for (const tc of choice.delta?.tool_calls ?? []) {
              const idx = tc.index ?? 0;
              const cur = calls.get(idx) ?? { id: "", name: "", args: "" };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.name += tc.function.name;
              if (tc.function?.arguments) cur.args += tc.function.arguments;
              calls.set(idx, cur);
            }
            if (choice.finish_reason) finish = choice.finish_reason;
          }
        }
      }

      const pending = [...calls.values()].filter((c) => c.name);
      if (!pending.length) {
        const final = assembled.trim();
        if (final) yield { type: "done", text: final, costUsd: null };
        else yield { type: "error", message: `${label} ended the turn without a reply${finish ? ` (${finish})` : ""}.` };
        return;
      }

      // ── run the tools it asked for, then loop with the results ─────────────
      messages.push({
        role: "assistant",
        content: roundText || null,
        tool_calls: pending.map((c) => ({ id: c.id || c.name, type: "function" as const, function: { name: c.name, arguments: c.args || "{}" } })),
      });

      for (const call of pending) {
        if (ac.signal.aborted) { yield { type: "error", message: CANCELLED }; return; }
        let args: Record<string, unknown> = {};
        try { args = call.args ? JSON.parse(call.args) : {}; } catch { /* malformed args */ }
        const activity: ToolActivity = {
          id: call.id || `${call.name}-${round}`, name: call.name,
          title: titleFor(call.name, args), status: "running", startedAt: Date.now(),
        };
        yield { type: "tool_start", tool: activity };
        if (call.name === "graph_upsert" && typeof args.caseName === "string") {
          yield { type: "graph_touched", caseName: args.caseName };
        }

        const { out, isError } = await run(call.name, args);
        yield { type: "tool_end", id: activity.id, status: isError ? "error" : "ok", detail: out.slice(0, 240) };
        messages.push({ role: "tool", tool_call_id: activity.id, content: out.slice(0, MAX_TOOL_CHARS) });
      }
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

/** Turn an HTTP failure into a sentence that says what to do next. */
function explainHttp(label: string, status: number, detail: string): string {
  if (status === 401) return `${label} rejected the API key (HTTP 401). Check it in Settings → Model.`;
  if (status === 403) return `${label} refused the request (HTTP 403). The key may not have access to this model.`;
  if (status === 404) return `${label} does not know that model (HTTP 404). Pick another in the model picker under the chat.`;
  if (status === 429) return `${label} is rate-limiting or out of quota (HTTP 429). Wait a moment, or pick a smaller model.`;
  return `${label} returned HTTP ${status}. ${detail}`;
}
