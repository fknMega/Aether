import { ipcMain, BrowserWindow } from "electron";
import { writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IPC } from "../shared/ipc";
import { paths, runtime, loadSettings } from "./config";
import { store } from "./store";
import { modules } from "./modules";
import { runTurn, resetToolServer } from "./agent";
import { runChatTurn, listOllamaModels } from "./chatEngine";
import { secrets, OPENAI_KEY } from "./secrets";
import { decodeImages, writeAttachments, attachedImagesBlock } from "./images";
import { authStatus, authLogin } from "./auth";
import type { ToolContext } from "./tools/context";
import type { AetherSettings, ChatRequest, ModuleConfig, Provider, ProviderStatus } from "../shared/types";

let settings: AetherSettings = loadSettings();
const activeTurns = new Map<string, AbortController>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

const toolCtx: ToolContext = {
  timezone: runtime.timezone,
  notifyGraphChanged: (caseName) => broadcast(IPC.graphChanged, { caseName }),
  // Reads the live setting each turn (the tool server is cached, so this closure
  // is how safe mode reaches command modules without a rebuild).
  isAutonomous: () => settings.autonomy,
};

/** After any module change: rebuild the tool server next turn and tell the UI. */
function afterModuleChange(result: ModuleConfig[]): ModuleConfig[] {
  resetToolServer();
  broadcast(IPC.modulesChanged, null);
  return result;
}

function saveSettings(): void {
  try { writeFileSync(paths.settingsFile, JSON.stringify(settings, null, 2), "utf8"); }
  catch (e) { console.error("[aether] could not save settings:", e); }
}

/** Accept only known settings keys with sane values from the renderer. */
function sanitizeSettings(patch: Partial<AetherSettings>): Partial<AetherSettings> {
  const out: Partial<AetherSettings> = {};
  if (typeof patch.ownerName === "string") out.ownerName = patch.ownerName.slice(0, 80);
  if (typeof patch.model === "string") out.model = patch.model.slice(0, 120);
  if (["low", "medium", "high", "xhigh", "max"].includes(patch.effort as string)) out.effort = patch.effort;
  if (patch.personaVoice === "flirty" || patch.personaVoice === "professional") out.personaVoice = patch.personaVoice;
  if (typeof patch.autonomy === "boolean") out.autonomy = patch.autonomy;
  if (["claude", "openai", "ollama"].includes(patch.provider as string)) out.provider = patch.provider;
  for (const k of ["openaiBaseUrl", "openaiModel", "ollamaBaseUrl", "ollamaModel"] as const) {
    if (typeof patch[k] === "string") out[k] = (patch[k] as string).slice(0, 300);
  }
  return out;
}

