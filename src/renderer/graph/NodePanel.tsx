import React from "react";
import type { CaseGraph } from "../../shared/types";
import { colorForType, STATUS_LABEL } from "../lib/graphColors";
import { IClose } from "../components/icons";

export function NodePanel({ graph, nodeKey, onClose, onSelect }: { graph: CaseGraph; nodeKey: string; onClose: () => void; onSelect: (k: string) => void; }) {
  const node = graph.nodes.find((n) => n.key === nodeKey);
  if (!node) return null;
  const color = colorForType(node.type);
  const links = graph.edges.filter((e) => e.source === nodeKey || e.target === nodeKey)
    .map((e) => ({ other: e.source === nodeKey ? e.target : e.source, label: e.label }));
  const portrait = node.type === "photo" || node.type === "person" || node.type === "target";

  return (
    <div className="node-panel glass">
      <button className="icon-btn close" onClick={onClose}><IClose size={15} /></button>
      {node.image && (
        <div className="node-hero">
          <img
            src={node.image}
            alt=""
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            style={{
              width: portrait ? "100%" : 56,
              height: portrait ? 176 : 56,
              objectFit: "cover",
              borderRadius: 12,
              border: `1px solid ${color}55`,
              background: `${color}14`,
            }}
          />
        </div>
      )}
      <span className="type-tag" style={{ background: `${color}22`, color }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />{node.type}
      </span>
      <h3>{node.label}</h3>
      {node.value && node.value !== node.label && <div className="val">{node.value}</div>}

      <div className="kv"><div className="k">Status</div><div className="v"><StatusBadge status={node.status} /></div></div>
      {node.confidence && <div className="kv"><div className="k">Confidence</div><div className="v" style={{ textTransform: "capitalize" }}>{node.confidence}</div></div>}
      {node.notes && <div className="kv"><div className="k">Notes</div><div className="v">{node.notes}</div></div>}
      {node.source && <div className="kv"><div className="k">Source</div><div className="v mono">{node.source}</div></div>}
      {links.length > 0 && (
        <div className="kv">
          <div className="k">Linked to ({links.length})</div>
          <div className="v">
            {links.map((l, i) => (
              <div key={i} style={{ margin: "6px 0", cursor: "pointer" }} onClick={() => onSelect(l.other)}>
                <span style={{ color: "var(--ember)", fontFamily: "var(--font-mono)", fontSize: 12 }}>→ {l.other}</span>
                {l.label && <span style={{ color: "var(--ink-3)" }}> · {l.label}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}
