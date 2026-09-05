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

// ── bundled default modules ───────────────────────────────────────────────────
// A curated catalog that ships with the app. The no-key HTTP ones were live-tested;
// a high-signal core starts enabled, the rest are available to flip on. Command
// modules ship disabled — they need the binary installed and autonomy on.
const H = (id: string, name: string, description: string, url: string, inputLabel: string, on = false, headers?: ModuleHeader[]): StoredModule =>
  ({ id: "def:" + id, name, description, kind: "http", enabled: on, builtin: false, default: true, method: "GET", url, inputLabel, ...(headers ? { headers } : {}) });
const C = (id: string, name: string, description: string, command: string, inputLabel: string): StoredModule =>
  ({ id: "def:" + id, name, description, kind: "command", enabled: false, builtin: false, default: true, command, inputLabel });

const DEFAULT_MODULES: StoredModule[] = [
  // people / identity (no key)
  H("github-user", "github_user", "Public GitHub profile: name, bio, company, location, blog, X handle, repo count, join date.", "https://api.github.com/users/{input}", "a GitHub username", true),
  H("github-repos", "github_repos", "List a GitHub user's public repositories, most-recently-updated first.", "https://api.github.com/users/{input}/repos?per_page=100&sort=updated", "a GitHub username"),
  H("github-search-user", "github_search_user", "Search public GitHub users by name or handle.", "https://api.github.com/search/users?q={input}", "a name or username"),
  H("gitlab-user", "gitlab_user", "Look up a public GitLab.com user by username.", "https://gitlab.com/api/v4/users?username={input}", "a GitLab username"),
  H("keybase", "keybase", "Keybase public identity: linked twitter/github/reddit/domain proofs and PGP keys.", "https://keybase.io/_/api/1.0/user/lookup.json?usernames={input}", "a Keybase username", true),
  H("hn-user", "hn_user", "Hacker News public user: karma, about text, join date.", "https://hacker-news.firebaseio.com/v0/user/{input}.json", "an HN username"),
  H("stackoverflow-user", "stackoverflow_user", "Search public Stack Overflow users by display name.", "https://api.stackexchange.com/2.3/users?inname={input}&site=stackoverflow&order=desc&sort=reputation", "a display name"),
  H("devto-user", "devto_user", "Public dev.to profile by username.", "https://dev.to/api/users/by_username?url={input}", "a dev.to username"),
  H("wikidata", "wikidata_person", "Search Wikidata for a person or organization. Returns QIDs and descriptions.", "https://www.wikidata.org/w/api.php?action=wbsearchentities&search={input}&language=en&format=json&type=item", "a person or organization name"),
  H("wikipedia", "wikipedia_search", "Search English Wikipedia for a person, company, or topic.", "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={input}&format=json", "a name or topic", true),
  H("nominatim", "nominatim", "OpenStreetMap geocode of a place, address, or named location (public geo only).", "https://nominatim.openstreetmap.org/search?q={input}&format=json&limit=5", "a place name or address"),
  H("hudson-email", "hudsonrock_email", "Hudson Rock free OSINT check: is this email seen in infostealer logs.", "https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email={input}", "an email address", true),
  H("hudson-user", "hudsonrock_username", "Hudson Rock free OSINT check: is this username seen in infostealer logs.", "https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-username?username={input}", "a username"),
  // domain / dns / ip / certs (no key)
  H("crtsh", "crtsh", "Certificate Transparency via crt.sh: issued certs and SANs, including historical subdomains.", "https://crt.sh/?q={input}&output=json", "a domain", true),
  H("anubisdb", "anubisdb", "AnubisDB stored subdomain list for a root domain.", "https://anubisdb.com/subdomains/{input}", "a domain"),
  H("rdap-domain", "rdap_domain", "RDAP registration data for a domain (the modern, structured WHOIS).", "https://rdap.org/domain/{input}", "a domain", true),
  H("rdap-ip", "rdap_ip", "RDAP registration data for an IPv4 or IPv6 address.", "https://rdap.org/ip/{input}", "an IP address"),
  H("doh-a", "doh_a", "Google DNS-over-HTTPS A-record lookup for a hostname.", "https://dns.google/resolve?name={input}&type=A", "a hostname"),
  H("doh-mx", "doh_mx", "Google DoH MX records: the mail provider behind a domain.", "https://dns.google/resolve?name={input}&type=MX", "a domain", true),
  H("doh-txt", "doh_txt", "Google DoH TXT records: SPF, DKIM selectors, verification tokens, product hints.", "https://dns.google/resolve?name={input}&type=TXT", "a hostname", true),
  H("doh-ns", "doh_ns", "Google DoH NS records for a domain.", "https://dns.google/resolve?name={input}&type=NS", "a domain"),
  H("cloudflare-doh", "cloudflare_doh", "Cloudflare DNS-over-HTTPS A lookup (a second resolver to compare with Google).", "https://cloudflare-dns.com/dns-query?name={input}&type=A", "a hostname", false, [{ name: "Accept", value: "application/dns-json" }]),
  H("internetdb", "shodan_internetdb", "Shodan InternetDB (no key): open ports, hostnames, CPEs, tags and known CVEs for an IP. Input must be an IP, not a domain.", "https://internetdb.shodan.io/{input}", "an IPv4 address", true),
  H("ip-api", "ip_api", "ip-api.com geo, ISP, ASN, org and reverse DNS for an IP.", "http://ip-api.com/json/{input}?fields=status,message,country,regionName,city,lat,lon,isp,org,as,asname,reverse,proxy,hosting,query", "an IP address", true),
  H("ipwhois", "ipwhois", "ipwho.is geo and connection info for an IP.", "https://ipwho.is/{input}", "an IP address"),
  H("ripe-whois", "ripe_whois", "RIPE Stat whois-style JSON for an IP, prefix, or ASN.", "https://stat.ripe.net/data/whois/data.json?resource={input}", "an IP, prefix, or ASN"),
  H("ripe-prefix", "ripe_prefix", "RIPE Stat prefix overview and announcing ASNs for an IP or prefix.", "https://stat.ripe.net/data/prefix-overview/data.json?resource={input}", "an IP or prefix"),
  H("ht-reverse-ip", "ht_reverse_ip", "HackerTarget reverse IP: other hostnames sharing an IP (a shared-hosting pivot). Free daily cap.", "https://api.hackertarget.com/reverseiplookup/?q={input}", "an IP address"),
  H("ht-hostsearch", "ht_hostsearch", "HackerTarget hostsearch: domain to hostname/IP pairs, a passive subdomain source. Free daily cap.", "https://api.hackertarget.com/hostsearch/?q={input}", "a domain"),
  H("ht-aslookup", "ht_aslookup", "HackerTarget ASN lookup for an IP.", "https://api.hackertarget.com/aslookup/?q={input}", "an IP address"),
  // archive / surface / threat (no key)
  H("wayback", "wayback_available", "Internet Archive: is a URL snapshotted, and the closest snapshot.", "https://archive.org/wayback/available?url={input}", "a URL or domain", true),
  H("urlscan", "urlscan_search", "urlscan.io public search for past scans of a domain (search only, no submit).", "https://urlscan.io/api/v1/search/?q=domain:{input}", "a domain", true),
  H("otx-domain", "otx_domain", "AlienVault OTX public indicators for a domain: passive DNS, malware, whois, URLs.", "https://otx.alienvault.com/api/v1/indicators/domain/{input}/general", "a domain", true),
  H("otx-ip", "otx_ip", "AlienVault OTX public indicators for an IPv4 address.", "https://otx.alienvault.com/api/v1/indicators/IPv4/{input}/general", "an IPv4 address"),
  // code / package indexes (no key)
  H("npm", "npm_pkg", "npm registry metadata for a package: maintainers, repo, homepage.", "https://registry.npmjs.org/{input}", "an npm package name"),
  H("pypi", "pypi_pkg", "PyPI JSON for a package: author, author email, home page, project URLs.", "https://pypi.org/pypi/{input}/json", "a PyPI package name"),
  H("crates", "crates_pkg", "crates.io metadata and repository for a Rust crate.", "https://crates.io/api/v1/crates/{input}", "a crate name"),
  H("github-search-repos", "github_search_repos", "Search public GitHub repositories (unauthenticated, low rate limit).", "https://api.github.com/search/repositories?q={input}", "a search query"),
  // command modules (install the binary; run under autonomy). People footprint:
  C("maigret", "maigret", "Maigret username enumeration across sites. Returns sites with public accounts and their URLs.", "maigret {input} --timeout 8 --no-progressbar -J simple", "a username"),
  C("holehe", "holehe", "Holehe: which sites report an email address as registered.", "holehe {input} --no-color --no-clear", "an email address"),
  C("socialscan", "socialscan", "socialscan email/username availability across platforms.", "socialscan {input}", "an email or username"),
  C("phoneinfoga", "phoneinfoga_recon", "PhoneInfoga public-source recon for an international number you're authorized to check.", "phoneinfoga scan -n {input}", "an E.164 phone number"),
  // Website recon / authorized-scan wrappers:
  C("whatweb", "whatweb", "WhatWeb fingerprint: CMS, frameworks, headers, plugins on an authorized URL.", "whatweb --color=never --no-errors -a 3 {input}", "a URL you are authorized to test"),
  C("wafw00f", "wafw00f", "Detect the WAF vendor in front of an authorized URL.", "wafw00f {input}", "a URL you are authorized to test"),
  C("httpx", "httpx", "httpx probe: scheme, status, title, tech, server and length for a host/URL in scope.", "httpx -u {input} -silent -status-code -title -tech-detect -web-server -content-length -follow-redirects", "a host or URL in scope"),
  C("tlsx", "tlsx", "tlsx certificate and TLS parameter grab for an authorized host.", "tlsx -u {input} -san -cn -so -expired -self-signed -untrusted -silent", "a hostname"),
  C("sslscan", "sslscan", "sslscan supported ciphers and cert info for an authorized host.", "sslscan --no-colour {input}", "a hostname"),
  C("subfinder", "subfinder", "subfinder passive subdomain enumeration (works with zero keys, fewer sources).", "subfinder -d {input} -silent", "a domain"),
  C("amass-passive", "amass_passive", "OWASP Amass passive enumeration only (no active brute force).", "amass enum -passive -d {input} -nocolor", "a domain"),
  C("assetfinder", "assetfinder", "assetfinder related domains and subdomains from public sources.", "assetfinder --subs-only {input}", "a domain"),
  C("waybackurls", "waybackurls", "Pull archived URLs for a domain from the Wayback Machine.", "waybackurls {input}", "a domain"),
  C("gau", "gau", "gau: archived URLs from Wayback, Common Crawl, OTX and urlscan for a domain.", "gau --subs {input}", "a domain"),
  C("katana", "katana", "katana crawl of an in-scope URL (depth 2), collecting links and JS.", "katana -u {input} -d 2 -silent -jc", "an in-scope URL"),
  C("nuclei", "nuclei_exposures", "nuclei exposure/misconfig/tech/ssl/dns templates against an authorized target. No exploit templates.", "nuclei -u {input} -tags exposure,misconfig,tech,ssl,dns -silent", "an in-scope URL or host"),
  C("nikto", "nikto", "Nikto web-server misconfiguration scan of an authorized URL.", "nikto -h {input} -ask no -Display P", "an in-scope URL"),
  C("wpscan", "wpscan_enum", "WPScan non-destructive enumeration of an authorized WordPress site (no password attack).", "wpscan --url {input} --enumerate vp,vt,u --no-banner --format json", "an in-scope WordPress URL"),
  C("dnsx", "dnsx", "dnsx A/AAAA/CNAME/MX/NS/TXT resolution for a hostname.", "dnsx -a -aaaa -cname -mx -ns -txt -resp -silent -n {input}", "a hostname"),
  C("cdncheck", "cdncheck", "cdncheck: whether a host or IP sits on a known CDN/WAF range.", "cdncheck -i {input} -resp -silent", "a host or IP"),
  C("naabu", "naabu", "naabu connect-scan of the top 1000 ports on an in-scope host.", "naabu -host {input} -top-ports 1000 -silent", "an in-scope host or IP"),
  C("nmap", "nmap_safe", "nmap version + default-safe scripts against a host you own or are permitted to scan.", "nmap -sV -sC -T4 --top-ports 1000 {input}", "an in-scope host or IP"),
];

function seed(): StoredModule[] { return [...BUILTINS.map(seedBuiltin), ...DEFAULT_MODULES]; }

/** Add any bundled default missing from the stored set (so existing installs
 *  pick up new defaults), without touching the user's enabled/edited copies. */
function reconcileDefaults(list: StoredModule[]): StoredModule[] {
  const out = [...list];
  for (const d of DEFAULT_MODULES) if (!out.some((m) => m.id === d.id)) out.push(d);
  return out;
}

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
  return reconcilePrivate(reconcileDefaults(base));
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
    // Bundled defaults, built-ins and connectors can't be deleted (only disabled).
    if (m && !m.builtin && !m.default && m.kind !== "connector") mods = mods.filter((x) => x.id !== id);
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
