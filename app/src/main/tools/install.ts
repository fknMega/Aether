// ─────────────────────────────────────────────────────────────────────────────
// Letting Aether ask for a tool it needs.
//
// Roughly twenty bundled modules drive a command-line program. When one is
// missing, Aether previously just failed and moved on — the operator had to
// notice, work out which binary was involved, and go install it. Now it can say
// "I need subfinder for this, may I install it?" and the operator answers.
//
// The safety story is entirely in what this CANNOT do. It takes a module id,
// not a command: the actual install command is a constant in installer.ts,
// chosen by us, never assembled from anything the model said. An id we do not
// recognise is refused before anything spawns. And the permission policy gates
// the call itself, so at access level "ask" nothing runs until a human agrees.
// ─────────────────────────────────────────────────────────────────────────────
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { installTool, toolFor, toolStatuses, allTools } from "../installer";
import { modules } from "../modules";
import type { ToolContext } from "./context";
import { text } from "./context";

const nameFor = (id: string) => modules.list().find((m) => m.id === id)?.name ?? id;

export function installTools(_ctx: ToolContext) {
  const list = tool(
    "tool_status",
    "List the command-line programs the bundled modules depend on and whether each is installed on this machine. " +
      "Call this when a command module fails, or before planning work that needs one, so you can tell the operator " +
      "what is missing instead of guessing.",
    {},
    async () => {
      const rows = await toolStatuses(nameFor);
      const line = (s: (typeof rows)[number]) =>
        `${s.bin}: ${s.state}${s.state === "missing" && s.via ? ` (installable with \`${s.via}\`)` : ""}` +
        `${s.state === "unavailable" && s.manual ? ` (needs the operator to run \`${s.manual}\`)` : ""}`;
      const missing = rows.filter((r) => r.state !== "installed");
      if (!missing.length) return text(`All ${rows.length} bundled command-line tools are installed.`);
      return text(
        `${rows.length - missing.length} of ${rows.length} installed. Not ready:\n` +
          missing.map(line).join("\n") +
          `\n\nUse install_tool with the module id to request one. The operator approves each install.`,
      );
    },
  );

  const install = tool(
    "install_tool",
    "Ask to install the command-line program a bundled module needs (for example subfinder, nuclei, maigret). " +
      "The operator is shown the request and approves or refuses it — never assume it succeeded. " +
      "Only bundled module ids are accepted; you cannot specify a command, a package name, or a URL.",
    {
      module: z.string().min(1).max(120).describe(
        "The bundled module id, e.g. `def:subfinder`. Get valid ids from tool_status.",
      ),
      reason: z.string().max(300).optional().describe(
        "One line on why it is needed for the current case — the operator sees this.",
      ),
    },
    async ({ module, reason }) => {
      const spec = toolFor(module);
      if (!spec) {
        const ids = allTools().map((t) => t.moduleId).join(", ");
        return text(`\`${module}\` is not a module with an installable program. Valid ids: ${ids}`, true);
      }

      const before = (await toolStatuses(nameFor)).find((r) => r.moduleId === module);
      if (before?.state === "installed") return text(`${spec.bin} is already installed at ${before.path}.`);
      if (before?.state === "unavailable") {
        return text(
          `${spec.bin} cannot be installed automatically here. Tell the operator to run: ${before.manual}`,
          true,
        );
      }

      const lines: string[] = [];
      const ok = await installTool(module, (e) => { if (e.line) lines.push(e.line); });
      if (ok) return text(`Installed ${spec.bin}. The ${nameFor(module)} module can be switched on now.`);
      const tail = lines.slice(-6).join("\n");
      return text(
        `Could not install ${spec.bin}${tail ? `:\n${tail}` : "."}\n` +
          `It may have been refused by the operator. Continue without it rather than retrying.`,
        true,
      );
    },
  );

  return [list, install];
}
