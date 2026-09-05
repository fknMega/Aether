import React, { useEffect } from "react";
import { useStore } from "../state/store";
import { DotField } from "./DotField";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { Chat } from "./Chat";
import { GraphView } from "../graph/GraphView";
import { Settings } from "./Settings";
import { Onboarding } from "./Onboarding";

export function App() {
  const view = useStore((s) => s.view);
  const auth = useStore((s) => s.auth);
  const dismissedAuthGate = useStore((s) => s.dismissedAuthGate);
  const init = useStore((s) => s.init);
  const handleChatEvent = useStore((s) => s.handleChatEvent);
  const refreshCases = useStore((s) => s.refreshCases);
  const refreshActiveGraph = useStore((s) => s.refreshActiveGraph);
  const refreshConversations = useStore((s) => s.refreshConversations);
  const reloadActiveMessages = useStore((s) => s.reloadActiveMessages);
  const refreshModules = useStore((s) => s.refreshModules);
  const setUpdateStatus = useStore((s) => s.setUpdateStatus);

  useEffect(() => {
    document.documentElement.dataset.platform = window.aether.platform;
    void init();
    const off1 = window.aether.onChatEvent((env) => handleChatEvent(env));
    const off2 = window.aether.onGraphChanged(() => { void refreshCases(); void refreshActiveGraph(); });
    const off3 = window.aether.onConversationsChanged(() => { void refreshConversations(); void reloadActiveMessages(); });
    const off4 = window.aether.onModulesChanged(() => { void refreshModules(); });
    const off5 = window.aether.onUpdateStatus((st) => setUpdateStatus(st));
    return () => { off1(); off2(); off3(); off4(); off5(); };
  }, []);

  const showRail = view === "chat" || view === "graph";

  return (
    <div className="app">
      <DotField />
      <TitleBar />
      <div className={`body${showRail ? "" : " no-rail"}`}>
        {showRail && <Sidebar />}
        {view === "chat" && <Chat />}
        {view === "graph" && <GraphView />}
        {view === "settings" && <Settings />}
      </div>
      {auth && !auth.loggedIn && !dismissedAuthGate && <Onboarding />}
    </div>
  );
}
