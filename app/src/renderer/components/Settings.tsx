import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { SENSITIVE_SUMMARY, ACCESS_LEVELS, type ModuleConfig, type ModuleSecret, type ModuleHeader, type ModuleTestResult, type ThemePref, type AccessLevel, type ModelInfo } from "../../shared/types";
import { CLAUDE_MODELS, GEMINI_MODELS, OPENAI_SUGGESTED, OLLAMA_RECOMMENDED, canonicalClaudeModel } from "../../shared/models";
import { IPlus, ITrash, IEdit, IClose, ISearch, IKey, IDiscord, IHeart } from "./icons";
import { ModulesPane as ModulesPaneList } from "./ModulesPane";

// The stored values are the SDK's; the labels are sentence case for the pane.
const EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Very high" },
  { value: "max", label: "Max" },
] as const;
const TABS = ["General", "Model", "Modules", "About"] as const;
type Tab = (typeof TABS)[number];

/** The three access levels, in increasing order of what Aether can do without
 *  being asked. `ask` is the default: capable, but nothing happens behind you.
 *  The same table drives the picker under the chat. */
const ACCESS = ACCESS_LEVELS;

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The switch. Its state is the knob's position and the track's fill, so it
 *  carries no text — role="switch" + aria-checked is what announces it. */
