import React from "react";
import { useStore } from "../state/store";
import { IChat, IGraph, ISettings, IWork } from "./icons";

export function TitleBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const busy = useStore((s) => !!s.stream);
  const owner = useStore((s) => s.settings?.ownerName ?? "");
  const auth = useStore((s) => s.auth);

  const account = auth?.loggedIn
    ? (owner ? `Signed in as ${owner}` : "Signed in")
    : "Not signed in";

  return (
    <div className="titlebar">
      <div className="brand"><span className="mark" /><span className="name">Aether</span></div>

      <nav className="seg" aria-label="View">
        <button className={view === "chat" ? "active" : ""} aria-current={view === "chat" ? "page" : undefined} onClick={() => setView("chat")}>
          <IChat size={14} />Chat
        </button>
        <button className={view === "graph" ? "active" : ""} aria-current={view === "graph" ? "page" : undefined} onClick={() => setView("graph")}>
          <IGraph size={14} />Graph
        </button>
      </nav>

      <span className="title-lead" />

      <div className="title-state">
        {/* A state icon, not a live region: role="status" on an element whose only
            child is an aria-hidden SVG announces nothing on insertion. */}
        {busy
          ? <span className="title-work" role="img" aria-label="Working"><IWork size={12} /></span>
          : <span className="title-idle" aria-hidden="true" />}
        <span>{account}</span>
      </div>

      <button
        className={`icon-btn${view === "settings" ? " active" : ""}`}
        aria-label="Settings" title="Settings"
        onClick={() => setView("settings")}
      ><ISettings size={16} /></button>
    </div>
  );
}
