import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { ForceGraph, type GraphHandle } from "./ForceGraph";
import { NodePanel } from "./NodePanel";
import { ISearch, IZoomIn, IZoomOut, IFit } from "../components/icons";

export function GraphView() {
  const cases = useStore((s) => s.cases);
  const activeCaseId = useStore((s) => s.activeCaseId);
  const graph = useStore((s) => s.graph);
  const selectCase = useStore((s) => s.selectCase);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [camK, setCamK] = useState(1);
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

  const hasNodes = !!graph && graph.nodes.length > 0;

  return (
    <div className="graph-view">
      <div className="gtoolbar">
        <div className="gsearch">
          <ISearch />
          <input
            placeholder="Search nodes"
            aria-label="Search nodes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={!hasNodes}
          />
        </div>

        {graph && (
          <div className="gmeta">
            <span className="nm" title={graph.case.name}>{graph.case.name}</span>
            <span className="long">{graph.case.nodeCount} nodes</span>
            <span className="long">{graph.case.edgeCount} links</span>
            {graph.case.pendingCount > 0 && <span className="open">{graph.case.pendingCount} open</span>}
          </div>
        )}

        <span className="spacer" />

        <div className="zoom">
          <button className="icon-btn" aria-label="Zoom out" title="Zoom out"
            disabled={!hasNodes} onClick={() => fgRef.current?.zoomBy(0.8)}><IZoomOut /></button>
          <button className="icon-btn" aria-label="Zoom in" title="Zoom in"
            disabled={!hasNodes} onClick={() => fgRef.current?.zoomBy(1.25)}><IZoomIn /></button>
          <button className="icon-btn" aria-label="Fit to view" title="Fit to view"
            disabled={!hasNodes} onClick={() => fgRef.current?.fit()}><IFit /></button>
          <span className="k">{camK.toFixed(2)}x</span>
        </div>
      </div>

      <div className="graph-stage">
        {graph && <ForceGraph ref={fgRef} graph={graph} search={search} selectedKey={selected} onSelect={setSelected} onCamera={setCamK} />}

        {!cases.length && (
          <div className="graph-empty">
            <div className="empty-card">
              <h1>No case open</h1>
              <div className="empty-rule" />
              <p>Aether opens a case the moment an investigation starts. Name a target in Chat and the graph builds here.</p>
            </div>
          </div>
        )}

        {!!cases.length && !hasNodes && (
          <div className="graph-empty">
            <div className="empty-card">
              <h1>Nothing on the graph yet</h1>
              <div className="empty-rule" />
              <p>Nodes and links appear here as the investigation runs. Ask for a lookup in Chat and watch this fill in.</p>
            </div>
          </div>
        )}

        {graph && selected && (
          <NodePanel graph={graph} nodeKey={selected} onClose={() => setSelected(null)} onSelect={setSelected} />
        )}
      </div>
    </div>
  );
}
