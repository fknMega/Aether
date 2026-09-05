import React, { useEffect, useRef } from "react";
import { useStore } from "../state/store";

/** The lamplit drafting field behind every screen: slow warm motes drifting up
 *  like dust caught in lamplight, and a soft ember pool from the top-left. Idle
 *  it is near-still; while Aether works it stirs — motes brighten and rise
 *  faster and the lamp warms up — so the app is quietly, not garishly, alive.
 *
 *  (The canvas is sized to its parent explicitly. A bare `inset:0` collapses a
 *  <canvas> — a replaced element — to its intrinsic 300×150, which used to jam
 *  the whole field into the top-left corner.) */
export function DotField() {
  const ref = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(false);
  const busy = useStore((s) => !!s.stream);
  busyRef.current = busy;

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const parent = canvas.parentElement ?? canvas;
    let raf = 0, w = 0, h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const N = 44;

    // motes: normalized position, an upward drift, a slow horizontal sway, size + base alpha
    const motes = Array.from({ length: N }, () => ({
      x: Math.random(),
      y: Math.random(),
      vy: 0.012 + Math.random() * 0.02,          // rise speed (norm units / sec)
      sway: 0.2 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      r: 0.6 + Math.random() * 1.6,
      warm: Math.random() < 0.6,                  // amber vs paper-white
      a: 0.05 + Math.random() * 0.10,
    }));
    let intensity = 0, target = 0;                // 0 idle → 1 working

    const resize = () => {
      const r = parent.getBoundingClientRect();
      if (!r.width || !r.height) return;
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(parent);

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      target = busyRef.current ? 1 : 0;
      intensity += (target - intensity) * Math.min(1, dt * 0.7);   // ease over ~2s

      ctx.clearRect(0, 0, w, h);

      // the lamp: a soft ember pool from the top-left that warms up while working
      const lampA = 0.05 + intensity * 0.09;
      const g = ctx.createRadialGradient(w * 0.1, -h * 0.08, 0, w * 0.1, -h * 0.08, Math.max(w, h) * 0.9);
      g.addColorStop(0, `rgba(255,111,165,${lampA})`);
      g.addColorStop(1, "rgba(255,111,165,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const speed = reduce ? 0 : 1 + intensity * 1.6;
      const bright = 1 + intensity * 1.4;
      for (const m of motes) {
        if (!reduce) {
          m.y -= m.vy * speed * dt;
          m.phase += dt * m.sway;
          if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }     // recycle at the top
        }
        const px = (m.x + Math.sin(m.phase) * 0.01) * w;
        const py = m.y * h;
        const alpha = Math.min(0.9, m.a * bright);
        ctx.beginPath();
        ctx.arc(px, py, m.r, 0, Math.PI * 2);
        ctx.fillStyle = m.warm ? `rgba(255,150,195,${alpha})` : `rgba(240,234,222,${alpha * 0.8})`;
        ctx.shadowColor = m.warm ? "rgba(255,111,165,0.6)" : "transparent";
        ctx.shadowBlur = m.warm ? 4 + intensity * 4 : 0;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="dotfield" />;
}
