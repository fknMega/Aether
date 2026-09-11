// ─────────────────────────────────────────────────────────────────────────────
// The approval broker.
//
// At access level "ask", the permission policy stops mid-decision and waits for
// a human. This module is that wait: it hands a request to the renderer, parks
// the promise, and resolves it when the operator answers.
//
// Three properties it has to hold, because it sits directly on the security
// boundary:
//
//   · Fail closed. No window, no answer, a timeout, or a reply that does not
//     match a live request — all of those deny. An approval must be something
//     the operator actively did.
//   · Session-scoped grants only. "Allow all shell commands" lasts until the app
//     quits and is never written to disk. Persisting it would turn one click
//     into a permanent policy the operator would not remember making.
//   · Requests do not survive their turn. Cancelling a turn drops everything it
//     was waiting on, so an answer can never land against a stale question.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "node:crypto";
import type { PermissionRequest, PermissionReply } from "../shared/types";

type Pending = {
  resolve: (ok: boolean) => void;
  timer: NodeJS.Timeout;
  kind: PermissionRequest["kind"];
};

const pending = new Map<string, Pending>();

/** Kinds the operator chose to stop being asked about, for this session only. */
const sessionGrants = new Set<PermissionRequest["kind"]>();

/** How long a question stays open. A turn that waits forever looks like a hang,
 *  and an operator who walked away has not approved anything. */
const TIMEOUT_MS = 5 * 60_000;

let deliver: ((req: PermissionRequest) => void) | null = null;

/** Wire the broker to the renderer. Called once from registerIpc. */
export function setDelivery(fn: (req: PermissionRequest) => void): void {
  deliver = fn;
}

/** Ask the operator. Resolves true only on an explicit allow. */
export function requestPermission(req: Omit<PermissionRequest, "id">): Promise<boolean> {
  if (sessionGrants.has(req.kind)) return Promise.resolve(true);
  if (!deliver) return Promise.resolve(false);           // no surface, no approval

  const id = randomUUID();
  const full: PermissionRequest = { ...req, id };

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(false);
    }, TIMEOUT_MS);
    // Node keeps the process alive for a pending timer; this one must not.
    timer.unref?.();
    pending.set(id, { resolve, timer, kind: req.kind });
    try { deliver!(full); }
    catch { pending.delete(id); clearTimeout(timer); resolve(false); }
  });
}

/** The operator answered. Unknown ids are ignored rather than treated as a
 *  decision — a reply that matches nothing is not consent. */
export function resolvePermission(reply: PermissionReply): void {
  const p = pending.get(reply.id);
  if (!p) return;
  pending.delete(reply.id);
  clearTimeout(p.timer);
  const ok = reply.decision === "allow";
  if (ok && reply.remember) sessionGrants.add(p.kind);
  p.resolve(ok);
}

/** Drop every open question — on turn cancellation, or when the window closes.
 *  Everything waiting is denied, so nothing runs on a question nobody saw. */
export function cancelAllPermissions(): void {
  for (const [, p] of pending) { clearTimeout(p.timer); p.resolve(false); }
  pending.clear();
}

/** Forget the "don't ask again" grants — used when access level changes, so a
 *  grant made under one policy does not silently carry into another. */
export function clearSessionGrants(): void { sessionGrants.clear(); }

/** For the UI: which kinds are currently auto-allowed for this session. */
export const grantedKinds = (): PermissionRequest["kind"][] => [...sessionGrants];
