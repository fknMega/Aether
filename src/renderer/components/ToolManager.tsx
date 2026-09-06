import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { ToolStatus } from "../../shared/types";
import { ICheck, IDownload, IWarn, ICopy, IStop } from "./icons";

// ─────────────────────────────────────────────────────────────────────────────
// The install manager.
//
// Twenty-odd bundled modules wrap a command-line binary, and a module whose
// binary is missing is a tool that always fails. This is the one place that
// shows which are real, installs the rest, and — when Aether will not run the
// install itself, because it would need root — hands over the exact command
// instead of a shrug.
// ─────────────────────────────────────────────────────────────────────────────

function StateIcon({ state }: { state: ToolStatus["state"] }) {
  if (state === "installed") return <ICheck size={15} />;
  if (state === "installing") return <IDownload size={15} />;
  if (state === "unavailable") return <IWarn size={15} />;
  if (state === "failed") return <IWarn size={15} />;
  return <IDownload size={15} />;
}

/** Right-hand cell for one tool: where it is, or what it would take. */
function ToolAction({ tool, locked }: { tool: ToolStatus; locked: boolean }) {
  const install = useStore((s) => s.installTool);
  const cancel = useStore((s) => s.cancelInstall);
  const [copied, setCopied] = useState(false);

  if (tool.state === "installing") {
    return (
      <button className="btn ghost sm" onClick={() => void cancel(tool.moduleId)}>
        <IStop size={10} /> Stop
      </button>
    );
  }
  if (tool.state === "installed") {
    return <span className="val mono" title={tool.path}>{tool.path?.replace(/^.*\//, "") ?? "ready"}</span>;
  }
  if (tool.state === "unavailable" && tool.manual) {
    // Aether will not sudo. The honest move is to give the user the command.
    return (
      <button
        className="btn ghost sm"
        title={tool.manual}
        onClick={() => { void navigator.clipboard?.writeText(tool.manual!); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
      >
        <ICopy size={11} /> {copied ? "Copied" : "Copy command"}
      </button>
    );
  }
  // Package managers take repository locks; two concurrent installs is a
  // reliable way to wedge both. While a run is walking the catalog, the
  // per-tool buttons stand down.
  return (
    <button className="btn primary sm" disabled={locked} onClick={() => void install(tool.moduleId)}>
      Install
    </button>
  );
}

function ToolRow({ tool, locked }: { tool: ToolStatus; locked: boolean }) {
  const sub = tool.error
    ?? (tool.state === "installed" ? tool.path
      : tool.state === "unavailable" ? tool.manual
      : tool.via);
  return (
    <div className={`row tool-item ${tool.state}`}>
      <span className="gut"><StateIcon state={tool.state} /></span>
      <span className="tool-name">
        <span className="lbl mono">{tool.bin}</span>
        {sub && <span className="tool-sub" title={sub}>{sub}</span>}
      </span>
      <span className="lead" />
      <ToolAction tool={tool} locked={locked} />
    </div>
  );
}

/** Live output while something is installing. Collapsed to the last few lines —
 *  this is a progress indicator, not a terminal. */
function InstallLog() {
  const log = useStore((s) => s.installLog);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log.length]);
  if (!log.length) return null;
  return (
    <div className="install-log" ref={ref} role="log" aria-label="Installer output">
      {log.slice(-40).map((line, i) => <div key={i}>{line}</div>)}
    </div>
  );
}

export function ToolManager({ compact = false }: { compact?: boolean }) {
  const tools = useStore((s) => s.tools);
  const installingAll = useStore((s) => s.installingAll);
  const refresh = useStore((s) => s.refreshTools);
  const installAll = useStore((s) => s.installAllTools);
  const cancel = useStore((s) => s.cancelInstall);
  const [rechecking, setRechecking] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const counts = useMemo(() => ({
    installed: tools.filter((t) => t.state === "installed").length,
    missing: tools.filter((t) => t.state === "missing").length,
    blocked: tools.filter((t) => t.state === "unavailable").length,
    busy: tools.some((t) => t.state === "installing"),
  }), [tools]);

  // Missing first — the whole point of the screen is what still needs doing.
  const ordered = useMemo(() => {
    const rank: Record<ToolStatus["state"], number> = { installing: 0, missing: 1, failed: 2, unavailable: 3, installed: 4 };
    return [...tools].sort((a, b) => rank[a.state] - rank[b.state] || a.bin.localeCompare(b.bin));
  }, [tools]);

  const shown = compact && !showAll ? ordered.filter((t) => t.state !== "installed") : ordered;
  const busy = installingAll || counts.busy;

  const recheck = async () => { setRechecking(true); await refresh(); setRechecking(false); };

  if (!tools.length) {
    return <div className="desc">Checking which tools are installed…</div>;
  }

  return (
    <>
      <div className="tool-summary">
        <div className="grow">
          <div className="t">{counts.installed} of {tools.length} installed</div>
          <div className="s">
            {counts.missing > 0
              ? `${counts.missing} can be installed for you${counts.blocked ? `, ${counts.blocked} need a command you run yourself` : ""}.`
              : counts.blocked > 0
                ? `${counts.blocked} need a command you run yourself.`
                : "Every bundled tool is ready."}
          </div>
        </div>
        {busy
          ? <button className="btn ghost" onClick={() => void cancel()}><IStop size={11} /> Stop</button>
          : <button className="btn ghost sm" disabled={rechecking} onClick={() => void recheck()}>{rechecking ? "Checking…" : "Recheck"}</button>}
        {!busy && counts.missing > 0 && (
          <button className="btn primary" onClick={() => void installAll()}>
            Install {counts.missing} missing
          </button>
        )}
      </div>

      <InstallLog />

      <div className="mod-list tool-list">
        {shown.map((t) => <ToolRow key={t.moduleId} tool={t} locked={busy} />)}
      </div>

      {compact && counts.installed > 0 && (
        <button className="btn link" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Hide installed" : `Show ${counts.installed} already installed`}
        </button>
      )}
    </>
  );
}
