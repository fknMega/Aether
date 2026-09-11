// ─────────────────────────────────────────────────────────────────────────────
// What every turn runner has in common.
//
// Aether has four brains but one set of tools, one access policy and one
// transcript. The Claude runner gets its policy applied by the Agent SDK
// (canUseTool); the ChatGPT, Gemini and Ollama runners call tool handlers
// directly, so THEY have to apply it — otherwise "Ask" would mean "ask, but
// only when Claude is driving". This module is the one place that decides
// what a tool call is allowed to do, whichever model asked for it.
// ─────────────────────────────────────────────────────────────────────────────
import { z } from "zod";
import { paths } from "./config";
import { makePolicy } from "./permissions";
import type { ToolContext } from "./tools/context";

/** The shape the SDK's `tool()` helper returns, as much of it as we touch. */
export type SdkTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown, extra: unknown) => Promise<{ content?: Array<{ type?: string; text?: string }>; isError?: boolean }>;
};

/** How much of one tool result is fed back to the model. */
export const MAX_TOOL_CHARS = 8000;
/** Tool-call rounds before a turn is stopped rather than looped forever. */
export const MAX_ROUNDS = 12;

export const textOf = (r: { content?: Array<{ type?: string; text?: string }> } | undefined): string =>
  (r?.content ?? []).map((c) => (typeof c?.text === "string" ? c.text : "")).join("\n").trim();

/** A tool's zod shape as JSON Schema, or null for one that cannot be expressed. */
export function jsonSchemaFor(t: SdkTool): Record<string, unknown> | null {
  try {
    const schema = z.toJSONSchema(z.object((t.inputSchema ?? {}) as never), { io: "input" }) as Record<string, unknown>;
    delete schema.$schema;
    return schema;
  } catch { return null; }
}

/** A short, human title for the activity card. One table for every runner, so
 *  the transcript reads the same whichever model made the call. */
export function titleFor(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
  switch (name) {
    case "username_search": return `Hunting @${s(i.username)} across platforms`;
    case "graph_upsert": return `Updating graph "${s(i.caseName)}"`;
    case "graph_get": return `Reading graph "${s(i.caseName)}"`;
    case "dns_lookup": return `DNS ${s(i.domain)}`;
    case "whois": return `WHOIS ${s(i.query)}`;
    case "http_probe": return `Fetching ${s(i.url)}`;
    case "exif_read": return "Reading EXIF";
    case "reverse_image_urls": return "Reverse-image search";
    case "tool_status": return "Checking installed tools";
    case "install_tool": return `Asking to install ${s(i.module)}`;
    case "nesher_search": return `Breach search "${s(i.q)}"`;
    case "nesher_power_search": return "Breach power-search";
    case "facebook_id": return "Resolving Facebook ID";
    case "web_search": return `Web search "${s(i.query)}"`;
    case "web_fetch": return `Reading ${s(i.url)}`;
    case "bash": return `Shell: ${s(i.command).slice(0, 60)}`;
    case "read": return `Reading ${s(i.file_path).split(/[\\/]/).pop()}`;
    case "write": return `Writing ${s(i.file_path).split(/[\\/]/).pop()}`;
    default: return name.replace(/_/g, " ") + (i.input ? ` "${s(i.input)}"` : "");
  }
}

export interface ToolRunResult { out: string; isError: boolean; }

/**
 * The in-process tool set, with the access policy in front of it.
 *
 * `run` is what a non-Claude runner calls for each tool the model asked for.
 * The name is passed through the same policy the Agent SDK consults, under the
 * same `mcp__aether__` prefix it would carry there, so a fetch of a URL the
 * model chose or a request to install a tool is a decision at "Ask" and a
 * refusal at "Safe" on every provider — not just the one whose SDK happens to
 * expose a permission callback. A refusal is returned to the model as an error
 * result with the reason, which is how the Claude path reports it too.
 */
export const CANCELLED = "That request was cancelled.";

export function gatedTools(ctx: ToolContext, tools: SdkTool[], signal: AbortSignal) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const policy = makePolicy({
    access: ctx.access,
    roots: () => [paths.workspace],
    onDenied: (tool, why) => console.warn(`[aether] refused ${tool}: ${why}`),
    ask: ctx.requestPermission,
  });

  async function run(name: string, args: Record<string, unknown>): Promise<ToolRunResult> {
    const tool = byName.get(name);
    if (!tool) return { out: `No such tool: ${name}`, isError: true };
    // A stopped turn raises no new question and runs nothing further. Checked
    // here, not only at the loop, because a round can hold several calls and
    // the Stop can land while an earlier one is still being decided.
    if (signal.aborted) return { out: CANCELLED, isError: true };
    // The Agent SDK validates arguments against the tool's zod shape before a
    // handler ever sees them; here that is our job. It is also what makes the
    // consent prompt honest — a URL sent as an array would show no URL at all.
    const parsed = z.object((tool.inputSchema ?? {}) as z.ZodRawShape).safeParse(args ?? {});
    if (!parsed.success) return { out: `Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}`, isError: true };
    const input = parsed.data as Record<string, unknown>;
    let verdict: Awaited<ReturnType<typeof policy>>;
    try {
      verdict = await policy(`mcp__aether__${name}`, input, {} as never);
    } catch (e) {
      return { out: `Refused: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
    if (verdict && verdict.behavior === "deny") return { out: verdict.message, isError: true };
    // The operator may have pressed Stop while the prompt was up and then
    // clicked Allow in the same instant; the Stop wins.
    if (signal.aborted) return { out: CANCELLED, isError: true };
    try {
      const r = await tool.handler(input, {});
      return { out: textOf(r) || "(no output)", isError: !!r?.isError };
    } catch (e) {
      return { out: `Tool failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  return { byName, run };
}

/** True for the rejection `fetch` throws when its signal aborts — so a Stop or
 *  a turn timeout is reported as a cancellation, not as an unreachable server. */
export const isAbortError = (e: unknown): boolean =>
  e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
