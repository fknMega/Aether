import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { paths } from "../config";
import { modules } from "../modules";
import type { ToolContext } from "./context";
import { timeTools } from "./time";
import { graphTools } from "./graph";
import { netTools } from "./net";
import { exifTools } from "./exif";
import { imageTools } from "./image";
import { usernameTools } from "./username";
import { buildModuleTools } from "./customModules";
import { installTools } from "./install";

type SdkTool = ReturnType<typeof tool<any>>;

/** One connector file and the tools it produced. `failed` marks a file that
 *  is on disk but could not be loaded (a syntax error mid-edit, a missing
 *  dependency); its module is kept — switch, name, notes — for when it works. */
interface Connector { file: string; tools: SdkTool[]; toolNames: string[]; failed?: boolean; }

/**
 * Load every `private/connectors/*.mjs`. Each default-exports a factory
 * `({ tool, z, config }) => Tool[]`. This is how the licensed breach connector
 * reaches Aether on the owner's machine without ever entering the public repo.
 */
async function loadPrivateConnectors(ctx: ToolContext): Promise<Connector[]> {
  const dir = paths.connectorsDir;
  const out: Connector[] = [];
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    try {
      const mod = await import(pathToFileURL(join(dir, file)).href);
      const factory = mod.default ?? mod.register;
      if (typeof factory !== "function") continue;
      const produced: SdkTool[] = factory({ tool, z, config: { timezone: ctx.timezone } }) ?? [];
      const toolNames = produced.map((t) => (t as { name?: string }).name ?? "").filter(Boolean);
      out.push({ file, tools: produced, toolNames });
    } catch (e) {
      console.error(`[aether] failed to load private connector ${file}:`, e);
      out.push({ file, tools: [], toolNames: [], failed: true });
    }
  }
  return out;
}

/** The operator's notes for a module, appended to each of its tools where the
 *  model reads about the tool — a copy, so the underlying tool object (which
 *  the Claude MCP server also holds) is never mutated. */
export function withNotes<T extends { description: string }>(tools: T[], notes: string | undefined): T[] {
  const n = notes?.trim();
  if (!n) return tools;
  return tools.map((t) => ({ ...t, description: `${t.description}\n\nOperator's notes for this module:\n${n}` }));
}

/** Every tool Aether can call, as plain SDK tool objects. Used directly by the
 *  non-Claude engines, and wrapped in an MCP server for the Claude Agent SDK. */
export async function buildToolList(ctx: ToolContext): Promise<{ tools: SdkTool[]; privateToolNames: string[] }> {
  // time + graph are core (always on). The rest are gated by their module toggle.
  const group = (key: "username" | "recon" | "exif" | "reverse_image", make: () => SdkTool[]) =>
    modules.isBuiltinEnabled(key) ? withNotes(make(), modules.builtinNotes(key)) : [];
  const builtIn: SdkTool[] = [
    ...timeTools(ctx),
    ...graphTools(ctx),
    ...group("username", usernameTools),
    ...group("recon", netTools),
    ...group("exif", exifTools),
    ...group("reverse_image", imageTools),
    // Asking for a missing program is always available; the permission policy
    // decides whether the request reaches the operator or is refused outright.
    ...installTools(ctx),
    ...buildModuleTools(ctx),
  ];
  const connectors = await loadPrivateConnectors(ctx);
  // One module per connector file: the operator can switch it off, rename it,
  // and leave notes for the model, exactly as with a module they typed in.
  modules.registerConnectors(connectors.map((c) => ({ file: c.file, toolNames: c.toolNames, failed: c.failed })));
  const privateTools: SdkTool[] = [];
  const privateToolNames: string[] = [];
  const withheld: string[] = [];
  for (const c of connectors) {
    for (const t of c.tools) {
      const name = (t as { name?: string }).name ?? "";
      const mod = modules.connectorFor(name);
      if (mod && !mod.enabled) { withheld.push(name); continue; }
      privateTools.push(...withNotes([t as SdkTool & { description: string }], mod?.instructions));
      privateToolNames.push(name);
    }
  }
  if (privateToolNames.length) console.log(`[aether] loaded private connector tools: ${privateToolNames.join(", ")}`);
  if (withheld.length) console.log(`[aether] connector tools withheld (module switched off): ${withheld.join(", ")}`);
  return { tools: [...builtIn, ...privateTools], privateToolNames };
}

export async function buildToolServer(ctx: ToolContext) {
  const { tools, privateToolNames } = await buildToolList(ctx);

  const server = createSdkMcpServer({
    name: "aether",
    version: "2.0.0",
    instructions:
      "Aether's collection tools. graph_upsert/graph_get maintain the operator's live knowledge graph — " +
      "the primary workspace, updated as selectors are found and resolved. username_search hunts a handle " +
      "across platforms; dns_lookup/whois/http_probe do infrastructure recon; exif_read pulls image " +
      "metadata; reverse_image_urls builds reverse-image searches. tool_status reports which command-line " +
      "programs are installed, and install_tool asks the operator to install a missing one.",
    tools,
  });

  return { server, privateToolNames };
}
