// ─────────────────────────────────────────────────────────────────────────────
// Turn the user's enabled custom modules into SDK tools Aether can call.
//   • command modules run a local shell command in the workspace (withheld at
//     Safe access; at Ask the operator approves each run).
//   • http modules call an API with the user's own keys — either a fixed
//     template with one `{input}` slot, or, when the operator allows it, a
//     request the model shapes itself (path, method, query, body) against a
//     base URL whose origin the model cannot leave.
// The module's description is the tool description — that is how Aether learns
// when to reach for it — and the operator's notes ride along after it.
// ─────────────────────────────────────────────────────────────────────────────
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execFile, execFileSync } from "node:child_process";
import { platform } from "node:os";
import { paths, dotEnvKeys } from "../config";
import { modules, type LiveModule } from "../modules";
import type { ToolContext } from "./context";
import { text } from "./context";
import type { ModuleTestResult } from "../../shared/types";
import { renderCommand, windowsArgProblem, templateRequest, freeformRequest, describeCall, FREEFORM_METHODS, type HttpCall } from "./moduleRequests";

type SdkTool = ReturnType<typeof tool<any>>;
type Live = LiveModule & { toolName: string };

const OUT_CAP = 6000;
const isWin = platform() === "win32";

/** The PowerShell to run templates in on Windows: PowerShell 7 (`pwsh`) when
 *  it is installed — UTF-8 by default, actively maintained — else the 5.1
 *  that every Windows ships. Probed once; AETHER_POWERSHELL overrides. */
let psCache: string | undefined;
function powershell(): string {
  if (psCache) return psCache;
  if (process.env.AETHER_POWERSHELL) return (psCache = process.env.AETHER_POWERSHELL);
  try { execFileSync("where", ["pwsh"], { stdio: "ignore", timeout: 3000 }); psCache = "pwsh.exe"; }
  catch { psCache = "powershell.exe"; }
  return psCache;
}

/** The notes block, when the operator wrote one. */
const notes = (m: Live): string => (m.instructions?.trim() ? `\n\nOperator's notes for this module:\n${m.instructions.trim()}` : "");

/** Run a rendered command in the workspace with the module's secrets in its
 *  environment. Resolves with combined output; never rejects. */
export function runCommand(cmd: string, input: string, secretValues: Record<string, string>, timeoutMs = 90_000): Promise<{ out: string; error?: string }> {
  // Scrubbed: a command module gets the process environment MINUS every key
  // loaded from private/.env, plus only its own secrets. Handing every module
  // the full env meant one module's command could print another module's API
  // key — and the operator's — straight to stdout, which then goes to the model.
  const env: NodeJS.ProcessEnv = { ...process.env, AETHER_INPUT: input };
  for (const k of dotEnvKeys) delete env[k];
  for (const [k, v] of Object.entries(secretValues)) env[k] = v;
  const opts = { cwd: paths.workspace, timeout: timeoutMs, maxBuffer: 4 << 20, env };
  return new Promise((resolve) => {
    const done = (err: Error | null, stdout: string, stderr: string) => {
      const out = [stdout?.trim(), stderr?.trim() ? `[stderr] ${stderr.trim()}` : ""].filter(Boolean).join("\n");
      resolve(err && !out ? { out: "", error: err.message } : { out: out.slice(0, OUT_CAP) || "(command produced no output)" });
    };
    if (isWin) {
      // UTF-16LE base64 is what -EncodedCommand takes. The script sets nothing
      // and reads nothing but the template; secrets arrive as $env: variables.
      // powershell.exe is started directly (no shell option), so cmd.exe never
      // sees the command line, and base64 has nothing any quoting could mangle.
      const encoded = Buffer.from(cmd, "utf16le").toString("base64");
      // Windows caps a command line at 32,767 characters.
      if (encoded.length > 30_000) { resolve({ out: "", error: "The command is too long to run on Windows (over ~10 KB after encoding). Shorten the module's command." }); return; }
      execFile(powershell(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], opts, done);
    } else {
      execFile("/bin/sh", ["-c", cmd], opts, done);
    }
  });
}

