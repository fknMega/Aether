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

/** A way to install one binary. `sudo: true` means we will not run it — it is
 *  shown to the user instead. */
interface Recipe {
  manager: Manager;
  argv: string[];
  sudo?: boolean;
}
type Manager = "brew" | "pipx" | "go" | "apt" | "gem" | "winget" | "scoop";

interface Tool {
  /** The bundled module this installs for, e.g. `def:subfinder`. */
  moduleId: string;
  /** The executable that must end up on PATH. */
  bin: string;
  /** Ordered by preference; the first whose manager is present wins. */
  recipes: Recipe[];
}

const brew = (...pkg: string[]): Recipe => ({ manager: "brew", argv: ["install", ...pkg] });
const pipx = (pkg: string): Recipe => ({ manager: "pipx", argv: ["install", pkg] });
const go = (mod: string): Recipe => ({ manager: "go", argv: ["install", mod] });
const apt = (pkg: string): Recipe => ({ manager: "apt", argv: ["install", "-y", pkg], sudo: true });
const gem = (pkg: string): Recipe => ({ manager: "gem", argv: ["install", "--user-install", pkg] });

/** The catalog. Keyed to the bundled module ids in modules.ts. */
const TOOLS: Tool[] = [
  // people / identity
  { moduleId: "def:maigret", bin: "maigret", recipes: [pipx("maigret")] },
  { moduleId: "def:holehe", bin: "holehe", recipes: [pipx("holehe")] },
  { moduleId: "def:socialscan", bin: "socialscan", recipes: [pipx("socialscan")] },
  { moduleId: "def:phoneinfoga", bin: "phoneinfoga", recipes: [
    brew("sundowndev/phoneinfoga/phoneinfoga"),
    go("github.com/sundowndev/phoneinfoga/v2/cmd/phoneinfoga@latest"),
  ] },
  // web recon
  { moduleId: "def:whatweb", bin: "whatweb", recipes: [brew("whatweb"), apt("whatweb")] },
  { moduleId: "def:wafw00f", bin: "wafw00f", recipes: [pipx("wafw00f")] },
  { moduleId: "def:httpx", bin: "httpx", recipes: [
    brew("httpx"),
    go("github.com/projectdiscovery/httpx/cmd/httpx@latest"),
  ] },
  { moduleId: "def:tlsx", bin: "tlsx", recipes: [
    brew("tlsx"),
    go("github.com/projectdiscovery/tlsx/cmd/tlsx@latest"),
  ] },
  { moduleId: "def:sslscan", bin: "sslscan", recipes: [brew("sslscan"), apt("sslscan")] },
  // subdomain / asset discovery
  { moduleId: "def:subfinder", bin: "subfinder", recipes: [
    brew("subfinder"),
    go("github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest"),
  ] },
  { moduleId: "def:amass-passive", bin: "amass", recipes: [
    brew("amass"),
    go("github.com/owasp-amass/amass/v4/...@master"),
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
    go("github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest"),
  ] },
  { moduleId: "def:nikto", bin: "nikto", recipes: [brew("nikto"), apt("nikto")] },
  { moduleId: "def:wpscan", bin: "wpscan", recipes: [brew("wpscanteam/tap/wpscan"), gem("wpscan")] },
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
  ] },
  { moduleId: "def:nmap", bin: "nmap", recipes: [brew("nmap"), apt("nmap"), { manager: "winget", argv: ["install", "-e", "--id", "Insecure.Nmap"] }] },
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
  const names: Manager[] = isWin ? ["winget", "scoop", "go", "pipx", "gem"]
    : isMac ? ["brew", "pipx", "go", "gem"]
    : ["brew", "pipx", "go", "apt", "gem"];
  const found = await Promise.all(names.map(async (n) => [n, (await which(n)) !== null] as const));
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

const describe = (r: Recipe): string =>
  `${r.sudo ? "sudo " : ""}${r.manager} ${r.argv.join(" ")}`;

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
      // the exact command rather than a shrug.
      manual: !path && (!recipe || !runnable)
        ? describe(recipe ?? t.recipes[0])
        : undefined,
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
          : `No supported package manager found for ${tool.bin}. Install it manually, then press Recheck.`,
      });
      return resolve(false);
    }

    emit({ moduleId, state: "installing", line: `$ ${describe(recipe)}` });
    // argv form, never a shell string: nothing here is interpolated, and this
    // keeps it that way by construction.
    const child = spawn(recipe.manager, recipe.argv, {
      env: process.env,                 // the repaired PATH
      stdio: ["ignore", "pipe", "pipe"],
    });
    active.set(moduleId, child);

    const onData = (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        const t = line.trim();
        if (t) emit({ moduleId, state: "installing", line: t.slice(0, 400) });
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const finish = async (okGuess: boolean, error?: string) => {
      active.delete(moduleId);
      // Trust the filesystem over the exit code: some installers exit non-zero
      // on a warning, and `go install` can succeed while printing to stderr.
      const found = await which(tool.bin);
      if (found) emit({ moduleId, state: "installed", line: found });
      else emit({ moduleId, state: "failed", error: error ?? (okGuess ? `${tool.bin} did not appear on PATH after install.` : `Install failed. Try: ${describe(recipe)}`) });
      resolve(!!found);
    };

    child.on("error", (e) => void finish(false, e.message));
    child.on("close", (code) => void finish(code === 0));
  });
}

/** Cancel an in-flight install. */
export function cancelInstall(moduleId: string): void {
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
