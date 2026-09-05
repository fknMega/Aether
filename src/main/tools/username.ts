import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { text } from "./context";

/**
 * A curated catalog of sites whose *public* profile pages have a reliable
 * existence signal — the same idea as Sherlock/WhatsMyName, kept dependency-free
 * so it runs on macOS and Windows with no Python.
 *
 *  - "status": a real profile returns 200, a missing one 404/410.
 *  - "message": the page always returns 200, so a "not found" string in the body
 *    is what distinguishes an absent profile.
 */
interface Site { name: string; url: (u: string) => string; type: "status" | "message"; absent?: string; cat: string; }

const CATALOG: Site[] = [
  // dev / code
  { name: "GitHub", cat: "dev", type: "status", url: (u) => `https://github.com/${u}` },
  { name: "GitLab", cat: "dev", type: "status", url: (u) => `https://gitlab.com/${u}` },
  { name: "Replit", cat: "dev", type: "status", url: (u) => `https://replit.com/@${u}` },
  { name: "Kaggle", cat: "dev", type: "status", url: (u) => `https://www.kaggle.com/${u}` },
  { name: "Dev.to", cat: "dev", type: "status", url: (u) => `https://dev.to/${u}` },
  { name: "npm", cat: "dev", type: "status", url: (u) => `https://www.npmjs.com/~${u}` },
  { name: "PyPI", cat: "dev", type: "status", url: (u) => `https://pypi.org/user/${u}/` },
  { name: "DockerHub", cat: "dev", type: "status", url: (u) => `https://hub.docker.com/v2/users/${u}/` },
  { name: "Keybase", cat: "dev", type: "status", url: (u) => `https://keybase.io/${u}` },
  { name: "HackerNews", cat: "dev", type: "message", absent: "No such user.", url: (u) => `https://news.ycombinator.com/user?id=${u}` },
  // social / content
  { name: "Reddit", cat: "social", type: "status", url: (u) => `https://old.reddit.com/user/${u}` },
  { name: "Telegram", cat: "social", type: "message", absent: "tgme_page_extra", url: (u) => `https://t.me/${u}` },
  { name: "TikTok", cat: "social", type: "status", url: (u) => `https://www.tiktok.com/@${u}` },
  { name: "YouTube", cat: "social", type: "status", url: (u) => `https://www.youtube.com/@${u}` },
  { name: "Pinterest", cat: "social", type: "status", url: (u) => `https://www.pinterest.com/${u}/` },
  { name: "Tumblr", cat: "social", type: "status", url: (u) => `https://${u}.tumblr.com` },
  { name: "Medium", cat: "social", type: "status", url: (u) => `https://medium.com/@${u}` },
  { name: "ProductHunt", cat: "social", type: "status", url: (u) => `https://www.producthunt.com/@${u}` },
  { name: "Wattpad", cat: "social", type: "status", url: (u) => `https://www.wattpad.com/user/${u}` },
  { name: "AboutMe", cat: "social", type: "status", url: (u) => `https://about.me/${u}` },
  // photo / art
  { name: "Behance", cat: "art", type: "status", url: (u) => `https://www.behance.net/${u}` },
  { name: "Dribbble", cat: "art", type: "status", url: (u) => `https://dribbble.com/${u}` },
  { name: "Flickr", cat: "art", type: "status", url: (u) => `https://www.flickr.com/people/${u}` },
  { name: "500px", cat: "art", type: "status", url: (u) => `https://500px.com/p/${u}` },
  { name: "VSCO", cat: "art", type: "status", url: (u) => `https://vsco.co/${u}/gallery` },
  { name: "Imgur", cat: "art", type: "status", url: (u) => `https://imgur.com/user/${u}` },
  { name: "DeviantArt", cat: "art", type: "status", url: (u) => `https://www.deviantart.com/${u}` },
  // music
  { name: "SoundCloud", cat: "music", type: "status", url: (u) => `https://soundcloud.com/${u}` },
  { name: "Bandcamp", cat: "music", type: "status", url: (u) => `https://${u}.bandcamp.com` },
  { name: "LastFM", cat: "music", type: "status", url: (u) => `https://www.last.fm/user/${u}` },
  { name: "Mixcloud", cat: "music", type: "status", url: (u) => `https://www.mixcloud.com/${u}/` },
  // gaming
  { name: "Steam", cat: "gaming", type: "message", absent: "The specified profile could not be found", url: (u) => `https://steamcommunity.com/id/${u}` },
  { name: "Chess.com", cat: "gaming", type: "status", url: (u) => `https://www.chess.com/member/${u}` },
  { name: "Lichess", cat: "gaming", type: "status", url: (u) => `https://lichess.org/@/${u}` },
  { name: "Twitch", cat: "gaming", type: "status", url: (u) => `https://m.twitch.tv/${u}` },
  // blogging / writing
  { name: "WordPress", cat: "blog", type: "status", url: (u) => `https://${u}.wordpress.com` },
  { name: "Blogger", cat: "blog", type: "status", url: (u) => `https://${u}.blogspot.com` },
  { name: "Letterboxd", cat: "blog", type: "status", url: (u) => `https://letterboxd.com/${u}/` },
  { name: "Gravatar", cat: "blog", type: "status", url: (u) => `https://gravatar.com/${u}` },
  { name: "Patreon", cat: "blog", type: "status", url: (u) => `https://www.patreon.com/${u}` },
  { name: "Trello", cat: "blog", type: "status", url: (u) => `https://trello.com/${u}` },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

type Verdict = "found" | "absent" | "uncertain" | "error";

async function checkSite(site: Site, username: string): Promise<{ site: string; category: string; url: string; verdict: Verdict; status?: number }> {
  const url = site.url(username);
  try {
    const res = await fetch(url, {
      method: "GET", redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/json" },
      signal: AbortSignal.timeout(9000),
    });
    const base = { site: site.name, category: site.cat, url, status: res.status };
    if (res.status === 404 || res.status === 410) return { ...base, verdict: "absent" };
    if (res.status === 403 || res.status === 429 || res.status >= 500) return { ...base, verdict: "uncertain" };
    if (site.type === "message") {
      const body = await res.text();
      return { ...base, verdict: body.includes(site.absent!) ? "absent" : res.status === 200 ? "found" : "uncertain" };
    }
    // status type: a 200 that quietly redirected to the site root is a soft 404.
    if (res.status === 200) {
      try {
        const to = new URL(res.url);
        if (res.redirected && (to.pathname === "/" || to.pathname === "")) return { ...base, verdict: "uncertain" };
      } catch { /* ignore */ }
      return { ...base, verdict: "found" };
    }
    return { ...base, verdict: "uncertain" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { site: site.name, category: site.cat, url, verdict: /timeout|aborted/i.test(msg) ? "uncertain" : "error" };
  }
}

/** Bounded-concurrency map so we don't open 40 sockets at once. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function usernameTools() {
  const usernameSearch = tool(
    "username_search",
    [
      `Hunt a username across ${CATALOG.length} platforms at once (a built-in Sherlock — dev, social,`,
      "art, music, gaming and blogging sites) and report where a public profile exists. This is a",
      "primary pivot: a handle on one site is a hypothesis for every other site and for the graph.",
      "",
      "Each result is 'found', 'absent', 'uncertain' (the site bot-blocked or rate-limited us — verify",
      "with http_probe/WebFetch or a headless browser), or 'error'. A clean 'absent' is a finding.",
      "Feed every 'found' profile's displayed name, photo and linked accounts back into the graph as",
      "new pending nodes, and mint variants (separators, trailing digits, l33t swaps) to re-run.",
    ].join("\n"),
    {
      username: z.string().min(1).max(64).describe("The handle to hunt (no @, no spaces)."),
      categories: z.array(z.enum(["dev", "social", "art", "music", "gaming", "blog"])).optional().describe("Restrict to these categories. Default: all."),
    },
    async ({ username, categories }) => {
      const handle = username.trim().replace(/^@/, "");
      if (!/^[\w.\-]+$/.test(handle)) return text("A username can only contain letters, digits, dot, underscore and hyphen.", true);
      const sites = categories?.length ? CATALOG.filter((s) => categories.includes(s.cat as never)) : CATALOG;
      const results = await pooled(sites, 12, (s) => checkSite(s, handle));
      const found = results.filter((r) => r.verdict === "found");
      const uncertain = results.filter((r) => r.verdict === "uncertain");
      const summary = {
        username: handle,
        checked: results.length,
        foundCount: found.length,
        found: found.map((r) => ({ site: r.site, url: r.url })),
        uncertain: uncertain.map((r) => ({ site: r.site, url: r.url })),
        absentCount: results.filter((r) => r.verdict === "absent").length,
        note: "Feed each 'found' profile into the graph and pivot on it. Verify 'uncertain' sites manually — they blocked the automated check.",
      };
      return text(JSON.stringify(summary));
    },
  );
  return [usernameSearch];
}

export const USERNAME_SITE_COUNT = CATALOG.length;
