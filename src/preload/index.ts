import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import type { AetherApi, ChatEventEnvelope } from "../shared/ipc";
import type { ChatRequest, AetherSettings } from "../shared/types";

const api: AetherApi = {
  platform: process.platform,

  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<AetherSettings>) => ipcRenderer.invoke(IPC.settingsSet, patch),

  authStatus: () => ipcRenderer.invoke(IPC.authStatus),
  authLogin: () => ipcRenderer.invoke(IPC.authLogin),

  updateStatusGet: () => ipcRenderer.invoke(IPC.updateGet),
  checkForUpdate: () => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),

  providerStatus: () => ipcRenderer.invoke(IPC.providerStatus),
  setProviderKey: (provider, key) => ipcRenderer.invoke(IPC.providerSetKey, provider, key),

  listModules: () => ipcRenderer.invoke(IPC.modulesList),
  saveModule: (mod) => ipcRenderer.invoke(IPC.moduleSave, mod),
  deleteModule: (id) => ipcRenderer.invoke(IPC.moduleDelete, id),
  toggleModule: (id, enabled) => ipcRenderer.invoke(IPC.moduleToggle, id, enabled),

  listConversations: () => ipcRenderer.invoke(IPC.conversationsList),
  getConversation: (id) => ipcRenderer.invoke(IPC.conversationGet, id),
  renameConversation: (id, title) => ipcRenderer.invoke(IPC.conversationRename, id, title),
  deleteConversation: (id) => ipcRenderer.invoke(IPC.conversationDelete, id),
  getAttachment: (id) => ipcRenderer.invoke(IPC.attachmentGet, id),

  listGraphCases: () => ipcRenderer.invoke(IPC.graphCases),
  getGraph: (caseId) => ipcRenderer.invoke(IPC.graphGet, caseId),
  getGraphByName: (name) => ipcRenderer.invoke(IPC.graphGetByName, name),
  deleteGraph: (caseId) => ipcRenderer.invoke(IPC.graphDelete, caseId),

  sendChat: (req: ChatRequest) => ipcRenderer.invoke(IPC.chatSend, req),
  cancelChat: (turnId) => ipcRenderer.invoke(IPC.chatCancel, turnId),

  onChatEvent: (cb) => {
    const h = (_e: unknown, env: ChatEventEnvelope) => cb(env);
    ipcRenderer.on(IPC.chatEvent, h);
    return () => ipcRenderer.removeListener(IPC.chatEvent, h);
  },
  onGraphChanged: (cb) => {
    const h = (_e: unknown, payload: { caseName: string }) => cb(payload);
    ipcRenderer.on(IPC.graphChanged, h);
    return () => ipcRenderer.removeListener(IPC.graphChanged, h);
  },
  onConversationsChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on(IPC.conversationsChanged, h);
    return () => ipcRenderer.removeListener(IPC.conversationsChanged, h);
  },
  onModulesChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on(IPC.modulesChanged, h);
    return () => ipcRenderer.removeListener(IPC.modulesChanged, h);
  },
  onUpdateStatus: (cb) => {
    const h = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s);
    ipcRenderer.on(IPC.updateStatus, h);
    return () => ipcRenderer.removeListener(IPC.updateStatus, h);
  },
};

contextBridge.exposeInMainWorld("aether", api);
