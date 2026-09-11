import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { Provider } from "../../shared/types";

// ─────────────────────────────────────────────────────────────────────────────
// First run — choose how Aether thinks.
//
// Aether runs on any of four backends, but the old welcome screen only knew how
// to sign into Claude, so the other three were invisible until you dug through
// Settings. This screen offers all four up front and sets up whichever you pick,
// then gets out of the way the moment that backend is actually reachable.
//
// "Reachable" differs by provider — a Claude login, a stored OpenAI or Gemini
// key, a running Ollama with a model — so App owns that check and
// unmounts this overlay when it flips true. Here we just drive each setup flow
// and refresh the relevant status so App can re-evaluate.
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDERS: { id: Provider; name: string; tag: string; blurb: string }[] = [
  { id: "claude", name: "Claude",  tag: "Subscription", blurb: "Your Claude account through the Agent SDK — the most capable option, and the default." },
  { id: "openai", name: "ChatGPT", tag: "API key",      blurb: "OpenAI, or any compatible endpoint: Azure, OpenRouter, a local gateway." },
  { id: "gemini", name: "Gemini",  tag: "API key",      blurb: "A Google AI Studio key — free to create, and Flash models have a free tier." },
  { id: "ollama", name: "Ollama",  tag: "Local",        blurb: "Runs entirely on your machine — nothing leaves it. Needs a tool-capable model." },
];

