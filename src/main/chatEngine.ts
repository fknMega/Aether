// ─────────────────────────────────────────────────────────────────────────────
// OpenAI-compatible turn runner. Drives ChatGPT (api.openai.com) and any local
// OpenAI-compatible server — Ollama's /v1 in particular — over
// POST /chat/completions with streaming + tool calling.
//
// It reuses the exact same in-process tools as the Claude path: each SDK tool's
// zod shape is converted to JSON Schema for the `tools` array, and its handler is
// invoked when the model calls it. Emits the same AgentEvent stream as the Claude
// runner, so the UI can't tell which brain is behind a turn.
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { systemPrompt } from "./prompt";
import { buildToolList } from "./tools";
import { secrets, OPENAI_KEY } from "./secrets";
import { runtime } from "./config";
import type { ToolContext } from "./tools/context";
import type { AetherSettings, AgentEvent, Message, ToolActivity } from "../shared/types";

type SdkTool = { name: string; description: string; inputSchema: Record<string, unknown>; handler: (args: unknown, extra: unknown) => Promise<{ content?: Array<{ type?: string; text?: string }>; isError?: boolean }> };

interface OaiToolCall { id: string; name: string; args: string; }
interface OaiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

const MAX_ROUNDS = 12;        // tool-call rounds before we stop looping
const MAX_TOOL_CHARS = 8000;  // cap a single tool result fed back to the model

/** Where to send the request, and how to authenticate, for the active provider. */
function endpointFor(settings: AetherSettings): { url: string; model: string; headers: Record<string, string>; label: string } {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.provider === "openai") {
    const base = (settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const key = secrets.get(OPENAI_KEY);
    if (key) headers.Authorization = `Bearer ${key}`;
    return { url: `${base}/chat/completions`, model: settings.openaiModel || "gpt-4o", headers, label: "ChatGPT" };
  }
  const base = (settings.ollamaBaseUrl || "http://localhost:11434/v1").replace(/\/+$/, "");
  return { url: `${base}/chat/completions`, model: settings.ollamaModel || "llama3.1", headers, label: "Ollama" };
}

/** SDK tools -> OpenAI function-tool definitions (zod shape -> JSON Schema). */
function toOpenAiTools(tools: SdkTool[]) {
  const out: Array<{ type: "function"; function: { name: string; description: string; parameters: unknown } }> = [];
  for (const t of tools) {
    try {
      const parameters = z.toJSONSchema(z.object((t.inputSchema ?? {}) as never), { io: "input" }) as Record<string, unknown>;
      delete parameters.$schema;
      out.push({ type: "function", function: { name: t.name, description: (t.description || "").slice(0, 1024), parameters } });
    } catch { /* a schema we can't express as JSON Schema — skip that tool */ }
  }
  return out;
}

const textOf = (r: { content?: Array<{ type?: string; text?: string }> } | undefined): string =>
  (r?.content ?? []).map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n").trim();

/** A short, human title for the activity card (mirrors the Claude runner). */
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

export async function* runChatTurn(
  prompt: string,
  history: Message[],
  settings: AetherSettings,
  ctx: ToolContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const { url, model, headers, label } = endpointFor(settings);
  if (settings.provider === "openai" && !secrets.get(OPENAI_KEY)) {
    yield { type: "error", message: "No OpenAI API key set. Add one in Settings → Model, or switch provider." };
    return;
  }

  const { tools } = await buildToolList(ctx);
  const byName = new Map(tools.map((t) => [(t as unknown as SdkTool).name, t as unknown as SdkTool]));
  const toolDefs = toOpenAiTools(tools as unknown as SdkTool[]);

  const messages: OaiMessage[] = [{ role: "system", content: systemPrompt(settings) }];
  for (const m of history.slice(-30)) {
    if (m.content?.trim()) messages.push({ role: m.role === "user" ? "user" : "assistant", content: m.content });
  }
  messages.push({ role: "user", content: prompt });

  const timeout = setTimeout(() => { /* the caller's signal drives abort */ }, runtime.turnTimeoutMs);
  let assembled = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const body = JSON.stringify({ model, messages, stream: true, ...(toolDefs.length ? { tools: toolDefs } : {}) });
      let res: Response;
      try {
        res = await fetch(url, { method: "POST", headers, body, signal });
      } catch (e) {
        yield { type: "error", message: `Could not reach ${label} at ${url}: ${e instanceof Error ? e.message : String(e)}` };
        return;
      }
      if (!res.ok || !res.body) {
        const detail = (await res.text().catch(() => "")).slice(0, 400);
        yield { type: "error", message: `${label} returned HTTP ${res.status}. ${detail}` };
        return;
      }

      // ── stream this round ──────────────────────────────────────────────────
      const reader = res.body.getReader();
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
            let json: { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }> };
            try { json = JSON.parse(payload); } catch { continue; }
            const choice = json.choices?.[0];
            if (!choice) continue;
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
        messages.push({ role: "tool", tool_call_id: activity.id, content: out.slice(0, MAX_TOOL_CHARS) });
      }
    }

    const final = assembled.trim();
    if (final) yield { type: "done", text: final, costUsd: null };
    else yield { type: "error", message: "Hit the tool-call limit for one turn. Try narrowing the request." };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    yield { type: "error", message: /abort/i.test(msg) ? "That request was cancelled." : msg };
  } finally {
    clearTimeout(timeout);
  }
}

/** Ask a local Ollama for the models it has pulled (used by the model picker). */
export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const root = (baseUrl || "http://localhost:11434/v1").replace(/\/v1\/?$/, "").replace(/\/+$/, "");
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { models?: Array<{ name?: string }> };
    return (j.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch { return []; }
}
