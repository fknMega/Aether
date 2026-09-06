// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY browser preview bridge. Installs a fake `window.aether` with rich
// seed data so the renderer can be driven in a plain browser (no Electron).
// Never imported by the real app — only by preview.html.
// ─────────────────────────────────────────────────────────────────────────────
import type { AetherApi, ChatEventEnvelope, ConversationDetail, AttachmentPayload } from "../../shared/ipc";
import type {
  AetherSettings, AuthStatus, Conversation, Message, CaseGraph, GraphCaseInfo,
  GraphNode, GraphEdge, ChatRequest, AgentEvent, ModuleConfig, ToolStatus, InstallProgress,
} from "../../shared/types";

const q = new URLSearchParams(location.search);
const now = Date.now();

// `?theme=light|dark|system` drives the seeded appearance so every palette is
// reachable from a URL; anything else falls back to dark.
const THEMES: AetherSettings["theme"][] = ["system", "light", "dark"];
const themeParam = THEMES.find((t) => t === q.get("theme")) ?? "dark";
// `?fail=1` makes the simulated turn end in an error banner instead of a reply.
const failTurn = q.has("fail") && q.get("fail") !== "0";

// unsplash/pravatar images — remote, allowed by the preview CSP only.
const face = (n: number) => `https://i.pravatar.cc/240?img=${n}`;
const photo = (id: string, w = 400) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;
const favicon = (d: string) => `https://www.google.com/s2/favicons?domain=${d}&sz=128`;

let settings: AetherSettings = {
  ownerName: "George",
  model: "claude-opus-5",
  effort: "medium",
  personaVoice: "flirty",
  autonomy: true,
  provider: "claude",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o",
  ollamaBaseUrl: "http://localhost:11434/v1",
  ollamaModel: "llama3.1",
  geminiModel: "gemini-2.5-pro",
  autoUpdate: true,
  theme: themeParam,
  // ?setup=1 replays the first-run experience.
  setupDone: !q.has("setup"),
};

let providerKeySet = false;
let geminiSignedIn = false;

const auth: AuthStatus = q.get("onboard")
  ? { loggedIn: false, authMethod: null, detail: "Run npm run login, or sign in here." }
  : { loggedIn: true, authMethod: "Claude subscription", detail: "Opus 5 · via your account" };

const conversations: Conversation[] = [
  { id: "c0", title: "Who is fknMega?", claudeSessionId: "s0", createdAt: now - 900e3, updatedAt: now - 240e3 },
  { id: "c1", title: "Maya Okafor — full workup", claudeSessionId: "s1", createdAt: now - 86400e3, updatedAt: now - 1200e3 },
  { id: "c2", title: "Domain map: helio-labs.io", claudeSessionId: "s2", createdAt: now - 3 * 86400e3, updatedAt: now - 5400e3 },
  { id: "c3", title: "EXIF on the rooftop photo", claudeSessionId: "s3", createdAt: now - 6 * 86400e3, updatedAt: now - 2 * 86400e3 },
  { id: "c4", title: "HTB — Blackfield foothold", claudeSessionId: "s4", createdAt: now - 9 * 86400e3, updatedAt: now - 4 * 86400e3 },
];

