import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Resolver, lookup } from "node:dns/promises";
import { Socket } from "node:net";
import { text } from "./context";

/** Reject loopback / private / link-local targets so http_probe can't be turned
 *  into an SSRF pivot into the operator's own network. */
function isPrivateIp(ip: string): boolean {
  if (/^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip) || ip === "0.0.0.0") return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (ip === "::1" || /^fe80:/i.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip)) return true;
  return false;
}
export async function isBlockedHost(host: string): Promise<boolean> {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^[0-9.]+$/.test(h) || h.includes(":")) return isPrivateIp(h);
  try { const { address } = await lookup(h); return isPrivateIp(address); } catch { return false; }
}

// ── whois over raw TCP (port 43), following one IANA referral ─────────────────
function whoisQuery(server: string, query: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let data = "";
    const done = (out: string) => { try { socket.destroy(); } catch { /* noop */ } resolve(out); };
    socket.setTimeout(timeoutMs, () => done(data || `whois timed out contacting ${server}`));
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
    socket.on("error", (e) => done(data || `whois error contacting ${server}: ${e.message}`));
    socket.on("close", () => resolve(data));
    socket.connect(43, server, () => socket.write(query + "\r\n"));
  });
}

export function netTools() {
  const dnsLookup = tool(
    "dns_lookup",
    "Resolve DNS records for a domain (A, AAAA, MX, TXT, NS, CNAME). Use it to map a domain's infrastructure, find mail providers, or confirm a host exists. Returns whatever record types resolve; missing types are a finding, not an error.",
    {
      domain: z.string().min(1).max(253).describe("The domain to resolve, e.g. example.com (no scheme, no path)."),
      types: z.array(z.enum(["A", "AAAA", "MX", "TXT", "NS", "CNAME"])).optional().describe("Record types to fetch. Defaults to all of them."),
    },
    async ({ domain, types }) => {
      const clean = domain.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
      const want = types ?? ["A", "AAAA", "MX", "TXT", "NS", "CNAME"];
      const r = new Resolver();
      const out: Record<string, unknown> = { domain: clean };
      await Promise.all(want.map(async (t) => {
        try {
          if (t === "A") out.A = await r.resolve4(clean);
          else if (t === "AAAA") out.AAAA = await r.resolve6(clean);
          else if (t === "MX") out.MX = await r.resolveMx(clean);
          else if (t === "TXT") out.TXT = (await r.resolveTxt(clean)).map((x) => x.join(""));
          else if (t === "NS") out.NS = await r.resolveNs(clean);
          else if (t === "CNAME") out.CNAME = await r.resolveCname(clean);
        } catch (e) {
          out[t] = { error: (e as NodeJS.ErrnoException).code ?? String(e) };
        }
      }));
      return text(JSON.stringify(out));
    },
  );

  const whois = tool(
    "whois",
    "Look up WHOIS registration for a domain or IP over port 43 — registrar, creation/expiry dates, name servers, and (where not redacted) registrant org. Follows the IANA referral to the authoritative server automatically. Returns the raw WHOIS text.",
    { query: z.string().min(1).max(253).describe("A domain (example.com) or an IP address.") },
    async ({ query }) => {
      const q = query.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
      const iana = await whoisQuery("whois.iana.org", q);
      const referral = iana.match(/^refer:\s*(\S+)/im)?.[1] ?? iana.match(/^whois:\s*(\S+)/im)?.[1];
      if (!referral) return text(`WHOIS (via IANA) for ${q}:\n\n${iana.trim().slice(0, 6000)}`);
      const authoritative = await whoisQuery(referral, q);
      const body = (authoritative.trim() || iana.trim()).slice(0, 8000);
      return text(`WHOIS for ${q} (server ${referral}):\n\n${body}`);
    },
  );

  const httpProbe = tool(
    "http_probe",
    "Fetch a URL and report what came back: final status, redirect chain endpoint, page <title>, server/content-type headers, and byte size. Use it to confirm a page or profile exists, read a title without rendering, or check where a short link lands. Reads only; never submits forms or authenticates.",
    {
      url: z.string().min(1).describe("The URL to fetch (http/https). A bare host is assumed https."),
      method: z.enum(["GET", "HEAD"]).optional().describe("Default GET (needed to read a title). HEAD for existence only."),
    },
    async ({ url, method }) => {
      const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      let host = "";
      try { host = new URL(target).hostname; } catch { return text(`http_probe: not a valid URL: ${target}`, true); }
      if (await isBlockedHost(host)) {
        return text(`http_probe refused ${host}: loopback / private / link-local addresses are out of scope.`, true);
      }
      try {
        const res = await fetch(target, {
          method: method ?? "GET",
          redirect: "follow",
          headers: { "user-agent": "Mozilla/5.0 (compatible; AetherBot/2.0)" },
          signal: AbortSignal.timeout(20_000),
        });
        let title: string | undefined;
        let bytes = 0;
        if ((method ?? "GET") === "GET") {
          const body = await res.text();
          bytes = body.length;
          title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim().replace(/\s+/g, " ").slice(0, 200);
        }
        return text(JSON.stringify({
          requested: target, finalUrl: res.url, status: res.status, ok: res.ok,
          redirected: res.redirected, contentType: res.headers.get("content-type"),
          server: res.headers.get("server"), bytes, title,
        }));
      } catch (e) {
        return text(`http_probe failed for ${target}: ${e instanceof Error ? e.message : String(e)}`, true);
      }
    },
  );

  return [dnsLookup, whois, httpProbe];
}
