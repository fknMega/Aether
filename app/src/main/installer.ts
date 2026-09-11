// ─────────────────────────────────────────────────────────────────────────────
// The tool installer.
//
// Twenty-odd bundled modules wrap a command-line binary. Until that binary is on
// PATH the module is a tool that always fails, which is worse than one that is
// not there. This module answers three questions for each of them: is it
// installed, can we install it here, and what happened when we tried.
//
// Rules it holds to:
//   · Recipes are CONSTANTS. Nothing here is ever built from module config, a
//     model response, or anything else that could be influenced. The commands
//     that can run are the ones written in this file and no others.
//   · Never sudo. If the only route on this machine needs root, the recipe is
//     reported to the UI as a command for the user to run themselves.
//   · Nothing installs without an explicit click. There is no silent install.
// ─────────────────────────────────────────────────────────────────────────────
import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";
import type { ToolStatus, ToolInstallState } from "../shared/types";

const isWin = platform() === "win32";
const isMac = platform() === "darwin";

/** One command of a recipe. `optional` steps may fail without failing the
 *  recipe — adding a scoop bucket that is already there, for instance. */
interface Step {
  /** The program to run — a package manager, or for a `post` step the tool
   *  just installed. Always a bare name resolved on PATH, never a path. */
  manager: Manager | InstalledTool;
  argv: string[];
  optional?: boolean;
}
/** Tools that have a post-install step of their own. */
type InstalledTool = "webanalyze";

/** A way to install one binary. `sudo: true` means we will not run it — it is
 *  shown to the user instead. `pre` runs first (adding a scoop bucket); `post`
 *  runs after a successful install, in Aether's workspace (fetching a data
 *  file the tool needs). */
interface Recipe extends Step {
  manager: Manager;
  sudo?: boolean;
  pre?: Step[];
  post?: Step[];
}
type Manager = "brew" | "pipx" | "go" | "apt" | "gem" | "winget" | "scoop" | "choco";

interface Tool {
  /** The bundled module this installs for, e.g. `def:subfinder`. */
  moduleId: string;
  /** The executable that must end up on PATH. */
  bin: string;
  /** Ordered by preference; the first whose manager is present wins. */
  recipes: Recipe[];
  /** What to tell the operator when no recipe applies here — for a tool whose
   *  install is a few commands rather than one package. Per platform, with
   *  `all` as the fallback. */
  manualHint?: Partial<Record<"darwin" | "linux" | "win32" | "all", string>>;
  /** A one-time step the operator has to do themselves even after a
   *  successful install (Npcap for the packet-capture tools on Windows). */
  afterNote?: Partial<Record<"darwin" | "linux" | "win32", string>>;
}

const os = platform() as "darwin" | "linux" | "win32";
const hintFor = (t: Tool): string | undefined => t.manualHint?.[os] ?? t.manualHint?.all;

/** Where `post` steps run, and how to re-scan PATH after an install (env.ts's
 *  repair, which knows the gem/go/pipx bin dirs). Set once from main; the
 *  tests never install, so both stay unset there. */
let workspaceDir: string | undefined;
let refreshPath: () => void = () => {};
export function configureInstaller(opts: { workspace: string; refreshPath: () => void }): void {
  workspaceDir = opts.workspace;
  refreshPath = opts.refreshPath;
}

/** A formula. For a third-party tap use the fully-qualified `user/repo/name`:
 *  Homebrew 6 then adds the tap and trusts that one formula by itself, with
 *  no prompt — the short name after a separate `brew tap` would be refused as
 *  untrusted. */