async function startTurn(req: ChatRequest, conversationId: string, prompt: string, resumeId: string | null): Promise<void> {
  const abort = new AbortController();
  activeTurns.set(req.turnId, abort);
  const send = (event: unknown) => broadcast(IPC.chatEvent, { turnId: req.turnId, event });

  send({ type: "start", turnId: req.turnId, conversationId });
  let finalText = "";
  let cost: number | null = null;
  let failed = false;
  try {
    const prior = settings.provider === "claude" ? [] : store.listMessages(conversationId).slice(0, -1);
    const stream = settings.provider === "claude"
      ? runTurn(prompt, resumeId, settings, toolCtx, abort.signal)
      : runChatTurn(prompt, prior, settings, toolCtx, abort.signal);
    for await (const event of stream) {
      if (event.type === "session") { store.setClaudeSessionId(conversationId, event.claudeSessionId); continue; }
      if (event.type === "done") { finalText = event.text; cost = event.costUsd; }
      if (event.type === "error") failed = true;
      send(event);
    }
  } catch (error) {
    failed = true;
    send({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    activeTurns.delete(req.turnId);
  }
  try {
    // The user may have deleted the thread mid-turn — don't resurrect it.
    if (!failed && finalText && store.getConversation(conversationId)) {
      store.addMessage(conversationId, "assistant", finalText, cost);
      broadcast(IPC.conversationsChanged, null);
    }
  } catch (e) {
    console.error("[aether] could not persist reply:", e);
  }
}

async function providerStatus(): Promise<ProviderStatus> {
  const models = settings.provider === "ollama" ? await listOllamaModels(settings.ollamaBaseUrl) : [];
  return {
    provider: settings.provider,
    hasKey: settings.provider === "openai" ? secrets.has(OPENAI_KEY) : true,
    models,
    detail: settings.provider === "ollama" && !models.length ? "No local models found. Is `ollama serve` running?" : undefined,
  };
}

export function registerIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => settings);
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AetherSettings>) => {
    settings = { ...settings, ...sanitizeSettings(patch) };
    saveSettings();
    return settings;
  });

  ipcMain.handle(IPC.authStatus, () => authStatus());
  ipcMain.handle(IPC.authLogin, () => authLogin());

  ipcMain.handle(IPC.providerStatus, () => providerStatus());
  ipcMain.handle(IPC.providerSetKey, async (_e, provider: Provider, key: string) => {
    if (provider === "openai") secrets.set(OPENAI_KEY, typeof key === "string" ? key.trim() : "");
    return providerStatus();
  });

  ipcMain.handle(IPC.modulesList, () => modules.list());
  ipcMain.handle(IPC.moduleSave, (_e, mod: ModuleConfig) => afterModuleChange(modules.save(mod)));
  ipcMain.handle(IPC.moduleDelete, (_e, id: string) => afterModuleChange(modules.remove(id)));
  ipcMain.handle(IPC.moduleToggle, (_e, id: string, enabled: boolean) => afterModuleChange(modules.toggle(id, !!enabled)));

  ipcMain.handle(IPC.conversationsList, () => store.listConversations());
  ipcMain.handle(IPC.conversationGet, (_e, id: string) => {
    const conversation = store.getConversation(id);
    if (!conversation) return null;
    return { conversation, messages: store.listMessages(id) };
  });
  ipcMain.handle(IPC.conversationRename, (_e, id: string, title: string) => {
    const ok = store.renameConversation(id, title);
    if (ok) broadcast(IPC.conversationsChanged, null);
    return ok;
  });
  ipcMain.handle(IPC.conversationDelete, (_e, id: string) => {
    const ok = store.deleteConversation(id);
    if (ok) {
      rmSync(join(paths.uploadsDir, id), { recursive: true, force: true });
      broadcast(IPC.conversationsChanged, null);
    }
    return ok;
  });

  ipcMain.handle(IPC.attachmentGet, (_e, id: string) => {
    const a = store.getAttachment(id);
    if (!a) return null;
    try {
      const bytes = readFileSync(a.path);
      return { mimeType: a.mimeType, dataUrl: `data:${a.mimeType};base64,${bytes.toString("base64")}` };
    } catch { return null; }
  });

  ipcMain.handle(IPC.graphCases, () => store.listGraphCases());
  ipcMain.handle(IPC.graphGet, (_e, caseId: string) => store.getGraph(caseId));
  ipcMain.handle(IPC.graphGetByName, (_e, name: string) => store.getGraphByName(name));
  ipcMain.handle(IPC.graphDelete, (_e, caseId: string) => {
    const ok = store.deleteGraphCase(caseId);
    if (ok) broadcast(IPC.graphChanged, { caseName: "" });
    return ok;
  });

  ipcMain.handle(IPC.chatCancel, (_e, turnId: string) => { activeTurns.get(turnId)?.abort(); });

  ipcMain.handle(IPC.chatSend, async (_e, req: ChatRequest) => {
    const message = (req.message ?? "").trim();
    if (!message) throw new Error("message is required");
    const decoded = decodeImages(req.images);
    if ("error" in decoded) throw new Error(decoded.error);

    let conversationId = req.conversationId;
    let resumeId: string | null = null;
    if (conversationId) {
      const existing = store.getConversation(conversationId);
      if (!existing) throw new Error("conversation not found");
      conversationId = existing.id;
      resumeId = existing.claudeSessionId;
    } else {
      conversationId = store.createConversation(message).id;
    }

    const attachments = writeAttachments(conversationId, decoded.images);
    store.addMessage(conversationId, "user", message, null, attachments);
    broadcast(IPC.conversationsChanged, null);
    const prompt = attachments.length ? `${message}\n\n${attachedImagesBlock(attachments, settings.ownerName)}` : message;

    void startTurn(req, conversationId, prompt, resumeId);
    return { conversationId };
  });
}