const messages: Record<string, Message[]> = {
  c0: [
    { id: "k1", conversationId: "c0", role: "user", content: "Who is fknMega? Just the handle to start — figure out where they're active and whether it ties to a real identity. Authorized: it's my own alt, checking my exposure.", createdAt: now - 900e3, costUsd: null, attachments: [] },
    { id: "k2", conversationId: "c0", role: "assistant", content: "Opening a case on **fknMega** and running the handle across platforms first — I'll write every hit into the graph as it lands.\n\nStarting sweep now. Flip over to the **Graph** tab and watch it build.", createdAt: now - 880e3, costUsd: 0.0089, attachments: [] },
    { id: "k3", conversationId: "c0", role: "user", content: "go", createdAt: now - 600e3, costUsd: null, attachments: [] },
    { id: "k4", conversationId: "c0", role: "assistant", content: "Here's where **fknMega** lives, and who's behind it.\n\n| Platform | Status | Signal |\n|---|---|---|\n| Twitch | confirmed | 18.4k followers, panels link the Discord + `fknmega.gg` |\n| YouTube | confirmed | same avatar, **business@fknmega.gg** on the About page |\n| X / Reddit | confirmed | bio gives Austin, TX; both cross-link the site |\n| GitHub | confirmed | overlay repo, commits signed **Marcus** |\n\nThe identity chain: the YouTube business email recovers the **GitHub**, whose commits are authored by **Marcus D. Reyes**. A people-search on that name in the 78704 ZIP (where a stream VOD placed him) turns up a phone, **(512) 704-1183**, and an address, **1712 W Mary St, Austin TX** — both low-confidence, one source each, so I've flagged them for a second look. The birthday shout-outs line up with a Travis County voter record: **Apr 12 1998**.\n\nSo fknMega is very likely **Marcus Reyes, 26, Austin**. Want me to firm up the phone and address with a second source, or leave it there?", createdAt: now - 250e3, costUsd: 0.0417, attachments: [], tools: [
      { id: "t-k4-1", name: "username_search", title: "username_search \"fknMega\"", status: "ok", detail: "11 sites, 6 hits", startedAt: now - 600e3, endedAt: now - 580e3 },
      { id: "t-k4-2", name: "graph_upsert", title: "graph_upsert", status: "ok", detail: "9 nodes, 11 edges", startedAt: now - 578e3, endedAt: now - 575e3 },
      { id: "t-k4-3", name: "http_probe", title: "http_probe fknmega.gg", status: "error", detail: "403 from origin", startedAt: now - 500e3, endedAt: now - 496e3 },
      { id: "t-k4-4", name: "graph_upsert", title: "graph_upsert", status: "ok", detail: "4 nodes, 3 edges", startedAt: now - 300e3, endedAt: now - 297e3 },
    ] },
  ],
  c1: [
    { id: "m1", conversationId: "c1", role: "user", content: "Work this up for me: Maya Okafor, maya.okafor@gmail.com, and the handle @mayacodes. Consent-based: Maya asked me to check the exposure.", createdAt: now - 3600e3, costUsd: null, attachments: [{ id: "att1", name: "profile.jpg", mimeType: "image/jpeg" }] },
    { id: "m2", conversationId: "c1", role: "assistant", content: "On it. Opening a case graph for **Maya Okafor** and seeding the three selectors you gave me.\n\nHere's the plan:\n\n1. Run `@mayacodes` across platforms with `username_search`.\n2. Pull EXIF from the photo you attached (GPS + camera).\n3. Map the mail domain and any linked accounts.\n\nI'll move nodes from pending to confirmed as links firm up. Watch the **Graph** tab — it's building live.", createdAt: now - 3550e3, costUsd: 0.0182, attachments: [] },
    { id: "m3", conversationId: "c1", role: "user", content: "Great. What did the username sweep turn up?", createdAt: now - 1300e3, costUsd: null, attachments: [] },
    { id: "m4", conversationId: "c1", role: "assistant", content: "`@mayacodes` resolves to public profiles on **GitHub**, **Mastodon** and **Dev.to**, and is *taken but private* on Instagram. No hit on TikTok or Reddit.\n\n| Platform | Status | Signal |\n|---|---|---|\n| GitHub | confirmed | 42 repos, bio links helio-labs.io |\n| Mastodon | confirmed | same avatar as the photo you gave me |\n| Dev.to | candidate | name matches, no cross-link yet |\n\nThe GitHub bio links back to **helio-labs.io**, which ties Maya to that domain — I've drawn the edge and marked it high-confidence.", createdAt: now - 1250e3, costUsd: 0.0231, attachments: [] },
  ],
  c2: [
    { id: "m5", conversationId: "c2", role: "user", content: "Map the infrastructure behind helio-labs.io", createdAt: now - 5500e3, costUsd: null, attachments: [] },
    { id: "m6", conversationId: "c2", role: "assistant", content: "Done a first pass — `dns_lookup`, `whois`, and an `http_probe`. It's on Cloudflare, registered through Namecheap 14 months ago, WHOIS privacy on. MX points at Google Workspace.", createdAt: now - 5450e3, costUsd: 0.0117, attachments: [] },
  ],
  c3: [], c4: [],
};

const attachments: Record<string, AttachmentPayload> = {
  att1: { mimeType: "image/jpeg", dataUrl: photo("photo-1494790108377-be9c29b29330", 264) },
};

