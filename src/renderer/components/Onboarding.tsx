import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";

export function Onboarding() {
  const refreshAuth = useStore((s) => s.refreshAuth);
  const dismiss = useStore((s) => s.dismissAuthGate);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const signIn = async () => {
    setBusy(true);
    const r = await window.aether.authLogin();
    if (mounted.current) setMsg(r.message);
    for (let i = 0; i < 40; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      if (!mounted.current) return;
      await refreshAuth();
      if (useStore.getState().auth?.loggedIn) return; // overlay unmounts itself
    }
    if (mounted.current) setBusy(false);
  };

  return (
    <div className="onboard">
      <div className="onboard-card fade-in">
        <h1 style={{ fontSize: 24, margin: "0 0 2px" }}>Sign Aether in to Claude</h1>
        <div className="rule" />
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, margin: "0 0 6px" }}>
          Aether runs on your Claude subscription through the Agent SDK. Sign in once and every session picks it up.
        </p>
        <button className="btn primary" disabled={busy} style={{ marginTop: 12 }} onClick={signIn}>{busy ? "Waiting for sign-in…" : "Sign in with Claude"}</button>
        <div className="callout">
          {msg ?? <>If the button doesn't open a browser, run <code>npm run login</code> in a terminal from the project folder, then come back — this closes automatically once you're in.</>}
        </div>
        <button className="btn ghost" style={{ marginTop: 14, background: "transparent", border: 0, color: "var(--text-3)", fontSize: 12.5 }} onClick={dismiss}>
          Already set up? Continue anyway →
        </button>
      </div>
    </div>
  );
}
