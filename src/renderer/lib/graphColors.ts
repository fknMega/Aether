/** Node colour by selector type — one archival-ink tonal family so the graph
 *  reads as ink on paper, not neon. The TARGET (and a person) is the one ember
 *  node — the lit subject; everyone else is a muted, mid-luminance ink, distinct
 *  enough in hue to tell types apart but never decorative. Kept in one place so
 *  the legend, the canvas and the detail panel always agree. */
export const NODE_COLORS: Record<string, string> = {
  target: "#ff6fa5", person: "#ff6fa5",         // the lit subject
  name: "#b0857e",                               // rose-brown, person-adjacent
  email: "#7e90ae",                              // slate
  phone: "#7fa0a2",                              // steel-teal
  username: "#94a97e",                           // sage
  photo: "#c08f63",                              // clay
  account: "#8e8cb4", service: "#8e8cb4",        // periwinkle
  employer: "#a88fb0",                           // mauve
  address: "#b0857e", location: "#b0857e",       // rose-brown
  breach: "#bc6a50",                             // rust
  domain: "#6e9b90", host: "#6e9b90",            // verdigris
  document: "#a7a08c",                           // stone
  note: "#8a857a",                               // ink
};
export const colorForType = (t: string): string => NODE_COLORS[t?.toLowerCase()] ?? "#8a857a";

export const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", searched: "Searched", confirmed: "Confirmed", candidate: "Candidate", dead: "Excluded",
};
