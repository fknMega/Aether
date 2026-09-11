import React, { useMemo, useState } from "react";
import { useStore } from "../state/store";
import type { ModuleConfig, ToolStatus } from "../../shared/types";
import { GROUPS, groupFor } from "../lib/moduleGroups";
import { InstallLog, InstallSummary } from "./ToolManager";
import {
  IEdit, ITrash, IKey, ISearch, IChevron, ICheck, IDownload, IWarn, ICopy, IStop,
} from "./icons";

// ─────────────────────────────────────────────────────────────────────────────
// The Modules pane.
//
// One list, grouped by the question each capability answers. The switch is the
// user's INTENT — "I want subdomain enumeration" — and installing is what
// Aether has to do to honour it, not a second decision on a second screen.
// Turning on a command module whose binary is missing installs it and then
// enables it, in one gesture.
//
// That is the whole fix: previously a bundled command module appeared twice,
// once with an Install button and once with a switch, two sections apart and
// neither aware of the other — so you could switch on a module whose program
// did not exist and get a tool that always failed.
// ─────────────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { builtin: "Built-in", command: "Command", http: "API", connector: "Your code" };

/** What stands between this module and a tool that actually works. */
type Readiness =
  | { state: "ready" }
  | { state: "busy"; note: string }
  | { state: "needs"; note: string; action?: "install" | "copy"; command?: string }
  | { state: "broke"; note: string }
  | { state: "paused"; note: string }
  | { state: "off" };

function readinessOf(m: ModuleConfig, tool: ToolStatus | undefined, canRunCommands: boolean): Readiness {
  const missingKey = (m.secrets ?? []).some((s) => !s.set);
  if (tool) {
    if (tool.state === "installing") return { state: "busy", note: "Installing…" };
    if (tool.state === "failed") return { state: "broke", note: tool.error ?? "Install failed." };
    if (tool.state === "unavailable") {
      return { state: "needs", note: tool.manual ? `Run this yourself: ${tool.manual}` : "Not installable here.", action: "copy", command: tool.manual };
    }
    if (tool.state === "missing") {
      return { state: "needs", note: tool.via ? `Not installed — turning this on runs ${tool.via}` : "Not installed.", action: "install" };
    }
  }
  if (missingKey) return { state: "needs", note: "Needs a key before it will run." };
  // Installed and keyed, but the shell is off, so a command module cannot run.
  if (m.kind === "command" && !canRunCommands) return { state: "paused", note: "Withheld at Safe access — switch to Ask or Full." };
  return m.enabled ? { state: "ready" } : { state: "off" };
}

function ReadyGlyph({ r }: { r: Readiness }) {
  switch (r.state) {
    case "ready":  return <ICheck size={15} />;
    case "busy":   return <IDownload size={15} />;
    case "needs":  return <IDownload size={15} />;
    case "broke":  return <IWarn size={15} />;
    case "paused": return <IWarn size={15} />;
    default:       return <span className="dot-status" />;
  }
}