// ── the case graph: rich, with pics on people/photo/account/domain nodes ──────
function mayaGraph(): CaseGraph {
  const N = (n: Partial<GraphNode> & { key: string; type: string }): GraphNode => ({
    label: n.key, value: null, status: "pending", confidence: null, notes: null, source: null, image: null, ...n,
  });
  const nodes: GraphNode[] = [
    N({ key: "maya okafor", type: "target", label: "Maya Okafor", status: "confirmed", confidence: "high", image: face(47), notes: "Subject. Software engineer, Lisbon. Consent-based self-OSINT.", value: "Maya Okafor" }),
    N({ key: "maya.okafor@gmail.com", type: "email", label: "maya.okafor@gmail.com", status: "confirmed", confidence: "high", notes: "Primary personal address; recovers the GitHub account.", source: "provided by operator" }),
    N({ key: "@mayacodes", type: "username", label: "@mayacodes", status: "confirmed", confidence: "high", notes: "Handle reused across dev platforms." }),
    N({ key: "github.com/mayacodes", type: "account", label: "GitHub · mayacodes", status: "confirmed", confidence: "high", image: favicon("github.com"), value: "https://github.com/mayacodes", notes: "42 public repos, bio links helio-labs.io.", source: "username_search" }),
    N({ key: "mastodon.social/@mayacodes", type: "account", label: "Mastodon · @mayacodes", status: "confirmed", confidence: "medium", image: favicon("mastodon.social"), notes: "Same avatar as the operator's photo.", source: "username_search" }),
    N({ key: "dev.to/mayacodes", type: "account", label: "Dev.to · mayacodes", status: "candidate", confidence: "low", image: favicon("dev.to"), notes: "Name matches, no cross-link yet.", source: "username_search" }),
    N({ key: "instagram.com/mayacodes", type: "account", label: "Instagram · mayacodes", status: "pending", image: favicon("instagram.com"), notes: "Taken but private — can't confirm ownership." }),
    N({ key: "helio-labs.io", type: "domain", label: "helio-labs.io", status: "confirmed", confidence: "high", image: favicon("helio-labs.io"), notes: "Maya's side project. Cloudflare, Namecheap, GWS mail.", source: "whois / dns_lookup" }),
    N({ key: "ns.cloudflare.com", type: "host", label: "Cloudflare NS", status: "searched", notes: "Nameservers for helio-labs.io." }),
    N({ key: "rooftop.jpg", type: "photo", label: "rooftop.jpg", status: "confirmed", confidence: "medium", image: photo("photo-1519681393784-d120267933ba", 320), notes: "EXIF: iPhone 14 Pro, GPS 38.72,-9.14 (Lisbon), 2024-05-11.", source: "exif_read" }),
    N({ key: "lisbon, portugal", type: "location", label: "Lisbon, Portugal", status: "confirmed", confidence: "medium", image: photo("photo-1585208798174-6cedd86e019a", 320), notes: "From the photo's GPS + GitHub profile location." }),
    N({ key: "haveibeenpwned:adobe", type: "breach", label: "Adobe (2013)", status: "confirmed", confidence: "high", notes: "Email present in the Adobe breach corpus.", source: "breach connector" }),
    N({ key: "+351 91 234 5678", type: "phone", label: "+351 91 234 5678", status: "candidate", confidence: "low", notes: "Surfaced on an old résumé PDF; unverified." }),
    N({ key: "helio labs", type: "employer", label: "Helio Labs (self)", status: "confirmed", image: face(12), notes: "Founder / solo." }),
  ];
  const E = (source: string, target: string, label: string, confidence = "high"): GraphEdge => ({ source, target, label, confidence });
  const edges: GraphEdge[] = [
    E("maya okafor", "maya.okafor@gmail.com", "email"),
    E("maya okafor", "@mayacodes", "handle"),
    E("maya okafor", "rooftop.jpg", "appears in"),
    E("@mayacodes", "github.com/mayacodes", "profile"),
    E("@mayacodes", "mastodon.social/@mayacodes", "profile", "medium"),
    E("@mayacodes", "dev.to/mayacodes", "profile", "low"),
    E("@mayacodes", "instagram.com/mayacodes", "profile", "low"),
    E("github.com/mayacodes", "helio-labs.io", "links to"),
    E("helio-labs.io", "ns.cloudflare.com", "hosted on"),
    E("helio-labs.io", "helio labs", "operated by"),
    E("maya okafor", "helio labs", "founder of"),
    E("rooftop.jpg", "lisbon, portugal", "geotag"),
    E("maya.okafor@gmail.com", "haveibeenpwned:adobe", "in breach"),
    E("maya okafor", "+351 91 234 5678", "possible number", "low"),
    E("maya okafor", "lisbon, portugal", "lives in", "medium"),
  ];
  return { case: caseInfo("case-maya", "Maya Okafor", nodes, edges, now - 1200e3), nodes, edges };
}

function heliograph(): CaseGraph {
  const N = (key: string, type: string, extra: Partial<GraphNode> = {}): GraphNode =>
    ({ key, type, label: key, value: null, status: "searched", confidence: null, notes: null, source: null, image: null, ...extra });
  const nodes = [
    N("helio-labs.io", "domain", { label: "helio-labs.io", status: "confirmed", image: favicon("helio-labs.io") }),
    N("104.21.5.12", "host", { label: "104.21.5.12", notes: "Cloudflare edge" }),
    N("namecheap", "service", { label: "Namecheap", image: favicon("namecheap.com") }),
    N("google workspace", "service", { label: "Google Workspace (MX)", image: favicon("google.com") }),
    N("api.helio-labs.io", "host", { label: "api.helio-labs.io", status: "pending" }),
  ];
  const edges: GraphEdge[] = [
    { source: "helio-labs.io", target: "104.21.5.12", label: "A record", confidence: "high" },
    { source: "helio-labs.io", target: "namecheap", label: "registrar", confidence: "high" },
    { source: "helio-labs.io", target: "google workspace", label: "MX", confidence: "high" },
    { source: "helio-labs.io", target: "api.helio-labs.io", label: "subdomain", confidence: "medium" },
  ];
  return { case: caseInfo("case-helio", "helio-labs.io", nodes, edges, now - 5400e3), nodes, edges };
}

function caseInfo(id: string, name: string, nodes: GraphNode[], edges: GraphEdge[], updatedAt: number): GraphCaseInfo {
  return { id, name, nodeCount: nodes.length, edgeCount: edges.length, pendingCount: nodes.filter((n) => n.status === "pending").length, updatedAt };
}

