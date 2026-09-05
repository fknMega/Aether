import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { ForceGraph, type GraphHandle } from "./ForceGraph";
import { NodePanel } from "./NodePanel";
import { colorForType } from "../lib/graphColors";
import { ISearch, IZoomIn, IZoomOut, IFit, IGraph } from "../components/icons";

const LEGEND_TYPES = [
  ["target", "Target / person"], ["email", "Email"], ["phone", "Phone"],
  ["username", "Username"], ["account", "Account"], ["domain", "Domain / host"],
  ["breach", "Breach"], ["photo", "Photo"], ["location", "Location"],
] as const;

export function GraphView() {
  const cases = useStore((s) => s.cases);
  const activeCaseId = useStore((s) => s.activeCaseId);
  const graph = useStore((s) => s.graph);
  const selectCase = useStore((s) => s.selectCase);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const fgRef = useRef<GraphHandle>(null);

  // Auto-open the most recent case when entering the view with nothing selected.
  useEffect(() => {
    if (!activeCaseId && cases.length) void selectCase(cases[0].id);
  }, [activeCaseId, cases]);

  useEffect(() => { setSelected(null); }, [activeCaseId]);

  // Dev-only (preview mock): lets the screenshot tool open a node's panel by key.
  useEffect(() => {
    const w = window as unknown as { __aetherMock?: boolean; __selectNode?: (k: string | null) => void };
    if (!w.__aetherMock) return;
    w.__selectNode = (k) => setSelected(k);
    return () => { delete w.__selectNode; };
  }, []);

  // Frame the graph a beat after a case is opened, once the layout has spread.
  // Keyed on case id only, so live updates to the open case don't refit.
  useEffect(() => {
    if (!graph) return;
    const t = setTimeout(() => fgRef.current?.fit(), 750);
    return () => clearTimeout(t);
  }, [graph?.case.id]);

  if (!cases.length) {
    return (
      <div className="graph-view">
        <div className="graph-empty">
          <div className="welcome-card" style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 26 }}>No case open yet</h1>
            <div className="rule" />
            <p className="muted" style={{ maxWidth: 380 }}>Aether opens a case file the moment an investigation starts. Give her a target in Chat and watch the graph build here.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-view">
      {graph && <ForceGraph ref={fgRef} graph={graph} search={search} selectedKey={selected} onSelect={setSelected} />}

      <div className="graph-hud">
        <div className="hud-search glass">
          <ISearch size={15} />
          <input placeholder="Search nodes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {graph && (
          <div className="hud-title glass">
            <IGraph size={15} />
            <span className="nm">{graph.case.name}</span>
            <span className="meta">
              <span>{graph.case.nodeCount} nodes</span>
              <span>{graph.case.edgeCount} links</span>
              {graph.case.pendingCount > 0 && <span style={{ color: "var(--amber)" }}>{graph.case.pendingCount} open</span>}
            </span>
          </div>
        )}
        <div className="hud-spacer" />
      </div>

      <div className="legend glass">
        <h4>Node type</h4>
        {LEGEND_TYPES.map(([type, label]) => (
          <div className="lg" key={type}><span className="sw" style={{ backgroundColor: colorForType(type) }} />{label}</div>
        ))}
        <div className="rings">
          <span className="ring-key"><Ring color="#f4efe6" /> confirmed</span>
          <span className="ring-key"><Ring color="#e9a94a" /> pending</span>
          <span className="ring-key"><Ring color="#8c8676" dash /> candidate</span>
        </div>
      </div>

      <div className="zoom-ctl glass">
        <button className="icon-btn" title="Zoom in" onClick={() => fgRef.current?.zoomBy(1.25)}><IZoomIn /></button>
        <button className="icon-btn" title="Zoom out" onClick={() => fgRef.current?.zoomBy(0.8)}><IZoomOut /></button>
        <button className="icon-btn" title="Fit to view" onClick={() => fgRef.current?.fit()}><IFit /></button>
      </div>

      {graph && selected && <NodePanel graph={graph} nodeKey={selected} onClose={() => setSelected(null)} onSelect={setSelected} />}
    </div>
  );
}

function Ring({ color, dash }: { color: string; dash?: boolean }) {
  return <span style={{ width: 10, height: 10, borderRadius: "50%", border: `1.5px ${dash ? "dashed" : "solid"} ${color}`, display: "inline-block" }} />;
}
