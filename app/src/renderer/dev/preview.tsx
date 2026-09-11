// DEV-ONLY preview entry: install the mock bridge, then boot the real App.
import "./mock";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../components/App";
import "../theme.css";

const q = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(<App />);

// Allow ?view=graph / ?view=settings to preselect a screen after boot.
const view = q.get("view");
if (view === "graph" || view === "settings" || view === "chat") {
  import("../state/store").then(({ useStore }) => {
    // small delay so init() has populated cases/conversations
    setTimeout(() => {
      if (view === "graph") { const c = useStore.getState().cases[0]; if (c) void useStore.getState().selectCase(c.id); }
      else if (view === "settings") useStore.getState().setView("settings");
      if (view === "chat" && !q.get("empty")) { const id = useStore.getState().conversations[0]?.id; if (id) void useStore.getState().selectConversation(id); }
    }, 120);
  });
}