function fknMegaGraph(): CaseGraph {
  const N = (n: Partial<GraphNode> & { key: string; type: string }): GraphNode => ({
    label: n.key, value: null, status: "pending", confidence: null, notes: null, source: null, image: null, ...n,
  });
  const nodes: GraphNode[] = [
    N({ key: "fknmega", type: "target", label: "fknMega", status: "confirmed", confidence: "high", image: face(33), value: "fknMega", notes: "Subject of the lookup. Gaming/streaming persona; handle reused widely." }),
    N({ key: "twitch.tv/fknmega", type: "account", label: "Twitch · fknMega", status: "confirmed", confidence: "high", image: favicon("twitch.tv"), value: "https://twitch.tv/fknmega", notes: "18.4k followers, streams FPS. Panels link the Discord + the .gg site.", source: "username_search" }),
    N({ key: "youtube.com/@fknmega", type: "account", label: "YouTube · @fknMega", status: "confirmed", confidence: "high", image: favicon("youtube.com"), notes: "Same avatar; 'About' lists a business email.", source: "username_search" }),
    N({ key: "x.com/fknmega", type: "account", label: "X · @fknMega", status: "confirmed", confidence: "medium", image: favicon("x.com"), notes: "Bio: 'Austin, TX'. Cross-links the YouTube.", source: "username_search" }),
    N({ key: "steamcommunity.com/id/fknmega", type: "account", label: "Steam · fknMega", status: "candidate", confidence: "low", image: favicon("steampowered.com"), notes: "Same handle, private profile — can't confirm ownership.", source: "username_search" }),
    N({ key: "github.com/fknmega", type: "account", label: "GitHub · fknmega", status: "confirmed", confidence: "medium", image: favicon("github.com"), notes: "A stream-overlay repo; commits signed 'marcus'.", source: "username_search" }),
    N({ key: "discord:fknmega", type: "account", label: "Discord · fknMega", status: "searched", image: favicon("discord.com"), notes: "Server invite from the Twitch panel." }),
    N({ key: "fknmega.gg", type: "domain", label: "fknmega.gg", status: "confirmed", confidence: "high", image: favicon("fknmega.gg"), notes: "Cloudflare, registered via Porkbun 8 months ago; WHOIS privacy on.", source: "whois / dns_lookup" }),
    N({ key: "business@fknmega.gg", type: "email", label: "business@fknmega.gg", status: "confirmed", confidence: "high", notes: "Listed on the YouTube About page; recovers the GitHub.", source: "http_probe" }),
    N({ key: "setup.jpg", type: "photo", label: "setup.jpg", status: "confirmed", confidence: "medium", image: photo("photo-1542751371-adc38448a05e", 320), notes: "Battlestation shot from X. EXIF stripped, but a monitor reflection is legible.", source: "exif_read" }),
    N({ key: "austin, tx", type: "location", label: "Austin, TX", status: "confirmed", confidence: "medium", image: photo("photo-1531218150217-54595bc2b934", 320), notes: "From the X bio + a landmark in a stream VOD." }),
    N({ key: "marcus reyes", type: "name", label: "Marcus Reyes", status: "candidate", confidence: "medium", value: "Marcus D. Reyes", notes: "Full name from a signed Git commit + a tagged photo on a friend's public IG. Age 26.", source: "github.com/fknmega + correlation" }),
    N({ key: "haveibeenpwned:twitch", type: "breach", label: "Twitch (2021)", status: "confirmed", confidence: "high", notes: "business@ address present in the Twitch source-code leak corpus.", source: "breach connector" }),
    N({ key: "reddit.com/u/fknmega", type: "account", label: "Reddit · u/fknMega", status: "confirmed", confidence: "medium", image: favicon("reddit.com"), notes: "Same handle; posts in r/Twitch promoting the .gg site.", source: "username_search" }),
    N({ key: "linkedin.com/in/marcusdreyes", type: "account", label: "LinkedIn · Marcus Reyes", status: "candidate", confidence: "low", image: favicon("linkedin.com"), value: "https://linkedin.com/in/marcusdreyes", notes: "Austin · 'video editor & streamer'. Same first name, plausible match.", source: "username_search" }),
    N({ key: "+1 512-704-1183", type: "phone", label: "+1 (512) 704-1183", status: "candidate", confidence: "low", notes: "People-search listing tied to the name + ZIP. Texas MVNO. Unverified — needs a second source.", source: "people-search" }),
    N({ key: "1712 w mary st, austin tx 78704", type: "address", label: "1712 W Mary St, Austin TX 78704", status: "candidate", confidence: "low", image: photo("photo-1568605114967-8130f3a36994", 320), notes: "People-search address for a 'Marcus Reyes' in the 78704 ZIP the stream VOD placed him in. Low confidence.", source: "people-search" }),
    N({ key: "dob:1998-04-12", type: "note", label: "DOB · Apr 12 1998 (26)", status: "candidate", confidence: "low", notes: "Birthday shout-outs on stream + a voter-record match in Travis County.", source: "correlation" }),
    N({ key: "employer:local-esports", type: "employer", label: "Rooster Teeth (freelance)", status: "candidate", confidence: "low", image: favicon("roosterteeth.com"), notes: "LinkedIn lists a freelance video-editing contract.", source: "linkedin" }),
    // The rest of the mark vocabulary, so one screenshot of the default case
    // shows every shape family and all five ring treatments.
    N({ key: "tiktok.com/@fknmega", type: "account", label: "TikTok · @fknMega", status: "pending", image: favicon("tiktok.com"), notes: "Handle is taken but the account has no posts. Ownership unconfirmed.", source: "username_search" }),
    N({ key: "cdn.fknmega.gg", type: "host", label: "cdn.fknmega.gg", status: "pending", notes: "Seen in a page asset URL; not yet resolved.", source: "http_probe" }),
    N({ key: "porkbun", type: "service", label: "Porkbun (registrar)", status: "confirmed", confidence: "high", image: favicon("porkbun.com"), notes: "Registrar of record for fknmega.gg.", source: "whois" }),
    N({ key: "sponsor-kit.pdf", type: "document", label: "sponsor-kit.pdf", status: "searched", notes: "Media kit linked from the .gg site. Author field is empty; no useful metadata.", source: "http_probe" }),
    N({ key: "linkedin.com/in/mreyes-sea", type: "account", label: "LinkedIn · M. Reyes (Seattle)", status: "dead", confidence: "low", image: favicon("linkedin.com"), notes: "Excluded. Different person — Seattle, finance, no overlap with any confirmed selector.", source: "username_search" }),
    N({ key: "+1 512-555-0147", type: "phone", label: "+1 (512) 555-0147", status: "dead", notes: "Excluded. People-search number for a different Marcus Reyes in the same ZIP.", source: "people-search" }),
    N({ key: "note:scope", type: "note", label: "Scope · operator's own alt", status: "confirmed", confidence: "high", notes: "Operator states this is their own account and authorized the lookup.", source: "operator" }),
  ];
  const E = (source: string, target: string, label: string, confidence = "high"): GraphEdge => ({ source, target, label, confidence });
  const edges: GraphEdge[] = [
    E("fknmega", "twitch.tv/fknmega", "profile"),
    E("fknmega", "youtube.com/@fknmega", "profile"),
    E("fknmega", "x.com/fknmega", "profile", "medium"),
    E("fknmega", "steamcommunity.com/id/fknmega", "profile", "low"),
    E("fknmega", "github.com/fknmega", "profile", "medium"),
    E("twitch.tv/fknmega", "discord:fknmega", "links to"),
    E("twitch.tv/fknmega", "fknmega.gg", "links to"),
    E("youtube.com/@fknmega", "business@fknmega.gg", "contact"),
    E("business@fknmega.gg", "fknmega.gg", "same domain"),
    E("business@fknmega.gg", "github.com/fknmega", "recovers"),
    E("github.com/fknmega", "marcus reyes", "commit author", "medium"),
    E("x.com/fknmega", "setup.jpg", "posted"),
    E("x.com/fknmega", "austin, tx", "bio location", "medium"),
    E("setup.jpg", "austin, tx", "VOD landmark", "low"),
    E("business@fknmega.gg", "haveibeenpwned:twitch", "in breach"),
    E("fknmega", "marcus reyes", "likely identity", "medium"),
    E("fknmega", "reddit.com/u/fknmega", "profile"),
    E("reddit.com/u/fknmega", "fknmega.gg", "promotes"),
    E("marcus reyes", "linkedin.com/in/marcusdreyes", "possible profile", "low"),
    E("linkedin.com/in/marcusdreyes", "employer:local-esports", "employer", "low"),
    E("marcus reyes", "+1 512-704-1183", "listed number", "low"),
    E("marcus reyes", "1712 w mary st, austin tx 78704", "listed address", "low"),
    E("1712 w mary st, austin tx 78704", "austin, tx", "in city"),
    E("marcus reyes", "dob:1998-04-12", "date of birth", "low"),
    E("fknmega", "tiktok.com/@fknmega", "possible profile", "low"),
    E("fknmega.gg", "cdn.fknmega.gg", "subdomain", "medium"),
    E("fknmega.gg", "porkbun", "registrar"),
    E("fknmega.gg", "sponsor-kit.pdf", "hosts"),
    E("marcus reyes", "linkedin.com/in/mreyes-sea", "ruled out", "low"),
    E("marcus reyes", "+1 512-555-0147", "ruled out", "low"),
    E("fknmega", "note:scope", "scope"),
  ];
  return { case: caseInfo("case-fknmega", "fknMega", nodes, edges, now - 240e3), nodes, edges };
}

