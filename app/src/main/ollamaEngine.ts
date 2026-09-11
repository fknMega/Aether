// ─────────────────────────────────────────────────────────────────────────────
// Ollama turn runner, on the native POST /api/chat.
//
// Ollama also speaks OpenAI's /v1, and this used to go through that. It moved
// here for one reason that matters and two that are nice: the native endpoint
// honours `options.num_ctx`. Ollama's default context is sized by GPU memory
// — 4,096 tokens on most laptops — and the brief plus the tool schemas are
// bigger than that, so on /v1 (which ignores num_ctx) a freshly pulled model
// would silently lose its own instructions. The nice parts: `think` is a
// first-class field, and tool-call arguments arrive as objects, not strings.
//
// Same tools, same access policy, same AgentEvent stream as every other brain.
// ─────────────────────────────────────────────────────────────────────────────
import { systemPrompt } from "./prompt";
import { buildToolList } from "./tools";
import { runtime } from "./config";
import { gatedTools, jsonSchemaFor, titleFor, isAbortError, CANCELLED, MAX_ROUNDS, MAX_TOOL_CHARS, type SdkTool } from "./engineShared";
import { ollamaRoot, ollamaModelInfo } from "./models";
import {
  buildChatBody, drainNdjson, explainOllamaHttp, numCtxFor, thinkFor, toOllamaTools, toolResultMessage,
  type OllamaMessage, type OllamaToolCall, type ThinkValue,
} from "./ollamaWire";
import type { ToolContext } from "./tools/context";
import type { AetherSettings, AgentEvent, Message, ToolActivity } from "../shared/types";

export async function* runOllamaTurn(
  prompt: string,
  history: Message[],
  settings: AetherSettings,
  ctx: ToolContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const root = ollamaRoot(settings.ollamaBaseUrl);
  const model = settings.ollamaModel || runtime.defaults.ollamaModel;
  const url = `${root}/api/chat`;

  // Abort on the caller's signal OR after the turn timeout; a local model that
  // has wedged must not hang the turn forever. The same signal stops the tool
  // loop, so a Stop mid-round runs nothing more.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => ac.abort(), runtime.turnTimeoutMs);

  const { tools } = await buildToolList(ctx);
  const sdkTools = tools as unknown as SdkTool[];
  const { run } = gatedTools(ctx, sdkTools, ac.signal);
  const toolDefs = toOllamaTools(sdkTools.map((t) => ({ name: t.name, description: t.description, schema: jsonSchemaFor(t) })));

  // One /api/show for the chosen model: what it can do and how big it is, so
  // `think` and `num_ctx` are right first time rather than learned from a 400.
  const info = await ollamaModelInfo(settings.ollamaBaseUrl, model);
  let think: ThinkValue | undefined = thinkFor(model, settings.effort, info);
  const numCtx = numCtxFor(info, process.env.OLLAMA_NUM_CTX);

  const messages: OllamaMessage[] = [{ role: "system", content: systemPrompt(settings) }];
  for (const m of history.slice(-30)) {
    if (m.content?.trim()) messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.content });
  }
  messages.push({ role: "user", content: prompt });

  let assembled = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let body: ReadableStream<Uint8Array> | null = null;
      // One retry: a model that turns out not to think refuses `think` with a
      // 400 that names it, and the fix is to stop sending it.
      while (!body) {
        const payload = JSON.stringify(buildChatBody(model, messages, toolDefs, think, numCtx));
        let res: Response;
        try {
          res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal: ac.signal });
        } catch (e) {
          if (isAbortError(e) || ac.signal.aborted) throw e; // the outer catch says "cancelled"
          yield { type: "error", message: `Could not reach Ollama at ${root}: ${e instanceof Error ? e.message : String(e)}. Is \`ollama serve\` running?` };
          return;
        }
        if (res.ok && res.body) { body = res.body; break; }
        const detail = (await res.text().catch(() => "")).slice(0, 600);
        if (res.status === 400 && think !== undefined && /think/i.test(detail)) { think = undefined; continue; }
        yield { type: "error", message: explainOllamaHttp(res.status, detail, model) };
        return;
      }

      // ── stream this round (NDJSON: one object per line) ───────────────────
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let roundText = "";
      let roundThinking = "";
      const calls: OllamaToolCall[] = [];
      let doneReason = "";

      readLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { chunks, rest } = drainNdjson(buf);
        buf = rest;
        for (const c of chunks) {
          if (c.error) { yield { type: "error", message: `Ollama: ${c.error}` }; return; }
          const th = c.message?.thinking;
          if (th) { roundThinking += th; yield { type: "thinking", text: th }; }
          const dc = c.message?.content;
          if (dc) { roundText += dc; assembled += dc; yield { type: "delta", text: dc }; }
          for (const tc of c.message?.tool_calls ?? []) if (tc?.function?.name) calls.push(tc);
          if (c.done) { doneReason = c.done_reason ?? ""; break readLoop; }
        }
      }
      // A final line with no trailing newline is still in the buffer.
      if (buf.trim()) {
        const { chunks } = drainNdjson(buf + "\n");
        for (const c of chunks) {
          if (c.message?.content) { roundText += c.message.content; assembled += c.message.content; yield { type: "delta", text: c.message.content }; }
          for (const tc of c.message?.tool_calls ?? []) if (tc?.function?.name) calls.push(tc);
        }
      }

      if (!calls.length) {
        const final = assembled.trim();
        if (final) yield { type: "done", text: final, costUsd: null };
        else if (doneReason === "length") yield { type: "error", message: `${model} ran out of room before answering. Start a new conversation, or start Ollama with a larger OLLAMA_CONTEXT_LENGTH.` };
        else yield { type: "error", message: `Ollama ended the turn without a reply${doneReason ? ` (${doneReason})` : ""}.` };
        return;
      }

      // ── run the tools it asked for, then loop with the results ─────────────
      // The assistant turn goes back with its reasoning, so a thinking model
      // sees what it already worked out rather than starting over.
      messages.push({ role: "assistant", content: roundText, ...(roundThinking ? { thinking: roundThinking } : {}), tool_calls: calls });

      for (const [i, call] of calls.entries()) {
        if (ac.signal.aborted) { yield { type: "error", message: CANCELLED }; return; }
        const args = (call.function.arguments && typeof call.function.arguments === "object") ? call.function.arguments : {};
        const activity: ToolActivity = {
          id: call.id || `${call.function.name}-${round}-${i}`, name: call.function.name,
          title: titleFor(call.function.name, args), status: "running", startedAt: Date.now(),
        };
        yield { type: "tool_start", tool: activity };
        if (call.function.name === "graph_upsert" && typeof args.caseName === "string") {
          yield { type: "graph_touched", caseName: args.caseName };
        }
        const { out, isError } = await run(call.function.name, args);
        yield { type: "tool_end", id: activity.id, status: isError ? "error" : "ok", detail: out.slice(0, 240) };
        messages.push(toolResultMessage(call, out.slice(0, MAX_TOOL_CHARS)));
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