function commandTool(m: Live, ctx: ToolContext): SdkTool {
  return tool(
    m.toolName,
    `${m.description}\n\n(Custom local-command module "${m.name}". Runs in Aether's workspace${isWin ? " in PowerShell" : ""}.)${notes(m)}`,
    { input: z.string().max(4000).optional().describe(m.inputLabel || "Text substituted into the command (available as {input} and the $AETHER_INPUT env var).") },
    async ({ input }) => {
      // The access gate lives HERE, in the handler, rather than in the Claude
      // path's canUseTool policy — so ChatGPT, Gemini and Ollama get exactly
      // the same answer. Safe withholds the shell; Ask shows the operator the
      // exact command, with the input already substituted; Full just runs it.
      const level = ctx.access();
      if (level === "safe") {
        return text(`"${m.name}" is a local-command module and access is set to Safe, so the shell is withheld. Set access to Ask or Full — in Settings, or from the picker under the chat — to use it.`, true);
      }
      const arg = input ?? "";
      if (isWin) { const bad = windowsArgProblem(arg); if (bad) return text(bad, true); }
      const rendered = renderCommand(m.command || "", arg);
      if (typeof rendered !== "string") return text(`Module "${m.name}": ${rendered.error}`, true);
      const cmd = rendered;
      if (!cmd.trim()) return text(`Module "${m.name}" has no command configured.`, true);
      if (level === "ask") {
        const ok = await ctx.requestPermission({
          kind: "shell", title: "Run a shell command", detail: cmd,
          reason: `The "${m.name}" module.`,
        });
        if (!ok) return text(`You declined: run a shell command ("${m.name}"). Continue without it rather than retrying.`, true);
      }
      const r = await runCommand(cmd, arg, m.secretValues);
      return r.error ? text(`"${m.name}" failed: ${r.error}`, true) : text(r.out);
    },
  );
}

// ── http modules ────────────────────────────────────────────────────────────

const MAX_HOPS = 5;

/** Perform one call. Redirects are followed only while they stay on the
 *  request's own origin — the boundary freeformRequest enforces — so a
 *  redirect on the operator's host cannot carry the module's headers (its
 *  API keys) to another host, or to loopback. Never rejects. */