const graphs: Record<string, CaseGraph> = { "case-fknmega": fknMegaGraph(), "case-maya": mayaGraph(), "case-helio": heliograph() };
const cases: GraphCaseInfo[] = [graphs["case-fknmega"].case, graphs["case-maya"].case, graphs["case-helio"].case];

// ── modules ───────────────────────────────────────────────────────────────────
let mods: ModuleConfig[] = [
  { id: "builtin:username", name: "Username search", kind: "builtin", enabled: true, builtin: true, builtinKey: "username", description: "Hunt a username / handle across dozens of platforms at once (Sherlock-style) and report where a public profile exists." },
  { id: "builtin:recon", name: "Network recon", kind: "builtin", enabled: true, builtin: true, builtinKey: "recon", description: "DNS lookups, WHOIS, and safe HTTP probing to map a domain's infrastructure and confirm hosts." },
  { id: "builtin:exif", name: "Image EXIF", kind: "builtin", enabled: true, builtin: true, builtinKey: "exif", description: "Read GPS coordinates, camera make/model and timestamps out of a photo's metadata." },
  { id: "builtin:reverse_image", name: "Reverse image", kind: "builtin", enabled: false, builtin: true, builtinKey: "reverse_image", description: "Build reverse-image-search links (Yandex / Google Lens / TinEye / Bing) for a photo." },
  // bundled defaults (a sample of the real catalog)
  { id: "def:github-user", name: "github_user", kind: "http", enabled: true, builtin: false, default: true, method: "GET", description: "Public GitHub profile: name, bio, company, location, blog, X handle, repo count, join date.", inputLabel: "a GitHub username", url: "https://api.github.com/users/{input}" },
  { id: "def:crtsh", name: "crtsh", kind: "http", enabled: true, builtin: false, default: true, method: "GET", description: "Certificate Transparency via crt.sh: issued certs and SANs, including historical subdomains.", inputLabel: "a domain", url: "https://crt.sh/?q={input}&output=json" },
  { id: "def:internetdb", name: "shodan_internetdb", kind: "http", enabled: true, builtin: false, default: true, method: "GET", description: "Shodan InternetDB (no key): open ports, hostnames, CPEs, tags and known CVEs for an IP.", inputLabel: "an IPv4 address", url: "https://internetdb.shodan.io/{input}" },
  { id: "def:hudson-email", name: "hudsonrock_email", kind: "http", enabled: true, builtin: false, default: true, method: "GET", description: "Hudson Rock free OSINT check: is this email seen in infostealer logs.", inputLabel: "an email address", url: "https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email={input}" },
  { id: "def:rdap-domain", name: "rdap_domain", kind: "http", enabled: true, builtin: false, default: true, method: "GET", description: "RDAP registration data for a domain (the modern, structured WHOIS).", inputLabel: "a domain", url: "https://rdap.org/domain/{input}" },
  { id: "def:wayback", name: "wayback_available", kind: "http", enabled: true, builtin: false, default: true, method: "GET", description: "Internet Archive: is a URL snapshotted, and the closest snapshot.", inputLabel: "a URL or domain", url: "https://archive.org/wayback/available?url={input}" },
  { id: "def:keybase", name: "keybase", kind: "http", enabled: true, builtin: false, default: true, method: "GET", description: "Keybase public identity: linked twitter/github/reddit/domain proofs and PGP keys.", inputLabel: "a Keybase username", url: "https://keybase.io/_/api/1.0/user/lookup.json?usernames={input}" },
  { id: "def:maigret", name: "maigret", kind: "command", enabled: true, builtin: false, default: true, description: "Maigret username enumeration across sites. Returns sites with public accounts and URLs.", inputLabel: "a username", command: "maigret {input} --timeout 8 --no-progressbar -J simple" },
  { id: "def:subfinder", name: "subfinder", kind: "command", enabled: true, builtin: false, default: true, description: "subfinder passive subdomain enumeration (works with zero keys).", inputLabel: "a domain", command: "subfinder -d {input} -silent" },
  { id: "def:nuclei", name: "nuclei_exposures", kind: "command", enabled: true, builtin: false, default: true, description: "nuclei exposure/misconfig/tech/ssl/dns templates against an authorized target. No exploit templates.", inputLabel: "an in-scope URL or host", command: "nuclei -u {input} -tags exposure,misconfig,tech,ssl,dns -silent" },
  { id: "m-nesher", name: "nesher", kind: "http", enabled: true, builtin: false, method: "GET", description: "Search breach corpora for an email, username, or phone and return matching leaked records.", inputLabel: "an email, username, phone, or domain", url: "https://api.nesher.example/v1/search?q={input}", headers: [{ name: "Authorization", value: "Bearer {{NESHER_KEY}}" }], body: "", secrets: [{ name: "NESHER_KEY", set: true }] },
  { id: "m-amass", name: "amass", kind: "command", enabled: false, builtin: false, description: "Enumerate subdomains for a domain with OWASP Amass and print the discovered hosts.", inputLabel: "a domain", command: "amass enum -d {input} -silent", secrets: [] },
  { id: "connector:facebook_id", name: "facebook_id", kind: "connector", enabled: true, builtin: true, description: "Loaded from a private code connector." },
];
const redactMods = (): ModuleConfig[] => mods.map((m) => ({ ...m, secrets: (m.secrets ?? []).map((s) => ({ name: s.name, set: true })) }));
let modulesCb: (() => void) | null = null;

