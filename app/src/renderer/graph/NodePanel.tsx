import React, { useState } from "react";
import type { CaseGraph } from "../../shared/types";
import { MARKS, STATUS_LABEL } from "../lib/graphColors";
import { IClose, StatusGlyph } from "../components/icons";

/** Mark-family label per node type, derived from MARKS so the inspector can
 *  never name a family the canvas doesn't draw. */
const FAMILY_LABEL: Record<string, string> = Object.fromEntries(
  MARKS.flatMap((m) => m.types.map((t) => [t, m.label])),
);

/** The node inspector — an opaque overlay on the right edge of the stage. */
export function NodePanel({ graph, nodeKey, onClose, onSelect }: { graph: CaseGraph; nodeKey: string; onClose: () => void; onSelect: (k: string) => void; }) {
  // Keyed by src, so moving to another node clears a previous node's failure
  // without an effect. `hidden` cannot do this job: `.insp-hero{display:block}`
  // is author-origin and outranks the UA sheet's `[hidden]{display:none}`.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);

  const node = graph.nodes.find((n) => n.key === nodeKey);
  if (!node) return null;

  const byKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const links = graph.edges
    .filter((e) => e.source === nodeKey || e.target === nodeKey)
    .map((e) => {
      const other = e.source === nodeKey ? e.target : e.source;
      const peer = byKey.get(other);
      // The canvas draws labels, so the inspector must too — a key like
      // `haveibeenpwned:adobe` is an identifier, not a name.
      return { key: other, label: peer?.label ?? other, edge: e.label, status: norm(peer?.status) };
    });

  // Faces and photos earn the tall plate; a favicon-shaped node gets the square.
  const tall = node.type === "target" || node.type === "person" || node.type === "photo";
  const family = FAMILY_LABEL[String(node.type).toLowerCase()] ?? "Note";
  const status = norm(node.status);
  const conf = node.confidence ? String(node.confidence).toLowerCase() : null;

  return (
    <div className="inspector">
      <div className="insp-head">
        <h3>{node.label}</h3>
        <button className="icon-btn" aria-label="Close inspector" title="Close" onClick={onClose}><IClose /></button>
      </div>

      {node.value && node.value !== node.label && <div className="insp-val">{node.value}</div>}

      {node.image && node.image !== brokenSrc && (
        <div className="kv">
          <img
            className={tall ? "insp-hero" : "insp-hero sq"}
            src={node.image}
            alt=""
            onError={() => setBrokenSrc(node.image)}
          />
        </div>
      )}

      <div className="kv">
        <div className="k">Type</div>
        <div className="v">{family} <span className="sep">/</span> {node.type}</div>
      </div>

      <div className="kv">
        <div className="k">Status</div>
        <div className="v"><StatusBadge status={status} /></div>
      </div>

      {conf && (
        <div className="kv">
          <div className="k">Confidence</div>
          {/* Roman = established, italic = provisional. */}
          <div className={conf === "low" ? "v low" : "v"}>{capitalize(conf)}</div>
        </div>
      )}

      {node.notes && (
        <div className="kv">
          <div className="k">Notes</div>
          <div className="v">{node.notes}</div>
        </div>
      )}

      {node.source && (
        <div className="kv">
          <div className="k">Source</div>
          <div className="v">{node.source}</div>
        </div>
      )}

      {links.length > 0 && (
        <div className="kv">
          <div className="k">Linked ({links.length})</div>
          <div role="listbox" aria-label="Linked nodes">
            {links.map((l, i) => (
              <button
                key={`${l.key}-${i}`}
                type="button"
                role="option"
                aria-selected={false}
                className="row sm link-row"
                title={l.edge ? `${l.label} (${l.edge})` : l.label}
                onClick={() => onSelect(l.key)}
              >
                <span className="gut"><StatusGlyph status={l.status} /></span>
                <span className="lbl">{l.label}</span>
                <span className="lead" />
                {l.edge && <span className="val">{l.edge}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Status arrives from the model as free text; the alphabet is lower-case. */
const norm = (s: unknown): string => String(s ?? "").toLowerCase();

const badgeClass = (status: string): string =>
  status === "pending" ? "badge pending" : status === "dead" ? "badge dead" : "badge";

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The one badge, shared by the inspector and any surface that needs it. */
export function StatusBadge({ status }: { status: string }) {
  const s = norm(status);
  return <span className={badgeClass(s)}>{STATUS_LABEL[s] ?? status}</span>;
}
