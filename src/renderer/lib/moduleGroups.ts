// ─────────────────────────────────────────────────────────────────────────────
// How the Modules pane is organized.
//
// Modules are grouped by the QUESTION they answer, not by how they are
// implemented. A user looking for subdomain enumeration is not thinking "I want
// an http module" — and grouping by readiness instead would make rows jump
// between sections as things install, which is disorienting on the one screen
// whose job is to be legible.
//
// Anything unmapped falls into "Other", so a new bundled module shows up rather
// than disappearing.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleGroup {
  key: string;
  label: string;
  /** The question this group answers, shown under the header when expanded. */
  blurb: string;
}

export const GROUPS: readonly ModuleGroup[] = [
  { key: "identity",  label: "People & identity",       blurb: "Who is behind a handle, email, phone or name." },
  { key: "infra",     label: "Domains & infrastructure", blurb: "What a domain resolves to, who runs it, and what it exposes." },
  { key: "archive",   label: "Archives & exposure",      blurb: "What used to be there, and where it has shown up since." },
  { key: "scan",      label: "Scanning",                 blurb: "Fingerprinting and misconfiguration checks on targets you are authorized to test." },
  { key: "code",      label: "Code & packages",          blurb: "Package registries and repository search." },
  { key: "media",     label: "Photos & media",           blurb: "Metadata and reverse-image lookups." },
  { key: "custom",    label: "Your modules",             blurb: "Commands, APIs and code connectors you added." },
  { key: "other",     label: "Other",                    blurb: "" },
] as const;

/** Bundled + built-in module id → group. Ids come from main/modules.ts. */
const BY_ID: Record<string, string> = {};
const put = (group: string, ids: string[]) => { for (const id of ids) BY_ID[id] = group; };

put("identity", [
  "builtin:username",
  "def:github-user", "def:github-repos", "def:github-search-user", "def:gitlab-user",
  "def:keybase", "def:hn-user", "def:stackoverflow-user", "def:devto-user",
  "def:wikidata", "def:wikipedia", "def:nominatim",
  "def:hudson-email", "def:hudson-user",
  "def:maigret", "def:holehe", "def:socialscan", "def:phoneinfoga",
]);
put("infra", [
  "builtin:recon",
  "def:crtsh", "def:anubisdb", "def:rdap-domain", "def:rdap-ip",
  "def:doh-a", "def:doh-mx", "def:doh-txt", "def:doh-ns", "def:cloudflare-doh",
  "def:internetdb", "def:ip-api", "def:ipwhois", "def:ripe-whois", "def:ripe-prefix",
  "def:ht-reverse-ip", "def:ht-hostsearch", "def:ht-aslookup",
  "def:subfinder", "def:amass-passive", "def:assetfinder",
  "def:dnsx", "def:cdncheck", "def:naabu", "def:tlsx", "def:sslscan", "def:httpx",
]);
put("archive", [
  "def:wayback", "def:urlscan", "def:otx-domain", "def:otx-ip",
  "def:waybackurls", "def:gau", "def:katana",
]);
put("scan", ["def:whatweb", "def:webanalyze", "def:wafw00f", "def:nuclei", "def:nikto", "def:wpscan"]);
put("code", ["def:npm", "def:pypi", "def:crates", "def:github-search-repos"]);
put("media", ["builtin:exif", "builtin:reverse_image"]);

/** Which group a module belongs in. Provenance wins for the tail: anything
 *  the user authored — a command, an API, or a code connector — is theirs. */
export function groupFor(m: { id: string; kind: string; default?: boolean }): string {
  if (m.kind === "connector") return "custom";
  if ((m.kind === "command" || m.kind === "http") && !m.default) return "custom";
  return BY_ID[m.id] ?? "other";
}
