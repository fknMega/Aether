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
import { Setup } from "./Setup";
import { PermissionPrompt } from "./PermissionPrompt";

/** The only values the stylesheet has titlebar insets for. Stamping the raw
 *  value put `data-platform="undefined"` on <html> wherever the bridge does not
 *  report one, which falls through to the macOS rule and reserves 84px for
 *  traffic lights that are never drawn — so an unknown host is treated as the
 *  chrome-less layout instead. */
const PLATFORMS = new Set(["darwin", "win32", "linux"]);

export function App() {
  const view = useStore((s) => s.view);
  const settings = useStore((s) => s.settings);
  const auth = useStore((s) => s.auth);
  const providerStatus = useStore((s) => s.providerStatus);
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
  const handleInstallProgress = useStore((s) => s.handleInstallProgress);
  const pushPermission = useStore((s) => s.pushPermission);

  useEffect(() => {
    const platform = window.aether.platform;
    document.documentElement.dataset.platform = PLATFORMS.has(platform) ? platform : "linux";
    void init();
    const off1 = window.aether.onChatEvent((env) => handleChatEvent(env));
    const off2 = window.aether.onGraphChanged(() => { void refreshCases(); void refreshActiveGraph(); });
    const off3 = window.aether.onConversationsChanged(() => { void refreshConversations(); void reloadActiveMessages(); });
    const off4 = window.aether.onModulesChanged(() => { void refreshModules(); });
    const off5 = window.aether.onUpdateStatus((st) => setUpdateStatus(st));
    const off6 = window.aether.onInstallProgress((p) => handleInstallProgress(p));
    const off7 = window.aether.onPermissionRequest((req) => pushPermission(req));
    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off7(); };
  }, []);

  // Settings load asynchronously; until they arrive the OS appearance wins.
  useEffect(() => { applyThemePref(theme ?? "system"); }, [theme]);

  // Is the CHOSEN provider actually reachable? Claude needs a login, OpenAI a
  // stored key, Gemini a Google sign-in, Ollama a running server with a model.
  // The old gate only ever checked Claude, so a Gemini or Ollama user was shown
  // a "sign in to Claude" wall they could not clear.
  const provider = settings?.provider ?? "claude";
  // Only a status that belongs to the CHOSEN provider counts — the store holds
  // the last one fetched, which for a moment after a switch is the old one's.
  const live = providerStatus?.provider === provider ? providerStatus : null;
  const known = provider === "claude" ? auth != null : live != null;
  const providerReady =
    provider === "claude" ? !!auth?.loggedIn
    : provider === "ollama" ? (live?.models?.length ?? 0) > 0
    : !!live?.hasKey;
  // Onboarding is "done" once a provider is reachable or the user skipped it —
  // that, not a Claude login specifically, is what should reveal the tool setup.
  const onboarded = providerReady || dismissedAuthGate;

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
      {/* Never over Settings: that pane holds the full connect UI, and a
          provider switched there must not be covered by the welcome wall. */}
      {known && !providerReady && !dismissedAuthGate && view !== "settings" && <Onboarding />}
      {/* Connecting a provider comes first; tool setup is the next thing. */}
      <PermissionPrompt />
      {settings && !settings.setupDone && onboarded && <Setup />}
    </div>
  );
}
