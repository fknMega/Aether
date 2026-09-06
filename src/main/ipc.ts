import { ipcMain, BrowserWindow, nativeTheme } from "electron";
import { writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IPC } from "../shared/ipc";
import { paths, runtime, loadSettings } from "./config";
import { store } from "./store";
import { modules } from "./modules";
import { runTurn, resetToolServer } from "./agent";
import { buildToolList } from "./tools";
import { runChatTurn, listOllamaModels } from "./chatEngine";
import { runGeminiTurn } from "./geminiEngine";
import { geminiSignedIn, geminiEmail, geminiLogin, geminiLogout } from "./geminiAuth";
import { configureUpdater, getUpdateStatus, checkForUpdates, installUpdate } from "./updater";
import { secrets, OPENAI_KEY } from "./secrets";
import { decodeImages, writeAttachments, attachedImagesBlock } from "./images";
import { authStatus, authLogin } from "./auth";
import type { ToolContext } from "./tools/context";
import type { AetherSettings, ChatRequest, ModuleConfig, Provider, ProviderStatus, ToolActivity } from "../shared/types";

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

// ── appearance ───────────────────────────────────────────────────────────────
// The renderer paints the app, but the OS chrome around it (the window frame,
// the Windows caption buttons, native scrollbars, the flash of colour before
// the first paint) is the main process's job. `applyTheme` keeps both in step.

/** Window-chrome colours per resolved theme. These are exactly --ground and
 *  --ink-2 from theme.css, so the native frame and the CSS panel are the same
 *  material — no seam at the window edge, no wrong-colour flash before the
 *  first paint. If theme.css changes, these change with it. */
export const CHROME = {
  dark:  { bg: "#0F1214", caption: "#0F1214", symbol: "#A2ACB2" },
  light: { bg: "#F6F7F8", caption: "#F6F7F8", symbol: "#4A555B" },
} as const;

/** Resolve `system` against the OS, then repaint the native chrome. */
/** Must equal --h-title in theme.css: the CSS titlebar and the Windows caption
 *  strip are the same 36px band and drift visibly if they disagree. */
export const TITLEBAR_H = 36;

export function applyTheme(pref: AetherSettings["theme"]): void {
  nativeTheme.themeSource = pref === "light" || pref === "dark" ? pref : "system";
  const c = CHROME[nativeTheme.shouldUseDarkColors ? "dark" : "light"];
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.setBackgroundColor(c.bg);
    // Windows/Linux draw their own caption strip over our titlebar.
    if (process.platform !== "darwin") {
      try { win.setTitleBarOverlay({ color: c.caption, symbolColor: c.symbol, height: TITLEBAR_H }); }
      catch { /* only present when titleBarOverlay was set at construction */ }
    }
  }
}

/** The theme the app should boot in, for the window's pre-paint background. */
export function bootTheme(): { pref: AetherSettings["theme"]; chrome: typeof CHROME[keyof typeof CHROME] } {
  const pref = settings.theme ?? "system";
  nativeTheme.themeSource = pref === "light" || pref === "dark" ? pref : "system";
  return { pref, chrome: CHROME[nativeTheme.shouldUseDarkColors ? "dark" : "light"] };
}