function ModuleRow({
  m, tool, canRunCommands, onEdit,
}: { m: ModuleConfig; tool?: ToolStatus; canRunCommands: boolean; onEdit: (m: ModuleConfig) => void }) {
  const toggle = useStore((s) => s.toggleModule);
  const install = useStore((s) => s.installTool);
  const del = useStore((s) => s.deleteModule);
  const [copied, setCopied] = useState(false);

  const r = readinessOf(m, tool, canRunCommands);
  const keys = m.secrets?.length ?? 0;
  // Everything opens in the editor: custom modules fully, a connector or a
  // built-in for its name, description and the operator's notes to the model.
  const editable = true;
  const deletable = (m.kind === "command" || m.kind === "http") && !m.default;

  // The one gesture. Switching on something that is not installed installs it
  // first and only enables on success — so there is never an enabled module
  // whose program is missing.
  const onToggle = async () => {
    if (m.enabled) { void toggle(m.id, false); return; }
    if (tool && (tool.state === "missing" || tool.state === "failed")) {
      await install(m.id);
      const now = useStore.getState().tools.find((t) => t.moduleId === m.id);
      if (now?.state !== "installed") return;      // install failed: stay off, row shows why
    }
    void toggle(m.id, true);
  };

  const switchLabel =
    m.enabled ? `Disable ${m.name}`
    : r.state === "needs" && r.action === "install" ? `Install and enable ${m.name}`
    : `Enable ${m.name}`;

  return (
    <div className={`mod-row ${r.state}${!m.enabled && r.state !== "off" ? " off" : ""}`}>
      <span className="gut"><ReadyGlyph r={r} /></span>
      <div className="minfo">
        <div className="mtitle">
          {m.name}
          <span className="tag">{KIND_LABEL[m.kind] ?? m.kind}</span>
          {keys > 0 && <span className="tag strong" title={`${keys} key${keys === 1 ? "" : "s"} stored`}><IKey size={11} />{keys}</span>}
          {m.instructions?.trim() && <span className="tag" title={`Notes for Aether: ${m.instructions}`}>notes</span>}
        </div>
        <div className="mdesc" title={m.description}>{m.description}</div>
        {r.state !== "ready" && r.state !== "off" && (
          <div className={`mmeta${r.state === "broke" ? " bad" : r.state === "needs" || r.state === "paused" ? " warn" : ""}`} title={r.note}>
            {r.note}
          </div>
        )}
        {tool?.note && tool.state === "installed" && <div className="mmeta warn" title={tool.note}>{tool.note}</div>}
      </div>
      <div className="mod-acts">
        {r.state === "needs" && r.action === "copy" && r.command && (
          <button
            className="btn ghost sm"
            title={r.command}
            onClick={() => { void navigator.clipboard?.writeText(r.command!); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
          >
            <ICopy size={11} /> {copied ? "Copied" : "Copy"}
          </button>
        )}
        {r.state === "needs" && r.action === "install" && m.enabled && (
          <button className="btn primary sm" onClick={() => void install(m.id)}>Install</button>
        )}
        {r.state === "broke" && (
          <button className="btn ghost sm" onClick={() => void install(m.id)}>Retry</button>
        )}
        {r.state === "busy" && <span className="locked">installing</span>}
        {editable && (
          <>
            <button className="mini-btn" aria-label={`Edit ${m.name}`} title={m.kind === "connector" || m.kind === "builtin" ? "Notes and description" : "Edit"} onClick={() => onEdit(m)}><IEdit /></button>
            {deletable && <button className="mini-btn danger" aria-label={`Delete ${m.name}`} title="Delete" onClick={() => void del(m.id)}><ITrash /></button>}
          </>
        )}
        <button
          className={`switch${m.enabled ? " on" : ""}`}
          role="switch"
          aria-checked={m.enabled}
          aria-label={switchLabel}
          disabled={r.state === "busy"}
          onClick={() => void onToggle()}
        />
      </div>
    </div>
  );
}

export function ModulesPane({ onEdit, onAdd }: { onEdit: (m: ModuleConfig) => void; onAdd: () => void }) {
  const modules = useStore((s) => s.modules);
  const tools = useStore((s) => s.tools);
  // Only Safe withholds command modules outright; at Ask the prompt is the gate.
  const canRunCommands = useStore((s) => (s.settings?.access ?? "ask") !== "safe");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ custom: true });

  const toolBy = useMemo(() => new Map(tools.map((t) => [t.moduleId, t])), [tools]);

  const q = query.trim().toLowerCase();
  const matches = (m: ModuleConfig) =>
    !q || m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);

  const grouped = useMemo(() => {
    const by = new Map<string, ModuleConfig[]>();
    for (const m of modules) {
      if (!matches(m)) continue;
      const g = groupFor(m);
      (by.get(g) ?? by.set(g, []).get(g)!).push(m);
    }
    return by;
  }, [modules, q]);

  const total = modules.length;
  const ready = modules.filter((m) => readinessOf(m, toolBy.get(m.id), canRunCommands).state === "ready").length;

  return (
    <>
      <div className="field">
        <span className="flabel">Modules</span>
        <div className="desc">
          Everything Aether can reach for, grouped by the question it answers. The switch says you want a
          capability — if it needs a program installed, turning it on installs it first.
        </div>
      </div>

      <InstallSummary readyCount={ready} totalCount={total} />
      <InstallLog />

      <div className="gsearch wide">
        <ISearch size={14} />
        <input
          aria-label="Search modules"
          placeholder={`Search ${total} modules`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {GROUPS.map((g) => {
        const list = grouped.get(g.key);
        if (!list?.length) return null;
        // A search flattens the pane: every group with a hit opens, because
        // hiding matches behind a collapsed header is the opposite of searching.
        const expanded = q ? true : (open[g.key] ?? false);
        const on = list.filter((m) => m.enabled).length;
        const needs = list.filter((m) => {
          const st = readinessOf(m, toolBy.get(m.id), canRunCommands).state;
          return st === "needs" || st === "broke";
        }).length;

        return (
          <div className="group mod-group" key={g.key}>
            <button
              className="row group-head"
              aria-expanded={expanded}
              onClick={() => setOpen((o) => ({ ...o, [g.key]: !expanded }))}
            >
              <span className="gut"><IChevron size={14} className={expanded ? "chev-open" : undefined} /></span>
              <span className="lbl">{g.label}</span>
              <span className="lead" />
              <span className="val">
                {on} of {list.length} on
                {needs > 0 && <> <span className="sep">·</span> <span className="open">{needs} need setup</span></>}
              </span>
            </button>
            {expanded && list.map((m) => (
              <ModuleRow key={m.id} m={m} tool={toolBy.get(m.id)} canRunCommands={canRunCommands} onEdit={onEdit} />
            ))}
          </div>
        );
      })}

      {q && grouped.size === 0 && <div className="desc">No module matches “{query}”.</div>}

      <div className="sec">
        <span className="lead" />
        <button className="btn ghost sm" onClick={onAdd}>Add your own module</button>
      </div>
    </>
  );
}
