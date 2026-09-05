import React from "react";
import type { ToolActivity } from "../../shared/types";
import {
  ISearch, IGraph, ISpark, IImage,
} from "./icons";

function glyphFor(name: string) {
  if (name.startsWith("graph")) return <IGraph size={15} />;
  if (name.includes("username") || name.includes("search") || name.includes("dns") || name.includes("whois") || name.includes("probe")) return <ISearch size={14} />;
  if (name.includes("image") || name.includes("exif")) return <IImage size={14} />;
  return <ISpark size={14} />;
}

export function ToolCard({ tool }: { tool: ToolActivity }) {
  return (
    <div className={`tool-card ${tool.status}`}>
      <div className="glyph" style={{ color: tool.status === "ok" ? "var(--success)" : tool.status === "error" ? "var(--danger)" : "var(--accent)" }}>
        {glyphFor(tool.name)}
      </div>
      <div className="body">
        <div className="tt">{tool.title}</div>
        {tool.detail && tool.status !== "running" && <div className="td">{tool.detail}</div>}
      </div>
      <div className="status-ic">
        {tool.status === "running" && <div className="spinner" />}
        {tool.status === "ok" && <svg className="check" width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
        {tool.status === "error" && <svg className="cross" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>}
      </div>
    </div>
  );
}
