// ─────────────────────────────────────────────────────────────────────────────
// Modules — the capabilities Aether can reach for, configurable from Settings.
//
//  • built-in modules map to the native tool groups (username search, recon,
//    EXIF, reverse-image) and are default-enabled; toggling one includes/excludes
//    that tool group when the server is (re)built.
//  • custom modules are user-authored: a local COMMAND or an HTTP API called with
//    the user's own keys. Each enabled one becomes a tool the agent can call.
//  • connector rows mirror loaded private code connectors (read-only, for visibility).
//
// Secrets (API keys) are encrypted at rest with Electron safeStorage (OS keychain)
// when available, and are NEVER sent back to the renderer — the renderer only
// learns whether a value is set.
// ─────────────────────────────────────────────────────────────────────────────
import { safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { paths } from "./config";
import type { ModuleConfig, ModuleSecret, ModuleHeader } from "../shared/types";

interface StoredSecret { name: string; enc: string; }
type StoredModule = Omit<ModuleConfig, "secrets"> & { secrets?: StoredSecret[] };

/** A custom module with its secrets decrypted — main-process use only. */
export interface LiveModule extends Omit<ModuleConfig, "secrets"> {
  secretValues: Record<string, string>;
}

const BUILTINS: Array<{ key: NonNullable<ModuleConfig["builtinKey"]>; name: string; description: string }> = [
  { key: "username", name: "Username search", description: "Hunt a username / handle across dozens of platforms at once (Sherlock-style) and report where a public profile exists." },
  { key: "recon", name: "Network recon", description: "DNS lookups, WHOIS, and safe HTTP probing to map a domain's infrastructure and confirm hosts." },
  { key: "exif", name: "Image EXIF", description: "Read GPS coordinates, camera make/model and timestamps out of a photo's metadata." },
  { key: "reverse_image", name: "Reverse image", description: "Build reverse-image-search links (Yandex / Google Lens / TinEye / Bing) for a photo." },
];

const seedBuiltin = (b: (typeof BUILTINS)[number]): StoredModule => ({
  id: "builtin:" + b.key, name: b.name, description: b.description,
  kind: "builtin", enabled: true, builtin: true, builtinKey: b.key,
});

function seed(): StoredModule[] { return BUILTINS.map(seedBuiltin); }

// ── crypto ────────────────────────────────────────────────────────────────────
function encrypt(value: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(value).toString("base64");
  } catch { /* fall through */ }
  return "raw:" + Buffer.from(value, "utf8").toString("base64"); // plaintext fallback (no keychain)
}
function decrypt(enc: string): string {
  try {
    if (enc.startsWith("enc:")) return safeStorage.decryptString(Buffer.from(enc.slice(4), "base64"));
    if (enc.startsWith("raw:")) return Buffer.from(enc.slice(4), "base64").toString("utf8");
  } catch { /* ignore */ }
  return "";
}

// ── persistence ─────────────────────────────────────────────────────────────
let mods: StoredModule[] = load();
let connectorNames: string[] = [];

function load(): StoredModule[] {
  let base: StoredModule[] = seed();
  try {
    if (existsSync(paths.modulesFile)) {
      const raw = JSON.parse(readFileSync(paths.modulesFile, "utf8")) as StoredModule[];
      if (Array.isArray(raw)) base = reconcileBuiltins(raw);
    }
  } catch (e) { console.error("[aether] modules load failed:", e); }
  return reconcilePrivate(base);
}

/** Seed custom modules declared in the gitignored `private/modules.json` (e.g. a
 *  licensed connector's config) if they aren't already in the store. Secret
 *  values are NOT taken from the file — each declared secret becomes an empty,
 *  fillable slot the owner completes in Settings (encrypted on save). */
function reconcilePrivate(list: StoredModule[]): StoredModule[] {
  const file = join(paths.privateDir, "modules.json");
  if (!existsSync(file)) return list;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(raw)) return list;
    const out = [...list];
    for (const p of raw) {
      const id = String(p?.id || "").trim() || "private:" + slug(String(p?.name || "module"));
      if (out.some((m) => m.id === id)) continue; // preserve the owner's edits / keys
      out.push({
        id,
        name: String(p?.name || "module").slice(0, 60),
        description: String(p?.description || "").slice(0, 2000),
        kind: p?.kind === "http" ? "http" : "command",
        enabled: p?.enabled !== false,
        builtin: false,
        inputLabel: typeof p?.inputLabel === "string" ? p.inputLabel : undefined,
        command: typeof p?.command === "string" ? p.command : undefined,
        method: p?.method === "POST" ? "POST" : "GET",
        url: typeof p?.url === "string" ? p.url : undefined,
        headers: Array.isArray(p?.headers) ? p.headers.filter((h: unknown) => (h as ModuleHeader)?.name) : [],
        body: typeof p?.body === "string" ? p.body : undefined,
        secrets: Array.isArray(p?.secrets) ? p.secrets.map((s: { name?: string }) => ({ name: String(s?.name || ""), enc: "" })).filter((s: StoredSecret) => s.name) : [],
      });
    }
    return out;
  } catch (e) { console.error("[aether] private modules load failed:", e); return list; }
}

/** Make sure every built-in exists (add ones introduced in a later version),
 *  preserving the user's enabled/disabled choice for the ones already present. */
