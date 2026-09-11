import React, { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import {
  forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY,
  type Simulation,
} from "d3-force";
import type { CaseGraph } from "../../shared/types";
import { shapeForType, ringForStatus, type MarkShape } from "../lib/graphColors";
import { token, canvasMonoStack, invalidatePalette, withAlpha, onThemeChange } from "../lib/theme";
import { prefersReducedMotion, onMotionChange } from "../lib/motion";

// ─────────────────────────────────────────────────────────────────────────────
// The canvas speaks the same language as the DOM: no hue, no shadow, no
// gradient. TYPE is the mark's shape, STATUS is the ring treatment, and
// de-emphasis is a value drop — a paler token, not an alpha fade. Alpha 0.2
// reads as "receded" on ink but as "erased" on paper.
//
// The loop is not free-running. It draws while something is actually moving and
// then parks; every input path calls wake(). An idle app is a still app.
// ─────────────────────────────────────────────────────────────────────────────

interface SimNode { key: string; type: string; label: string; status: string; image?: string | null; deg: number; r: number; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null; }
interface SimLink { source: SimNode | string; target: SimNode | string; label: string | null; }

export interface GraphHandle { zoomBy(f: number): void; fit(): void; wake(): void; }

interface Props { graph: CaseGraph; search: string; selectedKey: string | null; onSelect: (key: string | null) => void; /** Live camera scale, reported only when it actually changes — never per frame. */ onCamera?: (k: number) => void; }

type Ctx = CanvasRenderingContext2D;
type CanvasToken = Parameters<typeof token>[0];
/** RINGS carries its token name as a plain string; the palette is keyed by a
 *  literal union. Every name in RINGS is in that union, so the cast is safe. */
const tok = (name: string): string => token(name as CanvasToken);

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const GRID = 24;            // world units between grid divisions
const GRID_FULL = 0.50;     // grid at full strength at or above this zoom
const GRID_CUT = 0.35;      // below this the grid is suppressed entirely
const LABEL_PX = 12;
const LABEL_MIN_K = 0.42;   // below this only pinned labels draw. The collision
                            // pass does the real thinning, so this can sit low.
const LABEL_MAX_W = 132;    // px — truncation is measured, never counted in chars
const WRITE_MS = 360;

/** A node that arrived since the last reconcile. `still` is the reduced-motion
 *  case: hold one static ring for a single paint instead of expanding it. */
interface WriteRing { at: number; still: boolean }

export const ForceGraph = forwardRef<GraphHandle, Props>(function ForceGraph({ graph, search, selectedKey, onSelect, onCamera }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<Map<string, SimNode>>(new Map());
  const linksRef = useRef<SimLink[]>([]);
  const cam = useRef({ x: 0, y: 0, k: 1, ready: false });
  const size = useRef({ w: 0, h: 0, dpr: Math.min(window.devicePixelRatio || 1, 2) });
  const hover = useRef<string | null>(null);
  const needsFit = useRef(true);
  const lastCaseId = useRef<string | null>(null);
  const writes = useRef<Map<string, WriteRing>>(new Map());
  const repaint = useRef(false);        // theme or motion pref flipped: force one frame
  const drag = useRef<{ node: SimNode | null; moved: boolean; panning: boolean; startX: number; startY: number; lastX: number; lastY: number } | null>(null);
  const searchRef = useRef(search); searchRef.current = search;
  const camCbRef = useRef(onCamera); camCbRef.current = onCamera;
  const reportedK = useRef(0);
  const selRef = useRef(selectedKey); selRef.current = selectedKey;

  // ── the frame pump ──────────────────────────────────────────────────────────
  // wake() is the whole scheduling contract: exactly one pending frame, ever.
  // draw() re-arms only while something is genuinely in flight.
  const rafRef = useRef(0);
  const drawRef = useRef<(t: number) => void>(() => {});
  const wake = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame((t) => { rafRef.current = 0; drawRef.current(t); });
  }, []);

  // A portrait decodes outside React; without this hook a late image would never
  // paint once the loop had parked.
  useEffect(() => { wakers.add(wake); return () => { wakers.delete(wake); }; }, [wake]);

  // ── reconcile graph data into the simulation, preserving positions ──────────
  useEffect(() => {
    const prev = nodesRef.current;
    const deg = new Map<string, number>();
    for (const e of graph.edges) { deg.set(e.source, (deg.get(e.source) ?? 0) + 1); deg.set(e.target, (deg.get(e.target) ?? 0) + 1); }
    const next = new Map<string, SimNode>();
    // A ring on every node of a freshly opened case is confetti, not signal. The
    // write-ring answers "which ones just arrived", so it only fires on a case
    // that was already on screen.
    const sameCase = graph.case.id === lastCaseId.current && prev.size > 0;
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
      else {
        next.set(n.key, { key: n.key, type: n.type, label: n.label, status: n.status, image: n.image, deg: d, r, x: (Math.random() - 0.5) * 120, y: (Math.random() - 0.5) * 120 });
        if (sameCase) writes.current.set(n.key, { at: performance.now(), still: prefersReducedMotion() });
      }
    }
    nodesRef.current = next;
    const nodeArr = [...next.values()];
    linksRef.current = graph.edges
      .filter((e) => next.has(e.source) && next.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, label: e.label }));

    if (!simRef.current) {
      const sim = forceSimulation<SimNode, SimLink>(nodeArr)
        .force("charge", forceManyBody<SimNode>().strength(-560).distanceMax(760))
        .force("link", forceLink<SimNode, SimLink>(linksRef.current).id((d) => d.key).distance((l) => 96 + ((l.source as SimNode).r ?? 8) + ((l.target as SimNode).r ?? 8)).strength(0.6))
        .force("center", forceCenter(0, 0).strength(0.04))
        // Collide takes the mark's CIRCUMSCRIBED radius — every shape is inscribed
        // in r — so the layout is identical whatever the type mix.
        .force("collide", forceCollide<SimNode>((d) => d.r + 18).strength(0.9))
        .force("x", forceX(0).strength(0.022))
        .force("y", forceY(0).strength(0.022))
        .alphaDecay(0.026);
      simRef.current = sim;
      if (prefersReducedMotion()) settle(sim);
    } else {
      simRef.current.nodes(nodeArr);
      (simRef.current.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>).links(linksRef.current);
      if (prefersReducedMotion()) { simRef.current.alpha(0.7); settle(simRef.current); }
      else simRef.current.alpha(0.7).restart();
    }
    // Only auto-frame when the CASE changes — not on every live node the agent
    // adds, which would keep yanking the user's pan/zoom away.
    if (graph.case.id !== lastCaseId.current) { needsFit.current = true; lastCaseId.current = graph.case.id; }
    wake();
  }, [graph, wake]);

  // Selection and the query change what is drawn but not what is moving, so they
  // need an explicit frame.
  useEffect(() => { wake(); }, [selectedKey, search, wake]);

  // Stop the physics timer when the graph unmounts (otherwise it keeps ticking).
  useEffect(() => () => { simRef.current?.stop(); }, []);

  // ── theme + motion ──────────────────────────────────────────────────────────
  // The canvas clears to transparent and .graph-stage paints --graph-field, so a
  // flip needs no remount: drop the cached palette and paint one more frame.
  useEffect(() => {
    const offTheme = onThemeChange(() => { invalidatePalette(); repaint.current = true; wake(); });
    const offMotion = onMotionChange(() => { repaint.current = true; wake(); });
    return () => { offTheme(); offMotion(); };
  }, [wake]);

  // ── canvas sizing ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const target = canvas.parentElement ?? canvas; // the graph stage fills reliably
    const resize = () => {
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height) return;
      size.current.w = r.width; size.current.h = r.height;
      const { dpr } = size.current;
      canvas.width = r.width * dpr; canvas.height = r.height * dpr;
      if (!cam.current.ready) { cam.current.x = r.width / 2; cam.current.y = r.height / 2; cam.current.ready = true; }
      needsFit.current = true; // re-frame once we know the real size
      wake();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(target);
    return () => ro.disconnect();
  }, [wake]);

  // Frame every node into view, honouring the HUD margins.
  const fitView = useCallback(() => {
    const ns = [...nodesRef.current.values()].filter((n) => n.x != null);
    if (!ns.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of ns) { minX = Math.min(minX, n.x!); minY = Math.min(minY, n.y!); maxX = Math.max(maxX, n.x!); maxY = Math.max(maxY, n.y!); }
    const { w, h } = size.current;
    if (!w || !h) return;
    const gw = Math.max(maxX - minX, 60), gh = Math.max(maxY - minY, 60);
    // The floor is 0.55, not 0.3: below it labels are zoom-gated and portraits
    // fall under the 7px suppression, so a "fit" that framed every node handed
    // back a field of anonymous grey dots. Opening readable and letting the
    // operator zoom out beats opening complete and illegible.
    const k = Math.max(0.55, Math.min(1.35, Math.min(w / (gw + 160), h / (gh + 130))));
    cam.current.k = k;
    cam.current.x = w / 2 - ((minX + maxX) / 2) * k;
    cam.current.y = h / 2 - ((minY + maxY) / 2) * k;
  }, []);

  // ── the frame ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    drawRef.current = (t: number) => {
      const { w, h, dpr } = size.current;
      const c = cam.current;
      const sim = simRef.current;
      if (!w || !h) return;

      // Consumed here so the frame a flip schedules is guaranteed to land even
      // when nothing else is in flight.
      const flipped = repaint.current;
      repaint.current = false;

      // The frame's palette. token() is a cached map read — getComputedStyle is
      // never called from inside this function.
      const P = {
        grid: tok("--graph-grid"),
        edge: tok("--graph-edge"), edgeOn: tok("--graph-edge-active"), edgeDim: tok("--edge-dim"),
        field: tok("--graph-field"),
        fill: tok("--node-fill"), fill2: tok("--node-fill-2"), dim: tok("--node-dim"),
        hollow: tok("--node-hollow"), rim: tok("--node-rim"), strike: tok("--node-strike"),
        ink: tok("--label"), stroke: tok("--node-stroke"), write: tok("--ring-write"),
        bracket: tok("--select-bracket"), cross: tok("--crosshair"),
        label1: tok("--graph-label"), label2: tok("--graph-label-2"),
        plate: tok("--graph-plate"), plateA: parseFloat(tok("--graph-plate-a")) || 0.88,
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "butt";
      ctx.setLineDash([]);

      const q = searchRef.current.trim().toLowerCase();
      const nodes = nodesRef.current;
      const sel = selRef.current;
      const hov = hover.current;
      // A focus key that names no live node would dim EVERY node — the whole
      // graph fades to anonymous grey with no labels, rings or portraits. That
      // is reachable for real: a node can be deleted or renamed by the agent
      // while it is selected. An unresolvable focus is treated as no focus.
      const wanted = hov ?? sel;
      const focusKey = wanted !== null && nodes.has(wanted) ? wanted : null;
      const neighbors = new Set<string>();
      if (focusKey) { neighbors.add(focusKey); for (const l of linksRef.current) { const s = (l.source as SimNode).key, tg = (l.target as SimNode).key; if (s === focusKey) neighbors.add(tg); if (tg === focusKey) neighbors.add(s); } }

      const matches = (n: SimNode) => !q || n.label.toLowerCase().includes(q) || n.key.toLowerCase().includes(q) || n.type.includes(q);
      const isDim = (n: SimNode) => (q !== "" && !matches(n)) || (focusKey !== null && !neighbors.has(n.key));

      const viz: { n: SimNode; dim: boolean; dead: boolean }[] = [];
      for (const n of nodes.values()) {
        if (n.x == null || n.y == null) continue;
        viz.push({ n, dim: isDim(n), dead: n.status === "dead" });
      }

      ctx.save();
      ctx.translate(c.x, c.y); ctx.scale(c.k, c.k);

      // ── dot grid ────────────────────────────────────────────────────────────
      // World-space, so it pans and zooms with the graph — but iterated over the
      // VISIBLE divisions only. An unclipped world lattice is by far the most
      // expensive thing on this canvas when zoomed out.
      if (c.k >= GRID_CUT) {
        const a = Math.min(1, (c.k - GRID_CUT) / (GRID_FULL - GRID_CUT));
        ctx.fillStyle = a >= 1 ? P.grid : withAlpha(P.grid, a);
        const d = 0.5 / c.k;                        // exactly one CSS pixel at any zoom
        const l = -c.x / c.k, r = (w - c.x) / c.k;
        const tp = -c.y / c.k, b = (h - c.y) / c.k;
        ctx.beginPath();
        for (let gx = Math.floor(l / GRID) * GRID; gx <= r; gx += GRID) {
          for (let gy = Math.floor(tp / GRID) * GRID; gy <= b; gy += GRID) ctx.rect(gx - d, gy - d, d * 2, d * 2);
        }
        ctx.fill();                                 // one path, one fill: 12k dots is free
      }

      // ── edges ───────────────────────────────────────────────────────────────
      for (const l of linksRef.current) {
        const s = l.source as SimNode, tg = l.target as SimNode;
        if (s.x == null || tg.x == null) continue;
        const lit = focusKey !== null && neighbors.has(s.key) && neighbors.has(tg.key);
        const dim = (q !== "" && (!matches(s) || !matches(tg))) || (focusKey !== null && !lit);
        ctx.strokeStyle = dim ? P.edgeDim : lit ? P.edgeOn : P.edge;
        ctx.lineWidth = lit ? 1.4 : 1;
        ctx.beginPath(); ctx.moveTo(s.x, s.y!); ctx.lineTo(tg.x, tg.y!); ctx.stroke();
      }

      // ── node marks ──────────────────────────────────────────────────────────
      for (const v of viz) {
        const n = v.n, x = n.x!, y = n.y!;
        const shape = shapeForType(n.type);
        markPath(ctx, shape, x, y, n.r);

        if (v.dim) {
          // A value drop, and a total one: no picture, no ring, no label.
          ctx.fillStyle = P.dim; ctx.fill();
          ctx.strokeStyle = P.dim; ctx.lineWidth = 1; ctx.stroke();
          continue;
        }

        if (v.dead) {
          ctx.fillStyle = P.field; ctx.fill();
          ctx.save(); ctx.clip();
          ctx.strokeStyle = P.strike; ctx.lineWidth = 1;
          ctx.beginPath();
          // Stepped along x by 4·√2 so the PERPENDICULAR pitch of the 45° hatch
          // is the 4px the system asks for.
          for (let o = -n.r * 2; o <= n.r * 2; o += 4 * Math.SQRT2) {
            ctx.moveTo(x - n.r + o, y + n.r); ctx.lineTo(x + n.r + o, y - n.r);
          }
          ctx.stroke();
          ctx.restore();                            // MUST restore or the clip leaks
          markPath(ctx, shape, x, y, n.r);
          ctx.strokeStyle = P.strike; ctx.lineWidth = 1; ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x - n.r * 0.72, y + n.r * 0.72); ctx.lineTo(x + n.r * 0.72, y - n.r * 0.72);
          ctx.stroke();
          continue;                                 // excluded nodes carry no picture
        }

        if (shape === "hollow") {
          ctx.fillStyle = P.field; ctx.fill();
          ctx.strokeStyle = P.hollow; ctx.lineWidth = 1.5; ctx.stroke();
        } else {
          ctx.fillStyle = n.status === "confirmed" ? P.fill2 : P.fill;
          ctx.fill();
          ctx.strokeStyle = P.rim; ctx.lineWidth = 1; ctx.stroke();
        }

        // A picture is a rectangular plate laid over the mark, which stays as the
        // loading and fallback state. Skipped when tiny on screen — a favicon
        // crushed under 7px is mush.
        const plate = plateOf(n);
        const pic = plate && n.r * c.k >= 7 ? nodeImage(n.image) : null;
        if (pic && plate) {
          drawPlate(ctx, pic, x, y, plate.hw, plate.hh);
          // On light, this rim is the only thing separating a pale photo from
          // pale paper.
          ctx.beginPath(); roundRectPath(ctx, x - plate.hw, y - plate.hh, plate.hw * 2, plate.hh * 2, 2);
          ctx.strokeStyle = P.rim; ctx.lineWidth = 1; ctx.stroke();
        }
      }

      // ── status rings ────────────────────────────────────────────────────────
      ctx.lineWidth = 1.5;
      for (const v of viz) {
        if (v.dim || v.dead) continue;              // excluded is struck, never ringed
        const ring = ringForStatus(v.n.status);
        if (!ring || ring.stroke === "hatch") continue;
        const n = v.n;
        ctx.strokeStyle = tok(ring.token);
        ctx.setLineDash(ring.stroke === "dash23" ? [2, 3] : ring.stroke === "dot13" ? [1, 3] : []);
        ctx.beginPath();
        // An open lead is literally an open ring, broken at 12 o'clock. Static:
        // a pulse here is the one thing that would keep a settled graph awake.
        if (ring.stroke === "open12") ctx.arc(n.x!, n.y!, n.r + 4, -60 * DEG, 240 * DEG);
        else ctx.arc(n.x!, n.y!, n.r + 4, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // ── target reticle ──────────────────────────────────────────────────────
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5;
      for (const v of viz) {
        if (v.dim || v.n.type !== "target") continue;
        const n = v.n, a = n.r + 6, b = n.r + 11;
        ctx.beginPath();
        ctx.moveTo(n.x!, n.y! - a); ctx.lineTo(n.x!, n.y! - b);
        ctx.moveTo(n.x! + a, n.y!); ctx.lineTo(n.x! + b, n.y!);
        ctx.moveTo(n.x!, n.y! + a); ctx.lineTo(n.x!, n.y! + b);
        ctx.moveTo(n.x! - a, n.y!); ctx.lineTo(n.x! - b, n.y!);
        ctx.stroke();
      }

      // ── write-rings ─────────────────────────────────────────────────────────
      // The tool row says "4 nodes"; this says WHICH four. One ring per node,
      // once, ever.
      for (const [key, wr] of writes.current) {
        const n = nodes.get(key);
        if (!n || n.x == null || n.y == null) { writes.current.delete(key); continue; }
        if (wr.still) {
          ctx.strokeStyle = P.write; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 10, 0, TAU); ctx.stroke();
          writes.current.delete(key);
          continue;
        }
        const p = (t - wr.at) / WRITE_MS;
        if (p >= 1) { writes.current.delete(key); continue; }
        const e = ease(Math.max(0, p));
        ctx.strokeStyle = withAlpha(P.write, 0.9 * (1 - e));
        ctx.lineWidth = 1.5 - e;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 20 * e, 0, TAU); ctx.stroke();
      }

      ctx.restore();

      // ── selection ───────────────────────────────────────────────────────────
      // Screen space, so the brackets stay 1.5px and the hairlines 1px however
      // far the camera is zoomed. No coordinate readout: d3 x/y is emergent
      // physics, not data about the subject.
      const selNode = sel ? nodes.get(sel) : null;
      if (selNode && selNode.x != null && selNode.y != null) {
        const sx = selNode.x * c.k + c.x, sy = selNode.y * c.k + c.y;
        const gx = Math.round(sx) + 0.5, gy = Math.round(sy) + 0.5;
        ctx.strokeStyle = P.cross; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, gy); ctx.lineTo(w, gy);
        ctx.moveTo(gx, 0); ctx.lineTo(gx, h);
        ctx.stroke();
        const R = selNode.r * c.k + 9, arm = 6;
        ctx.strokeStyle = P.bracket; ctx.lineWidth = 1.5;
        for (const [dx, dy] of CORNERS) {
          const px = sx + dx * R, py = sy + dy * R;
          ctx.beginPath();
          ctx.moveTo(px - dx * arm, py); ctx.lineTo(px, py); ctx.lineTo(px, py - dy * arm);
          ctx.stroke();
        }
      }

      // ── labels ──────────────────────────────────────────────────────────────
      // One voice: 12px mono, in screen space. Two tiers of weight and colour;
      // italic is the epistemic channel (provisional), never emphasis.
      const mono = canvasMonoStack();
      const jobs = viz
        .filter((v) => !v.dim)
        .map((v) => {
          const n = v.n;
          // Two different privileges, which must not be one flag. `tier1` is a
          // STYLE (heavier, brighter) and is broad. `pinned` means "never zoom-
          // gated, never collision-dropped" and must stay tiny — at most three
          // nodes. Letting every confirmed node be pinned makes a well-worked
          // case unreadable: the labels all survive and print over each other.
          const tier1 = n.key === sel || n.key === hov || n.type === "target" || n.status === "confirmed";
          const pinned = n.key === sel || n.key === hov || n.type === "target";
          return { n, tier1, pinned, italic: n.status === "candidate", struck: v.dead };
        })
        .filter((j) => j.pinned || c.k >= LABEL_MIN_K);
      // Degree order keeps the surviving set stable as the sim jitters; the key
      // breaks ties so two labels never trade places between frames. The
      // never-dropped four are placed first because they win the space anyway.
      jobs.sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.n.deg - a.n.deg || (a.n.key < b.n.key ? -1 : 1)));

      ctx.textAlign = "center"; ctx.textBaseline = "top";
      // Seed the reservation list with every visible MARK, not just with other
      // labels. A label is always drawn below its own node, so this never drops
      // a label on its own account — it only stops one printing across someone
      // else's portrait, which is the artifact that made the old graph look
      // untended.
      const taken: Rect[] = [];
      for (const v of viz) {
        if (v.dim) continue;
        const n = v.n;
        const pl = plateOf(n);
        const hw = (pl ? pl.hw : n.r) * c.k, hh = (pl ? pl.hh : n.r) * c.k;
        const mx = n.x! * c.k + c.x, my = n.y! * c.k + c.y;
        taken.push({ x: mx - hw, y: my - hh, w: hw * 2, h: hh * 2 });
      }
      for (const j of jobs) {
        const n = j.n;
        const sx = n.x! * c.k + c.x, sy = n.y! * c.k + c.y;
        if (sx < -200 || sx > w + 200 || sy < -80 || sy > h + 80) continue;
        ctx.font = `${j.italic ? "italic " : ""}${j.tier1 ? 500 : 400} ${LABEL_PX}px ${mono}`;
        const text = clip(ctx, n.label, LABEL_MAX_W);
        const tw = ctx.measureText(text).width;
        const plate = plateOf(n);
        const top = sy + (plate ? plate.hh : n.r) * c.k + 6;
        const box: Rect = { x: sx - tw / 2 - 3, y: top - 1, w: tw + 6, h: LABEL_PX + 2 };
        if (!j.pinned && taken.some((r) => overlaps(r, box))) continue;
        taken.push(box);
        // The one use of globalAlpha in this renderer: the knockout plate has to
        // let a little field through or it reads as a printed chip.
        ctx.globalAlpha = P.plateA;
        ctx.fillStyle = P.plate;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = j.tier1 ? P.label1 : P.label2;
        ctx.fillText(text, sx, top);
        if (j.struck) {
          ctx.strokeStyle = j.tier1 ? P.label1 : P.label2; ctx.lineWidth = 1;
          const ly = Math.round(top + LABEL_PX * 0.55) + 0.5;
          ctx.beginPath(); ctx.moveTo(sx - tw / 2 - 1, ly); ctx.lineTo(sx + tw / 2 + 1, ly); ctx.stroke();
        }
      }

      // Auto-frame once the layout has cooled (and after a reconcile).
      if (needsFit.current && sim && sim.alpha() < 0.22) { fitView(); needsFit.current = false; }
      // Report the camera scale on change only — a per-frame setState would
      // re-render the toolbar 60x a second for a readout that rarely moves.
      if (c.k !== reportedK.current) { reportedK.current = c.k; camCbRef.current?.(c.k); }

      // Re-arm if and only if something is still moving. Hover is deliberately
      // NOT here: the highlight is static, every pointer event wakes the loop
      // itself, and re-arming on it pinned a core at 60fps for as long as the
      // cursor happened to rest on a node.
      const busy =
        (sim != null && sim.alpha() > 0.005) ||
        drag.current != null ||
        writes.current.size > 0 ||
        (needsFit.current && sim != null) ||
        flipped;
      if (busy) wake();
    };

    wake();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [fitView, wake]);

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
      else { drag.current = { node: null, moved: false, panning: true, startX: sx, startY: sy, lastX: sx, lastY: sy }; canvas.classList.add("dragging"); }
      try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
      wake();
    };
    const onMove = (e: PointerEvent) => {
      const { sx, sy } = pos(e);
      const d = drag.current;
      if (!d) {
        const n = nodeAt(sx, sy);
        hover.current = n?.key ?? null;
        canvas.classList.toggle("over", n != null);   // the stylesheet owns the cursor
        wake();
        return;
      }
      if (!d.moved && Math.hypot(sx - d.startX, sy - d.startY) < 4) return; // ignore click jitter
      d.moved = true;
      if (d.node) { const w = toWorld(sx, sy); d.node.fx = w.x; d.node.fy = w.y; }
      else if (d.panning) { cam.current.x += sx - d.lastX; cam.current.y += sy - d.lastY; d.lastX = sx; d.lastY = sy; }
      wake();
    };
    const onUp = (e: PointerEvent) => {
      const d = drag.current;
      if (d) {
        if (d.node) { d.node.fx = null; d.node.fy = null; simRef.current?.alphaTarget(0); if (!d.moved) onSelect(d.node.key); }
        else if (!d.moved) { onSelect(null); }
      }
      drag.current = null;
      canvas.classList.remove("dragging");
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* was never captured */ }
      wake();
    };
    // The pointer leaving is a hover change like any other, and it is also what
    // lets the loop park after the cursor has gone.
    const onLeave = () => { hover.current = null; canvas.classList.remove("over"); wake(); };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const c = cam.current;
      const before = toWorld(sx, sy);
      c.k = Math.max(0.15, Math.min(4, c.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      c.x = sx - before.x * c.k; c.y = sy - before.y * c.k;
      wake();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    // A cancelled gesture (the OS claiming the touch, a browser scroll takeover)
    // never delivers pointerup. Without this the drag state is stranded, which
    // leaves the node pinned on alphaTarget(0.25) — a simulation that never
    // cools and a frame loop that never parks.
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [onSelect, wake]);

  useImperativeHandle(ref, () => ({
    zoomBy(f: number) {
      const c = cam.current, { w, h } = size.current;
      const cx = w / 2, cy = h / 2;
      const before = toWorld(cx, cy);
      c.k = Math.max(0.15, Math.min(4, c.k * f));
      c.x = cx - before.x * c.k; c.y = cy - before.y * c.k;
      wake();
    },
    fit() { fitView(); wake(); },
    wake,
  }), [fitView, wake]);

  // A canvas cannot be a button, so it carries its own accessible name rather
  // than reaching a screen reader as an unlabelled blank.
  return <canvas ref={canvasRef} className="graph-canvas" aria-label={`Knowledge graph, ${graph.nodes.length} nodes`} />;
});

