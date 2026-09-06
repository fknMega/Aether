import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { paths, runtime } from "./config";
import { systemPrompt } from "./prompt";
import { findClaudeBinary } from "./auth";
import { buildToolServer } from "./tools";
import { makePolicy, SANDBOX_DENY_READ } from "./permissions";
import type { ToolContext } from "./tools/context";
import type { AetherSettings, AgentEvent, ToolActivity } from "../shared/types";

const offsecPlugin = { type: "local" as const, path: join(paths.pluginsDir, "aether-offsec"), skipMcpDiscovery: true };
const offsecSkills = [
  "aether-offsec:htb-methodology", "aether-offsec:network-recon", "aether-offsec:web-enumeration",
  "aether-offsec:exploitation-foothold", "aether-offsec:privilege-escalation", "aether-offsec:password-attacks",
];

/** `mcp__aether__username_search` / `WebSearch` -> a clean `username_search`. */
function friendlyToolName(raw: string): string {
  return raw.replace(/^mcp__[^_]+__/, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** A short, human title for a tool card from its parsed input. */
function titleFor(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
  switch (name) {
    case "username_search": return `Hunting @${s(i.username)} across platforms`;
    case "graph_upsert": return `Updating graph "${s(i.caseName)}"`;
    case "graph_get": return `Reading graph "${s(i.caseName)}"`;
    case "dns_lookup": return `DNS ${s(i.domain)}`;
    case "whois": return `WHOIS ${s(i.query)}`;
    case "http_probe": return `Fetching ${s(i.url)}`;
    case "exif_read": return `Reading EXIF`;
    case "reverse_image_urls": return `Reverse-image search`;
    case "nesher_search": return `Breach search "${s(i.q)}"`;
    case "nesher_power_search": return `Breach power-search`;
    case "facebook_id": return `Resolving Facebook ID`;
    case "web_search": return `Web search "${s(i.query)}"`;
    case "web_fetch": return `Reading ${s(i.url)}`;
    case "bash": return `Shell: ${s(i.command).slice(0, 60)}`;
    case "read": return `Reading ${s(i.file_path).split(/[\\/]/).pop()}`;
    case "write": return `Writing ${s(i.file_path).split(/[\\/]/).pop()}`;
    default: return name.replace(/_/g, " ");
  }
}

let warnedNoSandbox = false;
let toolServerPromise: ReturnType<typeof buildToolServer> | null = null;
function toolServer(ctx: ToolContext) {
  // Cache the built server, but don't cache a transient failure forever.
  if (!toolServerPromise) {
    toolServerPromise = buildToolServer(ctx).catch((e) => { toolServerPromise = null; throw e; });
  }
  return toolServerPromise;
}

/** Drop the cached tool server so the next turn rebuilds it — call after the
 *  module configuration changes (a toggle, add, edit, or delete). */
export function resetToolServer(): void { toolServerPromise = null; }

export async function* runTurn(
  prompt: string,
  resumeSessionId: string | null,
  settings: AetherSettings,
  ctx: ToolContext,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => abort.abort(), runtime.turnTimeoutMs);

  const { server } = await toolServer(ctx);
  if (settings.autonomy && process.platform === "win32" && !warnedNoSandbox) {
    warnedNoSandbox = true;
    console.warn("[aether] autonomy is on and this platform has no sandbox backend — commands run with the policy in main/permissions.ts as the only boundary.");
  }
  const policy = makePolicy({
    isAutonomous: ctx.isAutonomous,
    roots: () => [paths.workspace],
    onDenied: (tool, why) => console.warn(`[aether] refused ${tool}: ${why}`),
  });
  // Point the SDK at the real, unpacked binary. Its own resolution can land on
  // an app.asar path that the OS refuses to exec (ENOTDIR) in a packaged build.
  const claudeBin = findClaudeBinary();

  // Correlate streamed tool_use blocks with their results so the UI can animate
  // each call from running -> ok/error.
  const pending = new Map<string, { activity: ToolActivity; name: string }>(); // tool_use_id -> card
  const jsonBuf = new Map<number, { id: string; name: string; raw: string }>(); // block index -> accumulating input

  let assembled = "";
  let reportedSession = false;

  try {
    const stream = query({
      prompt,
      options: {
        model: settings.model,
        effort: settings.effort,
        systemPrompt: systemPrompt(settings),
        mcpServers: { aether: server },
        // NOT bypassPermissions. That flag skips `canUseTool` entirely, which
        // means no policy runs at all — every tool call is allowed, including a
        // shell command an injected web page talked the model into. Aether reads
        // attacker-controlled text for a living, so the boundary has to be real.
        // `canUseTool` is the enforcement point; see main/permissions.ts.
        permissionMode: "default",
        canUseTool: policy,
        // OS-level isolation for command execution — seatbelt on macOS,
        // bubblewrap on Linux. This is the only control here that is enforced
        // by the kernel rather than by us reading strings.
        //
        // failIfUnavailable is tied to autonomy on purpose: with the shell
        // enabled we refuse to run rather than silently degrade to an
        // unsandboxed agent. In safe mode Bash and the write tools are already
        // removed from context, so a missing bubblewrap is not worth bricking
        // the app over.
        //
        // Windows is excluded because the SDK's sandbox has no backend there —
        // failing closed would make autonomy simply not work on Windows rather
        // than make it safer. Windows users get layers 2-4 and the honest
        // warning below, which is worse, and is stated rather than hidden.
        sandbox: {
          enabled: true,
          failIfUnavailable: settings.autonomy && process.platform !== "win32",
          // Our canUseTool policy stays the decision-maker; the sandbox is the
          // floor under it, not a replacement for it.
          autoAllowBashIfSandboxed: false,
          filesystem: { denyRead: SANDBOX_DENY_READ },
        },
        settings: {
          permissions: {
            // Documented as enforced in EVERY permission mode — this is what
            // actually fences Read/Grep/Glob to the workspace. `cwd` alone
            // never did; it is a starting directory, not a boundary.
            blockReadsOutsideWorkingDirectories: true,
            additionalDirectories: [],
          },
        },
        // Deliberately empty. The agent's cwd is a directory it can write to,
        // so loading project settings from there would let it grant itself
        // permissions by writing .claude/settings.json into its own workspace.
        // Belt and braces: in safe mode the mutating tools are not merely denied
        // at call time, they are removed from the model's context entirely.
        ...(settings.autonomy ? {} : { disallowedTools: ["Bash", "Write", "Edit", "NotebookEdit"] }),
        // The workspace is the only root. Relative paths resolve here, and the
        // policy refuses absolute paths that lead anywhere else.
        cwd: paths.workspace,
        ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
        settingSources: [],
        plugins: existsSync(offsecPlugin.path) ? [offsecPlugin] : [],
        skills: existsSync(offsecPlugin.path) ? offsecSkills : [],
        includePartialMessages: true,
        abortController: abort,
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      },
    });

    for await (const message of stream) {
      switch (message.type) {
        case "system": {
          if (message.subtype === "init" && !reportedSession) {
            reportedSession = true;
            yield { type: "session", claudeSessionId: message.session_id };
          }
          break;
        }

        case "stream_event": {
          const ev = message.event;
          if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
            const idx = ev.index;
            const name = friendlyToolName(ev.content_block.name);
            jsonBuf.set(idx, { id: ev.content_block.id, name, raw: "" });
          } else if (ev.type === "content_block_delta") {
            if (ev.delta.type === "input_json_delta") {
              const buf = jsonBuf.get(ev.index);
              if (buf) buf.raw += ev.delta.partial_json;
            } else if (ev.delta.type === "text_delta" && ev.delta.text) {
              assembled += ev.delta.text;
              yield { type: "delta", text: ev.delta.text };
            } else if (ev.delta.type === "thinking_delta" && ev.delta.thinking) {
              yield { type: "thinking", text: ev.delta.thinking };
            }
          } else if (ev.type === "content_block_stop") {
            const buf = jsonBuf.get(ev.index);
            if (buf) {
              jsonBuf.delete(ev.index);
              let input: unknown = {};
              try { input = buf.raw ? JSON.parse(buf.raw) : {}; } catch { /* partial */ }
              const activity: ToolActivity = {
                id: buf.id, name: buf.name, title: titleFor(buf.name, input),
                status: "running", startedAt: Date.now(),
              };
              pending.set(buf.id, { activity, name: buf.name });
              yield { type: "tool_start", tool: activity };
              if (buf.name === "graph_upsert") {
                const caseName = (input as { caseName?: string }).caseName;
                if (caseName) yield { type: "graph_touched", caseName };
              }
            }
          }
          break;
        }

        case "user": {
          // tool_result blocks arrive on a synthetic user message.
          const content = (message as { message?: { content?: unknown } }).message?.content;
          if (Array.isArray(content)) {
            for (const block of content as Array<Record<string, unknown>>) {
              if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
                const card = pending.get(block.tool_use_id);
                if (card) {
                  pending.delete(block.tool_use_id);
                  const isError = block.is_error === true;
                  let detail = "";
                  const c = block.content;
                  if (typeof c === "string") detail = c;
                  else if (Array.isArray(c)) detail = c.map((b) => (typeof b?.text === "string" ? b.text : "")).join(" ");
                  yield { type: "tool_end", id: block.tool_use_id, status: isError ? "error" : "ok", detail: detail.trim().slice(0, 240) };
                }
              }
            }
          }
          break;
        }

        case "result": {
          if (message.subtype === "success") {
            const finalText = message.result?.trim() || assembled.trim();
            if (isNotLoggedIn(finalText)) { yield { type: "error", message: explainError(finalText) }; return; }
            yield { type: "done", text: finalText, costUsd: message.total_cost_usd ?? null };
          } else {
            yield { type: "error", message: describeFailure(message.subtype, assembled) };
          }
          return;
        }
      }
    }

    if (assembled.trim()) yield { type: "done", text: assembled.trim(), costUsd: null };
    else yield { type: "error", message: "Aether ended the turn without responding." };
  } catch (error) {
    yield { type: "error", message: explainError(error instanceof Error ? error.message : String(error)) };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

const isNotLoggedIn = (t: string) => /^\s*not logged in\b/i.test(t) || /please run \/login/i.test(t);

function describeFailure(subtype: string, partial: string): string {
  if (subtype === "error_max_turns") return "That took more back-and-forth than one turn allows. Try narrowing the request.";
  if (partial.trim()) return `The turn ended early (${subtype}). Partial reply: ${partial.trim()}`;
  return `The turn failed (${subtype}).`;
}

function explainError(raw: string): string {
  if (/not logged in|\/login/i.test(raw)) return "Aether isn't signed in to Claude. Open Settings and sign in, or run `npm run login`.";
  if (/abort/i.test(raw)) return "That request timed out or was cancelled.";
  return raw;
}