function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      className={`switch${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
    />
  );
}

/** Dev-only (browser preview): let ?tab=Modules open a pane directly, so the
 *  screenshot script can reach one without clicking. Same guard convention as
 *  the __selectNode hook in GraphView. */
function initialTab(): Tab {
  if (!(window as unknown as { __aetherMock?: boolean }).__aetherMock) return "General";
  const t = new URLSearchParams(location.search).get("tab");
  return (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "General";
}

export function Settings() {
  const settings = useStore((s) => s.settings);
  const [tab, setTab] = useState<Tab>(initialTab);
  if (!settings) return null;

  return (
    <div className="pane-scroll">
      <div className="pane">
        <h1>Settings</h1>
        <p className="sub">How Aether signs in, which model it runs, and what it can reach for.</p>
        <div className="tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button key={t} id={`tab-${t}`} role="tab" aria-selected={tab === t} aria-controls="settings-panel"
              className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {tab === "General" && <GeneralPane />}
          {tab === "Model" && <ModelPane />}
          {tab === "Modules" && <ModulesPane />}
          {tab === "About" && <AboutPane />}
        </div>
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
  // A login made in a terminal (`npm run login`) lands out of band; re-read
  // the status when the pane opens so it is never stale on arrival.
  useEffect(() => { void refreshAuth(); }, []);

  const signIn = async () => {
    const r = await window.aether.authLogin();
    if (mounted.current) setLoginMsg(r.message);
    // The CLI login lands out-of-band, so poll for it rather than asking the
    // operator to come back and press Recheck.
    for (let i = 0; i < 30; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      if (!mounted.current) return;
      await refreshAuth();
      if (useStore.getState().auth?.loggedIn) { if (mounted.current) setLoginMsg("Signed in."); break; }
    }
  };

  const theme = settings.theme ?? "system";
  const access: AccessLevel = settings.access ?? "ask";

  return (
    <>
      <div className="field">
        <span className="flabel">Claude account</span>
        <div className="desc">Aether drives Claude through the Agent SDK using your subscription — sign in once.</div>
        <div className="slab">
          <span className={`dot-status ${auth?.loggedIn ? "ok" : "bad"}`} />
          <div className="grow">
            <div className="t">{auth?.loggedIn ? "Signed in" : "Not signed in"}</div>
            <div className="s">{loginMsg ?? auth?.detail ?? (auth?.authMethod ? `via ${auth.authMethod}` : "Run npm run login, or sign in here.")}</div>
          </div>
          {!auth?.loggedIn && <button className="btn primary" onClick={signIn}>Sign in</button>}
          <button className="btn ghost" onClick={() => void refreshAuth()}>Recheck</button>
        </div>
      </div>

      <div className="field">
        <span className="flabel">Appearance</span>
        <div className="desc">Follow the system setting, or pick one.</div>
        <div className="seg-pick" role="group" aria-label="Appearance">
          {THEMES.map((t) => (
            <button key={t.value} className={theme === t.value ? "on" : ""} aria-pressed={theme === t.value} onClick={() => void save({ theme: t.value })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="owner-name">Your name</label>
        <div className="desc">What Aether calls you.</div>
        <input id="owner-name" type="text" defaultValue={settings.ownerName} onBlur={(e) => void save({ ownerName: e.target.value.trim() || "friend" })} />
      </div>

      <div className="field">
        <span className="flabel">Voice</span>
        <div className="desc">Changes Aether's tone and nothing else — every boundary holds either way.</div>
        <div className="seg-pick" role="group" aria-label="Voice">
          <button className={settings.personaVoice === "flirty" ? "on" : ""} aria-pressed={settings.personaVoice === "flirty"} onClick={() => void save({ personaVoice: "flirty" })}>Casual</button>
          <button className={settings.personaVoice === "professional" ? "on" : ""} aria-pressed={settings.personaVoice === "professional"} onClick={() => void save({ personaVoice: "professional" })}>Professional</button>
        </div>
      </div>

      <div className="field">
        <span className="flabel">Access</span>
        <div className="desc">
          What Aether may do on this machine, whichever model is driving. Whatever you pick, commands run in an
          OS sandbox, reads cannot leave its workspace, and your credentials stay off-limits — these levels decide
          what it can reach for, not whether the boundary holds. The picker under the chat sets the same thing;
          Shift+Tab in the message box toggles Safe and Ask.
        </div>
        <div className="seg-pick" role="group" aria-label="Access level">
          {ACCESS.map((a) => (
            <button
              key={a.value}
              className={access === a.value ? "on" : ""}
              aria-pressed={access === a.value}
              onClick={() => void save({ access: a.value })}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="slab" style={{ marginTop: "var(--sp-3)" }}>
          <div className="grow">
            <div className="t">{ACCESS.find((a) => a.value === access)?.headline}</div>
            <div className="s">{ACCESS.find((a) => a.value === access)?.blurb}</div>
          </div>
        </div>
      </div>
    </>
  );
}

/** One row of capability tags for a listed model. */
function ModelTags({ m }: { m: ModelInfo }) {
  const tags: Array<[string, string]> = [];
  if (m.running) tags.push(["loaded", "strong"]);
  if (m.tools) tags.push(["tools", ""]);
  else if (m.tools === false) tags.push(["no tools", "bad"]);
  if (m.thinking) tags.push(["thinking", ""]);
  if (m.vision) tags.push(["vision", ""]);
  if (m.numCtx) tags.push([`${Math.round(m.numCtx / 1024)}k ctx`, ""]);
  else if (m.contextLength) tags.push([`${Math.round(m.contextLength / 1024)}k max`, ""]);
  if (!tags.length) return null;
  return <span className="model-tags">{tags.map(([t, cls]) => <span key={t} className={`tag ${cls}`}>{t}</span>)}</span>;
}

function ModelPane() {
  const settings = useStore((s) => s.settings)!;
  const save = useStore((s) => s.saveSettings);
  const status = useStore((s) => s.providerStatus);
  const refreshStatus = useStore((s) => s.refreshProviderStatus);
  const setProviderKey = useStore((s) => s.setProviderKey);
  const [key, setKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [scanning, setScanning] = useState(false);
  const provider = settings.provider ?? "claude";
  // Only trust a listing that belongs to the provider on screen — the store
  // holds the last one fetched, which may be the previous provider's.
  const live = status?.provider === provider ? status : null;
  const listed: ModelInfo[] = live?.modelInfo ?? [];

  const pick = async (p: typeof provider) => { await save({ provider: p }); void refreshStatus(); };
  const rescan = async () => { setScanning(true); try { await refreshStatus(true); } finally { setScanning(false); } };

  const claudeModel = canonicalClaudeModel(settings.model);
  const claudeOptions = CLAUDE_MODELS.some((m) => m.id === claudeModel) ? CLAUDE_MODELS : [...CLAUDE_MODELS, { id: claudeModel, label: claudeModel }];
  const geminiBase = listed.length ? listed : GEMINI_MODELS;
  const geminiOptions = geminiBase.some((m) => m.id === settings.geminiModel) ? geminiBase : [{ id: settings.geminiModel }, ...geminiBase];
  const openaiSuggest = listed.length ? listed : [...OPENAI_SUGGESTED];
  const ollamaModel = settings.ollamaModel;
  const ollamaSelected = listed.some((m) => m.id === ollamaModel) ? ollamaModel
    : listed.some((m) => m.id === `${ollamaModel}:latest`) ? `${ollamaModel}:latest` : ollamaModel;
  const ollamaOptions = listed.some((m) => m.id === ollamaSelected) || !ollamaSelected ? listed : [{ id: ollamaSelected }, ...listed];

  return (
    <>
      <div className="field">
        <span className="flabel">Provider</span>
        <div className="desc">Which model runs the investigation. Claude uses your subscription through the Agent SDK; ChatGPT is OpenAI or any compatible endpoint; Gemini is a Google AI Studio key; Ollama runs on this machine. All four get the same tools, the same graph and the same access rules.</div>
        <div className="seg-pick" role="group" aria-label="Provider">
          <button className={provider === "claude" ? "on" : ""} aria-pressed={provider === "claude"} onClick={() => void pick("claude")}>Claude</button>
          <button className={provider === "openai" ? "on" : ""} aria-pressed={provider === "openai"} onClick={() => void pick("openai")}>ChatGPT</button>
          <button className={provider === "gemini" ? "on" : ""} aria-pressed={provider === "gemini"} onClick={() => void pick("gemini")}>Gemini</button>
          <button className={provider === "ollama" ? "on" : ""} aria-pressed={provider === "ollama"} onClick={() => void pick("ollama")}>Ollama</button>
        </div>
      </div>

      {provider === "claude" && (
        <div className="field">
          <label htmlFor="claude-model">Model</label>
          <div className="desc">Which Claude model runs the investigation. Fable 5.1 is the most capable and the most expensive; Opus 5 is the default.</div>
          <select id="claude-model" value={claudeModel} onChange={(e) => void save({ model: e.target.value })}>
            {claudeOptions.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id}</option>)}
          </select>
        </div>
      )}

      {provider === "openai" && (
        <>
          <div className="field">
            <label htmlFor="openai-key">OpenAI API key</label>
            <div className="desc">
              OpenAI has no sign-in for API access, so Aether connects with a key. It is stored encrypted on this
              machine (OS keychain) and never shown again or sent to the renderer.
            </div>
            <div className="row-inline">
              <input id="openai-key" type="password" placeholder={live?.hasKey ? "Stored — type to replace" : "sk-..."} value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn primary" disabled={!key.trim()} onClick={async () => { await setProviderKey("openai", key.trim()); setKey(""); }}>Connect</button>
            </div>
            {live?.hasKey && <div className="desc ok tight">Connected.</div>}
            <div className="row-inline">
              <button className="btn link" onClick={() => window.open("https://platform.openai.com/api-keys")}>Get an API key</button>
              {live?.hasKey && <button className="btn link" onClick={() => void setProviderKey("openai", "")}>Disconnect</button>}
            </div>
          </div>
          <div className="field">
            <label htmlFor="openai-model">Model</label>
            <div className="desc">
              {live?.hasKey && live.listedLive && listed.length
                ? `${listed.length} chat models listed from this endpoint — pick one, or type any id it accepts.`
                : "Type any model id the endpoint accepts. Once a key is connected the endpoint's own list is offered here."}
              {" "}Reasoning models take the effort setting.
            </div>
            <div className="row-inline">
              <input id="openai-model" type="text" list="openai-models" defaultValue={settings.openaiModel} onBlur={(e) => void save({ openaiModel: e.target.value.trim() })} placeholder={OPENAI_SUGGESTED[0]?.id ?? "gpt-5"} />
              <datalist id="openai-models">
                {openaiSuggest.map((m) => <option key={m.id} value={m.id}>{m.label ?? ""}</option>)}
              </datalist>
              {live?.hasKey && <button className="btn ghost" disabled={scanning} onClick={() => void rescan()}>{scanning ? "Listing…" : "Re-list"}</button>}
            </div>
            {live?.detail && <div className="desc tight">{live.detail}</div>}
          </div>
          <div className="field">
            <label htmlFor="openai-url">Base URL</label>
            <div className="desc">Point this at any OpenAI-compatible gateway (Azure, OpenRouter, LM Studio, vLLM, a proxy) if you are not using OpenAI directly. Its model list is read from <code>GET /models</code>.</div>
            <input id="openai-url" type="text" defaultValue={settings.openaiBaseUrl} onBlur={(e) => void save({ openaiBaseUrl: e.target.value.trim() })} placeholder="https://api.openai.com/v1" />
          </div>
        </>
      )}

      {provider === "gemini" && (
        <>
          <div className="field">
            <label htmlFor="gemini-key">Gemini API key</label>
            <div className="desc">
              A key from Google AI Studio — free to create, and the Flash models have a free tier. It is stored
              encrypted on this machine (OS keychain) and never shown again or sent to the renderer.
            </div>
            <div className="row-inline">
              <input id="gemini-key" type="password" placeholder={live?.hasKey ? "Stored — type to replace" : "AIza…"} value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} />
              <button className="btn primary" disabled={!geminiKey.trim()} onClick={async () => { await setProviderKey("gemini", geminiKey.trim()); setGeminiKey(""); }}>Connect</button>
            </div>
            {live?.hasKey && <div className="desc ok tight">Connected.</div>}
            <div className="row-inline">
              <button className="btn link" onClick={() => window.open("https://aistudio.google.com/apikey")}>Get an API key</button>
              {live?.hasKey && <button className="btn link" onClick={() => void setProviderKey("gemini", "")}>Disconnect</button>}
            </div>
          </div>
          <div className="field">
            <label htmlFor="gemini-model">Model</label>
            <div className="desc">
              {live?.hasKey && live.listedLive && listed.length ? `${listed.length} models available to this key. ` : ""}
              Pro is the most capable; Flash is faster and has free-tier headroom. Tool calling drives the graph on
              all of them, and the effort setting sets how deeply they think.
            </div>
            <div className="row-inline">
              <select id="gemini-model" value={settings.geminiModel} onChange={(e) => void save({ geminiModel: e.target.value })}>
                {geminiOptions.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.id}</option>)}
              </select>
              {live?.hasKey && <button className="btn ghost" disabled={scanning} onClick={() => void rescan()}>{scanning ? "Listing…" : "Re-list"}</button>}
            </div>
            {live?.detail && <div className="desc tight">{live.detail}</div>}
          </div>
        </>
      )}

      {provider === "ollama" && (
        <>
          <div className="field">
            <label htmlFor="ollama-model">Local model</label>
            <div className="desc">
              Runs entirely on your machine. Aether reads what Ollama has pulled, which of those are loaded right
              now, and whether each one does tool calling — a model without tools can chat but cannot search or
              write the graph. Good local choices: {OLLAMA_RECOMMENDED.join(", ")}.
            </div>
            <div className="row-inline">
              {ollamaOptions.length ? (
                <select id="ollama-model" value={ollamaSelected} onChange={(e) => void save({ ollamaModel: e.target.value })}>
                  {ollamaOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}{m.running ? " · loaded" : ""}{m.tools === false ? " · no tools" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input id="ollama-model" type="text" defaultValue={settings.ollamaModel} onBlur={(e) => void save({ ollamaModel: e.target.value.trim() })} placeholder={OLLAMA_RECOMMENDED[0] ?? "qwen3"} />
              )}
              <button className="btn ghost" disabled={scanning} onClick={() => void rescan()}>{scanning ? "Scanning…" : "Re-scan"}</button>
            </div>
            {live?.detail && <div className={`desc tight${listed.length ? "" : " bad"}`}>{live.detail}</div>}
            {live?.warning && <div className="desc bad tight">{live.warning}</div>}
            {listed.length > 0 && (
              <div className="mod-list">
                {listed.map((m) => (
                  <div className={`row sm${m.id === ollamaSelected ? " sel" : ""}`} key={m.id} onClick={() => void save({ ollamaModel: m.id })} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void save({ ollamaModel: m.id }); } }}>
                    <span className="lbl">{m.id}</span>
                    <ModelTags m={m} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="ollama-url">Base URL</label>
            <div className="desc">Where Ollama listens. Aether asks for a 32k context (or the model's own baked <code>num_ctx</code> if larger) so the brief and the tools fit; set <code>OLLAMA_NUM_CTX</code> in the environment to change that.</div>
            <input id="ollama-url" type="text" defaultValue={settings.ollamaBaseUrl} onBlur={(e) => void save({ ollamaBaseUrl: e.target.value.trim() })} placeholder="http://localhost:11434/v1" />
          </div>
        </>
      )}

      <div className="field">
        <span className="flabel">Reasoning effort</span>
        <div className="desc">
          Higher digs deeper on hard cases; lower is snappier and cheaper. Applies to every provider that can
          reason: Claude's effort levels, <code>reasoning_effort</code> on GPT-5, o-series and gpt-oss, thinking on
          Gemini and on thinking-capable local models.
        </div>
        <div className="seg-pick" role="group" aria-label="Reasoning effort">
          {EFFORTS.map((e) => (
            <button key={e.value} className={settings.effort === e.value ? "on" : ""} aria-pressed={settings.effort === e.value} onClick={() => void save({ effort: e.value })}>{e.label}</button>
          ))}
        </div>
      </div>
    </>
  );
}

function ModulesPane() {
  const [editing, setEditing] = useState<ModuleConfig | null>(null);
  return (
    <>
      <ModulesPaneList onEdit={setEditing} onAdd={() => setEditing(newModule())} />
      {editing && <ModuleEditor initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function newModule(): ModuleConfig {
  return { id: "", name: "", description: "", kind: "command", enabled: true, builtin: false, method: "GET", inputLabel: "", command: "", url: "", headers: [], body: "", secrets: [], instructions: "", freeform: false };
}

function ModuleEditor({ initial, onClose }: { initial: ModuleConfig; onClose: () => void }) {
  const saveModule = useStore((s) => s.saveModule);
  const testModule = useStore((s) => s.testModule);
  const access = useStore((s) => s.settings?.access ?? "ask");
  const [m, setM] = useState<ModuleConfig>({ ...initial, headers: initial.headers ?? [], secrets: initial.secrets ?? [], instructions: initial.instructions ?? "" });
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState("");
  const [trying, setTrying] = useState(false);
  const [result, setResult] = useState<ModuleTestResult | null>(null);
  const set = (patch: Partial<ModuleConfig>) => setM((prev) => ({ ...prev, ...patch }));
  /** A change of shape (command ↔ API, template ↔ freeform) makes the last
   *  test result about a different module; it goes with the change. */
  const reshape = (patch: Partial<ModuleConfig>) => { set(patch); setResult(null); };
  const isHttp = m.kind === "http";
  const isConnector = m.kind === "connector";
  const isBuiltin = m.kind === "builtin";
  // A connector's code and a built-in's tools are fixed; what the operator
  // edits there is how the model is told about them.
  const locked = isConnector || isBuiltin;
  const canTry = !locked && (isHttp ? !!m.url?.trim() : !!m.command?.trim());
  // One predicate for the button and the Enter key — the shell stays withheld
  // at Safe either way.
  const tryEnabled = canTry && !trying && (isHttp || access !== "safe");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setSecret = (i: number, patch: Partial<ModuleSecret>) =>
    set({ secrets: (m.secrets ?? []).map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setHeader = (i: number, patch: Partial<ModuleHeader>) =>
    set({ headers: (m.headers ?? []).map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  const save = async () => {
    if (!m.name.trim() || !m.description.trim()) return;
    setBusy(true);
    try {
      // The switch is the row's, not the editor's: a module switched on (or
      // installed and enabled) while this sheet was open must stay that way.
      const live = useStore.getState().modules.find((x) => x.id === m.id);
      await saveModule(live ? { ...m, enabled: live.enabled } : m);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const tryIt = async () => {
    setTrying(true);
    setResult(null);
    try { setResult(await testModule(m, sample)); }
    catch (e) { setResult({ ok: false, request: "", output: e instanceof Error ? e.message : String(e), ms: 0 }); }
    finally { setTrying(false); }
  };

  const title = initial.id ? (isConnector ? "Your connector" : isBuiltin ? "Built-in module" : "Edit module") : "New module";

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><IClose size={16} /></button>
        </div>
        <div className="modal-body">
          {isConnector && (
            <div className="field">
              <span className="flabel">Code</span>
              <div className="desc tight">
                This module is your own file, <code>private/connectors/{m.connectorFile}</code>. It provides{" "}
                {(m.connectorTools ?? []).map((t, i) => <React.Fragment key={t}>{i > 0 && ", "}<code>{t}</code></React.Fragment>)}.
                Edit the file to change what it does; edit here to change what Aether is told about it.
              </div>
            </div>
          )}
          <div className="field">
            <label className="flabel" htmlFor="mod-name">Name</label>
            <input id="mod-name" type="text" placeholder="nesher" value={m.name} disabled={isBuiltin} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="field">
            <label className="flabel" htmlFor="mod-desc">When should Aether use this?</label>
            <div className="desc tight">
              {isConnector
                ? "Shown in the Modules list. The tools keep the descriptions written in your code; use the notes below to tell the model more."
                : "This becomes the tool's description — say what it does and when to reach for it."}
            </div>
            <textarea id="mod-desc" className="ctl" rows={2} disabled={isBuiltin} placeholder="Search breach corpora for an email or username and return matching records." value={m.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <div className="field">
            <label className="flabel" htmlFor="mod-notes">Notes for Aether</label>
            <div className="desc tight">
              Your own instructions about this module, shown to the model alongside the tool: how to read its output,
              formats it wants, when not to bother. Optional.
            </div>
            <textarea id="mod-notes" className="ctl" rows={3} placeholder="Phone numbers must be in local format (05x…), not +972. An empty result is a finding, not an error." value={m.instructions ?? ""} onChange={(e) => set({ instructions: e.target.value })} />
          </div>

          {!locked && (
            <div className="field">
              <span className="flabel">Type</span>
              <div className="seg-pick" role="group" aria-label="Type">
                <button className={!isHttp ? "on" : ""} aria-pressed={!isHttp} onClick={() => reshape({ kind: "command" })}>Local command</button>
                <button className={isHttp ? "on" : ""} aria-pressed={isHttp} onClick={() => reshape({ kind: "http" })}>API (HTTP)</button>
              </div>
            </div>
          )}

          {!locked && !isHttp && (
            <>
              <div className="field">
                <label className="flabel" htmlFor="mod-input">What does Aether pass as input?</label>
                <div className="desc tight">The one free-form argument Aether fills, substituted as <code>{"{input}"}</code>.</div>
                <input id="mod-input" type="text" placeholder="an email, username, or domain" value={m.inputLabel ?? ""} onChange={(e) => set({ inputLabel: e.target.value })} />
              </div>
              <div className="field">
                <label className="flabel" htmlFor="mod-cmd">Command</label>
                <div className="desc tight">
                  Runs in Aether's workspace — in your shell on macOS and Linux, in PowerShell on Windows. Withheld at
                  Safe access; at Ask you approve each run. Use <code>{"{input}"}</code> (safely quoted) or the{" "}
                  <code>AETHER_INPUT</code> environment variable. Keys below are exported as environment variables.
                </div>
                <textarea id="mod-cmd" className="ctl" rows={2} placeholder="nesher --json {input}" value={m.command ?? ""} onChange={(e) => set({ command: e.target.value })} />
              </div>
            </>
          )}

          {!locked && isHttp && (
            <>
              <div className="field">
                <span className="flabel">Request style</span>
                <div className="seg-pick" role="group" aria-label="Request style">
                  <button className={!m.freeform ? "on" : ""} aria-pressed={!m.freeform} onClick={() => reshape({ freeform: false })}>Fixed template</button>
                  <button className={m.freeform ? "on" : ""} aria-pressed={m.freeform} onClick={() => reshape({ freeform: true })}>Aether shapes the request</button>
                </div>
                <div className="desc tight">
                  {m.freeform
                    ? "Aether chooses the path, method, query and body itself — for an API with many endpoints. It can only ever call the host in the base URL below; your headers and keys are added to every request."
                    : "One URL with an {input} slot Aether fills — the simplest kind, right for a single endpoint."}
                </div>
              </div>
              {!m.freeform && (
                <>
                  <div className="field">
                    <label className="flabel" htmlFor="mod-input">What does Aether pass as input?</label>
                    <div className="desc tight">The one free-form argument Aether fills, substituted as <code>{"{input}"}</code>.</div>
                    <input id="mod-input" type="text" placeholder="an email, username, or domain" value={m.inputLabel ?? ""} onChange={(e) => set({ inputLabel: e.target.value })} />
                  </div>
                  <div className="field">
                    <span className="flabel">Method</span>
                    <div className="seg-pick" role="group" aria-label="Method">
                      <button className={m.method !== "POST" ? "on" : ""} aria-pressed={m.method !== "POST"} onClick={() => set({ method: "GET" })}>GET</button>
                      <button className={m.method === "POST" ? "on" : ""} aria-pressed={m.method === "POST"} onClick={() => set({ method: "POST" })}>POST</button>
                    </div>
                  </div>
                </>
              )}
              <div className="field">
                <label className="flabel" htmlFor="mod-url">{m.freeform ? "Base URL" : "URL"}</label>
                <div className="desc tight">
                  {m.freeform
                    ? <>The API's root, e.g. <code>https://api.example.com/v1/</code>. A key in its query string is kept on every request. Use <code>{"{{KEY}}"}</code> to inject a secret below.</>
                    : <>Use <code>{"{input}"}</code> (URL-encoded) and <code>{"{{KEY}}"}</code> to inject a secret below.</>}
                </div>
                <input id="mod-url" type="text" placeholder={m.freeform ? "https://api.example.com/v1/" : "https://api.example.com/search?q={input}"} value={m.url ?? ""} onChange={(e) => set({ url: e.target.value })} />
              </div>
              <div className="field">
                <span className="flabel">Headers</span>
                {(m.headers ?? []).map((h, i) => (
                  <div className="row-inline" key={i}>
                    <input type="text" aria-label="Header name" placeholder="Authorization" value={h.name} onChange={(e) => setHeader(i, { name: e.target.value })} />
                    <input type="text" aria-label="Header value" placeholder="Bearer {{API_KEY}}" value={h.value} onChange={(e) => setHeader(i, { value: e.target.value })} />
                    <button className="mini-btn danger" aria-label="Remove header" onClick={() => set({ headers: (m.headers ?? []).filter((_, j) => j !== i) })}><IClose size={12} /></button>
                  </div>
                ))}
                <button className="add-row" onClick={() => set({ headers: [...(m.headers ?? []), { name: "", value: "" }] })}><IPlus size={12} />Add header</button>
              </div>
              {!m.freeform && m.method === "POST" && (
                <div className="field">
                  <label className="flabel" htmlFor="mod-body">Body</label>
                  <textarea id="mod-body" className="ctl" rows={2} placeholder={'{"query": "{input}"}'} value={m.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
                </div>
              )}
            </>
          )}

          {!locked && (
            <div className="field">
              <span className="flabel">Keys and secrets</span>
              <div className="desc tight">Stored encrypted on this machine and never shown again. Reference them by name: <code>{"{{NAME}}"}</code> in a URL, header or body, or as an environment variable in a command.</div>
              {(m.secrets ?? []).map((s, i) => (
                <div className="row-inline" key={i}>
                  <input type="text" aria-label="Key name" placeholder="API_KEY" value={s.name} onChange={(e) => setSecret(i, { name: e.target.value })} />
                  <input type="password" aria-label="Key value" placeholder={s.set ? "Stored — leave blank to keep" : "value"} value={s.value ?? ""} onChange={(e) => setSecret(i, { value: e.target.value, set: false })} />
                  <button className="mini-btn danger" aria-label="Remove key" onClick={() => set({ secrets: (m.secrets ?? []).filter((_, j) => j !== i) })}><IClose size={12} /></button>
                </div>
              ))}
              <button className="add-row" onClick={() => set({ secrets: [...(m.secrets ?? []), { name: "", set: false, value: "" }] })}><IPlus size={12} />Add key</button>
            </div>
          )}

          {!locked && (
            <div className="field">
              <span className="flabel">Try it</span>
              <div className="desc tight">
                {isHttp && m.freeform
                  ? <>Send one request as typed above. Enter a path (<code>users/jane</code>) or a JSON object with <code>path</code>, <code>method</code>, <code>query</code>, <code>body</code>.</>
                  : isHttp
                    ? "Send one request with a sample input and see exactly what the model would get. Uses the keys as typed above; nothing is saved."
                    : access === "safe"
                      ? "Runs the command once with a sample input. Access is set to Safe, so the shell is withheld — switch to Ask or Full to try it."
                      : "Runs the command once with a sample input, in Aether's workspace, and shows what came back. Nothing is saved."}
              </div>
              <div className="row-inline">
                <input type="text" aria-label="Sample input" placeholder={isHttp && m.freeform ? "users/jane" : (m.inputLabel || "a sample input")} value={sample} onChange={(e) => setSample(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && tryEnabled) void tryIt(); }} />
                <button className="btn ghost" disabled={!tryEnabled} onClick={() => void tryIt()}>{trying ? "Sending…" : isHttp ? "Send test request" : "Run once"}</button>
              </div>
              {result && (
                <div className={`try-result${result.ok ? "" : " bad"}`} role="status">
                  <div className="try-head">
                    <span className={`dot-status ${result.ok ? "ok" : "bad"}`} />
                    <span className="t">{result.status ? `HTTP ${result.status}` : result.ok ? "Ran" : "Failed"}</span>
                    <span className="s">{result.ms ? `${result.ms} ms` : ""}</span>
                  </div>
                  {result.request && <pre className="try-req">{result.request}</pre>}
                  <pre className="try-out">{result.output}</pre>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div className="note">
            {isConnector ? "The code is yours; the switch, name and notes are saved here."
              : isBuiltin ? "Built in. Notes are saved; the tools themselves are fixed."
              : isHttp ? "Runs at every access level." : "Runs the shell — needs Ask or Full access."}
          </div>
          <span className="spacer" />
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
  "not-available": "You are on the latest version",
  available: "Update found",
  downloading: "Downloading update…",
  downloaded: "Update ready to install",
  error: "Could not check for updates",
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
  const dot = state === "downloaded" || state === "available" ? " ok" : state === "error" ? " bad" : "";
  const line = state === "downloading" && status?.percent != null
    ? `Downloading update… ${status.percent}%`
    : (status?.message || UPDATE_LABEL[state] || "");

  return (
    <div className="field">
      <span className="flabel">Updates</span>
      <div className="desc">Aether updates itself from GitHub Releases. New builds download in the background and install on restart.</div>
      <div className="slab">
        <span className={`dot-status${dot}`} />
        <div className="grow">
          <div className="t">Version {status?.currentVersion ?? ""}{status?.newVersion && state !== "not-available" ? ` to ${status.newVersion}` : ""}</div>
          <div className="s">{line}</div>
        </div>
        {state === "downloaded"
          ? <button className="btn primary" onClick={() => void install()}>Restart and install</button>
          : <button className="btn ghost" disabled={state === "checking" || state === "downloading" || state === "disabled"} onClick={() => void check()}>{state === "checking" ? "Checking…" : "Check now"}</button>}
      </div>
      <div className="slab">
        <div className="grow">
          <div className="t">Check automatically on launch</div>
        </div>
        <Switch on={autoUpdate} label="Check for updates automatically" onToggle={() => void save({ autoUpdate: !autoUpdate })} />
      </div>
    </div>
  );
}

function AboutPane() {
  return (
    <>
      <UpdatesCard />
      <div className="field">
        <span className="flabel">Aether</span>
        <div className="desc">A desktop agent that works a live knowledge graph — OSINT and authorized security research, driven by Claude, ChatGPT, Gemini, or a local model.</div>
        <div className="row-inline">
          <button className="btn ghost" onClick={() => window.open("https://discord.gg/zjawxkDZVP")}><IDiscord size={13} /> Discord</button>
          <button className="btn ghost" onClick={() => window.open("https://github.com/sponsors/fknMega")}><IHeart size={13} /> Sponsor</button>
        </div>
      </div>
      <div className="field">
        <span className="flabel">Security</span>
        <div className="desc">
          Command execution runs in an OS sandbox (Seatbelt on macOS, Bubblewrap on Linux). File reads cannot
          leave Aether's workspace in any mode. These stay off-limits at every access level:
        </div>
        <div className="mod-list">
          {SENSITIVE_SUMMARY.map((line) => (
            <div className="row sm" key={line}><span className="lbl">{line}</span></div>
          ))}
        </div>
        <div className="desc">
          Aether reads content written by the people it investigates, so prompt injection is a real risk, not a
          theoretical one — the sandbox exists because the system prompt alone is not enough. Custom command
          modules are a shell command you asked for, so only add ones you trust. Keys are encrypted at rest
          (OS keychain when available) and never sent to the renderer or to the model in plaintext.
        </div>
      </div>
    </>
  );
}
