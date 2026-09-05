// ─────────────────────────────────────────────────────────────────────────────
// Custom auto-updater. Talks to the GitHub Releases API directly (no token for a
// public repo) and applies the update itself, so it works on UNSIGNED macOS
// builds where Squirrel.Mac's signature check would refuse to install.
//
//   check   -> GET /releases/latest, compare the tag to app.getVersion()
//   download-> fetch the platform asset (the .dmg on mac, the NSIS .exe on win)
//              with progress
//   install -> mac: mount the dmg, swap …/Aether.app for the new bundle after we
//              quit, relaunch (falls back to just opening the dmg if the app dir
//              isn't writable). win: run the downloaded installer, then quit.
//
// Same exported surface as before, so the IPC layer and Settings UI don't change.
// ─────────────────────────────────────────────────────────────────────────────
import { app, shell } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, writeFileSync, chmodSync, accessSync, constants } from "node:fs";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import type { UpdateStatus } from "../shared/types";

const REPO = "fknMega/Aether";
const UA = "Aether-Updater";

let status: UpdateStatus = { state: app.isPackaged ? "idle" : "disabled", currentVersion: app.getVersion() };
let broadcast: (s: UpdateStatus) => void = () => {};
let ready: { file: string; version: string } | null = null;
let inflight = false;

function set(patch: Partial<UpdateStatus>): void { status = { ...status, ...patch }; broadcast(status); }
export function getUpdateStatus(): UpdateStatus { return status; }

export function configureUpdater(onChange: (s: UpdateStatus) => void, autoCheck: boolean): void {
  broadcast = onChange;
  if (!app.isPackaged) { set({ state: "disabled", message: "Updates apply to an installed build, not a dev run." }); return; }
  if (autoCheck) setTimeout(() => void checkForUpdates(), 2500);
}

/** "v2.0.1" / "2.0.1" -> [2,0,1]; returns 1 if a>b, -1 if a<b, 0 if equal. */
function cmp(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1; if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1; }
  return 0;
}

interface Asset { name: string; browser_download_url: string; size: number; }

async function fetchLatest(): Promise<{ version: string; assets: Asset[] } | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;              // no published release yet
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const j = (await res.json()) as { tag_name?: string; assets?: Asset[] };
  return { version: (j.tag_name ?? "").replace(/^v/, ""), assets: j.assets ?? [] };
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) { set({ state: "disabled", message: "Updates apply to an installed build, not a dev run." }); return status; }
  if (inflight) return status;
  inflight = true;
  try {
    set({ state: "checking", message: undefined });
    const latest = await fetchLatest();
    if (!latest || !latest.version) { set({ state: "not-available", message: "No release published to update from yet." }); return status; }
    if (cmp(latest.version, app.getVersion()) <= 0) { set({ state: "not-available", newVersion: undefined, message: "You're on the latest version." }); return status; }
    set({ state: "available", newVersion: latest.version });
    await download(latest);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    set({ state: "error", message: /timed out|ENOTFOUND|network|fetch failed/i.test(m) ? "Couldn't reach GitHub to check for updates." : m.slice(0, 200) });
  } finally { inflight = false; }
  return status;
}

async function download(latest: { version: string; assets: Asset[] }): Promise<void> {
  const isMac = process.platform === "darwin";
  const want = isMac ? /-mac.*\.dmg$|\.dmg$/i : /\.exe$/i;
  const asset = latest.assets.find((a) => want.test(a.name)) ?? latest.assets.find((a) => (isMac ? /\.zip$/i : /\.exe$/i).test(a.name));
  if (!asset) { set({ state: "error", message: `No installable download for this platform in ${latest.version}.` }); return; }

  set({ state: "downloading", percent: 0, newVersion: latest.version });
  const dir = mkdtempSync(join(tmpdir(), "aether-update-"));
  const file = join(dir, asset.name);
  const res = await fetch(asset.browser_download_url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body) { set({ state: "error", message: `Download failed (HTTP ${res.status}).` }); return; }

  const total = Number(res.headers.get("content-length")) || asset.size || 0;
  let got = 0, lastPct = -1;
  const out = createWriteStream(file);
  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    got += chunk.length;
    if (total) { const pct = Math.round((got / total) * 100); if (pct !== lastPct) { lastPct = pct; set({ state: "downloading", percent: pct }); } }
  });
  await new Promise<void>((resolve, reject) => { body.pipe(out); out.on("finish", () => resolve()); out.on("error", reject); body.on("error", reject); });

  ready = { file, version: latest.version };
  set({ state: "downloaded", newVersion: latest.version });
}

export function installUpdate(): void {
  if (!ready) return;
  if (process.platform === "darwin") applyMac(ready.file);
  else applyWin(ready.file);
}

function applyWin(installer: string): void {
  spawn(installer, [], { detached: true, stdio: "ignore" }).unref();
  setTimeout(() => app.quit(), 400);
}

/** Mount the dmg, replace this app bundle with the new one after we quit, and
 *  relaunch. If the app's folder isn't writable (e.g. /Applications needs admin)
 *  the script safely restores and just opens the dmg for a manual drag. */
function applyMac(dmg: string): void {
  const appBundle = process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, "");
  // If we plainly can't write the app's parent, skip the risky swap.
  let writable = true;
  try { accessSync(dirname(appBundle), constants.W_OK); } catch { writable = false; }
  if (!writable) { void shell.openPath(dmg); return; }

  const script = `#!/bin/bash
set -o pipefail
DMG=${sh(dmg)}
APP=${sh(appBundle)}
PID=${process.pid}
MNT="$(/usr/bin/mktemp -d)"
if ! /usr/bin/hdiutil attach "$DMG" -nobrowse -noverify -mountpoint "$MNT" >/dev/null 2>&1; then /usr/bin/open "$DMG"; exit 0; fi
NEW="$(/usr/bin/find "$MNT" -maxdepth 1 -name '*.app' | /usr/bin/head -1)"
if [ -z "$NEW" ]; then /usr/bin/hdiutil detach "$MNT" >/dev/null 2>&1; /usr/bin/open "$DMG"; exit 0; fi
for i in $(/usr/bin/seq 1 75); do /bin/kill -0 "$PID" 2>/dev/null || break; /bin/sleep 0.4; done
/bin/sleep 0.6
BAK="$APP.bak-$$"
if /bin/mv "$APP" "$BAK" 2>/dev/null; then
  if /usr/bin/ditto "$NEW" "$APP" >/dev/null 2>&1; then
    /usr/bin/xattr -cr "$APP" >/dev/null 2>&1
    /bin/rm -rf "$BAK"
  else
    /bin/rm -rf "$APP" 2>/dev/null; /bin/mv "$BAK" "$APP" 2>/dev/null
  fi
else
  /usr/bin/hdiutil detach "$MNT" >/dev/null 2>&1; /usr/bin/open "$DMG"; exit 0
fi
/usr/bin/hdiutil detach "$MNT" >/dev/null 2>&1
/usr/bin/open "$APP"
/bin/rm -rf "$MNT" "$(/usr/bin/dirname "$DMG")" 2>/dev/null
`;
  const sp = join(mkdtempSync(join(tmpdir(), "aether-swap-")), "swap.sh");
  writeFileSync(sp, script, "utf8");
  chmodSync(sp, 0o755);
  spawn("/bin/bash", [sp], { detached: true, stdio: "ignore" }).unref();
  setTimeout(() => app.quit(), 400);
}

/** POSIX single-quote a path for safe embedding in the shell script. */
function sh(p: string): string { return "'" + p.replace(/'/g, "'\\''") + "'"; }