// ── geometry ─────────────────────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number }

const CORNERS: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/** The mark for a type, inscribed in `r` — every shape's circumscribed radius is
 *  exactly r, which is what keeps forceCollide honest across the five families. */
function markPath(ctx: Ctx, shape: MarkShape, x: number, y: number, r: number): void {
  ctx.beginPath();
  if (shape === "square") {
    const s = r / Math.SQRT2;
    roundRectPath(ctx, x - s, y - s, s * 2, s * 2, 2);
  } else if (shape === "diamond") {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  } else if (shape === "triangle") {
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 3;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, TAU);          // circle and hollow share one outline
  }
}

/** Appends a rounded rectangle to the current path. `ctx.roundRect` is not on
 *  every runtime this app ships to, and arcTo is exact. */
function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, rad: number): void {
  const k = Math.min(rad, w / 2, h / 2);
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/** Half-extents of a node's picture plate: 4:5 for a face, 1:1 for a favicon or
 *  a document. Null when the node carries no image. */
function plateOf(n: SimNode): { hw: number; hh: number } | null {
  if (!n.image) return null;
  const portrait = n.type === "target" || n.type === "person" || n.type === "photo";
  return portrait ? { hw: n.r * 0.8, hh: n.r } : { hw: n.r * 0.85, hh: n.r * 0.85 };
}

/** cubic-bezier(0.2, 0, 0, 1) — the stylesheet's --ease, solved for the canvas.
 *  x is monotonic in t, so bisect for t and then read y off the curve. */
function ease(x: number): number {
  const bez = (t: number, a: number, b: number) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 12; i++) {
    t = (lo + hi) / 2;
    if (bez(t, 0.2, 0) < x) lo = t; else hi = t;
  }
  return bez(t, 0, 1);
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Ellipsis at a measured pixel width. A character count would cut in the wrong
 *  place the moment the mono stack falls through to a wider face. */
function clip(ctx: Ctx, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, mid) + "…").width <= max) lo = mid; else hi = mid - 1;
  }
  return s.slice(0, lo) + "…";
}

