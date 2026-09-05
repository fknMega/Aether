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

type SdkTool = ReturnType<typeof tool<any>>;

/**
 * Load every `private/connectors/*.mjs`. Each default-exports a factory
 * `({ tool, z, config }) => Tool[]`. This is how the licensed breach connector
 * reaches Aether on the owner's machine without ever entering the public repo.
 */
async function loadPrivateConnectors(ctx: ToolContext): Promise<{ tools: SdkTool[]; names: string[] }> {
  const dir = paths.connectorsDir;
  const tools: SdkTool[] = [];
  const names: string[] = [];
  if (!existsSync(dir)) return { tools, names };
  for (const file of readdirSync(dir)) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    try {
      const mod = await import(pathToFileURL(join(dir, file)).href);
      const factory = mod.default ?? mod.register;
      if (typeof factory !== "function") continue;
      const produced: SdkTool[] = factory({ tool, z, config: { timezone: ctx.timezone } }) ?? [];
      for (const t of produced) { tools.push(t); names.push((t as { name?: string }).name ?? "?"); }
    } catch (e) {
      console.error(`[aether] failed to load private connector ${file}:`, e);
    }
  }
  return { tools, names };
}

/** Every tool Aether can call, as plain SDK tool objects. Used directly by the
 *  OpenAI-compatible engine (ChatGPT / Ollama), and wrapped in an MCP server for
 *  the Claude Agent SDK. */
export async function buildToolList(ctx: ToolContext): Promise<{ tools: SdkTool[]; privateToolNames: string[] }> {
  // time + graph are core (always on). The rest are gated by their module toggle.
  const builtIn: SdkTool[] = [
    ...timeTools(ctx),
    ...graphTools(ctx),
    ...(modules.isBuiltinEnabled("username") ? usernameTools() : []),
    ...(modules.isBuiltinEnabled("recon") ? netTools() : []),
    ...(modules.isBuiltinEnabled("exif") ? exifTools() : []),
    ...(modules.isBuiltinEnabled("reverse_image") ? imageTools() : []),
    ...buildModuleTools(ctx),
  ];
  const priv = await loadPrivateConnectors(ctx);
  modules.setConnectorNames(priv.names.filter((n) => n && n !== "?"));
  if (priv.names.length) console.log(`[aether] loaded private connector tools: ${priv.names.join(", ")}`);
  return { tools: [...builtIn, ...priv.tools], privateToolNames: priv.names };
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
      "metadata; reverse_image_urls builds reverse-image searches.",
    tools,
  });

  return { server, privateToolNames };
}
