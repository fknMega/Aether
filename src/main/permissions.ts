// ─────────────────────────────────────────────────────────────────────────────
// The agent's permission boundary.
//
// Aether reads attacker-controlled text by design: web pages, WHOIS records,
// profile bios, EXIF fields belonging to whoever it is investigating. Anything
// in that text can try to instruct the model. So the question is not "will the
// model be told to do something bad" — it will be — but "what happens when it
// is". This module is the answer.
//
// This is one of four layers, and it is the only one that is ours:
//
//   1. OS sandbox      seatbelt / bubblewrap, enabled in agent.ts. Kernel-
//                      enforced. The only layer a clever string cannot talk
//                      its way past.
//   2. Read boundary   blockReadsOutsideWorkingDirectories, enforced by the
//                      SDK in every permission mode.
//   3. This policy     a path boundary, a credential deny-list, an autonomy
//                      gate, and fail-closed on anything unparseable.
//   4. Tool removal    safe mode strips the mutating tools from the model's
//                      context entirely, so they cannot be called at all.
//
// Layer 3 exists because layers 1 and 2 do not know what Aether considers
// sensitive, and because Bash arguments are opaque to both. Its shell
// inspection is best-effort by construction — a determined injection can
// obfuscate a path — so it is a speed bump above the sandbox, never the
// thing standing between the user and a hostile web page.
//
// Every decision here is enforced through the SDK's `canUseTool` callback,
// which is ONLY consulted when the session is not in bypassPermissions mode.
// That is why agent.ts no longer sets it: under that flag this file is dead
// code and the app silently has no policy at all.
// ─────────────────────────────────────────────────────────────────────────────
import { isAbsolute, resolve, relative, sep, normalize } from "node:path";
import { homedir } from "node:os";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

const HOME = homedir();

const allow = (): PermissionResult => ({ behavior: "allow" });
const deny = (message: string): PermissionResult => ({ behavior: "deny", message });

/** Tools that write, execute, or otherwise change the machine. Gated on autonomy. */
const MUTATING = new Set([
  "Bash", "BashOutput", "KillShell", "KillBash",
  "Write", "Edit", "MultiEdit", "NotebookEdit",
]);

/** Paths that stay off-limits no matter what the workspace boundary says. These
 *  are the things an injected instruction would go looking for: credentials to
 *  steal, and Aether's own stored keys. Matched case-insensitively against the
 *  whole resolved path. */
const SENSITIVE: RegExp[] = [
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])\.aws([\\/]|$)/i,
  /(^|[\\/])\.gnupg([\\/]|$)/i,
  /(^|[\\/])\.kube([\\/]|$)/i,
  /(^|[\\/])\.docker([\\/]|$)/i,
  /(^|[\\/])\.config[\\/](gcloud|gh|git)([\\/]|$)/i,
  /(^|[\\/])(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$/i,
  /(^|[\\/])\.(netrc|npmrc|pypirc|git-credentials|dockercfg)$/i,
  /(^|[\\/])\.env(\.[\w.-]+)?$/i,
  /(^|[\\/])(credentials|secrets?)\.(json|ya?ml|toml|ini)$/i,
  /(^|[\\/])\.(bash|zsh|fish|sh)_history$/i,
  /(^|[\\/])Library[\\/]Keychains([\\/]|$)/i,
  /(^|[\\/])Library[\\/]Application Support[\\/](Google|Firefox|BraveSoftware|Microsoft Edge)([\\/]|$)/i,
  /(^|[\\/])AppData[\\/](Local|Roaming)[\\/](Google|Microsoft[\\/]Edge|Mozilla)([\\/]|$)/i,
  /(^|[\\/])(Cookies|Login Data|key[34]\.db|logins\.json)$/i,
  // Aether's own state: settings, the module store (encrypted keys), OAuth
  // tokens, the private overlay. The agent has no business reading the
  // operator's credentials, and an injection would ask for exactly these.
  /(^|[\\/])(settings|modules|store)\.json$/i,
  /(^|[\\/])gemini-oauth\.json$/i,
  /(^|[\\/])private([\\/]|$)/i,
];

const isSensitive = (p: string): boolean => SENSITIVE.some((re) => re.test(p));

/** True when `p` resolves inside one of `roots`. Compares resolved, normalised
 *  paths and requires a real path-segment boundary, so `/work` does not match
 *  `/workspace-elsewhere`. */
