import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { ModuleConfig, ModuleSecret, ModuleHeader } from "../../shared/types";
import { IPlus, ITrash, IEdit, IClose, ISearch } from "./icons";

const MODELS = [
  { id: "claude-opus-5", name: "Opus 5 — most capable" },
  { id: "claude-sonnet-5", name: "Sonnet 5 — balanced" },
  { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5 — fastest" },
];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const TABS = ["General", "Model", "Modules", "About"] as const;
type Tab = (typeof TABS)[number];

export function Settings() {
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState<Tab>("General");
  if (!settings) return null;

  return (
    <div className="pane-scroll">
      <div className="pane fade-in">
        <h1>Settings</h1>
        <p className="sub">How Aether signs in, thinks, and what she can reach for.</p>
        <div className="settings-tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        {tab === "General" && <GeneralPane />}
        {tab === "Model" && <ModelPane />}
        {tab === "Modules" && <ModulesPane />}
        {tab === "About" && <AboutPane />}
      </div>
    </div>
  );
}

function GeneralPane() {
  const settings = useStore((s) => s.settings)!;
  const save = useStore((s) => s.saveSettings);
  const auth = useStore((s) => s.auth);
  const refreshAuth = useStore((s) => s.refreshAuth);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const signIn = async () => {
    const r = await window.aether.authLogin();
    if (mounted.current) setLoginMsg(r.message);
    for (let i = 0; i < 30; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      if (!mounted.current) return;
      await refreshAuth();
      if (useStore.getState().auth?.loggedIn) { if (mounted.current) setLoginMsg("Signed in ✓"); break; }
    }
  };

  return (
    <>
      <div className="field">
        <label>Claude account</label>
        <div className="desc">Aether drives Claude through the Agent SDK using your subscription — sign in once.</div>
        <div className="auth-row">
          <span className={`dot-status ${auth?.loggedIn ? "ok" : "bad"}`} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{auth?.loggedIn ? "Signed in" : "Not signed in"}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{loginMsg ?? auth?.detail ?? (auth?.authMethod ? `via ${auth.authMethod}` : "Run npm run login, or sign in here.")}</div>
          </div>
          {!auth?.loggedIn && <button className="btn primary" onClick={signIn}>Sign in</button>}
          {auth?.loggedIn && <button className="btn ghost" onClick={() => void refreshAuth()}>Recheck</button>}
        </div>
      </div>

      <div className="field">
        <label>Your name</label>
        <div className="desc">What Aether calls you.</div>
        <input type="text" defaultValue={settings.ownerName} onBlur={(e) => void save({ ownerName: e.target.value.trim() || "friend" })} />
      </div>

      <div className="field">
        <label>Voice</label>
        <div className="desc">The persona changes her tone and nothing else — every boundary holds either way.</div>
        <div className="seg-pick">
          <button className={settings.personaVoice === "flirty" ? "on" : ""} onClick={() => void save({ personaVoice: "flirty" })}>Flirty best-friend</button>
          <button className={settings.personaVoice === "professional" ? "on" : ""} onClick={() => void save({ personaVoice: "professional" })}>Professional</button>
        </div>
      </div>

      <div className="field">
        <label>Autonomy</label>
        <div className="desc">On, Aether has full local access — she runs shell commands and reads/writes files in her workspace without asking, and local-command modules are available. Off (safe mode), she keeps her collection tools (search, graph, recon, APIs) but can't run the shell or write local files.</div>
        <div className="toggle">
          <div>{settings.autonomy ? "Full autonomy" : "Safe mode — no shell / file writes"}</div>
          <div className={`switch${settings.autonomy ? " on" : ""}`} onClick={() => void save({ autonomy: !settings.autonomy })}><div className="knob" /></div>
        </div>
      </div>
    </>
  );
}

function ModelPane() {
  const settings = useStore((s) => s.settings)!;
  const save = useStore((s) => s.saveSettings);
  const status = useStore((s) => s.providerStatus);
  const refreshStatus = useStore((s) => s.refreshProviderStatus);
  const setProviderKey = useStore((s) => s.setProviderKey);
  const providerLogin = useStore((s) => s.providerLogin);
  const providerLogout = useStore((s) => s.providerLogout);
  const [key, setKey] = useState("");
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [geminiMsg, setGeminiMsg] = useState<string | null>(null);
  const provider = settings.provider ?? "claude";

  const signInGemini = async () => {
    setGeminiBusy(true);
    setGeminiMsg("Opening your browser to sign in to Google…");
    try {
      const r = await providerLogin("gemini");
      setGeminiMsg(r.message);
    } finally {
      setGeminiBusy(false);
    }
  };

  const pick = async (p: typeof provider) => { await save({ provider: p }); void refreshStatus(); };

  return (
    <>
      <div className="field">
        <label>Provider</label>
        <div className="desc">Which brain runs the investigation. Claude uses your subscription through the Agent SDK. ChatGPT and Ollama talk to any OpenAI-compatible endpoint, and get the same tools and graph.</div>
        <div className="seg-pick">
          <button className={provider === "claude" ? "on" : ""} onClick={() => void pick("claude")}>Claude</button>
          <button className={provider === "openai" ? "on" : ""} onClick={() => void pick("openai")}>ChatGPT</button>
          <button className={provider === "gemini" ? "on" : ""} onClick={() => void pick("gemini")}>Gemini</button>
          <button className={provider === "ollama" ? "on" : ""} onClick={() => void pick("ollama")}>Ollama (local)</button>
        </div>
      </div>

      {provider === "claude" && (
        <>
          <div className="field">
            <label>Model</label>
            <div className="desc">Which Claude model runs the investigation.</div>
            <select defaultValue={settings.model} onChange={(e) => void save({ model: e.target.value })}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Reasoning effort</label>
            <div className="desc">Higher digs deeper on hard cases; lower is snappier and cheaper.</div>
            <div className="seg-pick">
              {EFFORTS.map((e) => <button key={e} className={settings.effort === e ? "on" : ""} onClick={() => void save({ effort: e })}>{e}</button>)}
            </div>
          </div>
        </>
      )}

      {provider === "openai" && (
        <>
          <div className="field">
            <label>OpenAI API key</label>
            <div className="desc">
              OpenAI has no "sign in" for API access, so Aether connects with a key. It's stored encrypted on this
              machine (OS keychain) and never shown again or sent to the renderer.
              &nbsp;<a href="#" onClick={(e) => { e.preventDefault(); window.open("https://platform.openai.com/api-keys"); }}>Get a key ↗</a>
            </div>
            <div className="row-inline">
              <input type="password" className="mono" placeholder={status?.hasKey ? "•••••••• (stored — type to replace)" : "sk-..."} value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn primary" disabled={!key.trim()} onClick={async () => { await setProviderKey("openai", key.trim()); setKey(""); }}>Connect</button>
            </div>
            {status?.hasKey && <div className="desc" style={{ marginTop: 8, color: "var(--success)" }}>Connected. <button className="add-row" style={{ marginLeft: 6 }} onClick={() => void setProviderKey("openai", "")}>Disconnect</button></div>}
          </div>
          <div className="field">
            <label>Model</label>
            <input type="text" className="mono" defaultValue={settings.openaiModel} onBlur={(e) => void save({ openaiModel: e.target.value.trim() })} placeholder="gpt-4o" />
          </div>
          <div className="field">
            <label>Base URL</label>
            <div className="desc">Point this at any OpenAI-compatible gateway (Azure, OpenRouter, a proxy) if you're not using OpenAI directly.</div>
            <input type="text" className="mono" defaultValue={settings.openaiBaseUrl} onBlur={(e) => void save({ openaiBaseUrl: e.target.value.trim() })} placeholder="https://api.openai.com/v1" />
          </div>
        </>
      )}

      {provider === "gemini" && (
        <>
          <div className="field">
            <label>Google account</label>
            <div className="desc">
              Sign in with your Google account to use Gemini free through Google's Code Assist — no API key. The
              sign-in opens in your browser; the token is stored encrypted on this machine and never shown to the
              renderer.
            </div>
            <div className="auth-row">
              <span className={`dot-status ${status?.hasKey ? "ok" : "bad"}`} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{status?.hasKey ? "Signed in" : "Not signed in"}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{geminiMsg ?? status?.detail ?? "Sign in with your Google account to use Gemini free."}</div>
              </div>
              {!status?.hasKey && <button className="btn primary" disabled={geminiBusy} onClick={() => void signInGemini()}>{geminiBusy ? "Signing in…" : "Sign in with Google"}</button>}
              {status?.hasKey && <button className="btn ghost" onClick={async () => { await providerLogout("gemini"); setGeminiMsg(null); }}>Sign out</button>}
            </div>
          </div>
          <div className="field">
            <label>Model</label>
            <div className="desc">gemini-2.5-pro is the most capable; flash is faster. Tool calling drives the graph on all of them.</div>
            <select defaultValue={settings.geminiModel} onChange={(e) => void save({ geminiModel: e.target.value })}>
              {["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </>
      )}

      {provider === "ollama" && (
        <>
          <div className="field">
            <label>Local model</label>
            <div className="desc">
              Runs entirely on your machine. Tool calling needs a tool-capable model (llama3.1, qwen2.5, mistral-nemo); models without tool support will still chat but can't drive the graph.
            </div>
            {status?.models?.length ? (
              <select defaultValue={settings.ollamaModel} onChange={(e) => void save({ ollamaModel: e.target.value })}>
                {status.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input type="text" className="mono" defaultValue={settings.ollamaModel} onBlur={(e) => void save({ ollamaModel: e.target.value.trim() })} placeholder="llama3.1" />
            )}
            {status?.detail && <div className="desc" style={{ marginTop: 8, color: "var(--danger)" }}>{status.detail}</div>}
          </div>
          <div className="field">
            <label>Base URL</label>
            <input type="text" className="mono" defaultValue={settings.ollamaBaseUrl} onBlur={(e) => void save({ ollamaBaseUrl: e.target.value.trim() })} placeholder="http://localhost:11434/v1" />
            <button className="add-row" style={{ marginTop: 8 }} onClick={() => void refreshStatus()}>Re-scan local models</button>
          </div>
        </>
      )}
    </>
  );
}

const KIND_LABEL: Record<string, string> = { builtin: "Built-in", command: "Local command", http: "API", connector: "Connector" };

function ModulesPane() {
  const modules = useStore((s) => s.modules);
  const toggleModule = useStore((s) => s.toggleModule);
  const deleteModule = useStore((s) => s.deleteModule);
  const [editing, setEditing] = useState<ModuleConfig | null>(null);
  const [showBundled, setShowBundled] = useState(false);
  const [bundledFilter, setBundledFilter] = useState("");

  const builtins = modules.filter((m) => m.kind === "builtin");
  const bundled = modules.filter((m) => (m.kind === "command" || m.kind === "http") && m.default);
  const customs = modules.filter((m) => (m.kind === "command" || m.kind === "http") && !m.default);
  const connectors = modules.filter((m) => m.kind === "connector");
  const bundledOn = bundled.filter((m) => m.enabled).length;
  const q = bundledFilter.trim().toLowerCase();
  const bundledShown = q ? bundled.filter((m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)) : bundled;

  const Row = (m: ModuleConfig) => (
    <div className={`module-row${m.enabled ? "" : " off"}`} key={m.id}>
      <div className="minfo">
        <div className="mtitle">
          {m.name}
          <span className={`mkind ${m.kind}`}>{KIND_LABEL[m.kind] ?? m.kind}</span>
          {(m.secrets?.length ?? 0) > 0 && <span className="mkey" title={`${m.secrets!.length} key(s) stored`}>🔑 {m.secrets!.length}</span>}
        </div>
        <div className="mdesc">{m.description}</div>
      </div>
      <div className="module-actions">
        {(m.kind === "command" || m.kind === "http") && (
          <>
            <button className="mini-btn" title="Edit" onClick={() => setEditing(m)}><IEdit /></button>
            {!m.default && <button className="mini-btn danger" title="Delete" onClick={() => void deleteModule(m.id)}><ITrash /></button>}
          </>
        )}
        {m.kind === "connector"
          ? <span className="locked-tag">code</span>
          : <div className={`switch sm${m.enabled ? " on" : ""}`} onClick={() => void toggleModule(m.id, !m.enabled)}><div className="knob" /></div>}
      </div>
    </div>
  );

  return (
    <>
      <div className="field">
        <label>Modules</label>
        <div className="desc">Capabilities Aether can reach for. Toggle the built-ins and the bundled tools, or add your own — a local <b>command</b> she can run, or an <b>API</b> called with your keys. Each enabled one becomes a tool she'll use when its description fits.</div>
      </div>

      <div className="module-group-head"><span>Built-in</span></div>
      <div className="module-list">{builtins.map(Row)}</div>

      <div className="module-group-head">
        <span>Bundled tools · {bundledOn} of {bundled.length} on</span>
        <button className="new-btn" onClick={() => setShowBundled((v) => !v)}>{showBundled ? "Hide" : "Show all"}</button>
      </div>
      <div className="desc" style={{ margin: "0 0 8px" }}>
        Free, no-key OSINT and recon endpoints, plus wrappers for common CLI tools. The HTTP ones work out of the box; the command ones need the tool installed and autonomy on.
      </div>
      {showBundled && (
        <>
          <div className="hud-search glass" style={{ margin: "0 0 8px", maxWidth: "none" }}>
            <ISearch size={14} />
            <input placeholder="Filter bundled tools…" value={bundledFilter} onChange={(e) => setBundledFilter(e.target.value)} />
          </div>
          <div className="module-list">{bundledShown.map(Row)}</div>
        </>
      )}

      <div className="module-group-head">
        <span>Custom</span>
        <button className="new-btn" onClick={() => setEditing(newModule())}><IPlus size={14} />Add module</button>
      </div>
      <div className="module-list">
        {customs.length === 0 && <div className="empty-hint" style={{ padding: "18px 12px" }}>No custom modules yet. Add a local command (e.g. <code>nesher</code>) or an API with your key.</div>}
        {customs.map(Row)}
      </div>

      {connectors.length > 0 && (
        <>
          <div className="module-group-head"><span>Connectors (code)</span></div>
          <div className="module-list">{connectors.map(Row)}</div>
        </>
      )}

      {editing && <ModuleEditor initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function newModule(): ModuleConfig {
  return { id: "", name: "", description: "", kind: "command", enabled: true, builtin: false, method: "GET", inputLabel: "", command: "", url: "", headers: [], body: "", secrets: [] };
}

function ModuleEditor({ initial, onClose }: { initial: ModuleConfig; onClose: () => void }) {
  const saveModule = useStore((s) => s.saveModule);
  const [m, setM] = useState<ModuleConfig>({ ...initial, headers: initial.headers ?? [], secrets: initial.secrets ?? [] });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ModuleConfig>) => setM((prev) => ({ ...prev, ...patch }));
  const isHttp = m.kind === "http";

  const setSecret = (i: number, patch: Partial<ModuleSecret>) =>
    set({ secrets: (m.secrets ?? []).map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setHeader = (i: number, patch: Partial<ModuleHeader>) =>
    set({ headers: (m.headers ?? []).map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  const save = async () => {
    if (!m.name.trim() || !m.description.trim()) return;
    setBusy(true);
    await saveModule(m);
    onClose();
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{initial.id ? "Edit module" : "New module"}</h2>
          <button className="icon-btn" onClick={onClose}><IClose size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="mfield">
            <label>Name</label>
            <input type="text" placeholder="nesher" value={m.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="mfield">
            <label>When should Aether use this?</label>
            <div className="mhint">This becomes the tool's description — say what it does and when to reach for it.</div>
            <textarea rows={2} placeholder="Search breach corpora for an email or username and return matching records." value={m.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className="mfield">
            <label>Type</label>
            <div className="seg-pick">
              <button className={!isHttp ? "on" : ""} onClick={() => set({ kind: "command" })}>Local command</button>
              <button className={isHttp ? "on" : ""} onClick={() => set({ kind: "http" })}>API (HTTP)</button>
            </div>
          </div>
          <div className="mfield">
            <label>What does Aether pass as input?</label>
            <div className="mhint">The one free-form argument she fills, substituted as <code>{"{input}"}</code>.</div>
            <input type="text" placeholder="an email, username, or domain" value={m.inputLabel ?? ""} onChange={(e) => set({ inputLabel: e.target.value })} />
          </div>

          {!isHttp ? (
            <div className="mfield">
              <label>Command</label>
              <div className="mhint">Runs in Aether's workspace (autonomy only). Use <code>{"{input}"}</code> (safely quoted) or the <code>$AETHER_INPUT</code> env var. Secrets below are exported as env vars.</div>
              <textarea className="mono" rows={2} placeholder="nesher --json {input}" value={m.command ?? ""} onChange={(e) => set({ command: e.target.value })} />
            </div>
          ) : (
            <>
              <div className="mfield">
                <label>Request</label>
                <div className="row-inline">
                  <select value={m.method} onChange={(e) => set({ method: e.target.value as "GET" | "POST" })} style={{ width: 96 }}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                  <input type="text" className="mono" placeholder="https://api.example.com/search?q={input}" value={m.url ?? ""} onChange={(e) => set({ url: e.target.value })} />
                </div>
                <div className="mhint">Use <code>{"{input}"}</code> (URL-encoded) and <code>{"{{KEY}}"}</code> to inject a secret below.</div>
              </div>
              <div className="mfield">
                <label>Headers</label>
                {(m.headers ?? []).map((h, i) => (
                  <div className="row-inline" key={i}>
                    <input type="text" className="mono" placeholder="Authorization" value={h.name} onChange={(e) => setHeader(i, { name: e.target.value })} />
                    <input type="text" className="mono" placeholder="Bearer {{API_KEY}}" value={h.value} onChange={(e) => setHeader(i, { value: e.target.value })} />
                    <button className="mini-btn danger" onClick={() => set({ headers: (m.headers ?? []).filter((_, j) => j !== i) })}><IClose size={12} /></button>
                  </div>
                ))}
                <button className="add-row" onClick={() => set({ headers: [...(m.headers ?? []), { name: "", value: "" }] })}><IPlus size={12} />Add header</button>
              </div>
              {m.method === "POST" && (
                <div className="mfield">
                  <label>Body</label>
                  <textarea className="mono" rows={2} placeholder={'{"query": "{input}"}'} value={m.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
                </div>
              )}
            </>
          )}

          <div className="mfield">
            <label>Keys & secrets</label>
            <div className="mhint">Stored encrypted on this machine and never shown again. Reference them by name: <code>{"{{NAME}}"}</code> in a URL/header/body, or as an env var in a command.</div>
            {(m.secrets ?? []).map((s, i) => (
              <div className="row-inline" key={i}>
                <input type="text" className="mono" placeholder="API_KEY" value={s.name} onChange={(e) => setSecret(i, { name: e.target.value })} />
                <input type="password" className="mono" placeholder={s.set ? "•••••••• (stored — leave blank to keep)" : "value"} value={s.value ?? ""} onChange={(e) => setSecret(i, { value: e.target.value, set: false })} />
                <button className="mini-btn danger" onClick={() => set({ secrets: (m.secrets ?? []).filter((_, j) => j !== i) })}><IClose size={12} /></button>
              </div>
            ))}
            <button className="add-row" onClick={() => set({ secrets: [...(m.secrets ?? []), { name: "", set: false, value: "" }] })}><IPlus size={12} />Add key</button>
          </div>
        </div>
        <div className="modal-foot">
          <div className="mfoot-note">{isHttp ? "Runs in safe mode & autonomy." : "Runs the shell — autonomy only."}</div>
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !m.name.trim() || !m.description.trim()} onClick={save}>{busy ? "Saving…" : "Save module"}</button>
        </div>
      </div>
    </div>
  );
}

const UPDATE_LABEL: Record<string, string> = {
  disabled: "Updates run on an installed build",
  idle: "Ready to check",
  checking: "Checking for updates…",
  "not-available": "You're on the latest version",
  available: "Update found",
  downloading: "Downloading update…",
  downloaded: "Update ready to install",
  error: "Couldn't check for updates",
};

function UpdatesCard() {
  const status = useStore((s) => s.updateStatus);
  const check = useStore((s) => s.checkForUpdate);
  const install = useStore((s) => s.installUpdate);
  const refresh = useStore((s) => s.refreshUpdateStatus);
  const save = useStore((s) => s.saveSettings);
  const autoUpdate = useStore((s) => s.settings?.autoUpdate ?? true);
  useEffect(() => { void refresh(); }, []);

  const state = status?.state ?? "idle";
  const dotClass = state === "downloaded" || state === "available" ? "ok" : state === "error" ? "bad" : "";
  const line = state === "downloading" && status?.percent != null ? `Downloading update… ${status.percent}%`
    : (status?.message || UPDATE_LABEL[state] || "");

  return (
    <div className="field">
      <label>Updates</label>
      <div className="desc">Aether updates itself from GitHub Releases. New builds download in the background and install on restart.</div>
      <div className="auth-row" style={{ flexWrap: "wrap" }}>
        <span className={`dot-status ${dotClass}`} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Version {status?.currentVersion ?? ""}{status?.newVersion && state !== "not-available" ? ` → ${status.newVersion}` : ""}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{line}</div>
        </div>
        {state === "downloaded"
          ? <button className="btn primary" onClick={() => void install()}>Restart & install</button>
          : <button className="btn ghost" disabled={state === "checking" || state === "downloading" || state === "disabled"} onClick={() => void check()}>{state === "checking" ? "Checking…" : "Check now"}</button>}
      </div>
      <div className="toggle" style={{ marginTop: 12 }}>
        <div>Check for updates automatically on launch</div>
        <div className={`switch${autoUpdate ? " on" : ""}`} onClick={() => void save({ autoUpdate: !autoUpdate })}><div className="knob" /></div>
      </div>
    </div>
  );
}

function AboutPane() {
  return (
    <>
      <UpdatesCard />
      <div className="field">
        <label>Aether</label>
        <div className="desc">A desktop agent that works a live knowledge graph — OSINT & authorized security research, driven by Claude, ChatGPT, or a local model.</div>
      </div>
      <div className="field">
        <label>Security</label>
        <div className="desc" style={{ lineHeight: 1.6 }}>
          With autonomy on, Aether runs shell commands and local-command modules without asking. Custom API modules call the endpoints you configure with your own keys — treat their config as trusted. Keys are stored encrypted on this machine (OS keychain when available) and are never sent to the renderer or to Claude in plaintext.
        </div>
      </div>
    </>
  );
}
