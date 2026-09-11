// ─────────────────────────────────────────────────────────────────────────────
// OpenAI turn runner on the Responses API (POST /v1/responses).
//
// Chat Completions is what every OpenAI-compatible gateway implements, and
// chatEngine.ts still speaks it for those. OpenAI's own current models,
// though, will not combine function tools with reasoning on that endpoint
// (GPT-5.4 onward wants `reasoning_effort: none`; GPT-6 takes no tools there
// at all) — the Responses API is where an agentic turn belongs. It streams
// typed events instead of chat chunks, carries reasoning as first-class items,
// and returns reasoning summaries the transcript can show.
//
// Stateless by choice: `store: false`, and every output item — reasoning
// included, as encrypted content — is echoed back on the next round, so the
// conversation lives on this machine, not on OpenAI's servers.
// ─────────────────────────────────────────────────────────────────────────────
import { systemPrompt } from "./prompt";
import { buildToolList } from "./tools";
import { secrets, OPENAI_KEY } from "./secrets";
import { runtime } from "./config";
import { gatedTools, jsonSchemaFor, titleFor, isAbortError, CANCELLED, MAX_ROUNDS, MAX_TOOL_CHARS, type SdkTool } from "./engineShared";
import { drainSse, isReasoningModel, responsesEffortFor } from "./openaiWire";
import type { ToolContext } from "./tools/context";
import type { AetherSettings, AgentEvent, Message, ToolActivity } from "../shared/types";

/** Output items as the API returns them; echoed back verbatim on the next
 *  round, so only the fields we read are typed. */
interface FunctionCallItem { type: "function_call"; id?: string; call_id: string; name: string; arguments: string; status?: string; }
interface OtherItem { type: string; id?: string; [k: string]: unknown; }
type OutputItem = FunctionCallItem | OtherItem;

type InputItem =
  | { role: "user" | "assistant"; content: string }
  | OutputItem
  | { type: "function_call_output"; call_id: string; output: string };

/** One streamed event, the fields we read. Every payload carries `type`. */
interface ResponsesEvent {
  type: string;
  delta?: string;
  item?: OutputItem;
  response?: { id?: string; output?: OutputItem[]; status?: string; error?: { message?: string } | null; incomplete_details?: { reason?: string } | null };
  message?: string;
  code?: string | null;
}

const isFunctionCall = (i: OutputItem): i is FunctionCallItem => i.type === "function_call";

function toResponsesTools(tools: SdkTool[]) {
  const out: Array<{ type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: false }> = [];
  for (const t of tools) {
    const parameters = jsonSchemaFor(t);
    if (!parameters) continue;
    out.push({ type: "function", name: t.name, description: (t.description || "").slice(0, 4000), parameters, strict: false });
  }
  return out;
}

/** Turn an HTTP failure into a sentence that says what to do next. */
function explainHttp(status: number, body: string, model: string): string {
  let msg = "";
  try { msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ""; } catch { msg = body; }
  if (status === 401) return "OpenAI rejected the API key (HTTP 401). Check it in Settings → Model.";
  if (status === 403) return `OpenAI refused the request (HTTP 403). ${msg || "The key may not have access to this model."}`;
  if (status === 404) return `OpenAI does not know the model "${model}" (HTTP 404). Pick another in the model picker under the chat.`;
  if (status === 429) return `OpenAI is rate-limiting or out of quota (HTTP 429). ${msg.slice(0, 200)}`;
  return `OpenAI returned HTTP ${status}. ${msg.slice(0, 300)}`;
}

