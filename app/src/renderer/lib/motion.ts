// ─────────────────────────────────────────────────────────────────────────────
// One shared reduced-motion subscription.
//
// CSS covers the stylesheet, but the canvas renderer has to make its own
// decisions (skip the write-ring, pre-settle the layout instead of animating
// physics). Both React and the canvas read this module, so the OS setting takes
// effect immediately instead of at the next app launch.
// ─────────────────────────────────────────────────────────────────────────────

const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const listeners = new Set<(reduced: boolean) => void>();

let reduced = mql?.matches ?? false;

/** Whether the user has asked for reduced motion, right now. */
export const prefersReducedMotion = (): boolean => reduced;

/** Subscribe to changes. Fires immediately with the current value. */
export function onMotionChange(fn: (reduced: boolean) => void): () => void {
  listeners.add(fn);
  fn(reduced);
  return () => { listeners.delete(fn); };
}

mql?.addEventListener?.("change", (e) => {
  reduced = e.matches;
  for (const fn of listeners) fn(reduced);
});