/** Reduced motion: the graph is simply already laid out. Run the physics to
 *  completion synchronously rather than animating it into place. */
function settle(sim: Simulation<SimNode, SimLink>): void {
  sim.stop();
  sim.tick(300);
}

// ── node-image cache (module scope; shared across renders & nodes) ───────────

/** Live frame pumps. An image decodes outside React and outside the loop, so its
 *  arrival has to be able to wake a parked canvas. */
const wakers = new Set<() => void>();
const wakeAll = () => { for (const f of wakers) f(); };

type ImgEntry = { img: HTMLImageElement; ready: boolean; failed: boolean };
const imgCache = new Map<string, ImgEntry>();
const IMG_CACHE_MAX = 500; // LRU cap so long OSINT sessions don't grow unbounded

/** Decoded image for this url, or null while loading / on failure. Never throws,
 *  never blocks the draw loop, never double-loads a url. Only data:/blob:/'self'
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
    img.onload = () => { e!.ready = true; wakeAll(); };
    img.onerror = () => { e!.failed = true; wakeAll(); };
    img.src = url;
  } else {
    imgCache.delete(url); imgCache.set(url, e); // touch for LRU
  }
  return e.ready && !e.failed ? e.img : null;
}

/** Cover-fit `img` into the plate and clip it to the rounded rect. ctx must be in
 *  world space. */
function drawPlate(ctx: Ctx, img: HTMLImageElement, cx: number, cy: number, hw: number, hh: number): void {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return;
  ctx.save();
  ctx.beginPath(); roundRectPath(ctx, cx - hw, cy - hh, hw * 2, hh * 2, 2); ctx.clip();
  const s = Math.max((hw * 2) / iw, (hh * 2) / ih); // cover: fill the plate, crop the overflow
  const dw = iw * s, dh = ih * s;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore(); // MUST restore or the clip leaks into later nodes
}