function reconcileBuiltins(raw: StoredModule[]): StoredModule[] {
  const out = [...raw];
  for (const b of BUILTINS) {
    if (!out.some((m) => m.id === "builtin:" + b.key)) out.push(seedBuiltin(b));
  }
  return out;
}

function persist(): void {
  try { writeFileSync(paths.modulesFile, JSON.stringify(mods, null, 2), "utf8"); }
  catch (e) { console.error("[aether] could not save modules:", e); }
}

// ── redaction (what the renderer sees) ────────────────────────────────────────
function redact(m: StoredModule): ModuleConfig {
  const { secrets, ...rest } = m;
  // An empty enc is a declared-but-unset slot (e.g. a private-seeded key) — the
  // UI shows it as fillable rather than "stored".
  return { ...rest, secrets: (secrets ?? []).map((s) => ({ name: s.name, set: (s.enc?.length ?? 0) > 0 })) };
}

function connectorRow(name: string): ModuleConfig {
  return { id: "connector:" + name, name, description: "Loaded from a private code connector.", kind: "connector", enabled: true, builtin: true };
}

// function declaration (hoisted) so reconcilePrivate() can call it during load().
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "module"; }

// ── merge an incoming save onto the stored record ─────────────────────────────
function mergeSecrets(prior: StoredSecret[] | undefined, incoming: ModuleSecret[] | undefined): StoredSecret[] {
  const priorMap = new Map((prior ?? []).map((s) => [s.name, s.enc]));
  const out: StoredSecret[] = [];
  for (const s of incoming ?? []) {
    const name = s.name.trim();
    if (!name || s.clear) continue;
    if (typeof s.value === "string" && s.value.length) out.push({ name, enc: encrypt(s.value) });
    else if (priorMap.has(name)) out.push({ name, enc: priorMap.get(name)! }); // keep existing
  }
  return out;
}

export const modules = {
  /** Redacted list for the renderer, with read-only connector rows appended. */
  list(): ModuleConfig[] {
    const configured = mods.map(redact);
    const extra = connectorNames
      .filter((n) => !mods.some((m) => m.name.toLowerCase() === n.toLowerCase()))
      .map(connectorRow);
    return [...configured, ...extra];
  },

  save(input: ModuleConfig): ModuleConfig[] {
    const existing = mods.find((m) => m.id === input.id);
    if (existing?.builtin || existing?.kind === "connector") {
      // Built-ins/connectors: only the enabled flag is user-mutable.
      if (existing) existing.enabled = !!input.enabled;
    } else if (existing) {
      Object.assign(existing, {
        name: input.name.slice(0, 60) || existing.name,
        description: input.description.slice(0, 2000),
        kind: input.kind === "http" ? "http" : "command",
        enabled: !!input.enabled,
        inputLabel: input.inputLabel?.slice(0, 400),
        command: input.command?.slice(0, 4000),
        method: input.method === "POST" ? "POST" : "GET",
        url: input.url?.slice(0, 2000),
        headers: (input.headers ?? []).filter((h) => h.name.trim()).slice(0, 20),
        body: input.body?.slice(0, 8000),
        secrets: mergeSecrets(existing.secrets, input.secrets),
      });
    } else {
      mods.push({
        id: randomUUID(),
        name: input.name.slice(0, 60) || "New module",
        description: input.description.slice(0, 2000),
        kind: input.kind === "http" ? "http" : "command",
        enabled: input.enabled !== false,
        builtin: false,
        inputLabel: input.inputLabel?.slice(0, 400),
        command: input.command?.slice(0, 4000),
        method: input.method === "POST" ? "POST" : "GET",
        url: input.url?.slice(0, 2000),
        headers: (input.headers ?? []).filter((h) => h.name.trim()).slice(0, 20),
        body: input.body?.slice(0, 8000),
        secrets: mergeSecrets(undefined, input.secrets),
      });
    }
    persist();
    return this.list();
  },

  remove(id: string): ModuleConfig[] {
    const m = mods.find((x) => x.id === id);
    if (m && !m.builtin && m.kind !== "connector") mods = mods.filter((x) => x.id !== id);
    persist();
    return this.list();
  },

  toggle(id: string, enabled: boolean): ModuleConfig[] {
    const m = mods.find((x) => x.id === id);
    if (m && m.kind !== "connector") { m.enabled = enabled; persist(); }
    return this.list();
  },

  /** Is a native tool group turned on? (defaults to true if somehow missing). */
  isBuiltinEnabled(key: NonNullable<ModuleConfig["builtinKey"]>): boolean {
    const m = mods.find((x) => x.builtinKey === key);
    return m ? m.enabled : true;
  },

  /** Enabled custom (command/http) modules with secrets decrypted + a tool slug —
   *  main-process only, used to generate SDK tools. */
  liveCustom(): Array<LiveModule & { toolName: string }> {
    const used = new Set<string>();
    const out: Array<LiveModule & { toolName: string }> = [];
    for (const m of mods) {
      if (m.builtin || m.kind === "connector" || !m.enabled) continue;
      if (m.kind !== "command" && m.kind !== "http") continue;
      let name = "mod_" + slug(m.name);
      while (used.has(name)) name += "_2";
      used.add(name);
      const secretValues: Record<string, string> = {};
      for (const s of m.secrets ?? []) secretValues[s.name] = decrypt(s.enc);
      const { secrets, ...rest } = m;
      out.push({ ...rest, secretValues, toolName: name });
    }
    return out;
  },

  setConnectorNames(names: string[]): void { connectorNames = names; },
};