const brew = (...pkg: string[]): Recipe => ({ manager: "brew", argv: ["install", ...pkg] });
const pipx = (pkg: string): Recipe => ({ manager: "pipx", argv: ["install", pkg] });
const go = (mod: string): Recipe => ({ manager: "go", argv: ["install", mod] });
const apt = (pkg: string): Recipe => ({ manager: "apt", argv: ["install", "-y", pkg], sudo: true });
const gem = (pkg: string): Recipe => ({ manager: "gem", argv: ["install", "--user-install", "--no-document", pkg] });
/** Scoop's main bucket needs no `bucket add`; a named bucket is added first. */
const scoop = (pkg: string, bucket?: string): Recipe => ({
  manager: "scoop", argv: ["install", bucket ? `${bucket}/${pkg}` : pkg],
  ...(bucket && bucket !== "main" ? { pre: [{ manager: "scoop", argv: ["bucket", "add", bucket], optional: true }] } : {}),
});

/** The catalog. Keyed to the bundled module ids in modules.ts. Routes are in
 *  order of preference; the first whose manager exists on this machine wins,
 *  so a macOS-first list still works on Windows through go/pipx/scoop. */
const WHATWEB_HINT = "git clone --depth 1 https://github.com/urbanadventurer/WhatWeb.git ~/WhatWeb && (cd ~/WhatWeb && bundle install) && ln -s ~/WhatWeb/whatweb ~/.local/bin/whatweb   # needs Ruby 3+";
const TOOLS: Tool[] = [
  // people / identity
  { moduleId: "def:maigret", bin: "maigret", recipes: [pipx("maigret")] },
  { moduleId: "def:holehe", bin: "holehe", recipes: [pipx("holehe")] },
  { moduleId: "def:socialscan", bin: "socialscan", recipes: [pipx("socialscan")] },
  // In homebrew-core (deprecated upstream as unmaintained, still installs).
  // `go install` does not work for it (an embedded web build is missing from
  // the module), and the PyPI package of that name is unrelated — elsewhere
  // it is the release binary or nothing.
  { moduleId: "def:phoneinfoga", bin: "phoneinfoga", recipes: [brew("phoneinfoga")],
    manualHint: { all: "Download the release for your OS from https://github.com/sundowndev/phoneinfoga/releases and put `phoneinfoga` on your PATH." } },
  // web recon
  // WhatWeb has never been in Homebrew and is not a gem: it is a Ruby program
  // you clone and run. Kali and Debian package it; elsewhere the route is
  // shown for the operator. webanalyze below is the installable alternative.
  { moduleId: "def:whatweb", bin: "whatweb", recipes: [apt("whatweb")],
    manualHint: {
      all: WHATWEB_HINT,
      win32: "winget install -e --id RubyInstallerTeam.Ruby.3.4 --scope user; git clone --depth 1 https://github.com/urbanadventurer/WhatWeb.git $HOME\\WhatWeb — then run it as `ruby $HOME\\WhatWeb\\whatweb`",
    } },
  // webanalyze reads a Wappalyzer fingerprint file it downloads on demand;
  // fetching it once into the workspace is part of installing it.
  { moduleId: "def:webanalyze", bin: "webanalyze", recipes: [
    { ...go("github.com/rverton/webanalyze/cmd/webanalyze@latest"), post: [{ manager: "webanalyze", argv: ["-update"], optional: true }] },
  ] },
  { moduleId: "def:wafw00f", bin: "wafw00f", recipes: [pipx("wafw00f")] },
  { moduleId: "def:httpx", bin: "httpx", recipes: [
    brew("httpx"),
    go("github.com/projectdiscovery/httpx/cmd/httpx@latest"),
  ] },
  { moduleId: "def:tlsx", bin: "tlsx", recipes: [
    brew("tlsx"),
    go("github.com/projectdiscovery/tlsx/cmd/tlsx@latest"),
  ] },
  { moduleId: "def:sslscan", bin: "sslscan", recipes: [brew("sslscan"), scoop("sslscan", "main"), apt("sslscan")] },
  // subdomain / asset discovery
  { moduleId: "def:subfinder", bin: "subfinder", recipes: [
    brew("subfinder"),
    go("github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest"),
  ] },
  { moduleId: "def:amass-passive", bin: "amass", recipes: [
    brew("amass"),
    scoop("amass", "main"),
    go("github.com/owasp-amass/amass/v5/cmd/amass@latest"),
  ] },
  { moduleId: "def:assetfinder", bin: "assetfinder", recipes: [go("github.com/tomnomnom/assetfinder@latest")] },
  { moduleId: "def:waybackurls", bin: "waybackurls", recipes: [go("github.com/tomnomnom/waybackurls@latest")] },
  { moduleId: "def:gau", bin: "gau", recipes: [go("github.com/lc/gau/v2/cmd/gau@latest")] },
  { moduleId: "def:katana", bin: "katana", recipes: [
    brew("katana"),
    go("github.com/projectdiscovery/katana/cmd/katana@latest"),
  ] },
  // scanning
  { moduleId: "def:nuclei", bin: "nuclei", recipes: [
    brew("nuclei"),
    scoop("nuclei", "main"),
    go("github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"),
  ] },
  // Nikto is a Perl script; no package on Windows.
  { moduleId: "def:nikto", bin: "nikto", recipes: [brew("nikto"), apt("nikto")],
    manualHint: { win32: "scoop install perl; git clone --depth 1 https://github.com/sullo/nikto $HOME\\nikto — then run it as `perl $HOME\\nikto\\program\\nikto.pl`" } },
  // The official tap builds from source (no bottle) and vendors its own Ruby;
  // the gem needs a Ruby >= 3.3 with a C toolchain, which macOS's own 2.6 is
  // not and which on Windows means RubyInstaller WITH DevKit.
  { moduleId: "def:wpscan", bin: "wpscan", recipes: [brew("wpscanteam/tap/wpscan"), gem("wpscan")],
    manualHint: { win32: "winget install -e --id RubyInstallerTeam.RubyWithDevKit.3.4 --scope user, open a new terminal, then: gem install wpscan --no-document" } },
  { moduleId: "def:dnsx", bin: "dnsx", recipes: [
    brew("dnsx"),
    go("github.com/projectdiscovery/dnsx/cmd/dnsx@latest"),
  ] },
  { moduleId: "def:cdncheck", bin: "cdncheck", recipes: [
    brew("cdncheck"),
    go("github.com/projectdiscovery/cdncheck/cmd/cdncheck@latest"),
  ] },
  { moduleId: "def:naabu", bin: "naabu", recipes: [
    brew("naabu"),
    go("github.com/projectdiscovery/naabu/v2/cmd/naabu@latest"),
  ], afterNote: { win32: "naabu needs Npcap to capture packets: install it once from https://npcap.com (it asks for administrator rights)." } },
  // winget's nmap is a 2019 build; scoop's is current and needs no elevation,
  // but Npcap — which nmap needs — has no silent installer and always wants UAC.
  { moduleId: "def:nmap", bin: "nmap", recipes: [brew("nmap"), scoop("nmap", "main"), apt("nmap")],
    manualHint: { win32: "Download the installer from https://nmap.org/download.html and run it (it installs Npcap; both ask for administrator rights)." },
    afterNote: { win32: "nmap needs Npcap: run the npcap installer that came with it once (%USERPROFILE%\\scoop\\apps\\nmap\\current\\npcap.exe; it asks for administrator rights)." } },
];

