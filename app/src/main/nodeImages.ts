// ─────────────────────────────────────────────────────────────────────────────
// Node pictures. The renderer's CSP is `img-src 'self' data: blob:`, so remote
// favicons/avatars/photos can't load there — the main process fetches them and
// hands the renderer a small `data:` URL as node.image. That is also the tainting
// protection (nothing remote ever touches the canvas) and keeps everything under
// the graph tool's 200 KB image cap.
//
// Every fetch is routed through the same SSRF guard as http_probe so a malicious
// favicon/og:image href can't pivot into the operator's LAN. Results are cached
// on disk so re-opening a case is instant and works offline. Best-effort: any
// failure resolves to null and the node just keeps its coloured disc.
// ─────────────────────────────────────────────────────────────────────────────
import { nativeImage } from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./config";
import { isBlockedHost } from "./tools/net";

const ICON_DIR = join(paths.dataDir, "node-icons");
mkdirSync(ICON_DIR, { recursive: true });
const MAX_DATA_URL = 190_000; // stay under the graph tool's 200k image cap
const UA = "Mozilla/5.0 (compatible; AetherBot/2.0)";

const keyOf = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const cacheFile = (k: string) => join(ICON_DIR, k + ".txt");

function readCache(k: string): string | null {
  try { return existsSync(cacheFile(k)) ? readFileSync(cacheFile(k), "utf8") : null; } catch { return null; }
}
function writeCache(k: string, dataUrl: string): void {
  try { writeFileSync(cacheFile(k), dataUrl); } catch { /* cache is best-effort */ }
}

/** Resize + re-encode any raster buffer to a small square-ish PNG data URL. */
function toThumb(buf: Buffer, size: number): string | null {
  try {
    const img = nativeImage.createFromBuffer(buf);           // PNG/JPEG/GIF/BMP/ICO
    if (img.isEmpty()) return null;
    const { height } = img.getSize();
    const resized = height > size ? img.resize({ height: size, quality: "good" }) : img;
    const url = resized.toDataURL();
    return url && url.length <= MAX_DATA_URL ? url : null;
  } catch { return null; }
}

async function fetchGuarded(url: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (await isBlockedHost(u.hostname)) return null;        // SSRF guard, same as http_probe
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct && !/^image\/|octet-stream|text\/html/.test(ct)) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) return null;
    return Buffer.from(ab);
  } catch { return null; }
}

/** Thumbnail an image the agent fetched to a known https URL (an avatar / logo /
 *  og:image she discovered). Cached by URL. */
export async function thumbFromUrl(imageUrl: string, size = 96): Promise<string | null> {
  const k = keyOf("url:" + imageUrl + ":" + size);
  const hit = readCache(k);
  if (hit) return hit;
  const buf = await fetchGuarded(imageUrl, 1024 * 1024);
  const dataUrl = buf ? toThumb(buf, size) : null;
  if (dataUrl) writeCache(k, dataUrl);
  return dataUrl;
}

/** Thumbnail a local file already on disk (a workspace photo she read for EXIF).
 *  The full-res original stays on disk; only a small thumb is inlined. */
export function thumbFromPath(localPath: string, size = 128): string | null {
  try { return toThumb(readFileSync(localPath), size); } catch { return null; }
}

/** The site's OWN favicon for an account / domain / host / service node.
 *  Privacy: fetched from the target origin the operator is already probing —
 *  never a third-party icon proxy, which would broadcast every target. */
export async function faviconFor(hostish: string): Promise<string | null> {
  const host = hostish.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").replace(/:.*/, "");
  if (!host || !host.includes(".")) return null;
  const k = keyOf("fav:" + host);
  const hit = readCache(k);
  if (hit) return hit;

  // 1) parse <link rel="icon"|"apple-touch-icon"> off the homepage, prefer the first.
  let iconUrl: string | null = null;
  const html = await fetchGuarded(`https://${host}/`, 300 * 1024);
  if (html) {
    const href = [...html.toString("utf8").matchAll(/<link[^>]+>/gi)]
      .map((m) => m[0])
      .filter((t) => /rel=["'][^"']*\bicon\b[^"']*["']/i.test(t))
      .map((t) => t.match(/href=["']([^"']+)["']/i)?.[1])
      .find(Boolean);
    if (href) { try { iconUrl = new URL(href, `https://${host}/`).href; } catch { /* ignore */ } }
  }
  // 2) fall back to /favicon.ico. 64px source keeps it crisp when a node is zoomed in.
  const buf = await fetchGuarded(iconUrl ?? `https://${host}/favicon.ico`, 512 * 1024);
  const dataUrl = buf ? toThumb(buf, 64) : null;
  if (dataUrl) writeCache(k, dataUrl);
  return dataUrl;
}
