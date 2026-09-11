// ─────────────────────────────────────────────────────────────────────────────
// The graph's visual vocabulary, in one place.
//
// Node TYPE is carried by mark shape, not by hue — shape is pre-attentive and
// still reads at 8px, and it survives greyscale. Node STATUS is carried by ring
// treatment. Both the canvas draw functions and the on-screen legend map over
// these constants, so the legend can never disagree with what is drawn.
// ─────────────────────────────────────────────────────────────────────────────

export type MarkShape = "circle" | "square" | "diamond" | "triangle" | "hollow";

export interface MarkFamily {
  family: string;
  shape: MarkShape;
  label: string;
  types: readonly string[];
}

/** Five shape families covering every NODE_TYPE in shared/types.ts. */
export const MARKS: readonly MarkFamily[] = [
  { family: "identity", shape: "circle",   label: "Identity", types: ["target", "person", "name", "username", "account"] },
  { family: "infra",    shape: "square",   label: "Infrastructure", types: ["domain", "host", "service", "employer"] },
  { family: "artifact", shape: "diamond",  label: "Artifact", types: ["photo", "document", "breach"] },
  { family: "contact",  shape: "triangle", label: "Contact", types: ["email", "phone", "address", "location"] },
  { family: "note",     shape: "hollow",   label: "Note", types: ["note"] },
] as const;

const SHAPE_BY_TYPE: Record<string, MarkShape> = Object.fromEntries(
  MARKS.flatMap((m) => m.types.map((t) => [t, m.shape])),
);

/** Mark shape for a node type. Unknown types fall back to the hollow circle,
 *  which is the same mark `note` gets — an unrecognised selector is a note. */
export const shapeForType = (t: string): MarkShape =>
  SHAPE_BY_TYPE[(t ?? "").toLowerCase()] ?? "hollow";

export type RingStroke = "solid" | "open12" | "dash23" | "dot13" | "hatch";

export interface RingSpec {
  status: string;
  stroke: RingStroke;
  token: string;
  label: string;
}

/** Five statuses, five distinct treatments — all readable without colour.
 *  `pending` is literally an open ring; `excluded` is struck through. */
export const RINGS: readonly RingSpec[] = [
  { status: "confirmed", stroke: "solid",  token: "--ring-confirmed", label: "Confirmed" },
  { status: "pending",   stroke: "open12", token: "--ring-pending",   label: "Open lead" },
  { status: "candidate", stroke: "dash23", token: "--ring-candidate", label: "Candidate" },
  { status: "searched",  stroke: "dot13",  token: "--ring-searched",  label: "Searched" },
  { status: "dead",      stroke: "hatch",  token: "--node-strike",    label: "Excluded" },
] as const;

const RING_BY_STATUS: Record<string, RingSpec> = Object.fromEntries(RINGS.map((r) => [r.status, r]));

export const ringForStatus = (s: string): RingSpec | null => RING_BY_STATUS[(s ?? "").toLowerCase()] ?? null;

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(RINGS.map((r) => [r.status, r.label]));
