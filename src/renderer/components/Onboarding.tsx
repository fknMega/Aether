import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";

export function Onboarding() {
  const refreshAuth = useStore((s) => s.refreshAuth);
  const dismiss = useStore((s) => s.dismissAuthGate);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  // StrictMode mounts, unmounts and remounts: without re-arming the flag here the
  // cleanup from the first pass leaves it false forever and the poll below exits
  // on its first tick, so sign-in never completes in development.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const signIn = async () => {
    setBusy(true);
    let r: { ok: boolean; message: string };
    try {
      r = await window.aether.authLogin();
    } catch {
      // Without this the button stays disabled with no explanation.
      if (mounted.current) { setMsg("Could not start sign-in. Try again, or run npm run login in a terminal from the project folder."); setBusy(false); }
      return;
    }
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
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard-card">
        <h1 id="onboard-title">Sign in to Claude</h1>
        <p className="desc">
          Aether runs on your Claude subscription through the Agent SDK. Sign in once and every session picks it up.
        </p>
        <div className="field">
          <button className="btn primary" disabled={busy} onClick={signIn}>
            {busy ? "Waiting for sign-in" : "Sign in with Claude"}
          </button>
        </div>
        <div className="field">
          <div className="slab">
            <div className="grow">
              <div className="s">
                {msg ?? "If no browser window opens, run npm run login in a terminal from the project folder. This closes itself once you are signed in."}
              </div>
            </div>
          </div>
        </div>
        <button className="btn link" onClick={dismiss}>Already set up — continue</button>
      </div>
    </div>
  );
}
