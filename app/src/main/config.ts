import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { AetherSettings } from "../shared/types";

/** out/main/index.js -> project root (dev). In a packaged build the asar root. */
const HERE = import.meta.dirname;
const PROJECT_ROOT = resolve(HERE, "..", "..");

const packaged = app.isPackaged;

/** Writable app data (SQLite-free JSON store, workspace, settings). */
const DATA_DIR = join(app.getPath("userData"), "data");
/** The agent's only filesystem root. Enforced three ways: it is the SDK cwd,
 *  `blockReadsOutsideWorkingDirectories` refuses reads outside it in every
 *  permission mode, and main/permissions.ts refuses absolute paths that leave
 *  it. Before all three existed this comment was aspirational. */
const WORKSPACE = join(app.getPath("userData"), "workspace");
/** Bundled offensive-security skill playbooks. */
const PLUGINS_DIR = packaged ? join(process.resourcesPath, "plugins") : join(PROJECT_ROOT, "plugins");
/** Private, gitignored overlay: licensed connectors + local doctrine + secrets. */
const PRIVATE_DIR = packaged ? join(app.getPath("userData"), "private") : join(PROJECT_ROOT, "private");

for (const dir of [DATA_DIR, WORKSPACE]) mkdirSync(dir, { recursive: true });

/** Keys that came from private/.env. Command modules get a scrubbed environment
 *  so one module cannot read another module's key, or the operator's, just by
 *  printing its own env. */
export const dotEnvKeys = new Set<string>();

/** Minimal dotenv: load private/.env into process.env without a dependency. */
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) { process.env[key] = val; dotEnvKeys.add(key); }
  }
}
loadDotEnv(join(PRIVATE_DIR, ".env"));

/** Version 2: gpt-4o and the dated Haiku id stopped being the shipped defaults. */
const SETTINGS_VERSION = 2;

const DEFAULT_SETTINGS: AetherSettings = {
  ownerName: process.env.AETHER_OWNER ?? "friend",
  model: process.env.AETHER_MODEL ?? "claude-opus-5",
  effort: (process.env.AETHER_EFFORT as AetherSettings["effort"]) ?? "medium",
  personaVoice: "flirty",
  // Capable, but never silent. Aether ingests attacker-controlled text for a
  // living, so the shell, the network and installing are decisions the operator
  // makes per request rather than ones they inherit from a default. "full"
  // removes the prompts; "safe" removes the capabilities.
  access: "ask",

  provider: (process.env.AETHER_PROVIDER as AetherSettings["provider"]) ?? "claude",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.6-terra",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",

  autoUpdate: true,
  theme: (process.env.AETHER_THEME as AetherSettings["theme"]) ?? "system",
  setupDone: false,
  settingsVersion: SETTINGS_VERSION,
};

export const paths = {
  projectRoot: PROJECT_ROOT,
  dataDir: DATA_DIR,
  workspace: WORKSPACE,
  pluginsDir: PLUGINS_DIR,
  privateDir: PRIVATE_DIR,
  settingsFile: join(DATA_DIR, "settings.json"),
  storeFile: join(DATA_DIR, "store.json"),
  modulesFile: join(DATA_DIR, "modules.json"),
  uploadsDir: join(WORKSPACE, "uploads"),
  briefFile: join(HERE, "brief.md"),
  privateBriefFile: join(PRIVATE_DIR, "brief.local.md"),
  connectorsDir: join(PRIVATE_DIR, "connectors"),
};

const rawTimeout = Number(process.env.AETHER_TURN_TIMEOUT_MS);

export const runtime = {
  timezone: process.env.AETHER_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  // Guard against a non-numeric env value (NaN would abort every turn instantly).
  turnTimeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 600_000,
  defaults: DEFAULT_SETTINGS,
};

export function loadSettings(): AetherSettings {
  try {
    if (existsSync(paths.settingsFile)) {
      const raw = JSON.parse(readFileSync(paths.settingsFile, "utf8"));
      const merged: AetherSettings = { ...DEFAULT_SETTINGS, ...raw };
      // Upgrade path: `autonomy` was a boolean before access levels existed.
      // Honour what the operator already chose rather than quietly widening or
      // narrowing it — true meant "no prompts", false meant "collection only".
      if (raw.access === undefined && typeof raw.autonomy === "boolean") {
        merged.access = raw.autonomy ? "full" : "safe";
      }
      // Defaults an earlier build wrote into the file that are retired now:
      // gpt-4o's snapshots are on a shutdown schedule, and the dated Haiku id
      // has an undated alias. Moved ONCE, gated on the file's version — on a
      // later launch the same value can only be a choice the operator made,
      // and the picker still offers gpt-4o on any gateway that serves it.
      const fromVersion = typeof raw.settingsVersion === "number" ? raw.settingsVersion : 1;
      if (fromVersion < 2) {
        if (raw.openaiModel === "gpt-4o") merged.openaiModel = DEFAULT_SETTINGS.openaiModel;
        if (raw.model === "claude-haiku-4-5-20251001") merged.model = "claude-haiku-4-5";
        merged.settingsVersion = SETTINGS_VERSION;
        // Persist the marker now, so it holds even if Settings is never saved.
        try { writeFileSync(paths.settingsFile, JSON.stringify(merged, null, 2), "utf8"); } catch { /* next save will */ }
      }
      return merged;
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}
