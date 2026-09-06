import React from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Every mark in the chrome is drawn here as SVG — never as a Unicode codepoint.
// The status alphabet (●◐○·⊘) has no coverage in Consolas, so on stock Windows
// each glyph would fall back to a different face with a different advance width
// and break the fixed 20px gutter column that the whole layout is built on.
//
// One geometry: 16×16 viewBox, 1.5 stroke, ROUND caps and joins — rounded
// terminals are most of what separates a native-feeling glyph from a technical
// drawing. No fill unless stated.
// ─────────────────────────────────────────────────────────────────────────────

type P = { size?: number; className?: string };

const S = (size: number, children: React.ReactNode, className?: string, sw = 1.5) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className}
    aria-hidden="true" focusable="false">{children}</svg>
);

// ── the status alphabet ──────────────────────────────────────────────────────
// The same five marks appear in the rail, the inspector, the status-line legend
// and (as ring treatments) on the canvas.

/** Confirmed — a filled disc. */
export const IStConfirmed = ({ size = 14, className }: P) =>
  S(size, <circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none" />, className);

/** Open lead — a ring broken at 12 o'clock. An open lead is an open ring. */
export const IStPending = ({ size = 14, className }: P) =>
  S(size, <path d="M9.75 4.97a3.5 3.5 0 1 1-3.5 0" />, className, 1.5);

/** Candidate — a dashed ring. Paired with italic type wherever it appears. */
export const IStCandidate = ({ size = 14, className }: P) =>
  S(size, <circle cx="8" cy="8" r="3.5" strokeDasharray="2 3" />, className);

/** Searched — a small filled dot. Looked at, nothing found. */
export const IStSearched = ({ size = 14, className }: P) =>
  S(size, <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />, className);

/** Excluded — a ring with a chord struck through it. */
export const IStExcluded = ({ size = 14, className }: P) =>
  S(size, <><circle cx="8" cy="8" r="3.5" strokeWidth={1} /><path d="M5.5 10.5 10.5 5.5" /></>, className);

// ── process marks ────────────────────────────────────────────────────────────

/** Tool running — an 8-spoke asterisk, rotated in steps(8) at 1s. */
export const IWork = ({ size = 14, className }: P) =>
  S(size, <><path d="M8 4v8M4 8h8M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6" /></>, className);

/** Tool succeeded. Deliberately not green — --ok is reserved for auth state. */
export const ICheck = ({ size = 14, className }: P) =>
  S(size, <path d="M4 8.4 6.8 11 12 5.4" />, className, 1.5);

/** Tool failed. */
export const IFail = ({ size = 14, className }: P) =>
  S(size, <path d="M5 5l6 6M11 5l-6 6" />, className, 1.5);

/** The composer's prompt. */
export const IPrompt = ({ size = 14, className }: P) =>
  S(size, <path d="M6 4.5 9.5 8 6 11.5" />, className, 1.5);

// ── chrome ───────────────────────────────────────────────────────────────────

export const IChat = ({ size = 14, className }: P) =>
  S(size, <path d="M2.5 3.5h11v8h-7l-4 3z" />, className);

export const IGraph = ({ size = 14, className }: P) =>
  S(size, <><circle cx="4" cy="4" r="1.6" /><circle cx="12.5" cy="5" r="1.6" /><circle cx="8" cy="9.5" r="1.8" /><circle cx="3.5" cy="12.5" r="1.6" /><path d="M5.3 5 6.8 8.2M11.1 6.1 9.3 8.3M6.9 10.7 4.8 11.6" /></>, className);

export const ISettings = ({ size = 14, className }: P) =>
  S(size, <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" /></>, className);

export const IPlus = ({ size = 14, className }: P) => S(size, <path d="M8 3.5v9M3.5 8h9" />, className);
export const IClose = ({ size = 14, className }: P) => S(size, <path d="M4 4l8 8M12 4l-8 8" />, className);
export const ITrash = ({ size = 13, className }: P) =>
  S(size, <><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5v9h8v-9" /></>, className);
export const IEdit = ({ size = 13, className }: P) =>
  S(size, <path d="M9.5 3.5 12.5 6.5 5.5 13.5H2.5v-3z" />, className);
export const ISearch = ({ size = 14, className }: P) =>
  S(size, <><circle cx="7" cy="7" r="4.2" /><path d="m13.5 13.5-3.2-3.2" /></>, className);
export const IImage = ({ size = 14, className }: P) =>
  S(size, <><rect x="2.5" y="3.5" width="11" height="9" /><path d="m2.5 10 3-3 2.5 2.5L11 6.5l2.5 2.5" /></>, className);
export const IZoomIn = ({ size = 14, className }: P) =>
  S(size, <><circle cx="7" cy="7" r="4.2" /><path d="M7 5v4M5 7h4M13.5 13.5l-3.2-3.2" /></>, className);
export const IZoomOut = ({ size = 14, className }: P) =>
  S(size, <><circle cx="7" cy="7" r="4.2" /><path d="M5 7h4M13.5 13.5l-3.2-3.2" /></>, className);
export const IFit = ({ size = 14, className }: P) =>
  S(size, <path d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3" />, className);
/** Send — the upward arrow of a message field, not a paper plane. */
export const ISend = ({ size = 16, className }: P) =>
  S(size, <path d="M8 12.5v-9M4.2 7.3 8 3.5l3.8 3.8" />, className, 1.9);
export const IStop = ({ size = 12, className }: P) =>
  S(size, <rect x="4" y="4" width="8" height="8" fill="currentColor" stroke="none" />, className);
export const ISpark = ({ size = 14, className }: P) =>
  S(size, <path d="M8 3v10M3 8h10" />, className);
export const IKey = ({ size = 13, className }: P) =>
  S(size, <><circle cx="5" cy="8" r="2.4" /><path d="M7.4 8h6M11.5 8v2.2" /></>, className);

/** Install — a download arrow. */
export const IDownload = ({ size = 14, className }: P) =>
  S(size, <path d="M8 3v7.5M4.8 7.6 8 10.8l3.2-3.2M3.5 13h9" />, className, 1.5);

/** Needs attention — the tool exists but Aether cannot install it here. */
export const IWarn = ({ size = 14, className }: P) =>
  S(size, <><path d="M8 3.2 14 13H2z" /><path d="M8 6.8v2.6M8 11.2v.1" /></>, className, 1.4);

/** Copy to clipboard. */
export const ICopy = ({ size = 13, className }: P) =>
  S(size, <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>, className, 1.3);

export const IDiscord = ({ size = 14, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
    <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
  </svg>
);

export const IHeart = ({ size = 14, className }: P) =>
  S(size, <path d="M8 13.5 2.8 8.3a3.1 3.1 0 1 1 4.4-4.4l.8.8.8-.8a3.1 3.1 0 1 1 4.4 4.4z" />, className);

/** The status glyph for a node/case status, from the one status alphabet. */
export function StatusGlyph({ status, size = 14 }: { status: string; size?: number }) {
  switch (status) {
    case "confirmed": return <IStConfirmed size={size} />;
    case "pending":   return <IStPending size={size} />;
    case "candidate": return <IStCandidate size={size} />;
    case "searched":  return <IStSearched size={size} />;
    case "dead":      return <IStExcluded size={size} />;
    default:          return <IStSearched size={size} />;
  }
}