// ── streaming simulation ──────────────────────────────────────────────────────
let chatCb: ((env: ChatEventEnvelope) => void) | null = null;
const emit = (turnId: string, event: AgentEvent) => chatCb?.({ turnId, event });

async function simulateTurn(req: ChatRequest) {
  const { turnId } = req;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await wait(400);
  // Reasoning arrives before any tool, so the "working" state is visible on its
  // own for a beat rather than only underneath a running tool.
  emit(turnId, { type: "thinking", text: "Three selectors, one of them a photo. Seed the case first, then sweep the handle, then read the EXIF." });
  await wait(900);
  emit(turnId, { type: "tool_start", tool: { id: "t1", name: "graph_upsert", title: 'graph_upsert · seed "Maya Okafor"', status: "running", startedAt: Date.now() } });
  await wait(1400);
  emit(turnId, { type: "tool_end", id: "t1", status: "ok", detail: "wrote 4 nodes, 3 edges" });
  emit(turnId, { type: "graph_touched", caseName: "Maya Okafor" });
  emit(turnId, { type: "tool_start", tool: { id: "t2", name: "username_search", title: 'username_search "mayacodes"', status: "running", startedAt: Date.now() } });
  await wait(2200);
  emit(turnId, { type: "tool_end", id: "t2", status: "ok", detail: "3 of 31 platforms matched" });
  emit(turnId, { type: "tool_start", tool: { id: "t3", name: "exif_read", title: "exif_read rooftop.jpg", status: "running", startedAt: Date.now() } });
  await wait(1500);
  emit(turnId, { type: "tool_end", id: "t3", status: "ok", detail: "GPS 38.72,-9.14 · iPhone 14 Pro" });
  // A failing tool that the turn survives — the run keeps going and reports it.
  emit(turnId, { type: "tool_start", tool: { id: "t4", name: "http_probe", title: "http_probe helio-labs.io", status: "running", startedAt: Date.now() } });
  await wait(1300);
  emit(turnId, { type: "tool_end", id: "t4", status: "error", detail: "403 from the origin after 3 attempts" });
  emit(turnId, { type: "thinking", text: "The probe is blocked. Enough is confirmed to answer without it." });
  await wait(600);

  if (failTurn) {
    emit(turnId, { type: "error", message: "The provider dropped the connection mid-turn. The case keeps what was written before the drop. Try again, or switch providers in Settings." });
    return;
  }

  const full = "Case is taking shape. `@mayacodes` is live on **GitHub**, **Mastodon** and **Dev.to**, and the rooftop photo geotags to **Lisbon** (38.72, -9.14, shot on an iPhone 14 Pro in May 2024).\n\nThe GitHub bio links **helio-labs.io** — I've tied that in as high-confidence. The origin refused a direct probe, so the domain's own pages are unread for now. Instagram (private) and an unverified phone number are still open leads. Want me to push on those?";
  for (let i = 0; i < full.length; i += 3) { emit(turnId, { type: "delta", text: full.slice(i, i + 3) }); await wait(14); }
  await wait(150);
  emit(turnId, { type: "done", text: full, costUsd: 0.0294 });
}

