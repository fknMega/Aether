import React, { useEffect } from "react";
import { useStore } from "../state/store";
import { applyThemePref } from "../lib/theme";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { StatusLine } from "./StatusLine";
import { Chat } from "./Chat";
import { GraphView } from "../graph/GraphView";
import { Settings } from "./Settings";
import { Onboarding } from "./Onboarding";

/** The only values the stylesheet has titlebar insets for. Stamping the raw
 *  value put `data-platform="undefined"` on <html> wherever the bridge does not
 *  report one, which falls through to the macOS rule and reserves 84px for
 *  traffic lights that are never drawn — so an unknown host is treated as the
 *  chrome-less layout instead. */
const PLATFORMS = new Set(["darwin", "win32", "linux"]);

export function App() {
  const view = useStore((s) => s.view);
  const auth = useStore((s) => s.auth);
  const theme = useStore((s) => s.settings?.theme);
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
    const platform = window.aether.platform;
    document.documentElement.dataset.platform = PLATFORMS.has(platform) ? platform : "linux";
    void init();
    const off1 = window.aether.onChatEvent((env) => handleChatEvent(env));
    const off2 = window.aether.onGraphChanged(() => { void refreshCases(); void refreshActiveGraph(); });
    const off3 = window.aether.onConversationsChanged(() => { void refreshConversations(); void reloadActiveMessages(); });
    const off4 = window.aether.onModulesChanged(() => { void refreshModules(); });
    const off5 = window.aether.onUpdateStatus((st) => setUpdateStatus(st));
    return () => { off1(); off2(); off3(); off4(); off5(); };
  }, []);

  // Settings load asynchronously; until they arrive the OS appearance wins.
  useEffect(() => { applyThemePref(theme ?? "system"); }, [theme]);

  const showRail = view === "chat" || view === "graph";

  return (
    <div className="app">
      <TitleBar />
      <div className={`body${showRail ? "" : " no-rail"}`}>
        {showRail && <Sidebar />}
        {view === "chat" && <Chat />}
        {view === "graph" && <GraphView />}
        {view === "settings" && <Settings />}
      </div>
      <StatusLine />
      {auth && !auth.loggedIn && !dismissedAuthGate && <Onboarding />}
    </div>
  );
}