export const toolFor = (moduleId: string): Tool | undefined => TOOLS.find((t) => t.moduleId === moduleId);
export const allTools = (): readonly Tool[] => TOOLS;

// ── detection ────────────────────────────────────────────────────────────────

const run = (cmd: string, args: string[], timeout = 8000) =>
  new Promise<{ ok: boolean; out: string }>((resolve) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 1 << 20 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout ?? ""}${stderr ?? ""}`.trim() }));
    child.on("error", () => resolve({ ok: false, out: "" }));
  });

/** Is `bin` on PATH? Uses the repaired PATH from env.ts, which is the whole
 *  reason this reports the truth in a packaged app. */
async function which(bin: string): Promise<string | null> {
  const { ok, out } = await run(isWin ? "where" : "which", [bin], 4000);
  if (!ok || !out) return null;
  return out.split(/\r?\n/)[0]?.trim() || null;
}

let managerCache: Map<Manager, boolean> | null = null;

/** Which package managers exist here. Cached — a manager does not appear
 *  mid-session, and `installAll` would otherwise probe once per tool. */
export async function availableManagers(force = false): Promise<Map<Manager, boolean>> {
  if (managerCache && !force) return managerCache;
  const names: Manager[] = isWin ? ["winget", "scoop", "choco", "go", "pipx", "gem"]
    : isMac ? ["brew", "pipx", "go", "gem"]
    : ["brew", "pipx", "go", "apt", "gem"];
  const found = await Promise.all(names.map(async (n) => {
    let present = (await which(n)) !== null;
    // Windows: what runs the shim matters more than the shim (resolveCommand).
    if (isWin && n === "gem") present = present && (await which("ruby")) !== null;
    if (isWin && n === "pipx") present = present || (await which("py")) !== null && (await run("py", ["-m", "pipx", "--version"], 8000)).ok;
    if (isWin && n === "choco") present = false; // admin-only by design; shown, never run
    return [n, present] as const;
  }));
  managerCache = new Map(found);
  return managerCache;
}

/** The recipe we would actually use here, and whether we are allowed to run it. */
async function pick(tool: Tool): Promise<{ recipe: Recipe | null; runnable: boolean }> {
  const managers = await availableManagers();
  for (const r of tool.recipes) {
    if (!managers.get(r.manager)) continue;
    return { recipe: r, runnable: !r.sudo };
  }
  return { recipe: null, runnable: false };
}

/** Every recipe we could run here, in order of preference — the first is what
 *  `pick` chose; the rest are what to try when it fails. */
async function runnableRecipes(tool: Tool): Promise<Recipe[]> {
  const managers = await availableManagers();
  return tool.recipes.filter((r) => managers.get(r.manager) && !r.sudo);
}

const describe = (r: Step & { sudo?: boolean }): string =>
  `${r.sudo ? "sudo " : ""}${r.manager} ${r.argv.join(" ")}`;

/** How to get a package manager this machine lacks, per platform — so "no
 *  manager" comes with the one line that fixes it. */
const MANAGER_HINT: Record<"darwin" | "linux" | "win32", Partial<Record<Manager, string>>> = {
  darwin: {
    brew: "Install Homebrew first: /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"",
    pipx: "Install pipx first: brew install pipx",
    go: "Install Go first: brew install go",
    gem: "Install a current Ruby first: brew install ruby",
  },
  linux: {
    pipx: "Install pipx first: sudo apt install pipx (or python3 -m pip install --user pipx)",
    go: "Install Go first: sudo apt install golang-go (or from https://go.dev/dl)",
    gem: "Install Ruby first: sudo apt install ruby-full",
  },
  win32: {
    pipx: "Install Python and pipx first: winget install -e --id Python.Python.3.13 --scope user; py -m pip install --user pipx; py -m pipx ensurepath",
    go: "Install Go first: winget install -e --id GoLang.Go (or, without admin rights, scoop install go)",
    scoop: "Install Scoop first (no admin needed): Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser; irm get.scoop.sh | iex",
    gem: "Install Ruby with DevKit first: winget install -e --id RubyInstallerTeam.RubyWithDevKit.3.4 --scope user",
  },
};

/** The hint for the first manager among a tool's recipes that is missing here. */
function missingManagerHint(t: Tool): string | undefined {
  for (const r of t.recipes) {
    if (r.sudo) continue;
    const hint = MANAGER_HINT[os]?.[r.manager];
    if (hint) return hint;
  }
  return undefined;
}

/**
 * The real process to start for a step. On macOS and Linux that is the
 * manager itself. On Windows several "commands" are .cmd or .ps1 shims that
 * CreateProcess cannot start and Node refuses to (CVE-2024-27980), so each is
 * started through its interpreter with the same constant argv:
 *   scoop → powershell -File <scoop.ps1> …    gem → ruby <gem script> …
 *   pipx  → py -m pipx … when pipx.exe is not on PATH
 * Nothing here goes through cmd.exe, and nothing in argv is ever interpolated.
 */
async function resolveCommand(step: Step): Promise<{ cmd: string; args: string[] }> {
  if (!isWin) return { cmd: step.manager, args: step.argv };
  const found = await which(step.manager);
  const ext = found?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const home = process.env.USERPROFILE ?? "";
  if (step.manager === "scoop") {
    // Scoop lives in ~\scoop unless SCOOP relocates it.
    const ps1 = `${process.env.SCOOP || `${home}\\scoop`}\\apps\\scoop\\current\\bin\\scoop.ps1`;
    return { cmd: await which("pwsh") ? "pwsh.exe" : "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1, ...step.argv] };
  }
  if (step.manager === "gem") {
    const ruby = await which("ruby");
    const gemScript = ruby ? ruby.replace(/ruby\.exe$/i, "gem") : "gem";
    return { cmd: "ruby.exe", args: [gemScript, ...step.argv] };
  }
  if (step.manager === "pipx" && ext !== "exe") return { cmd: "py.exe", args: ["-m", "pipx", ...step.argv] };
  if (ext === "cmd" || ext === "bat") return { cmd: "cmd.exe", args: ["/d", "/s", "/c", found!, ...step.argv] };
  return { cmd: found ?? step.manager, args: step.argv };
}

/** Current state of every installable tool, for the manager UI. */
export async function toolStatuses(nameFor: (moduleId: string) => string): Promise<ToolStatus[]> {
  await availableManagers(true);
  return Promise.all(TOOLS.map(async (t): Promise<ToolStatus> => {
    const path = await which(t.bin);
    const { recipe, runnable } = await pick(t);
    const state: ToolInstallState =
      path ? "installed" : recipe && runnable ? "missing" : "unavailable";
    return {
      moduleId: t.moduleId,
      name: nameFor(t.moduleId),
      bin: t.bin,
      state,
      path: path ?? undefined,
      via: recipe && runnable ? describe(recipe) : undefined,
      // When we cannot run it (needs root, or no manager here), hand the user
      // the exact command rather than a shrug — and when the missing piece is
      // a package manager, the command that installs THAT.
      manual: !path && (!recipe || !runnable)
        ? (recipe ? describe(recipe) : (hintFor(t) ?? missingManagerHint(t) ?? describe(t.recipes[0])))
        : undefined,
      note: t.afterNote?.[os],
    };
  }));
}

// ── installation ─────────────────────────────────────────────────────────────

export interface InstallEvent {
  moduleId: string;
  state: ToolInstallState;
  /** A line of installer output, for the log view. */
  line?: string;
  error?: string;
}

const active = new Map<string, ReturnType<typeof spawn>>();

/** Install one tool. Resolves when the process exits. Never runs a sudo recipe. */
export function installTool(moduleId: string, emit: (e: InstallEvent) => void): Promise<boolean> {
  return new Promise(async (resolve) => {
    const tool = toolFor(moduleId);
    if (!tool) { emit({ moduleId, state: "failed", error: "No installer is defined for that module." }); return resolve(false); }
    if (active.has(moduleId)) return resolve(false);

    if (await which(tool.bin)) { emit({ moduleId, state: "installed" }); return resolve(true); }

    const { recipe, runnable } = await pick(tool);
    if (!recipe || !runnable) {
      emit({
        moduleId, state: "unavailable",
        error: recipe
          ? `Installing ${tool.bin} here needs root. Run this yourself: ${describe(recipe)}`
          : hintFor(tool)
            ? `Install ${tool.bin} yourself, then press Recheck: ${hintFor(tool)}`
            : missingManagerHint(tool)
              ? `${missingManagerHint(tool)} Then press Recheck.`
              : `No supported package manager found for ${tool.bin}. Install it manually, then press Recheck.`,
      });
      return resolve(false);
    }

    cancelled.delete(moduleId);
    // Every route this machine can run, most preferred first. A route that
    // fails hands over to the next: a Homebrew whose bottle data is broken
    // still leaves `gem`, `go` or `pipx` to try.
    const routes = await runnableRecipes(tool);
    let found: string | null = null;
    let last: { ok: boolean; output: string; error?: string } = { ok: false, output: "" };
    let used: Recipe = recipe;
    for (const [i, route] of routes.entries()) {
      if (cancelled.has(moduleId)) break;
      used = route;
      if (i > 0) emit({ moduleId, state: "installing", line: `Trying another route: ${describe(route)}` });
      // Preparatory steps for this route (a scoop bucket). A required one that
      // fails ends this route; an optional one that fails is just reported.
      let prepOk = true;
      for (const step of route.pre ?? []) {
        if (cancelled.has(moduleId)) break;
        emit({ moduleId, state: "installing", line: `$ ${describe(step)}` });
        const p = await runStep(moduleId, step, emit);
        if (!p.ok && !step.optional) { prepOk = false; last = p; break; }
      }
      if (!prepOk) continue;
      if (cancelled.has(moduleId)) break; // Stop pressed during a preparatory step

      emit({ moduleId, state: "installing", line: `$ ${describe(route)}` });
      last = await runStep(moduleId, route, emit);
      const badBottle = () => route.manager === "brew" && /manifest matching bottle checksum/i.test(last.output);
      if (!last.ok && badBottle() && !cancelled.has(moduleId)) {
        // Homebrew's own advice for this one: refresh its metadata and retry.
        emit({ moduleId, state: "installing", line: "$ brew update   # stale bottle metadata; refreshing and retrying once" });
        await runStep(moduleId, { manager: "brew", argv: ["update"] }, emit);
        if (cancelled.has(moduleId)) break; // Stop pressed while brew update ran
        emit({ moduleId, state: "installing", line: `$ ${describe(route)}` });
        last = await runStep(moduleId, route, emit);
      }
      // A tool installed by a route this PATH did not know about yet (a gem's
      // bin dir that did not exist a minute ago) is found after a re-scan.
      refreshPath();
      found = await which(tool.bin);
      if (found) break;
    }

    // Trust the filesystem over the exit code: some installers exit non-zero
    // on a warning, and `go install` can succeed while printing to stderr.
    if (found) {
      for (const step of used.post ?? []) {
        if (cancelled.has(moduleId)) break;
        emit({ moduleId, state: "installing", line: `$ ${describe(step)}` });
        const p = await runStep(moduleId, step, emit, workspaceDir);
        if (!p.ok && !step.optional) emit({ moduleId, state: "installing", line: `(${describe(step)} failed — the tool is installed, but may need it run by hand)` });
      }
      emit({ moduleId, state: "installed", line: found });
    } else {
      const hint = hintFor(tool);
      const why = diagnose(last.output);
      emit({
        moduleId, state: "failed",
        error: last.error
          ?? (last.ok ? `${tool.bin} did not appear on PATH after install.`
            : `Install failed (tried ${routes.map(describe).join(", then ")}).${why ? ` ${why}` : ""}${hint ? ` You can also: ${hint}` : ""}`),
      });
    }
    resolve(!!found);
  });
}

/** Ids whose install was cancelled between steps. */
const cancelled = new Set<string>();

/** Known failure signatures → what is actually wrong, in one sentence. The
 *  raw log is in the install view; this is the line that says what to do. */
function diagnose(output: string): string | undefined {
  if (/too outdated|tapi error|unknown architecture|Failed to build gem native extension|xcrun: error|missing xcrun|No developer tools/i.test(output)) {
    return isMac
      ? "This Mac's C toolchain cannot build native code right now — update the Xcode Command Line Tools (xcode-select --install, or the Xcode that matches your macOS), then retry."
      : "A C toolchain is needed to build this — install build tools (gcc/make and the Ruby or Python headers), then retry.";
  }
  if (/manifest matching bottle checksum/i.test(output)) {
    return "Homebrew's bottle metadata does not match its downloads on this machine (a beta macOS, or a Homebrew development build) — `brew update-reset` may fix it.";
  }
  if (/externally-managed-environment/i.test(output)) return "This Python is externally managed — use pipx (the recipe already does; make sure pipx itself is installed).";
  if (/permission denied|EACCES/i.test(output)) return "A directory in the way is not writable by you; Aether never elevates. Fix the ownership or install by hand.";
  if (/could not resolve host|network is unreachable|TLS handshake|dial tcp|i\/o timeout/i.test(output)) return "The network was unreachable while downloading — check the connection or proxy and retry.";
  return undefined;
}

/** Package managers must never stop to ask: there is nobody at their stdin.
 *  Homebrew 6's default confirmation already skips itself off a TTY; the env
 *  says so explicitly and quiets the hints, and the rest are belt and braces. */
function installerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,                  // the repaired PATH
    HOMEBREW_NO_ASK: "1",
    HOMEBREW_NO_ENV_HINTS: "1",
    HOMEBREW_NO_INSTALL_CLEANUP: "1",
    HOMEBREW_NO_INSTALL_UPGRADE: "1",
    HOMEBREW_NO_ANALYTICS: "1",
    GIT_TERMINAL_PROMPT: "0",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_NO_INPUT: "1",
    GOFLAGS: process.env.GOFLAGS ?? "-buildvcs=false",
    // The Go tools here build without cgo, and a C toolchain is exactly what a
    // fresh Windows or macOS box does not have.
    CGO_ENABLED: process.env.CGO_ENABLED ?? "0",
    DEBIAN_FRONTEND: "noninteractive",
  };
}

/** Run one step to completion, streaming its output. Never rejects. */
function runStep(moduleId: string, step: Step, emit: (e: InstallEvent) => void, cwd?: string): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    // argv form, never a shell string: nothing here is interpolated, and this
    // keeps it that way by construction (see resolveCommand for Windows).
    let output = "";
    void resolveCommand(step).then(({ cmd, args }) => {
    const child = spawn(cmd, args, {
      env: installerEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      ...(cwd ? { cwd } : {}),
      ...(isWin ? { windowsHide: true } : {}),
    });
    active.set(moduleId, child);
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      if (output.length < 200_000) output += text;
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (t) emit({ moduleId, state: "installing", line: t.slice(0, 400) });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => { active.delete(moduleId); resolve({ ok: false, output, error: e.message }); });
    child.on("close", (code) => { active.delete(moduleId); resolve({ ok: code === 0, output }); });
    });
  });
}

/** Cancel an in-flight install. */
export function cancelInstall(moduleId: string): void {
  cancelled.add(moduleId);
  active.get(moduleId)?.kill();
  active.delete(moduleId);
}

/** Install everything missing, one at a time. Serial on purpose: package
 *  managers take repository locks, and three concurrent `brew install`s is a
 *  reliable way to wedge all three. */
export async function installMissing(
  emit: (e: InstallEvent) => void,
  shouldStop: () => boolean,
): Promise<{ installed: number; failed: number; skipped: number }> {
  const result = { installed: 0, failed: 0, skipped: 0 };
  for (const tool of TOOLS) {
    if (shouldStop()) break;
    if (await which(tool.bin)) { result.skipped++; continue; }
    const { recipe, runnable } = await pick(tool);
    if (!recipe || !runnable) { result.skipped++; emit({ moduleId: tool.moduleId, state: "unavailable" }); continue; }
    (await installTool(tool.moduleId, emit)) ? result.installed++ : result.failed++;
  }
  return result;
}
