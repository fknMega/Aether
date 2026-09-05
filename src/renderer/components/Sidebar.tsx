import React, { useState } from "react";
import { useStore } from "../state/store";
import { ago } from "../lib/time";
import { IPlus, ITrash, IEdit } from "./icons";

export function Sidebar() {
  const view = useStore((s) => s.view);
  return view === "graph" ? <CaseList /> : <ConversationList />;
}

function ConversationList() {
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeId);
  const select = useStore((s) => s.selectConversation);
  const create = useStore((s) => s.newConversation);
  const rename = useStore((s) => s.renameConversation);
  const del = useStore((s) => s.deleteConversation);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  return (
    <div className="sidebar">
      <div className="head">
        <h2>Conversations</h2>
        <button className="new-btn" onClick={create}><IPlus size={14} />New</button>
      </div>
      <div className="list">
        {conversations.length === 0 && <div className="empty-hint">No conversations yet.<br />Start one and Aether gets to work.</div>}
        {conversations.map((c) => (
          <div key={c.id} className={`list-item${c.id === activeId ? " active" : ""}`} onClick={() => select(c.id)}>
            {editing === c.id ? (
              <input autoFocus defaultValue={c.title} className="rename-input"
                style={{ width: "100%", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 8px", color: "var(--text)", fontSize: 13 }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { void rename(c.id, draft || c.title); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
                onBlur={() => { if (draft && draft !== c.title) void rename(c.id, draft); setEditing(null); }} />
            ) : (
              <>
                <div className="t">{c.title}</div>
                <div className="s">{ago(c.updatedAt)}</div>
                <div className="row-actions">
                  <button className="mini-btn" title="Rename" onClick={(e) => { e.stopPropagation(); setDraft(c.title); setEditing(c.id); }}><IEdit /></button>
                  <button className="mini-btn danger" title="Delete" onClick={(e) => { e.stopPropagation(); void del(c.id); }}><ITrash /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CaseList() {
  const cases = useStore((s) => s.cases);
  const activeCaseId = useStore((s) => s.activeCaseId);
  const select = useStore((s) => s.selectCase);
  const del = useStore((s) => s.deleteCase);

  return (
    <div className="sidebar">
      <div className="head"><h2>Cases</h2></div>
      <div className="list">
        {cases.length === 0 && <div className="empty-hint">No cases yet.<br />Aether opens a graph the moment an investigation starts.</div>}
        {cases.map((c) => (
          <div key={c.id} className={`list-item${c.id === activeCaseId ? " active" : ""}`} onClick={() => select(c.id)}>
            <div className="t">{c.name}</div>
            <div className="s">
              <span>{c.nodeCount} nodes · {c.edgeCount} links</span>
              {c.pendingCount > 0 && <span className="pending-pill">{c.pendingCount} open</span>}
            </div>
            <div className="row-actions">
              <button className="mini-btn danger" title="Delete case" onClick={(e) => { e.stopPropagation(); void del(c.id); }}><ITrash /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