/** Accept only known settings keys with sane values from the renderer. */
function sanitizeSettings(patch: Partial<AetherSettings>): Partial<AetherSettings> {
  const out: Partial<AetherSettings> = {};
  if (typeof patch.ownerName === "string") out.ownerName = patch.ownerName.slice(0, 80);
  if (typeof patch.model === "string") out.model = patch.model.slice(0, 120);
  if (["low", "medium", "high", "xhigh", "max"].includes(patch.effort as string)) out.effort = patch.effort;
  if (patch.personaVoice === "flirty" || patch.personaVoice === "professional") out.personaVoice = patch.personaVoice;
  if (typeof patch.autonomy === "boolean") out.autonomy = patch.autonomy;
  if (typeof patch.autoUpdate === "boolean") out.autoUpdate = patch.autoUpdate;
  if (["system", "light", "dark"].includes(patch.theme as string)) out.theme = patch.theme;
  if (["claude", "openai", "ollama", "gemini"].includes(patch.provider as string)) out.provider = patch.provider;
  for (const k of ["openaiBaseUrl", "openaiModel", "ollamaBaseUrl", "ollamaModel", "geminiModel"] as const) {
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
  // The evidence log is accumulated here rather than in the renderer, so it is
  // stored with the message and survives a reload and a restart. The transcript
  // cites these by number.
  const tools: ToolActivity[] = [];
  try {
    const prior = settings.provider === "claude" ? [] : store.listMessages(conversationId).slice(0, -1);
    const stream =
      settings.provider === "claude" ? runTurn(prompt, resumeId, settings, toolCtx, abort.signal)
      : settings.provider === "gemini" ? runGeminiTurn(prompt, prior, settings, toolCtx, abort.signal)
      : runChatTurn(prompt, prior, settings, toolCtx, abort.signal);
    for await (const event of stream) {
      if (event.type === "session") { store.setClaudeSessionId(conversationId, event.claudeSessionId); continue; }
      if (event.type === "tool_start") tools.push({ ...event.tool });
      if (event.type === "tool_end") {
        const t = tools.find((x) => x.id === event.id);
        if (t) { t.status = event.status; t.detail = event.detail; t.endedAt = Date.now(); }
      }
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
      store.addMessage(conversationId, "assistant", finalText, cost, [], tools);
      broadcast(IPC.conversationsChanged, null);
    }
  } catch (e) {
    console.error("[aether] could not persist reply:", e);
  }
}

const GEMINI_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];

async function providerStatus(): Promise<ProviderStatus> {
  const p = settings.provider;
  const models = p === "ollama" ? await listOllamaModels(settings.ollamaBaseUrl) : p === "gemini" ? GEMINI_MODELS : [];
  const hasKey = p === "openai" ? secrets.has(OPENAI_KEY) : p === "gemini" ? geminiSignedIn() : true;
  let detail: string | undefined;
  if (p === "ollama" && !models.length) detail = "No local models found. Is `ollama serve` running?";
  else if (p === "gemini") detail = geminiSignedIn() ? (geminiEmail() ? `Signed in as ${geminiEmail()}` : "Signed in with Google") : "Sign in with your Google account to use Gemini free.";
  return { provider: p, hasKey, models, detail };
}

export function registerIpc(): void {
  // When the pref is `system`, the OS can flip under us at any time.
  nativeTheme.on("updated", () => { if ((settings.theme ?? "system") === "system") applyTheme("system"); });

  ipcMain.handle(IPC.settingsGet, () => settings);
  ipcMain.handle(IPC.settingsSet, (_e, patch: Partial<AetherSettings>) => {
    settings = { ...settings, ...sanitizeSettings(patch) };
    saveSettings();
    // Keep the OS chrome (window frame, native menus, scrollbars) in step with
    // the palette the renderer is about to paint.
    applyTheme(settings.theme);
    return settings;
  });

  ipcMain.handle(IPC.authStatus, () => authStatus());
  ipcMain.handle(IPC.authLogin, () => authLogin());

  ipcMain.handle(IPC.updateGet, () => getUpdateStatus());
  ipcMain.handle(IPC.updateCheck, () => checkForUpdates());
  ipcMain.handle(IPC.updateInstall, () => installUpdate());
  configureUpdater((st) => broadcast(IPC.updateStatus, st), settings.autoUpdate !== false);

  // Warm the tool list once at startup so private code connectors (e.g. nesher)
  // show up in Settings → Modules immediately, instead of only after the first
  // chat turn builds the tool server. When it resolves, nudge the renderer to
  // re-fetch the list.
  void buildToolList(toolCtx)
    .then(() => broadcast(IPC.modulesChanged, null))
    .catch((e) => console.error("[aether] connector warm-up failed:", e));

  ipcMain.handle(IPC.providerStatus, () => providerStatus());
  ipcMain.handle(IPC.providerSetKey, async (_e, provider: Provider, key: string) => {
    if (provider === "openai") secrets.set(OPENAI_KEY, typeof key === "string" ? key.trim() : "");
    return providerStatus();
  });
  // OAuth sign-in (Gemini). Resolves when the browser flow completes.
  ipcMain.handle(IPC.providerLogin, async (_e, provider: Provider) => {
    if (provider === "gemini") return geminiLogin();
    return { ok: false, message: "That provider signs in with an API key, not a browser login." };
  });
  ipcMain.handle(IPC.providerLogout, async (_e, provider: Provider) => {
    if (provider === "gemini") geminiLogout();
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
