// ─────────────────────────────────────────────────────────────────────────────
// Auto-update from GitHub Releases (electron-updater).
//
// electron-builder publishes the installers plus a latest*.yml manifest to a
// GitHub Release; on launch the packaged app reads that manifest, downloads a
// newer build in the background, and offers to restart.
//
// Note for macOS: Squirrel.Mac validates the code signature, so auto-update only
// works on a signed (Developer ID) build. Unsigned local builds will log an
// error here and simply keep running — Windows (NSIS) updates fine unsigned.
// ─────────────────────────────────────────────────────────────────────────────
import { app, dialog } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export function initAutoUpdate(): void {
  if (!app.isPackaged) return; // never self-update a dev run

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on("error", (err: Error) => {
    // Most commonly an unsigned macOS build, or simply no release published yet.
    console.error("[aether] update check failed:", err?.message ?? err);
  });
  autoUpdater.on("update-available", (info: { version?: string }) => {
    console.log(`[aether] update available: ${info?.version ?? "?"} (downloading)`);
  });
  autoUpdater.on("update-downloaded", (info: { version?: string }) => {
    void dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Aether ${info?.version ?? ""} is ready to install.`,
      detail: "Restart to finish updating. Your cases and settings are kept.",
    }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
  });

  autoUpdater.checkForUpdates().catch(() => { /* offline / no release yet */ });
}