export async function* runResponsesTurn(
  prompt: string,
  history: Message[],
  settings: AetherSettings,
  ctx: ToolContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const key = secrets.get(OPENAI_KEY);
  if (!key) {
    yield { type: "error", message: "No OpenAI API key set. Add one in Settings → Model, or switch provider." };
    return;
  }
  const base = (settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${base}/responses`;
  const model = settings.openaiModel || runtime.defaults.openaiModel;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };

  // Caller abort OR turn timeout, and the same signal stops the tool loop.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => ac.abort(), runtime.turnTimeoutMs);

  const { tools } = await buildToolList(ctx);
  const sdkTools = tools as unknown as SdkTool[];
  const { run } = gatedTools(ctx, sdkTools, ac.signal);
  const toolDefs = toResponsesTools(sdkTools);

  const reasoning = isReasoningModel(model);
  let effort: string | undefined = reasoning ? responsesEffortFor(model, settings.effort) : undefined;
  // Reasoning summaries are gated on organisation verification; the effort
  // itself is not. They are tracked apart so losing one does not lose the other.
  let summary: "auto" | undefined = "auto";

  const input: InputItem[] = [];
  for (const m of history.slice(-30)) {
    if (m.content?.trim()) input.push({ role: m.role === "user" ? "user" : "assistant", content: m.content });
  }
  input.push({ role: "user", content: prompt });
  let assembled = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let body: ReadableStream<Uint8Array> | null = null;
      // Two retries at most, each once: an unverified organisation is refused
      // reasoning SUMMARIES (drop the summary, keep the effort); a model that
      // does not take the reasoning block at all is refused the block (drop
      // it). Any other 400 is reported as it is.
      while (!body) {
        const payload = JSON.stringify({
          model,
          instructions: systemPrompt(settings),
          input,
          ...(toolDefs.length ? { tools: toolDefs, parallel_tool_calls: true } : {}),
          ...(effort ? { reasoning: { effort, ...(summary ? { summary } : {}) }, include: ["reasoning.encrypted_content"] } : {}),
          store: false,
          stream: true,
        });
        let res: Response;
        try {
          res = await fetch(url, { method: "POST", headers, body: payload, signal: ac.signal });
        } catch (e) {
          if (isAbortError(e) || ac.signal.aborted) throw e; // the outer catch says "cancelled"
          yield { type: "error", message: `Could not reach OpenAI at ${url}: ${e instanceof Error ? e.message : String(e)}` };
          return;
        }
        if (res.ok && res.body) { body = res.body; break; }
        const detail = (await res.text().catch(() => "")).slice(0, 600);
        if (res.status === 400 && effort) {
          let param = "", msg = "";
          try { const e = (JSON.parse(detail) as { error?: { param?: string; message?: string } }).error; param = e?.param ?? ""; msg = e?.message ?? ""; } catch { msg = detail; }
          if (summary && (param === "reasoning.summary" || /reasoning[ ._-]?summar/i.test(msg))) { summary = undefined; continue; }
          if (param === "reasoning" || param === "reasoning.effort" || /unsupported (parameter|value).*reasoning|reasoning\.effort/i.test(msg)) { effort = undefined; continue; }
        }
        yield { type: "error", message: explainHttp(res.status, detail, model) };
        return;
      }

      // ── stream this round ──────────────────────────────────────────────────
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      // Items as they complete, in output order. `response.completed` carries
      // the authoritative list and replaces these when it arrives.
      let items: OutputItem[] = [];
      let completed = false;
      let failure = "";

      const handle = (ev: ResponsesEvent): AgentEvent[] => {
        const out: AgentEvent[] = [];
        switch (ev.type) {
          case "response.output_text.delta":
            if (ev.delta) { assembled += ev.delta; out.push({ type: "delta", text: ev.delta }); }
            break;
          case "response.reasoning_summary_text.delta":
          case "response.reasoning_text.delta":
            if (ev.delta) out.push({ type: "thinking", text: ev.delta });
            break;
          case "response.output_item.done":
            if (ev.item) items.push(ev.item);
            break;
          case "response.completed":
            completed = true;
            if (Array.isArray(ev.response?.output)) items = ev.response.output;
            break;
          case "response.failed":
            failure = ev.response?.error?.message || "OpenAI reported the response as failed.";
            break;
          case "response.incomplete":
            // Still usable: whatever arrived is kept, and the reason is said.
            completed = true;
            if (Array.isArray(ev.response?.output)) items = ev.response.output;
            if (ev.response?.incomplete_details?.reason === "max_output_tokens") out.push({ type: "delta", text: "\n\n_(cut off at the output limit)_" });
            break;
          case "error":
            failure = ev.message || "OpenAI reported an error.";
            break;
        }
        return out;
      };

      readLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { events, rest } = drainSse(buf);
        buf = rest;
        for (const e of events) {
          if (e.data === "[DONE]") break readLoop;
          let ev: ResponsesEvent;
          try { ev = JSON.parse(e.data) as ResponsesEvent; } catch { continue; }
          for (const a of handle(ev)) yield a;
          if (failure) { yield { type: "error", message: `OpenAI: ${failure}` }; return; }
        }
      }
      if (buf.trim()) {
        for (const e of drainSse(buf + "\n\n").events) {
          if (e.data === "[DONE]") continue;
          try { for (const a of handle(JSON.parse(e.data) as ResponsesEvent)) yield a; } catch { /* torn tail */ }
        }
      }
      if (failure) { yield { type: "error", message: `OpenAI: ${failure}` }; return; }

      const calls = items.filter(isFunctionCall);
      if (!calls.length) {
        const final = assembled.trim();
        if (final) yield { type: "done", text: final, costUsd: null };
        else yield { type: "error", message: completed ? "OpenAI ended the turn without a reply." : "The connection closed before OpenAI finished." };
        return;
      }

      // ── echo the model's turn, run the tools, feed results back ───────────
      // Every item goes back as received — reasoning items carry the encrypted
      // chain the next round needs, and the function_call items are what the
      // outputs below answer.
      for (const item of items) input.push(item);
      for (const [i, call] of calls.entries()) {
        if (ac.signal.aborted) { yield { type: "error", message: CANCELLED }; return; }
        let args: Record<string, unknown> = {};
        try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { /* malformed args */ }
        const activity: ToolActivity = {
          id: call.call_id || call.id || `${call.name}-${round}-${i}`, name: call.name,
          title: titleFor(call.name, args), status: "running", startedAt: Date.now(),
        };
        yield { type: "tool_start", tool: activity };
        if (call.name === "graph_upsert" && typeof args.caseName === "string") {
          yield { type: "graph_touched", caseName: args.caseName };
        }
        const { out, isError } = await run(call.name, args);
        yield { type: "tool_end", id: activity.id, status: isError ? "error" : "ok", detail: out.slice(0, 240) };
        input.push({ type: "function_call_output", call_id: call.call_id, output: out.slice(0, MAX_TOOL_CHARS) });
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
