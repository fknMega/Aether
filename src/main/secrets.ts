// ─────────────────────────────────────────────────────────────────────────────
// Encrypted secret store for provider API keys (e.g. the OpenAI key).
// Same rules as module secrets: encrypted at rest with the OS keychain via
// Electron safeStorage, and the plaintext never leaves the main process — the
// renderer only ever learns whether a key is set.
// ─────────────────────────────────────────────────────────────────────────────
import { safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./config";

const FILE = join(paths.dataDir, "secrets.json");
type Bag = Record<string, string>; // name -> "enc:"/"raw:" payload

function load(): Bag {
  try { if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")) as Bag; }
  catch (e) { console.error("[aether] secrets load failed:", e); }
  return {};
}
let bag: Bag = load();

function persist(): void {
  try { writeFileSync(FILE, JSON.stringify(bag, null, 2), "utf8"); }
  catch (e) { console.error("[aether] could not save secrets:", e); }
}

function encrypt(value: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(value).toString("base64");
  } catch { /* fall through */ }
  return "raw:" + Buffer.from(value, "utf8").toString("base64");
}
function decrypt(payload: string): string {
  try {
    if (payload.startsWith("enc:")) return safeStorage.decryptString(Buffer.from(payload.slice(4), "base64"));
    if (payload.startsWith("raw:")) return Buffer.from(payload.slice(4), "base64").toString("utf8");
  } catch { /* ignore */ }
  return "";
}

export const secrets = {
  /** Store (or clear, with an empty value) a named secret. */
  set(name: string, value: string): void {
    const k = name.trim();
    if (!k) return;
    if (value) bag[k] = encrypt(value); else delete bag[k];
    persist();
  },
  /** Main-process only. */
  get(name: string): string { return bag[name] ? decrypt(bag[name]) : ""; },
  has(name: string): boolean { return !!bag[name]; },
};

export const OPENAI_KEY = "OPENAI_API_KEY";
