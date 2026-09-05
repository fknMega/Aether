import React, { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import {
  forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY,
  type Simulation,
} from "d3-force";
import type { CaseGraph } from "../../shared/types";
import { colorForType } from "../lib/graphColors";

interface SimNode { key: string; type: string; label: string; status: string; image?: string | null; deg: number; r: number; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null; }
interface SimLink { source: SimNode | string; target: SimNode | string; label: string | null; }

export interface GraphHandle { zoomBy(f: number): void; fit(): void; }

interface Props { graph: CaseGraph; search: string; selectedKey: string | null; onSelect: (key: string | null) => void; }

export const ForceGraph = forwardRef<GraphHandle, Props>(function ForceGraph({ graph, search, selectedKey, onSelect }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<Map<string, SimNode>>(new Map());
  const linksRef = useRef<SimLink[]>([]);
  const cam = useRef({ x: 0, y: 0, k: 1, ready: false });
  const size = useRef({ w: 0, h: 0, dpr: Math.min(window.devicePixelRatio || 1, 2) });
  const hover = useRef<string | null>(null);
  const needsFit = useRef(true);
  const lastCaseId = useRef<string | null>(null);
  const drag = useRef<{ node: SimNode | null; moved: boolean; panning: boolean; startX: number; startY: number; lastX: number; lastY: number } | null>(null);
  const searchRef = useRef(search); searchRef.current = search;
  const selRef = useRef(selectedKey); selRef.current = selectedKey;

  // ── reconcile graph data into the simulation, preserving positions ──────────
  useEffect(() => {
    const prev = nodesRef.current;
    const deg = new Map<string, number>();
    for (const e of graph.edges) { deg.set(e.source, (deg.get(e.source) ?? 0) + 1); deg.set(e.target, (deg.get(e.target) ?? 0) + 1); }
    const next = new Map<string, SimNode>();
    for (const n of graph.nodes) {
      const d = deg.get(n.key) ?? 0;
      let r = (n.type === "target" ? 15 : 8) + Math.min(d, 12) * 1.5;
      // Image-bearing nodes get a size floor so the pic actually reads: faces and
      // photos want room; a favicon needs ~15.
      if (n.image) {
        const portrait = n.type === "target" || n.type === "person" || n.type === "photo";
        r = Math.max(r, portrait ? 23 : 15);
      }
      const existing = prev.get(n.key);
      if (existing) { existing.type = n.type; existing.label = n.label; existing.status = n.status; existing.image = n.image; existing.deg = d; existing.r = r; next.set(n.key, existing); }
      else next.set(n.key, { key: n.key, type: n.type, label: n.label, status: n.status, image: n.image, deg: d, r, x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120 });
    }
    nodesRef.current = next;
    const nodeArr = [...next.values()];
    linksRef.current = graph.edges
      .filter((e) => next.has(e.source) && next.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, label: e.label }));

    if (!simRef.current) {
      simRef.current = forceSimulation<SimNode, SimLink>(nodeArr)
        .force("charge", forceManyBody<SimNode>().strength(-560).distanceMax(760))
        .force("link", forceLink<SimNode, SimLink>(linksRef.current).id((d) => d.key).distance((l) => 96 + ((l.source as SimNode).r ?? 8) + ((l.target as SimNode).r ?? 8)).strength(0.6))
        .force("center", forceCenter(0, 0).strength(0.04))
        .force("collide", forceCollide<SimNode>((d) => d.r + 18).strength(0.9))
        .force("x", forceX(0).strength(0.022))
        .force("y", forceY(0).strength(0.022))
        .alphaDecay(0.026);
    } else {
      simRef.current.nodes(nodeArr);
      (simRef.current.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>).links(linksRef.current);
      simRef.current.alpha(0.7).restart();
    }
    // Only auto-frame when the CASE changes — not on every live node the agent
    // adds, which would keep yanking the user's pan/zoom away.
    if (graph.case.id !== lastCaseId.current) { needsFit.current = true; lastCaseId.current = graph.case.id; }
  }, [graph]);

  // Stop the physics timer when the graph unmounts (otherwise it keeps ticking).
  useEffect(() => () => { simRef.current?.stop(); }, []);

  // ── canvas sizing ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const target = canvas.parentElement ?? canvas; // the graph-view fills reliably
    const resize = () => {
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height) return;
      size.current.w = r.width; size.current.h = r.height;
      const { dpr } = size.current;
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      if (!cam.current.ready) { cam.current.x = r.width / 2; cam.current.y = r.height / 2; cam.current.ready = true; }
      needsFit.current = true; // re-frame once we know the real size
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(target);
    return () => ro.disconnect();
  }, []);

  // Frame every node into view, honouring the HUD margins.
  const fitView = useCallback(() => {
    const ns = [...nodesRef.current.values()].filter((n) => n.x != null);
    if (!ns.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of ns) { minX = Math.min(minX, n.x!); minY = Math.min(minY, n.y!); maxX = Math.max(maxX, n.x!); maxY = Math.max(maxY, n.y!); }
    const { w, h } = size.current;
    if (!w || !h) return;
    const gw = Math.max(maxX - minX, 60), gh = Math.max(maxY - minY, 60);
    const k = Math.max(0.3, Math.min(1.35, Math.min(w / (gw + 300), h / (gh + 240))));
    cam.current.k = k;
    cam.current.x = w / 2 - ((minX + maxX) / 2) * k;
    cam.current.y = h / 2 - ((minY + maxY) / 2) * k;
  }, []);

  // ── render loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const draw = (t: number) => {
      const { w, h, dpr } = size.current;
      const c = cam.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(c.x, c.y); ctx.scale(c.k, c.k);

      const q = searchRef.current.trim().toLowerCase();
      const nodes = nodesRef.current;
      const sel = selRef.current;
      const hov = hover.current;
      const focusKey = hov ?? sel;
      const neighbors = new Set<string>();
      if (focusKey) { neighbors.add(focusKey); for (const l of linksRef.current) { const s = (l.source as SimNode).key, tg = (l.target as SimNode).key; if (s === focusKey) neighbors.add(tg); if (tg === focusKey) neighbors.add(s); } }

      const matches = (n: SimNode) => !q || n.label.toLowerCase().includes(q) || n.key.toLowerCase().includes(q) || n.type.includes(q);

      // edges
      for (const l of linksRef.current) {
        const s = l.source as SimNode, tg = l.target as SimNode;
        if (s.x == null || tg.x == null) continue;
        const active = focusKey ? (neighbors.has(s.key) && neighbors.has(tg.key)) : true;
        const dim = (q && (!matches(s) || !matches(tg))) || (focusKey && !active);
        ctx.strokeStyle = dim ? "rgba(240,234,222,0.03)" : active && focusKey ? "rgba(255,111,165,0.5)" : "rgba(240,234,222,0.08)";
        ctx.lineWidth = active && focusKey ? 1.4 : 1;
        ctx.beginPath(); ctx.moveTo(s.x, s.y!); ctx.lineTo(tg.x, tg.y!); ctx.stroke();
      }

      // nodes — museum-quality archival ink; only the target glows.
      for (const n of nodes.values()) {
        if (n.x == null || n.y == null) continue;
        const color = colorForType(n.type);
        const dim = (q && !matches(n)) || (focusKey && !neighbors.has(n.key));
        const isFocus = n.key === focusKey;
        const isTarget = n.type === "target" || n.type === "person";
        const dead = n.status === "dead";
        const alpha = dim ? 0.20 : 1;
        ctx.globalAlpha = alpha;

        // The lit subject (target/person) is the one warm halo. Everyone else is
        // flat ink with, at most, a faint lift when focused.
        if (!dim && isTarget) { ctx.shadowColor = "rgba(255,111,165,0.9)"; ctx.shadowBlur = 22; }
        else if (!dim && isFocus) { ctx.shadowColor = shade(color, 0.1); ctx.shadowBlur = 6; }
        else ctx.shadowBlur = 0;

        // body: a clean printed disc — flat muted fill, subtle top-light.
        // All shade() args are the hex `color`; shade returns rgb() and can't be re-shaded.
        const grad = ctx.createRadialGradient(n.x, n.y - n.r * 0.4, 1, n.x, n.y, n.r);
        grad.addColorStop(0, shade(color, dead ? -0.42 : 0.14));
        grad.addColorStop(1, dead ? shade(color, -0.6) : color);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        // die-cut rim
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = shade(color, -0.45); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.stroke();

        // pic layered over the body (which doubles as loading + fallback state).
        // Skip when tiny on screen (a favicon crushed to <7px is mush) or excluded.
        const onScreenR = n.r * c.k;
        const pic = (dead || onScreenR < 7) ? null : nodeImage(n.image);
        if (pic) {
          drawClippedImage(ctx, pic, n.x, n.y, n.r - 0.5);
          ctx.strokeStyle = shade(color, -0.2); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r - 0.5, 0, Math.PI * 2); ctx.stroke();
        }

        // status ring — mostly monochrome + amber. Status is the colour that matters.
        ctx.globalAlpha = alpha;
        ctx.setLineDash([]);
        if (n.status === "pending") {
          const pulse = 1 + Math.sin(t / 520) * 0.10;
          ctx.strokeStyle = "#ff6fa5"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r * pulse + 4, 0, Math.PI * 2); ctx.stroke();
        } else if (n.status === "candidate") {
          ctx.strokeStyle = "#8c8676"; ctx.lineWidth = 1.4; ctx.setLineDash([2, 4]);
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        } else if (n.status === "confirmed") {
          ctx.strokeStyle = "rgba(244,239,230,0.92)"; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2); ctx.stroke();
        } else if (dead) {
          ctx.strokeStyle = "rgba(193,91,73,0.7)"; ctx.lineWidth = 1.3; ctx.setLineDash([1, 3]);
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        if (n.key === sel) { ctx.strokeStyle = "#f4efe6"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 7, 0, Math.PI * 2); ctx.stroke(); }

        // label — serif for the target/confirmed (typeset), sans/mono ink for the rest.
        // Concrete families only: ctx.font does not resolve `ui-serif`/"New York".
        if ((c.k > 0.55 || isFocus || isTarget || n.status === "confirmed") && !dim) {
          ctx.globalAlpha = dim ? 0.4 : 1;
          const serif = isTarget || n.status === "confirmed";
          ctx.font = serif
            ? `${isTarget ? 600 : 500} 13px Georgia, "Times New Roman", serif`
            : `500 11.5px -apple-system, "Segoe UI", system-ui, sans-serif`;
          ctx.fillStyle = serif ? "rgba(244,239,230,0.95)" : "rgba(173,167,154,0.9)";
          ctx.textAlign = "center"; ctx.textBaseline = "top";
          const label = n.label.length > 28 ? n.label.slice(0, 26) + "…" : n.label;
          ctx.fillText(label, n.x, n.y + n.r + 7);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      // Auto-frame once the layout has cooled (and after a reconcile).
      if (needsFit.current && simRef.current && simRef.current.alpha() < 0.22) { fitView(); needsFit.current = false; }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fitView]);

  // ── interaction ─────────────────────────────────────────────────────────────
  const toWorld = (sx: number, sy: number) => { const c = cam.current; return { x: (sx - c.x) / c.k, y: (sy - c.y) / c.k }; };
  const nodeAt = (sx: number, sy: number): SimNode | null => {
    const { x, y } = toWorld(sx, sy);
    let best: SimNode | null = null, bd = Infinity;
    for (const n of nodesRef.current.values()) {
      if (n.x == null || n.y == null) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < n.r + 6 && d < bd) { best = n; bd = d; }
    }
    return best;
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };

    const onDown = (e: PointerEvent) => {
      const { sx, sy } = pos(e);
      const n = nodeAt(sx, sy);
      // Set the drag state BEFORE capturing — setPointerCapture can throw for a
      // non-active/synthetic pointer, and a throw here must never swallow the click.
      if (n) { simRef.current?.alphaTarget(0.25).restart(); n.fx = n.x; n.fy = n.y; drag.current = { node: n, moved: false, panning: false, startX: sx, startY: sy, lastX: sx, lastY: sy }; }
      else { drag.current = { node: null, moved: false, panning: true, startX: sx, startY: sy, lastX: sx, lastY: sy }; }
      try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
    };
    const onMove = (e: PointerEvent) => {
      const { sx, sy } = pos(e);
      const d = drag.current;
      if (!d) { const n = nodeAt(sx, sy); hover.current = n?.key ?? null; canvas.style.cursor = n ? "pointer" : "grab"; return; }
      if (!d.moved && Math.hypot(sx - d.startX, sy - d.startY) < 4) return; // ignore click jitter
      d.moved = true;
      if (d.node) { const w = toWorld(sx, sy); d.node.fx = w.x; d.node.fy = w.y; }
      else if (d.panning) { cam.current.x += sx - d.lastX; cam.current.y += sy - d.lastY; d.lastX = sx; d.lastY = sy; }
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      const { sx, sy } = pos(e);
      if (d) {
        if (d.node) { d.node.fx = null; d.node.fy = null; simRef.current?.alphaTarget(0); if (!d.moved) onSelect(d.node.key); }
        else if (!d.moved) { onSelect(null); }
      }
      drag.current = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* was never captured */ }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const c = cam.current;
      const before = toWorld(sx, sy);
      c.k = Math.max(0.15, Math.min(4, c.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      c.x = sx - before.x * c.k; c.y = sy - before.y * c.k;
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [onSelect]);

  useImperativeHandle(ref, () => ({
    zoomBy(f: number) { const c = cam.current, { w, h } = size.current; const cx = w / 2, cy = h / 2; const before = toWorld(cx, cy); c.k = Math.max(0.15, Math.min(4, c.k * f)); c.x = cx - before.x * c.k; c.y = cy - before.y * c.k; },
    fit: fitView,
  }), [fitView]);

  return (
    <canvas
      ref={canvasRef}
      className={`graph-canvas${drag.current?.panning ? " dragging" : ""}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
});

// ── node-image cache (module scope; shared across renders & nodes) ───────────
type ImgEntry = { img: HTMLImageElement; ready: boolean; failed: boolean };
const imgCache = new Map<string, ImgEntry>();
const IMG_CACHE_MAX = 500; // LRU cap so long OSINT sessions don't grow unbounded

/** Decoded image for this url, or null while loading / on failure. Never throws,
 *  never blocks the draw loop, never double-loads a url. The continuous rAF loop
 *  repaints the pic in automatically once it decodes. Only data:/blob:/'self'
 *  load under our img-src CSP — the main process hands the renderer data: URLs. */
function nodeImage(url: string | null | undefined): HTMLImageElement | null {
  if (!url) return null;
  let e = imgCache.get(url);
  if (!e) {
    if (imgCache.size >= IMG_CACHE_MAX) { const oldest = imgCache.keys().next().value; if (oldest) imgCache.delete(oldest); }
    const img = new Image();
    e = { img, ready: false, failed: false };
    imgCache.set(url, e);
    img.decoding = "async";
    img.onload = () => { e!.ready = true; };
    img.onerror = () => { e!.failed = true; };
    img.src = url;
  } else {
    imgCache.delete(url); imgCache.set(url, e); // touch for LRU
  }
  return e.ready && !e.failed ? e.img : null;
}

/** Cover-fit + circular-clip `img` into the node. ctx must be in world space. */
function drawClippedImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, r: number) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  const s = Math.max((2 * r) / iw, (2 * r) / ih); // cover: fill the circle, crop overflow
  const dw = iw * s, dh = ih * s;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore(); // MUST restore or the clip leaks into later nodes/edges
}

/** Lighten (>0) or darken (<0) a hex colour. */
function shade(hex: string, amt: number): string {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((x) => x + x).join("") : m, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 1 + amt : amt;
  if (amt < 0) { r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f); }
  else { r = Math.round(r + (255 - r) * f); g = Math.round(g + (255 - g) * f); b = Math.round(b + (255 - b) * f); }
  return `rgb(${r},${g},${b})`;
}