function inside(p: string, roots: string[]): boolean {
  const target = resolve(normalize(p));
  return roots.some((root) => {
    const base = resolve(normalize(root));
    if (target === base) return true;
    const rel = relative(base, target);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
}

/** Expand a leading `~`, which the shell would expand but path.resolve will not. */
const expandHome = (p: string): string =>
  p === "~" || p.startsWith(`~${sep}`) || p.startsWith("~/") ? resolve(HOME, p.slice(2)) : p;

/** Absolute-looking path tokens in a shell command: POSIX, Windows and `~`.
 *  Deliberately greedy — a false positive costs a refusal the user can undo by
 *  rephrasing, a false negative costs the machine. */
const PATH_TOKEN = /(?:^|[\s"'=:(<>|&;])((?:~|\/|[A-Za-z]:\\)[^\s"';|&<>)]*)/g;

/** Shell constructs that are dangerous regardless of which path they name. */
const SHELL_RED_FLAGS: Array<[RegExp, string]> = [
  [/\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^|;&]*\|[^|]*\b(?:ba)?sh\b/i, "piping a download straight into a shell"],
  [/\brm\s+(-[a-zA-Z]*\s+)*-?[a-zA-Z]*[rf]/i, "a recursive or forced delete"],
  [/\b(?:mkfs|diskutil\s+erase|format\s+[a-z]:)/i, "formatting a disk"],
  [/\b(?:shutdown|reboot|halt)\b/i, "shutting the machine down"],
  [/\bsudo\b|\bdoas\b|\brunas\b/i, "elevating privileges"],
  [/\b(?:launchctl|systemctl|schtasks|crontab)\b/i, "changing system services or scheduled tasks"],
  [/>\s*(?:\/etc\/|\/usr\/|\/bin\/|C:\\Windows)/i, "writing into a system directory"],
  [/\bnc\b\s+-[a-z]*e|\b(?:bash|sh)\s+-i\s*>&/i, "opening a reverse shell"],
];

export interface PolicyContext {
  /** Live read of the autonomy setting — it can change between turns. */
  isAutonomous(): boolean;
  /** Directories the agent may touch. Normally just the workspace. */
  roots(): string[];
  /** Called when something is refused, so the UI can say so. */
  onDenied?(toolName: string, reason: string): void;
}

/** Every string in a tool's input, at any depth — the model can put a path in
 *  a field we do not know about, so we check them all rather than a known list. */
function strings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out, depth + 1);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out, depth + 1);
  return out;
}

/** Check one path-ish string. Returns a refusal reason, or null if it is fine. */
function checkPath(raw: string, roots: string[]): string | null {
  const p = expandHome(raw.trim());
  if (!p) return null;
  if (isSensitive(p)) return `\`${raw}\` is on Aether's never-read list (credentials, browser profiles, or Aether's own stored keys).`;
  if (!isAbsolute(p)) return null;                 // relative paths resolve under cwd, which is the workspace
  if (!inside(p, roots)) return `\`${raw}\` is outside Aether's workspace.`;
  return null;
}

export function makePolicy(ctx: PolicyContext): CanUseTool {
  return async (toolName, input) => {
    const roots = ctx.roots();
    const refuse = (why: string): PermissionResult => {
      ctx.onDenied?.(toolName, why);
      return deny(why);
    };

    // Aether's own MCP tools carry their own guards (safe mode withholds the
    // shell inside customModules, http_probe refuses private address space).
    // They never take a filesystem path from the model.
    if (toolName.startsWith("mcp__")) return allow();

    if (MUTATING.has(toolName) && !ctx.isAutonomous()) {
      return refuse(
        `Safe mode is on, so ${toolName} is withheld. Turn on Autonomy in Settings to let Aether run the shell and write files.`,
      );
    }

    // Bash is the one input we cannot parse into arguments, so it is inspected
    // as text. This is best-effort by nature: a determined injection can obfuscate
    // a path. It is a speed bump on top of the real controls — autonomy off by
    // default, and the workspace as cwd — not a substitute for them.
    if (toolName === "Bash" || toolName === "BashOutput") {
      const cmd = typeof (input as { command?: unknown }).command === "string"
        ? (input as { command: string }).command
        : "";
      for (const [re, what] of SHELL_RED_FLAGS) {
        if (re.test(cmd)) return refuse(`That command was refused: it involves ${what}.`);
      }
      for (const m of cmd.matchAll(PATH_TOKEN)) {
        const bad = checkPath(m[1], roots);
        if (bad) return refuse(`That command was refused: ${bad}`);
      }
      return allow();
    }

    // Everything else: scan every string argument for a path that leaves the
    // workspace or names something on the deny-list. Fail closed.
    for (const s of strings(input)) {
      if (s.length > 4096) continue;                       // prose, not a path
      if (!/[\\/]/.test(s) && !s.startsWith("~")) continue; // no separator, not a path
      const bad = checkPath(s, roots);
      if (bad) return refuse(`${toolName} was refused: ${bad}`);
    }
    return allow();
  };
}

/** Glob patterns handed to the SDK sandbox's kernel-level read deny-list. The
 *  regexes above guard our own policy; these guard the sandboxed child process
 *  even for a path our string-matching never sees. Belt and braces on purpose:
 *  one is enforced by us, the other by the OS. */
export const SANDBOX_DENY_READ: string[] = [
  `${HOME}/.ssh/**`,
  `${HOME}/.aws/**`,
  `${HOME}/.gnupg/**`,
  `${HOME}/.kube/**`,
  `${HOME}/.docker/**`,
  `${HOME}/.config/gcloud/**`,
  `${HOME}/.config/gh/**`,
  `${HOME}/.netrc`,
  `${HOME}/.npmrc`,
  `${HOME}/.git-credentials`,
  `${HOME}/.*_history`,
  `${HOME}/Library/Keychains/**`,
  `${HOME}/Library/Application Support/Google/**`,
  `${HOME}/Library/Application Support/Firefox/**`,
  `${HOME}/Library/Application Support/BraveSoftware/**`,
  `${HOME}/AppData/Local/Google/**`,
  `${HOME}/AppData/Roaming/Mozilla/**`,
  `**/.env`,
  `**/settings.json`,
  `**/modules.json`,
  `**/gemini-oauth.json`,
];
