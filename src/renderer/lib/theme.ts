// ─────────────────────────────────────────────────────────────────────────────
// Theme resolution, and token access for the canvas.
//
// theme.css defines every colour twice — once on :root (light), once under
// :root[data-theme="dark"]. This module decides which is on <html>, and hands
// the canvas renderer (which cannot read CSS) the same values the DOM is using.
//
// getComputedStyle is expensive and must never be called from a draw loop, so
// the whole canvas palette is read once per theme into a flat object.
// ─────────────────────────────────────────────────────────────────────────────
import type { ThemePref } from "../../shared/types";

export type Resolved = "light" | "dark";

/** Every token the canvas renderer may ask for. All are solid 6-digit hex
 *  (or, for --graph-plate-a, a bare number) so they feed ctx directly with no
 *  alpha-compositing step. */
const CANVAS_TOKENS = [
  "--graph-field", "--graph-grid", "--graph-edge", "--graph-edge-active", "--edge-dim",
  "--graph-label", "--graph-label-2", "--graph-plate", "--graph-plate-a",
  "--node-fill", "--node-fill-2", "--node-dim", "--node-hollow", "--node-rim",
  "--node-stroke", "--node-strike",
  "--ring-confirmed", "--ring-candidate", "--ring-searched", "--ring-pending", "--ring-write",
  "--select-bracket", "--crosshair", "--label", "--accent", "--font-mono",
] as const;

const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
const listeners = new Set<(t: Resolved) => void>();

let pref: ThemePref = "system";
let resolved: Resolved = mql?.matches ? "dark" : "light";
let palette: Record<string, string> | null = null;

/** The theme actually being painted right now. */
export const currentTheme = (): Resolved => resolved;

/** Subscribe to theme flips. Fires immediately. Returns an unsubscribe. */
export function onThemeChange(fn: (t: Resolved) => void): () => void {
  listeners.add(fn);
  fn(resolved);
  return () => { listeners.delete(fn); };
}

function paint(next: Resolved): void {
  const already = document.documentElement.dataset.theme === next;
  if (next === resolved && already) return;
  resolved = next;
  document.documentElement.dataset.theme = next;
  palette = null;                       // values changed under us
  for (const fn of listeners) fn(next);
}

/** Apply a preference. `system` tracks the OS from here on. */
export function applyThemePref(next: ThemePref): void {
  pref = next ?? "system";
  paint(pref === "system" ? (mql?.matches ? "dark" : "light") : pref);
}

mql?.addEventListener?.("change", (e) => {
  if (pref === "system") paint(e.matches ? "dark" : "light");
});

// Stamp the attribute at module load so the first frame is never unthemed.
document.documentElement.dataset.theme = resolved;

// ── canvas palette ───────────────────────────────────────────────────────────

/** Resolved value of a canvas token. Read once per theme, never in a draw loop. */
export function token(name: (typeof CANVAS_TOKENS)[number]): string {
  if (!palette) {
    const cs = getComputedStyle(document.documentElement);
    palette = Object.fromEntries(
      CANVAS_TOKENS.map((t) => [t, cs.getPropertyValue(t).trim()]),
    );
  }
  return palette[name] ?? "";
}

/** Drop the cached palette. Called on a theme flip before the next frame. */
export function invalidatePalette(): void { palette = null; }

/** ctx.font cannot resolve `ui-monospace` or other generic ui-* families, so
 *  the stack's generic tail is stripped for canvas use. */
export function canvasMonoStack(): string {
  const stack = token("--font-mono") || '"SF Mono", Menlo, Consolas, monospace';
  const kept = stack.split(",")
    .map((f) => f.trim())
    .filter((f) => !/^ui-/.test(f));
  if (!kept.some((f) => f === "monospace")) kept.push("monospace");
  return kept.join(", ");
}

/** Hex → rgb triple. Accepts #rgb, #rrggbb, #rrggbbaa. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{3,8}$/i.test(m)) return null;
  const full = m.length === 3 || m.length === 4 ? m.split("").map((c) => c + c).join("") : m;
  if (full.length < 6) return null;
  const n = parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A token colour with an alpha applied. Used for the write-ring fade only. */
export function withAlpha(hex: string, a: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})` : hex;
}