export async function performHttp(call: HttpCall, timeoutMs = 30_000): Promise<{ status?: number; statusText?: string; body: string; error?: string }> {
  try {
    const origin = new URL(call.url).origin;
    let url = call.url, method = call.method, body = call.body;
    for (let hops = 0; ; hops++) {
      const res = await fetch(url, { method, headers: call.headers, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      const loc = res.headers.get("location");
      if (!(res.status >= 300 && res.status < 400 && loc)) {
        return { status: res.status, statusText: res.statusText, body: (await res.text()).slice(0, OUT_CAP) };
      }
      let next: URL;
      try { next = new URL(loc, url); } catch { return { status: res.status, statusText: res.statusText, body: `(redirect to an invalid location: ${loc.slice(0, 200)})` }; }
      if (next.origin !== origin) {
        return { status: res.status, statusText: res.statusText, body: `(redirect to ${next.origin} not followed — requests stay on ${origin})` };
      }
      if (hops >= MAX_HOPS) return { status: res.status, statusText: res.statusText, body: "(too many redirects)" };
      url = next.href;
      // 303, and 301/302 on a POST, become GET without a body (what browsers do).
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
    }
  } catch (e) {
    return { body: "", error: e instanceof Error ? e.message : String(e) };
  }
}

function httpTool(m: Live): SdkTool {
  if (m.freeform) {
    return tool(
      m.toolName,
      `${m.description}\n\n(Custom HTTP-API module "${m.name}". You may shape the request: choose a path under ${m.url || "(no base url)"}, a method, query parameters and a body. The module's own headers and keys are added for you. Requests cannot leave that host.)${notes(m)}`,
      {
        path: z.string().max(2000).optional().describe("Path relative to the module's base URL, e.g. `users/jane` or `/v2/search`. Leave empty to call the base URL itself."),
        method: z.enum(FREEFORM_METHODS).optional().describe("HTTP method. Defaults to GET."),
        query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Query-string parameters to add."),
        body: z.string().max(20000).optional().describe("Request body for POST/PUT/PATCH — JSON text is sent as application/json."),
      },
      async (args) => {
        const call = freeformRequest(m, args);
        if ("error" in call) return text(call.error, true);
        const r = await performHttp(call);
        if (r.error) return text(`"${m.name}" request failed: ${r.error}`, true);
        return text(`${describeCall(call, m)}\nHTTP ${r.status} ${r.statusText}\n${r.body || "(empty body)"}`, !(r.status && r.status < 400));
      },
    );
  }
  return tool(
    m.toolName,
    `${m.description}\n\n(Custom HTTP-API module "${m.name}" — calls ${m.method || "GET"} ${m.url || "(no url)"} with your configured keys.)${notes(m)}`,
    { input: z.string().max(4000).optional().describe(m.inputLabel || "Text substituted into the request (available as {input} in the URL and body).") },
    async ({ input }) => {
      const call = templateRequest(m, input ?? "");
      if ("error" in call) return text(call.error, true);
      const r = await performHttp(call);
      if (r.error) return text(`"${m.name}" request failed: ${r.error}`, true);
      return text(`HTTP ${r.status} ${r.statusText}\n${r.body || "(empty body)"}`, !(r.status && r.status < 400));
    },
  );
}

export function buildModuleTools(_ctx: ToolContext): SdkTool[] {
  return modules.liveCustom().map((m) => (m.kind === "http" ? httpTool(m) : commandTool(m, _ctx)));
}

// ── "Try it" from the editor ────────────────────────────────────────────────

/**
 * Run a module draft once with a sample input, for the operator to see what
 * the model would get. An explicit click, so no permission prompt — but the
 * shell is still withheld at Safe, and nothing here touches the store.
 */
export async function testModule(
  m: Live,
  sample: string,
  access: () => "safe" | "ask" | "full",
): Promise<ModuleTestResult> {
  const t0 = Date.now();
  if (m.kind === "http") {
    const call = m.freeform
      ? freeformRequest(m, { path: sample.startsWith("{") ? undefined : sample, ...(sample.startsWith("{") ? safeJson(sample) : {}) })
      : templateRequest(m, sample);
    if ("error" in call) return { ok: false, request: "", output: call.error, ms: Date.now() - t0 };
    const r = await performHttp(call);
    return {
      ok: !r.error && !!r.status && r.status < 400,
      request: describeCall(call, m),
      status: r.status,
      output: r.error ? r.error : (r.body || "(empty body)"),
      ms: Date.now() - t0,
    };
  }
  if (access() === "safe") return { ok: false, request: "", output: "Access is set to Safe, so the shell is withheld. Switch to Ask or Full to try a command module.", ms: 0 };
  if (isWin) { const bad = windowsArgProblem(sample); if (bad) return { ok: false, request: "", output: bad, ms: 0 }; }
  const rendered = renderCommand(m.command || "", sample);
  if (typeof rendered !== "string") return { ok: false, request: "", output: rendered.error, ms: 0 };
  const cmd = rendered;
  if (!cmd.trim()) return { ok: false, request: "", output: "No command configured.", ms: 0 };
  const r = await runCommand(cmd, sample, m.secretValues, 60_000);
  return { ok: !r.error, request: cmd, output: r.error ? r.error : r.out, ms: Date.now() - t0 };
}

/** A JSON object typed into the test box for a freeform module, or nothing. */
function safeJson(s: string): { path?: string; method?: string; query?: Record<string, string | number | boolean>; body?: string } {
  try {
    const j = JSON.parse(s) as Record<string, unknown>;
    return {
      ...(typeof j.path === "string" ? { path: j.path } : {}),
      ...(typeof j.method === "string" ? { method: j.method } : {}),
      ...(j.query && typeof j.query === "object" ? { query: j.query as Record<string, string | number | boolean> } : {}),
      ...(typeof j.body === "string" ? { body: j.body } : j.body && typeof j.body === "object" ? { body: JSON.stringify(j.body) } : {}),
    };
  } catch { return {}; }
}
