import React, { useRef, useState } from "react";
import { useStore } from "../state/store";
import type { OutboundImage } from "../../shared/types";
import { ISend, IStop, IImage, IClose } from "./icons";

interface Pending extends OutboundImage { preview: string; }

const MAX = 6;

const MODELS = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function Composer() {
  const [text, setText] = useState("");
  const [imgs, setImgs] = useState<Pending[]>([]);
  const [focused, setFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streaming = useStore((s) => !!s.stream);
  const send = useStore((s) => s.send);
  const cancel = useStore((s) => s.cancel);
  const settings = useStore((s) => s.settings);
  const providerStatus = useStore((s) => s.providerStatus);
  const localModels = providerStatus?.models ?? [];
  const saveSettings = useStore((s) => s.saveSettings);
  const provider = settings?.provider ?? "claude";
  const effort = settings?.effort;

  // The picker follows the active provider: Claude presets, the local Ollama
  // models we discovered, or whatever OpenAI model is configured.
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const GEMINI = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const current =
    provider === "openai" ? (settings?.openaiModel ?? "gpt-4o")
    : provider === "ollama" ? (settings?.ollamaModel ?? "llama3.1")
    : provider === "gemini" ? (settings?.geminiModel ?? "gemini-2.5-pro")
    : (settings?.model ?? "claude-opus-5");
  const modelOptions: Array<{ id: string; label: string }> =
    provider === "claude"
      ? (MODELS.some((m) => m.id === current) ? MODELS : [...MODELS, { id: current, label: current }])
      : uniq(
          provider === "ollama" ? [current, ...localModels]
          : provider === "gemini" ? [current, ...GEMINI]
          : [current, "gpt-4o", "gpt-4o-mini", "o3-mini"],
        ).map((m) => ({ id: m, label: m }));
  const onPickModel = (v: string) =>
    void saveSettings(
      provider === "openai" ? { openaiModel: v }
      : provider === "ollama" ? { ollamaModel: v }
      : provider === "gemini" ? { geminiModel: v }
      : { model: v },
    );

  const grow = () => { const el = taRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; } };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, MAX - imgs.length);
    const read = await Promise.all(list.map((f) => new Promise<Pending>((res) => {
      const r = new FileReader();
      r.onload = () => { const url = String(r.result); res({ name: f.name, mimeType: f.type, data: url.slice(url.indexOf(",") + 1), preview: url }); };
      r.readAsDataURL(f);
    })));
    setImgs((prev) => [...prev, ...read].slice(0, MAX));
  };

  const submit = () => {
    const t = text.trim();
    if ((!t && imgs.length === 0) || streaming) return;
    void send(t, imgs.map(({ name, mimeType, data }) => ({ name, mimeType, data })));
    setText(""); setImgs([]);
    requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = "auto"; });
  };

  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        <div className={`composer${focused ? " focused" : ""}`}
          style={dragOver ? { borderColor: "var(--accent)" } : undefined}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}>
          {imgs.length > 0 && (
            <div className="attaches">
              {imgs.map((im, i) => (
                <div className="attach-thumb" key={i}>
                  <img src={im.preview} alt={im.name} />
                  <button onClick={() => setImgs((p) => p.filter((_, j) => j !== i))}><IClose size={11} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="row">
            <button className="round-btn" title="Attach image" onClick={() => fileRef.current?.click()}><IImage /></button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
            <textarea
              ref={taRef} value={text} rows={1} placeholder="Name, email, username, domain, or a photo…"
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              onChange={(e) => { setText(e.target.value); grow(); }}
              onPaste={(e) => { const f = Array.from(e.clipboardData.files); if (f.length) void addFiles(f); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            <div className="actions">
              {streaming
                ? <button className="round-btn send-btn stop" title="Stop" onClick={() => void cancel()}><IStop /></button>
                : <button className="round-btn send-btn" title="Send" disabled={!text.trim() && imgs.length === 0} onClick={submit}><ISend /></button>}
            </div>
          </div>
        </div>
        <div className="composer-foot">
          <label className="model-pick" title={`Model (${provider})`}>
            <span className="dot" />
            <select value={current} onChange={(e) => onPickModel(e.target.value)}>
              {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          {provider === "claude" && (
            <label className="model-pick" title="Reasoning effort — higher digs deeper, lower is snappier">
              <span className="pfx">effort</span>
              <select value={effort ?? "medium"} onChange={(e) => void saveSettings({ effort: e.target.value as (typeof EFFORTS)[number] })}>
                {EFFORTS.map((eff) => <option key={eff} value={eff}>{eff}</option>)}
              </select>
            </label>
          )}
          <div className="hint">Enter to send · Shift+Enter for a new line</div>
        </div>
      </div>
    </div>
  );
}
