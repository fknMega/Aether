import React from "react";
import { useStore } from "../state/store";
import { IChat, IGraph, ISettings, IDiscord, IHeart } from "./icons";

export function TitleBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const busy = useStore((s) => !!s.stream);
  const owner = useStore((s) => s.settings?.ownerName ?? "");
  const auth = useStore((s) => s.auth);

  return (
    <div className="titlebar">
      <div className="brand"><span className={`mark${busy ? " busy" : ""}`} /><span className="name">Aether</span></div>
      <div className="seg">
        <button className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}><IChat size={14} />Chat</button>
        <button className={view === "graph" ? "active" : ""} onClick={() => setView("graph")}><IGraph size={14} />Graph</button>
      </div>
      <div className="spacer" />
      <div className="owner-chip">
        <span className={`dot-status ${auth?.loggedIn ? "ok" : "bad"}`} />
        {auth?.loggedIn ? (owner ? `for ${owner}` : "signed in") : "not signed in"}
      </div>
      <button className="icon-btn sponsor" title="Sponsor Aether" onClick={() => window.open("https://github.com/sponsors/fknMega")}><IHeart size={16} /></button>
      <button className="icon-btn discord" title="Join the Discord" onClick={() => window.open("https://discord.gg/zjawxkDZVP")}><IDiscord size={17} /></button>
      <button className={`icon-btn${view === "settings" ? " active" : ""}`} title="Settings" onClick={() => setView("settings")}><ISettings size={17} /></button>
    </div>
  );
}
