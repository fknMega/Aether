import React from "react";
import type { ToolActivity } from "../../shared/types";
import { IWork, ICheck, IFail } from "./icons";

/** One line of the evidence chain. The gutter carries STATUS, not tool kind —
 *  the gutter column has exactly one job, and which tool ran is already spelled
 *  out in the label, where it can be read and cited. */
export function ToolCard({ tool, index }: { tool: ToolActivity; index: string }) {
  const state = tool.status === "running" ? " running" : tool.status === "error" ? " error" : "";
  const label = `${index} ${tool.name}`;

  return (
    <div className={`row xs tool-row${state}`}>
      <span className="gut">
        {tool.status === "running" ? <IWork size={12} />
          : tool.status === "error" ? <IFail size={12} />
          : <ICheck size={12} />}
      </span>
      <span className="lbl" title={tool.title || label}>{label}</span>
      <span className="lead" />
      {tool.detail && <span className="val" title={tool.detail}>{tool.detail}</span>}
    </div>
  );
}
