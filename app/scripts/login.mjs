// One-time (or re-)sign-in for Aether, from a terminal.
//   npm run login          sign in with your Claude subscription
//   npm run login token    mint a long-lived token (best for a persistent box)
//   npm run login status   report whether Aether is signed in
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const EXE = process.platform === "win32" ? "claude.exe" : "claude";

/** Recursively find the `claude` exe, following node_modules / @anthropic* /
 *  claude* dirs so a nested platform package is found, not just a hoisted one. */
function searchExe(dir, depth) {
  if (depth < 0) return null;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const c = join(dir, e.name, EXE);
    try { if (statSync(c).isFile()) return c; } catch { /* not here */ }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const n = e.name;
    if (n === "node_modules" || n.startsWith("@anthropic") || n.startsWith("claude")) {
      const f = searchExe(join(dir, n), depth - 1);
      if (f) return f;
    }
  }
  return null;
}

function findClaudeBinary() {
  if (process.env.AETHER_CLAUDE_BIN && existsSync(process.env.AETHER_CLAUDE_BIN)) return process.env.AETHER_CLAUDE_BIN;
  const bases = [];
  try { bases.push(dirname(require.resolve("@anthropic-ai/claude-agent-sdk/package.json"))); } catch { /* not resolvable */ }
  bases.push(join(process.cwd(), "node_modules", "@anthropic-ai"));
  for (const base of bases) {
    const found = searchExe(base, 6);
    if (found) return found;
  }
  return null;
}

const bin = findClaudeBinary();
if (!bin) {
  console.error("Couldn't find the bundled claude binary. Run `npm install` first, or set AETHER_CLAUDE_BIN.");
  process.exit(1);
}

function readStatus() {
  try { return JSON.parse(spawnSync(bin, ["auth", "status"], { encoding: "utf8" }).stdout); }
  catch { return null; }
}

const mode = process.argv[2] ?? "login";

if (mode === "status") {
  const s = readStatus();
  console.log(s?.loggedIn ? `Aether is signed in (${s.authMethod}).` : "Aether is not signed in. Run `npm run login`.");
  process.exit(s?.loggedIn ? 0 : 1);
}

const before = readStatus();
if (before?.loggedIn && mode !== "token") {
  console.log(`\n  Aether is already signed in (${before.authMethod}). Nothing to do.`);
  console.log("  To switch accounts: npm run login token\n");
  process.exit(0);
}

const args = mode === "token" ? ["setup-token"] : ["auth", "login", "--claudeai"];
console.log("\n  Signing Aether in to Claude…");
console.log("  A browser window will open. Approve it, then come back here.\n");
const result = spawnSync(bin, args, { stdio: "inherit" });
if (result.error) { console.error(`\n  Could not launch login: ${result.error.message}`); process.exit(1); }

const after = readStatus();
console.log(after?.loggedIn ? `\n  ✓ Aether is signed in (${after.authMethod}). You're set.\n` : "\n  Sign-in didn't complete. Try again with `npm run login`.\n");
process.exit(after?.loggedIn ? 0 : 1);
