// ─────────────────────────────────────────────────────────────────────────────
// Turn the user's enabled custom modules into SDK tools Aether can call.
//   • command modules run a local shell command in the workspace (autonomy only).
//   • http modules call an API with the user's own keys.
// The module's description is the tool description — that is how Aether learns
// when to reach for it. A single free-form `input` argument is substituted into
// the template; secrets are injected as env vars (command) or resolved from
// `{{NAME}}` placeholders (http url / headers / body).
// ─────────────────────────────────────────────────────────────────────────────
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { exec } from "node:child_process";
import { paths } from "../config";
import { modules, type LiveModule } from "../modules";
import type { ToolContext } from "./context";
import { text } from "./context";

type SdkTool = ReturnType<typeof tool<any>>;

const OUT_CAP = 6000;
/** POSIX single-quote so an AI-supplied `input` can't break out of the command. */
const shellQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
/** Replace {{NAME}} with the module's decrypted secret value. */
const fillSecrets = (t: string, secrets: Record<string, string>) =>
  t.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, k) => secrets[k] ?? "");

function commandTool(m: LiveModule & { toolName: string }, ctx: ToolContext): SdkTool {
  return tool(
    m.toolName,
    `${m.description}\n\n(Custom local-command module "${m.name}". Runs in Aether's workspace.)`,
    { input: z.string().max(4000).optional().describe(m.inputLabel || "Text substituted into the command (available as {input} and the $AETHER_INPUT env var).") },
    async ({ input }) => {
      if (!ctx.isAutonomous()) {
        return text(`"${m.name}" is a local-command module and Safe mode is on, so the shell is withheld. Turn on Autonomy in Settings to use it.`, true);
      }
      const arg = input ?? "";
      const cmd = (m.command || "").replaceAll("{input}", shellQuote(arg));
      if (!cmd.trim()) return text(`Module "${m.name}" has no command configured.`, true);
      const env: NodeJS.ProcessEnv = { ...process.env, AETHER_INPUT: arg };
      for (const [k, v] of Object.entries(m.secretValues)) env[k] = v;
      return await new Promise((resolve) => {
        exec(cmd, { cwd: paths.workspace, timeout: 90_000, maxBuffer: 4 << 20, env }, (err, stdout, stderr) => {
          const out = [stdout?.trim(), stderr?.trim() ? `[stderr] ${stderr.trim()}` : ""].filter(Boolean).join("\n");
          if (err && !out) resolve(text(`"${m.name}" failed: ${err.message}`, true));
          else resolve(text(out.slice(0, OUT_CAP) || "(command produced no output)"));
        });
      });
    },
  );
}

function httpTool(m: LiveModule & { toolName: string }, ctx: ToolContext): SdkTool {
  return tool(
    m.toolName,
    `${m.description}\n\n(Custom HTTP-API module "${m.name}" — calls ${m.method || "GET"} ${m.url || "(no url)"} with your configured keys.)`,
    { input: z.string().max(4000).optional().describe(m.inputLabel || "Text substituted into the request (available as {input} in the URL and body).") },
    async ({ input }) => {
      const arg = input ?? "";
      if (!m.url) return text(`Module "${m.name}" has no URL configured.`, true);
      const url = fillSecrets((m.url || "").replaceAll("{input}", encodeURIComponent(arg)), m.secretValues);
      const headers: Record<string, string> = {};
      for (const h of m.headers ?? []) if (h.name.trim()) headers[h.name.trim()] = fillSecrets(h.value ?? "", m.secretValues);
      const method = m.method === "POST" ? "POST" : "GET";
      const body = method === "POST" && m.body ? fillSecrets(m.body.replaceAll("{input}", arg), m.secretValues) : undefined;
      try {
        const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30_000) });
        const txt = (await res.text()).slice(0, OUT_CAP);
        return text(`HTTP ${res.status} ${res.statusText}\n${txt || "(empty body)"}`, !res.ok);
      } catch (e) {
        return text(`"${m.name}" request failed: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    },
  );
}

export function buildModuleTools(ctx: ToolContext): SdkTool[] {
  return modules.liveCustom().map((m) => (m.kind === "http" ? httpTool(m, ctx) : commandTool(m, ctx)));
}