export function Onboarding() {
  const settings = useStore((s) => s.settings);
  const auth = useStore((s) => s.auth);
  const rawStatus = useStore((s) => s.providerStatus);
  const save = useStore((s) => s.saveSettings);
  const refreshAuth = useStore((s) => s.refreshAuth);
  const refreshStatus = useStore((s) => s.refreshProviderStatus);
  const setProviderKey = useStore((s) => s.setProviderKey);
  const dismiss = useStore((s) => s.dismissAuthGate);

  const provider: Provider = settings?.provider ?? "claude";
  // The store keeps the last status fetched; right after picking a different
  // provider that is the previous one's, and must not read as "connected".
  const status = rawStatus?.provider === provider ? rawStatus : null;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState(settings?.ollamaBaseUrl ?? "http://localhost:11434/v1");

  // StrictMode double-mounts; re-arm the flag each mount or the browser-return
  // poll below exits on its first tick and sign-in never completes in dev.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Make sure both status sources are fresh when the screen opens.
  useEffect(() => { void refreshAuth(); void refreshStatus(); }, []);

  const pick = (p: Provider) => { setMsg(null); setBusy(false); setKey(""); void save({ provider: p }).then(() => refreshStatus()); };

  /** The Claude browser flow completes out of band, so poll the relevant
   *  status until it flips or we give up. App unmounts us on success. */
  const pollUntilReady = async (check: () => boolean, refresh: () => Promise<void>) => {
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!mounted.current) return;
      await refresh();
      if (check()) return;
    }
    if (mounted.current) setBusy(false);
  };

  const signInClaude = async () => {
    setBusy(true); setMsg(null);
    try { const r = await window.aether.authLogin(); if (mounted.current) setMsg(r.message); }
    catch { if (mounted.current) { setMsg("Could not start sign-in. Try running npm run login in the project folder."); setBusy(false); } return; }
    await pollUntilReady(() => !!useStore.getState().auth?.loggedIn, refreshAuth);
  };

  /** Both key providers store the same way; App unmounts us once hasKey flips. */
  const connectKey = async (p: "openai" | "gemini") => {
    if (!key.trim()) return;
    setBusy(true);
    await setProviderKey(p, key.trim());
    setKey("");
    if (mounted.current) setBusy(false);
  };

  const scanOllama = async () => {
    setBusy(true); setMsg(null);
    if (ollamaUrl.trim() && ollamaUrl.trim() !== settings?.ollamaBaseUrl) await save({ ollamaBaseUrl: ollamaUrl.trim() });
    await refreshStatus(true);
    if (mounted.current) { setBusy(false); if (!(useStore.getState().providerStatus?.models?.length)) setMsg(useStore.getState().providerStatus?.detail ?? "No local models found. Is `ollama serve` running?"); }
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard-card onboard-welcome">
        <div className="onboard-hero">
          <span className="onboard-mark">A</span>
          <div>
            <h1 id="onboard-title">Welcome to Aether</h1>
            <p className="desc tight">An AI OSINT analyst that works a live knowledge graph. First, choose the model it runs on.</p>
          </div>
        </div>

        <div className="seg-pick onboard-providers" role="group" aria-label="Model provider">
          {PROVIDERS.map((p) => (
            <button key={p.id} className={provider === p.id ? "on" : ""} aria-pressed={provider === p.id} onClick={() => pick(p.id)}>
              {p.name}
            </button>
          ))}
        </div>

        {PROVIDERS.filter((p) => p.id === provider).map((p) => (
          <div className="onboard-setup" key={p.id}>
            <div className="onboard-tag">{p.tag}</div>
            <p className="desc">{p.blurb}</p>

            {p.id === "claude" && (
              <div className="slab">
                <span className={`dot-status ${auth?.loggedIn ? "ok" : "bad"}`} />
                <div className="grow">
                  <div className="t">{auth?.loggedIn ? "Signed in" : "Not signed in"}</div>
                  <div className="s">{msg ?? (auth?.loggedIn ? "Ready to go." : "Opens your browser once; every session picks it up after.")}</div>
                </div>
                {!auth?.loggedIn && <button className="btn primary" disabled={busy} onClick={signInClaude}>{busy ? "Waiting…" : "Sign in"}</button>}
              </div>
            )}

            {p.id === "openai" && (
              <>
                <div className="row-inline">
                  <input type="password" aria-label="OpenAI API key" placeholder={status?.hasKey ? "Stored — type to replace" : "sk-…"} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void connectKey("openai"); }} />
                  <button className="btn primary" disabled={busy || !key.trim()} onClick={() => void connectKey("openai")}>Connect</button>
                </div>
                <div className="row-inline">
                  {status?.hasKey ? <span className="desc ok tight">Connected. Stored encrypted on this machine.</span> : <span className="desc tight">Stored encrypted on this machine, never shown again.</span>}
                  <span className="spacer" />
                  <button className="btn link" onClick={() => window.open("https://platform.openai.com/api-keys")}>Get a key</button>
                </div>
              </>
            )}

            {p.id === "gemini" && (
              <>
                <div className="row-inline">
                  <input type="password" aria-label="Gemini API key" placeholder={status?.hasKey ? "Stored — type to replace" : "AIza…"} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void connectKey("gemini"); }} />
                  <button className="btn primary" disabled={busy || !key.trim()} onClick={() => void connectKey("gemini")}>Connect</button>
                </div>
                <div className="row-inline">
                  {status?.hasKey ? <span className="desc ok tight">Connected. Stored encrypted on this machine.</span> : <span className="desc tight">Stored encrypted on this machine, never shown again.</span>}
                  <span className="spacer" />
                  <button className="btn link" onClick={() => window.open("https://aistudio.google.com/apikey")}>Get a key</button>
                </div>
              </>
            )}

            {p.id === "ollama" && (
              <>
                <div className="row-inline">
                  <input type="text" aria-label="Ollama endpoint" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
                  <button className="btn primary" disabled={busy} onClick={() => void scanOllama()}>{busy ? "Scanning…" : "Scan"}</button>
                </div>
                {msg
                  ? <div className="desc bad tight">{msg}</div>
                  : <div className="desc tight">Start <code>ollama serve</code>, then scan. Needs a tool-capable model such as qwen3, gemma4 or gpt-oss.</div>}
              </>
            )}
          </div>
        ))}

        <div className="onboard-foot">
          <span className="note">You can change this any time in Settings.</span>
          <span className="spacer" />
          <button className="btn link" onClick={dismiss}>Skip for now</button>
        </div>
      </div>
    </div>
  );
}