// ── tool installer (preview) ────────────────────────────────────────────────
// A mix of states so every branch of the install manager is reachable without
// touching the real machine: installed, missing, and needs-a-manual-command.
const TOOL_SEED: Array<[string, string, ToolStatus["state"]]> = [
  ["def:maigret", "maigret", "installed"], ["def:holehe", "holehe", "installed"],
  ["def:socialscan", "socialscan", "missing"], ["def:phoneinfoga", "phoneinfoga", "missing"],
  ["def:whatweb", "whatweb", "installed"], ["def:wafw00f", "wafw00f", "missing"],
  ["def:httpx", "httpx", "installed"], ["def:tlsx", "tlsx", "missing"],
  ["def:sslscan", "sslscan", "missing"], ["def:subfinder", "subfinder", "installed"],
  ["def:amass-passive", "amass", "missing"], ["def:assetfinder", "assetfinder", "missing"],
  ["def:waybackurls", "waybackurls", "installed"], ["def:gau", "gau", "missing"],
  ["def:katana", "katana", "missing"], ["def:nuclei", "nuclei", "installed"],
  ["def:nikto", "nikto", "unavailable"], ["def:wpscan", "wpscan", "missing"],
  ["def:dnsx", "dnsx", "missing"], ["def:cdncheck", "cdncheck", "missing"],
  ["def:naabu", "naabu", "missing"], ["def:nmap", "nmap", "installed"],
];
const toolState = new Map(TOOL_SEED.map(([id, bin, st]) => [id, { bin, state: st }]));
let installCbs: Array<(p: InstallProgress) => void> = [];
let stopAll = false;
const emitInstall = (p: InstallProgress) => installCbs.forEach((cb) => cb(p));

function toolRows(): ToolStatus[] {
  return TOOL_SEED.map(([id, bin]) => {
    const st = toolState.get(id)!;
    const mod = mods.find((m) => m.id === id);
    return {
      moduleId: id, name: mod?.name ?? bin, bin, state: st.state,
      path: st.state === "installed" ? `/opt/homebrew/bin/${bin}` : undefined,
      via: st.state === "missing" ? `brew install ${bin}` : undefined,
      manual: st.state === "unavailable" ? `sudo apt install -y ${bin}` : undefined,
    };
  });
}

async function fakeInstall(id: string): Promise<boolean> {
  const st = toolState.get(id);
  if (!st || st.state === "installed" || st.state === "unavailable") return false;
  st.state = "installing";
  emitInstall({ moduleId: id, state: "installing", line: `$ brew install ${st.bin}` });
  for (const line of [`==> Fetching ${st.bin}`, "==> Downloading from ghcr.io", `==> Pouring ${st.bin}.bottle.tar.gz`]) {
    await new Promise((r) => setTimeout(r, 240));
    emitInstall({ moduleId: id, state: "installing", line });
  }
  await new Promise((r) => setTimeout(r, 180));
  st.state = "installed";
  emitInstall({ moduleId: id, state: "installed", line: `/opt/homebrew/bin/${st.bin}` });
  return true;
}

