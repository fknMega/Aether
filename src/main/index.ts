import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { registerIpc, applyTheme, bootTheme, TITLEBAR_H } from "./ipc";

const isDev = !app.isPackaged;

function createWindow(): void {
  // Resolve the saved appearance BEFORE the window exists, so the very first
  // frame is painted in the right colour instead of flashing the wrong one.
  const { pref, chrome } = bootTheme();
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: chrome.bg,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Windows/Linux get the same flat chrome. Height matches the CSS titlebar.
    ...(process.platform !== "darwin" ? { titleBarOverlay: { color: chrome.caption, symbolColor: chrome.symbol, height: TITLEBAR_H } } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => { applyTheme(pref); win.show(); });

  // Open external links in the real browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // Never let the renderer navigate away from the app bundle — external URLs go
  // to the real browser, everything else is refused.
  win.webContents.on("will-navigate", (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}


// A second instance would share the JSON store and clobber it — refuse it and
// focus the window that's already open.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
