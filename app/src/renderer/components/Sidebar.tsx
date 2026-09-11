import React, { useRef, useState } from "react";
import { useStore } from "../state/store";
import { ago } from "../lib/time";
import { IPlus, ITrash, IEdit, StatusGlyph } from "./icons";
import type { GraphCaseInfo } from "../../shared/types";

// ─────────────────────────────────────────────────────────────────────────────
// The rail: conversations in Chat, cases in Graph. Two lists, one row geometry.
//
// A row is a div carrying role="option" and a tabindex rather than a <button>:
// each row nests its own rename/delete controls, and a <button> inside a
// <button> is hoisted out by the HTML parser. The tabindex is what matters —
// the global :focus-visible rule covers [tabindex], so rows are keyboard
// reachable and ringed exactly as the old <div onClick> rows were not.
// ─────────────────────────────────────────────────────────────────────────────

export function Sidebar() {
  const view = useStore((s) => s.view);
  return view === "graph" ? <CaseRail /> : <ConversationRail />;
}

/** j/k and the arrows walk the options; Home/End jump. Roving focus only —
 *  moving does not select, so a stray keypress can't reload a conversation. */
function useListNav() {
  const listRef = useRef<HTMLDivElement>(null);

  const focusAt = (resolve: (i: number, last: number) => number) => {
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    if (!opts.length) return;
    const active = document.activeElement;
    const cur = opts.findIndex((o) => o === active || o.contains(active));
    const next = resolve(cur, opts.length - 1);
    opts[Math.max(0, Math.min(opts.length - 1, next))]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;   // a rename is in progress
    switch (e.key) {
      case "ArrowDown": case "j": e.preventDefault(); focusAt((i) => i + 1); break;
      case "ArrowUp": case "k": e.preventDefault(); focusAt((i) => (i < 0 ? 0 : i - 1)); break;
      case "Home": e.preventDefault(); focusAt(() => 0); break;
      case "End": e.preventDefault(); focusAt((_i, last) => last); break;
    }
  };

  return { listRef, onKeyDown };
}

/** Enter or Space on a focused row opens it, the way the button it cannot be
 *  would have. The target check is load-bearing: the row's rename/delete buttons
 *  are descendants, so without it Enter on Delete would also select the row and
 *  Space on it would be preventDefault-ed into a selection instead of a delete. */
const activateKeys = (run: () => void) => (e: React.KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); }
};

/** The roving tabstop. Falls back to the first row whenever the selection is
 *  empty or stale — an id that is no longer in the list would otherwise leave
 *  every row at tabIndex -1 and the whole rail unreachable by keyboard. */
const tabStop = <T,>(items: T[], isActive: (item: T) => boolean): number =>
  Math.max(0, items.findIndex(isActive));

function EmptyRail({ note }: { note: string }) {
  return (
    <>
      <div className="skeleton" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div className="row" key={i}><span className="gut" /><span className="lbl" /><span className="lead" /></div>
        ))}
      </div>
      <div className="empty-note">{note}</div>
    </>
  );
}

// ── conversations ────────────────────────────────────────────────────────────

function ConversationRail() {
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeId);
  const select = useStore((s) => s.selectConversation);
  const create = useStore((s) => s.newConversation);
  const rename = useStore((s) => s.renameConversation);
  const del = useStore((s) => s.deleteConversation);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const { listRef, onKeyDown } = useListNav();

  const commit = (id: string, fallback: string) => {
    const title = draft.trim() || fallback;
    if (title !== fallback) void rename(id, title);
    setEditing(null);
  };

  const stop = tabStop(conversations, (c) => c.id === activeId);

  return (
    <div className="rail">
      <div className="sec">
        <span>Conversations</span>
        <span className="lead" />
        <button className="icon-btn" aria-label="New conversation" title="New conversation" onClick={create}>
          <IPlus size={14} />
        </button>
      </div>

      <div className="rail-list">
        {conversations.length === 0 ? (
          <EmptyRail note="No conversations yet. Send a message to start one." />
        ) : (
          <div className="group" ref={listRef} role="listbox" aria-label="Conversations" onKeyDown={onKeyDown}>
            {conversations.map((c, i) => (
              editing === c.id ? (
                <div className="row" key={c.id}>
                  <span className="gut" />
                  <input
                    className="rename-input" autoFocus defaultValue={c.title} aria-label="Conversation name"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") commit(c.id, c.title);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onBlur={() => commit(c.id, c.title)}
                  />
                </div>
              ) : (
                <div
                  key={c.id} role="option" aria-selected={c.id === activeId}
                  tabIndex={i === stop ? 0 : -1}
                  className={`row${c.id === activeId ? " sel" : ""}`} title={c.title}
                  onClick={() => void select(c.id)} onKeyDown={activateKeys(() => void select(c.id))}
                >
                  <span className="gut" />
                  <span className="lbl">{c.title}</span>
                  <span className="lead" />
                  <span className="val">{ago(c.updatedAt)}</span>
                  <span className="row-actions">
                    <button
                      className="mini-btn" aria-label={`Rename ${c.title}`} title="Rename"
                      onClick={(e) => { e.stopPropagation(); setDraft(c.title); setEditing(c.id); }}
                    ><IEdit /></button>
                    <button
                      className="mini-btn danger" aria-label={`Delete ${c.title}`} title="Delete"
                      onClick={(e) => { e.stopPropagation(); void del(c.id); }}
                    ><ITrash /></button>
                  </span>
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── cases ────────────────────────────────────────────────────────────────────

/** A case wears the status of its most urgent node: an open lead outranks a
 *  confirmed finding, and a case with nothing in it yet is still a candidate. */
function caseStatus(c: GraphCaseInfo): string {
  if (c.pendingCount > 0) return "pending";
  return c.nodeCount > 0 ? "confirmed" : "candidate";
}

function CaseRail() {
  const cases = useStore((s) => s.cases);
  const activeCaseId = useStore((s) => s.activeCaseId);
  const select = useStore((s) => s.selectCase);
  const del = useStore((s) => s.deleteCase);
  const { listRef, onKeyDown } = useListNav();
  const stop = tabStop(cases, (c) => c.id === activeCaseId);

  return (
    <div className="rail">
      <div className="sec">
        <span>Cases</span>
        <span className="lead" />
      </div>

      <div className="rail-list">
        {cases.length === 0 ? (
          <EmptyRail note="No cases yet. Aether opens one as soon as an investigation starts." />
        ) : (
          <div className="group" ref={listRef} role="listbox" aria-label="Cases" onKeyDown={onKeyDown}>
            {cases.map((c, i) => (
              <div
                key={c.id} role="option" aria-selected={c.id === activeCaseId}
                tabIndex={i === stop ? 0 : -1}
                className={`row${c.id === activeCaseId ? " sel" : ""}`} title={c.name}
                onClick={() => void select(c.id)} onKeyDown={activateKeys(() => void select(c.id))}
              >
                <span className="gut"><StatusGlyph status={caseStatus(c)} size={13} /></span>
                <span className="lbl">{c.name}</span>
                <span className="lead" />
                <span className="val">
                  {c.nodeCount}n
                  {c.pendingCount > 0 && <> <span className="open">{c.pendingCount} open</span></>}
                </span>
                <span className="row-actions">
                  <button
                    className="mini-btn danger" aria-label={`Delete ${c.name}`} title="Delete case"
                    onClick={(e) => { e.stopPropagation(); void del(c.id); }}
                  ><ITrash /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
