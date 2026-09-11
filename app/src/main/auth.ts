import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { shell } from "electron";
import type { AuthStatus } from "../shared/types";

/** Rewrite an `app.asar` path segment to `app.asar.unpacked`. Electron makes
 *  paths inside `app.asar` readable as if it were a directory, but the OS can't
 *  exec a file whose path runs *through* the archive (it throws ENOTDIR). The
 *  claude binary is asar-unpacked, so its real, runnable copy lives under
 *  `app.asar.unpacked`. Handles the segment anywhere, including end-of-path. */
const unpacked = (p: string): string => p.replace(/([\\/])app\.asar(?=[\\/]|$)/, "$1app.asar.unpacked");

/** node_modules/@anthropic-ai directories to search, dev and packaged. The
 *  unpacked path comes first so we resolve a real, executable file path. */
function anthropicDirs(): string[] {
  const here = import.meta.dirname; // out/main (inside app.asar in a packaged build)
  const root = join(here, "..", ".."); // project root / asar root
  const base = join(root, "node_modules", "@anthropic-ai");
  return [
    unpacked(base),
    base,
    join(process.cwd(), "node_modules", "@anthropic-ai"),
  ];
}

/** Recursively hunt for the `claude` exe under an @anthropic-ai tree, following
 *  only node_modules / @anthropic* / claude* directories. This finds the platform
 *  binary whether npm hoisted it to the top level (dev) OR left it nested at
 *  …/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-<plat>-<arch>/claude
 *  (which is how it lands inside a packaged, asar-unpacked build). */
function searchExe(dir: string, exe: string, depth: number): string | null {
  if (depth < 0) return null;
  let entries: Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const cand = join(dir, e.name, exe);
    try { if (statSync(cand).isFile()) return cand; } catch { /* not here */ }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const n = e.name;
    if (n === "node_modules" || n.startsWith("@anthropic") || n.startsWith("claude")) {
      const found = searchExe(join(dir, n), exe, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/** Locate the `claude` binary the Agent SDK ships (in a per-OS/arch package),
 *  always returning a real, executable path (never one that runs through
 *  app.asar). Exported so the turn runner can hand it to the SDK explicitly —
 *  the SDK's own default resolution can pick the asar path and fail with
 *  ENOTDIR when it spawns the CLI. */
export function findClaudeBinary(): string | null {
  if (process.env.AETHER_CLAUDE_BIN && existsSync(process.env.AETHER_CLAUDE_BIN)) return process.env.AETHER_CLAUDE_BIN;
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const platformPkg = `claude-agent-sdk-${process.platform}-${process.arch}`;
  // Normalise to a real, executable path — never one that runs through app.asar.
  const real = (p: string): string => {
    const u = unpacked(p);
    return u !== p && existsSync(u) ? u : p;
  };
  for (const base of anthropicDirs()) {
    // Preferred: the exact platform package hoisted to the top level.
    const direct = join(base, platformPkg, exe);
    if (existsSync(direct)) return real(direct);
    // Otherwise search the tree (handles the nested layout in packaged builds).
    const found = searchExe(base, exe, 6);
    if (found) return real(found);
  }
  return null;
}

export function authStatus(): AuthStatus {
  const bin = findClaudeBinary();
  if (!bin) return { loggedIn: false, authMethod: null, detail: "Could not find the bundled claude binary. Run `npm install`." };
  try {
    const probe = spawnSync(bin, ["auth", "status"], { encoding: "utf8", timeout: 15_000 });
    const parsed = JSON.parse(probe.stdout) as { loggedIn?: boolean; authMethod?: string };
    return { loggedIn: !!parsed.loggedIn, authMethod: parsed.authMethod ?? null };
  } catch {
    return { loggedIn: false, authMethod: null, detail: "Could not read auth status." };
  }
}

/** Start the sign-in flow and open the OAuth URL in the user's real browser.
 *  A GUI app has no TTY, so the CLI won't pop a browser on its own — we pipe its
 *  output, grab the first https URL it prints, and open that with the OS. The
 *  login process keeps running in the background (it listens on a localhost
 *  callback); the renderer polls auth status until it flips to signed-in. */
export function authLogin(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const bin = findClaudeBinary();
    if (!bin) return resolve({ ok: false, message: "Could not find the claude binary. Run `npm install`, then `npm run login`." });

    let settled = false;
    const done = (r: { ok: boolean; message: string }) => { if (!settled) { settled = true; resolve(r); } };

    try {
      const child = spawn(bin, ["auth", "login", "--claudeai"], { stdio: ["ignore", "pipe", "pipe"] });
      let opened = false;
      const scan = (chunk: Buffer) => {
        const m = chunk.toString("utf8").match(/https?:\/\/[^\s'"]+/);
        if (m && !opened) {
          opened = true;
          void shell.openExternal(m[0]);
          done({ ok: true, message: "Opening your browser to sign in to Claude — approve it, then come back here." });
        }
      };
      child.stdout?.on("data", scan);
      child.stderr?.on("data", scan);
      child.on("error", (e) => done({ ok: false, message: `Could not launch login: ${e.message}. Run \`npm run login\` in a terminal instead.` }));
      // If the CLI opened the browser itself (or was already signed in) and never
      // printed a URL, fall back to a reassuring message after a short wait.
      setTimeout(() => done({ ok: true, message: "If a browser window didn't open, run `npm run login` in a terminal from the project folder." }), 6000);
    } catch (e) {
      done({ ok: false, message: `Could not launch login: ${e instanceof Error ? e.message : String(e)}. Run \`npm run login\` in a terminal instead.` });
    }
  });
}
