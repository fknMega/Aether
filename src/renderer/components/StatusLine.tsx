import React from "react";
import { useStore } from "../state/store";
import { RINGS } from "../lib/graphColors";
import { StatusGlyph } from "./icons";

// ─────────────────────────────────────────────────────────────────────────────
// The status line: where you are, what the marks mean, what the keys do.
//
// The legend is generated from RINGS, the same table the canvas renderer draws
// from, so the key on screen cannot drift from the rings being painted. The
// hints list only keys that are actually bound — a status line that advertises
// a shortcut nobody wired is worse than no status line.
// ─────────────────────────────────────────────────────────────────────────────

/** The line is a fixed 22px with no room to wrap, and nothing in the stylesheet
 *  truncates it, so a long case name is clipped here rather than shoving the
 *  key hints off the right edge. */
function clip(s: string, max = 44): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function StatusLine() {
  const view = useStore((s) => s.view);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeId);
  const cases = useStore((s) => s.cases);
  const activeCaseId = useStore((s) => s.activeCaseId);

  let where = "Settings";
  if (view === "chat") {
    where = conversations.find((c) => c.id === activeId)?.title ?? "New conversation";
  } else if (view === "graph") {
    where = cases.find((c) => c.id === activeCaseId)?.name ?? "No case open";
  }

  // j/k walk the rail, Enter opens the focused row; in Chat the composer takes
  // Enter to send. Both are bound; nothing else is claimed.
  const keys =
    view === "chat" ? ["j/k rail", "Enter send"] :
    view === "graph" ? ["j/k rail", "Enter open"] : [];

  return (
    <div className="statusline">
      <span title={where}>{clip(where)}</span>

      {/* The separator belongs to the legend: `.keys` is pushed to the far right
          by margin-left:auto, so a separator drawn for it dangles mid-line. */}
      {view === "graph" && (
        <>
          <span className="sep">·</span>
          <div className="legend">
            {RINGS.map((r) => (
              <span key={r.status} className={`lg${r.status === "candidate" ? " candidate" : ""}`}>
                <StatusGlyph status={r.status} size={12} />{r.label}
              </span>
            ))}
          </div>
        </>
      )}

      {keys.length > 0 && (
        <div className="keys">
          {keys.map((k, i) => (
            <React.Fragment key={k}>
              {i > 0 && <span className="sep"> · </span>}
              {k}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
