// ─────────────────────────────────────────────────────────────────────────────
// PATH repair.
//
// A GUI app launched from Finder, the Dock, or a .desktop entry does NOT inherit
// the shell's environment. On macOS it gets launchd's default — literally
// `/usr/bin:/bin:/usr/sbin:/sbin` — so every tool the user installed with
// Homebrew, pipx, go install or cargo is invisible to the packaged app while
// working perfectly in their terminal. That single difference is why a command
// module can be "installed" and still fail with `command not found`.
//
// Two repairs, cheapest first:
//   1. Prepend the well-known install directories that actually exist.
//   2. Ask the user's real login shell what its PATH is, which is the only way
//      to catch version managers (mise, asdf, nvm, pyenv) and custom prefixes.
//
// Both are applied to `process.env.PATH` once at startup, so every child process
// inherits the result: the command runner, the installer, the Claude CLI, and
// the shell the agent runs under it.
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

const HOME = homedir();
const isWin = platform() === "win32";

/** `parent/<anything>/tail` for every child of `parent` — how version-stamped
 *  bin directories (gems, Pythons, Rubies) are found without knowing versions. */
function versioned(parent: string, ...tail: string[]): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(parent, d.name, ...tail));
  } catch { return []; }
}

/** Where package managers actually put things, in the order a shell would find
 *  them. Homebrew first: on Apple Silicon it is /opt/homebrew, on Intel it is
 *  /usr/local, and a machine can have both. */
function candidateDirs(): string[] {
  if (isWin) {
    const local = process.env.LOCALAPPDATA ?? join(HOME, "AppData", "Local");
    const roaming = process.env.APPDATA ?? join(HOME, "AppData", "Roaming");
    return [
      join(HOME, "scoop", "shims"),                  // scoop
      join(process.env.ProgramData ?? "C:\\ProgramData", "chocolatey", "bin"),
      join(local, "Microsoft", "WinGet", "Links"),   // winget shims
      join(local, "Programs", "Python", "Scripts"),
      // `pip install --user` / pipx-installed console scripts, per Python version.
      ...versioned(join(local, "Programs", "Python"), "Scripts"),
      ...versioned(join(roaming, "Python"), "Scripts"),
      join(roaming, "Python", "Scripts"),
      join(roaming, "npm"),
      join(HOME, "go", "bin"),
      join(HOME, ".cargo", "bin"),
      join(HOME, ".local", "bin"),                   // pipx
      // RubyInstaller puts each Ruby at C:\RubyXY-x64\bin; gems' executables
      // land there too.
      ...versioned(process.env.SystemDrive ? process.env.SystemDrive + "\\" : "C:\\", "bin").filter((d) => /[\\/]Ruby[^\\/]*[\\/]bin$/i.test(d)),
      // `gem install --user-install` (the wpscan route) does NOT use that dir:
      // RubyGems has no Windows special case, so its bin dir is
      // %USERPROFILE%\\.gem\\ruby\\<ver>\\bin when ~\\.gem exists, else
      // (XDG_DATA_HOME || %USERPROFILE%\\.local\\share)\\gem\\ruby\\<ver>\\bin.
      ...versioned(join(HOME, ".gem", "ruby"), "bin"),
      ...versioned(join(process.env.XDG_DATA_HOME || join(HOME, ".local", "share"), "gem", "ruby"), "bin"),
      join(process.env.ProgramFiles ?? "C:\\Program Files", "Go", "bin"),
      join(process.env.ProgramFiles ?? "C:\\Program Files", "Nmap"),
    ];
  }
  const dirs = [
    "/opt/homebrew/bin", "/opt/homebrew/sbin",       // Homebrew, Apple Silicon
    "/usr/local/bin", "/usr/local/sbin",             // Homebrew (Intel), manual installs
    "/home/linuxbrew/.linuxbrew/bin",                // Homebrew on Linux
    join(HOME, ".local", "bin"),                     // pipx, pip --user
    join(HOME, "bin"),
    join(HOME, "go", "bin"),                         // go install
    join(HOME, ".cargo", "bin"),                     // cargo install
    join(HOME, ".yarn", "bin"),
    join(HOME, ".npm-global", "bin"),
    "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    "/snap/bin",                                     // Ubuntu snaps
    "/usr/local/go/bin",
  ];
  // Respect an explicit Go setup rather than assuming ~/go.
  if (process.env.GOBIN) dirs.push(process.env.GOBIN);
  for (const gopath of (process.env.GOPATH ?? "").split(delimiter)) {
    if (gopath) dirs.push(join(gopath, "bin"));
  }
  // macOS `pip install --user` lands in a version-stamped Python framework dir.
  dirs.push(...versioned(join(HOME, "Library", "Python"), "bin"));
  // `gem install --user-install` puts executables in a per-Ruby-version dir:
  // XDG (~/.local/share/gem) for Ruby 3.2+, ~/.gem for older; a Homebrew Ruby's
  // own gem bin dir is not on PATH either. None of these are found otherwise.
  dirs.push(...versioned(join(HOME, ".local", "share", "gem", "ruby"), "bin"));
  dirs.push(...versioned(join(HOME, ".gem", "ruby"), "bin"));
  dirs.push(...versioned("/opt/homebrew/lib/ruby/gems", "bin"));
  dirs.push(...versioned("/usr/local/lib/ruby/gems", "bin"));
  return dirs;
}

/** Merge `extra` in front of the current PATH, keeping order, dropping entries
 *  that do not exist on disk, and never introducing a duplicate. */
function merge(extra: string[]): string {
  const current = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...extra, ...current]) {
    const d = dir.trim();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    // A missing directory in PATH is harmless but it is also noise; keep the
    // entries the user already had regardless, since they may appear later.
    if (current.includes(d) || existsSync(d)) out.push(d);
  }
  return out.join(delimiter);
}

/** Apply repair 1. Synchronous, no subprocess — safe to call before anything. */
export function repairPath(): void {
  process.env.PATH = merge(candidateDirs());
}

/**
 * Apply repair 2: ask the login shell for its PATH.
 *
 * This sources the user's own rc files, which is the point — it is how mise,
 * asdf, nvm, pyenv and hand-rolled prefixes get onto PATH at all. It runs the
 * shell the OS says is theirs, with a hard timeout, and it only ever ADDS
 * directories. A failure is silent by design: repair 1 has already run and the
 * app must not be blocked on someone's slow .zshrc.
 */
export async function repairPathFromLoginShell(): Promise<void> {
  if (isWin) return;                                   // no login-shell concept to query
  const shell = process.env.SHELL;
  if (!shell || !existsSync(shell)) return;

  const shellPath = await new Promise<string>((resolve) => {
    // `-ilc` = interactive login shell running one command. Interactive is what
    // makes most version managers initialise; without it their hooks never run.
    const child = execFile(
      shell,
      ["-ilc", "command -p printf '%s' \"$PATH\""],
      { timeout: 2500, maxBuffer: 1 << 20, env: { ...process.env, TERM: "dumb" } },
      (err, stdout) => resolve(err ? "" : stdout),
    );
    child.on("error", () => resolve(""));
  });

  const dirs = shellPath.split(delimiter).map((d) => d.trim()).filter(Boolean);
  if (dirs.length) process.env.PATH = merge(dirs);
}

/** The directories a "did you install it?" check should look in, for the UI to
 *  show when a tool cannot be found. */
export const pathEntries = (): string[] => (process.env.PATH ?? "").split(delimiter).filter(Boolean);
