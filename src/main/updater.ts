// ─────────────────────────────────────────────────────────────────────────────
// Auto-update from GitHub Releases (electron-updater), with live state the UI
// can show in Settings.
//
// electron-builder publishes the installers plus a latest*.yml manifest to a
// GitHub Release; the packaged app reads that manifest, downloads a newer build
// in the background, and offers to restart.
//
// macOS note: Squirrel.Mac validates the code signature, so silent auto-install
// only works on a signed (Developer ID) build. Unsigned local builds can still
// DETECT an update (the status reflects it) but can't self-install it; Windows
// (NSIS) updates fine unsigned.
// ─────────────────────────────────────────────────────────────────────────────
import { app } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateStatus } from "../shared/types";

const { autoUpdater } = electronUpdater;

let status: UpdateStatus = { state: app.isPackaged ? "idle" : "disabled", currentVersion: app.getVersion() };
let broadcast: (s: UpdateStatus) => void = () => {};
let wired = false;

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch };
  broadcast(status);
}

export function getUpdateStatus(): UpdateStatus { return status; }

/** Wire event handlers once, and (optionally) kick off a check on launch. */
export function configureUpdater(onChange: (s: UpdateStatus) => void, autoCheck: boolean): void {
  broadcast = onChange;
  if (!app.isPackaged) { set({ state: "disabled", message: "Updates apply to an installed build, not a dev run." }); return; }
  if (!wired) {
    wired = true;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on("checking-for-update", () => set({ state: "checking", message: undefined }));
    autoUpdater.on("update-available", (info: { version?: string }) => set({ state: "downloading", newVersion: info?.version, percent: 0 }));
    autoUpdater.on("update-not-available", () => set({ state: "not-available", newVersion: undefined, message: "You're on the latest version." }));
    autoUpdater.on("download-progress", (p: { percent?: number }) => set({ state: "downloading", percent: Math.round(p?.percent ?? 0) }));
    autoUpdater.on("update-downloaded", (info: { version?: string }) => set({ state: "downloaded", newVersion: info?.version }));
    autoUpdater.on("error", (err: Error) => set({ state: "error", message: friendlyError(err?.message ?? String(err)) }));
  }
  if (autoCheck) void checkForUpdates();
}

function friendlyError(msg: string): string {
  if (/404|Cannot find|No published|latest\.yml/i.test(msg)) return "No release published to update from yet.";
  if (/ENOTFOUND|ETIMEDOUT|network|getaddrinfo/i.test(msg)) return "Couldn't reach GitHub to check for updates.";
  if (/code signature|not signed|Could not get code signature/i.test(msg)) return "This build isn't code-signed, so macOS won't auto-install updates.";
  return msg.slice(0, 200);
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) { set({ state: "disabled", message: "Updates apply to an installed build, not a dev run." }); return status; }
  try { await autoUpdater.checkForUpdates(); }
  catch (e) { set({ state: "error", message: friendlyError(e instanceof Error ? e.message : String(e)) }); }
  return status;
}

/** Quit and install a downloaded update. */
export function installUpdate(): void {
  if (status.state === "downloaded") autoUpdater.quitAndInstall();
}