const api: AetherApi = {
  platform: q.get("platform") ?? "darwin",
  getSettings: async () => settings,
  // Merge and hand back the whole object, like the real IPC handler — the
  // appearance control reads the response to confirm what it just wrote.
  setSettings: async (patch) => {
    settings = { ...settings, ...patch };
    return settings;
  },
  authStatus: async () => auth,
  authLogin: async () => ({ ok: true, message: "Opened your browser to sign in…" }),
  listConversations: async () => conversations,
  getConversation: async (id): Promise<ConversationDetail | null> => {
    const c = conversations.find((x) => x.id === id);
    return c ? { conversation: c, messages: messages[id] ?? [] } : null;
  },
  // These mutate the seed rather than returning a bare `true`: a rename that
  // snaps back, or a row that returns on the next refresh, reads as a bug in
  // the component under test rather than a gap in the mock.
  renameConversation: async (id, title) => {
    const c = conversations.find((x) => x.id === id);
    if (c) { c.title = title; c.updatedAt = Date.now(); }
    return !!c;
  },
  deleteConversation: async (id) => {
    const i = conversations.findIndex((x) => x.id === id);
    if (i >= 0) { conversations.splice(i, 1); delete messages[id]; }
    return i >= 0;
  },
  getAttachment: async (id) => attachments[id] ?? { mimeType: "image/jpeg", dataUrl: photo("photo-1517841905240-472988babdf9", 264) },
  listGraphCases: async () => cases,
  getGraph: async (caseId) => graphs[caseId] ?? null,
  getGraphByName: async (name) => Object.values(graphs).find((g) => g.case.name === name) ?? null,
  deleteGraph: async (caseId) => {
    const i = cases.findIndex((c) => c.id === caseId);
    if (i >= 0) { cases.splice(i, 1); delete graphs[caseId]; }
    return i >= 0;
  },
  sendChat: async (req) => { void simulateTurn(req); return { conversationId: req.conversationId ?? "c1" }; },
  cancelChat: async () => {},
  updateStatusGet: async () => ({ state: "not-available", currentVersion: "2.0.1", message: "You're on the latest version." }),
  checkForUpdate: async () => ({ state: "not-available", currentVersion: "2.0.1", message: "You're on the latest version." }),
  installUpdate: async () => {},
  onUpdateStatus: () => () => {},

  providerStatus: async () => ({
    provider: settings.provider,
    hasKey: settings.provider === "openai" ? providerKeySet : settings.provider === "gemini" ? geminiSignedIn : true,
    models: settings.provider === "ollama" ? ["llama3.1:latest", "qwen2.5:14b", "gemma4-uncensored-64k:latest"]
      : settings.provider === "gemini" ? ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"] : [],
    detail: settings.provider === "gemini" ? (geminiSignedIn ? "Signed in as you@gmail.com" : "Sign in with your Google account to use Gemini free.") : undefined,
  }),
  setProviderKey: async (_p, key) => { providerKeySet = !!key; return { provider: settings.provider, hasKey: settings.provider === "openai" ? providerKeySet : true, models: [] }; },
  providerLogin: async (p) => { if (p === "gemini") geminiSignedIn = true; return { ok: true, message: "Signed in as you@gmail.com" }; },
  providerLogout: async (p) => { if (p === "gemini") geminiSignedIn = false; return { provider: settings.provider, hasKey: settings.provider === "gemini" ? geminiSignedIn : true, models: settings.provider === "gemini" ? ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"] : [] }; },

  toolStatuses: async () => toolRows(),
  installTool: async (id: string) => fakeInstall(id),
  installAllTools: async () => {
    let installed = 0, skipped = 0;
    for (const [id] of TOOL_SEED) {
      if (stopAll) break;
      const st = toolState.get(id)!;
      if (st.state === "installed" || st.state === "unavailable") { skipped++; continue; }
      if (await fakeInstall(id)) installed++;
    }
    stopAll = false;
    const summary = { installed, failed: 0, skipped };
    emitInstall({ moduleId: "", state: "installed", summary });
    return summary;
  },
  cancelInstall: async () => { stopAll = true; },
  onInstallProgress: (cb) => {
    installCbs.push(cb);
    return () => { installCbs = installCbs.filter((c) => c !== cb); };
  },

  listModules: async () => redactMods(),
  saveModule: async (mod) => {
    const idx = mods.findIndex((m) => m.id === mod.id);
    const withId = mod.id ? mod : { ...mod, id: "m-" + Math.round(performance.now()) };
    if (idx >= 0) mods[idx] = { ...mods[idx], ...withId };
    else mods.push(withId);
    modulesCb?.();
    return redactMods();
  },
  deleteModule: async (id) => { mods = mods.filter((m) => m.id !== id); modulesCb?.(); return redactMods(); },
  toggleModule: async (id, enabled) => { const m = mods.find((x) => x.id === id); if (m) m.enabled = enabled; modulesCb?.(); return redactMods(); },
  onChatEvent: (cb) => { chatCb = cb; return () => { if (chatCb === cb) chatCb = null; }; },
  onGraphChanged: () => () => {},
  onConversationsChanged: () => () => {},
  onModulesChanged: (cb) => { modulesCb = cb; return () => { if (modulesCb === cb) modulesCb = null; }; },
};

(window as unknown as { aether: AetherApi }).aether = api;
// Marker so a few dev-only affordances (e.g. GraphView's node-select hook used
// by the screenshot tool) activate only under the preview mock, never in the app.
(window as unknown as { __aetherMock?: boolean }).__aetherMock = true;
