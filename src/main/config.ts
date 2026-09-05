import { app } from "electron";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { AetherSettings } from "../shared/types";

/** out/main/index.js -> project root (dev). In a packaged build the asar root. */
const HERE = import.meta.dirname;
const PROJECT_ROOT = resolve(HERE, "..", "..");

const packaged = app.isPackaged;

/** Writable app data (SQLite-free JSON store, workspace, settings). */
const DATA_DIR = join(app.getPath("userData"), "data");
/** Where the agent may read/write files — fenced, never the whole home dir. */
const WORKSPACE = join(app.getPath("userData"), "workspace");
/** Bundled offensive-security skill playbooks. */
const PLUGINS_DIR = packaged ? join(process.resourcesPath, "plugins") : join(PROJECT_ROOT, "plugins");
/** Private, gitignored overlay: licensed connectors + local doctrine + secrets. */
const PRIVATE_DIR = packaged ? join(app.getPath("userData"), "private") : join(PROJECT_ROOT, "private");

for (const dir of [DATA_DIR, WORKSPACE]) mkdirSync(dir, { recursive: true });

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
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv(join(PRIVATE_DIR, ".env"));

const DEFAULT_SETTINGS: AetherSettings = {
  ownerName: process.env.AETHER_OWNER ?? "friend",
  model: process.env.AETHER_MODEL ?? "claude-opus-5",
  effort: (process.env.AETHER_EFFORT as AetherSettings["effort"]) ?? "medium",
  personaVoice: "flirty",
  autonomy: true,

  provider: (process.env.AETHER_PROVIDER as AetherSettings["provider"]) ?? "claude",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.1",
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
      return { ...DEFAULT_SETTINGS, ...raw };
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}
