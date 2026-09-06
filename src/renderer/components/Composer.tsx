import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { OutboundImage } from "../../shared/types";
import { IImage, IClose, ISend, IStop } from "./icons";

interface Pending extends OutboundImage { preview: string; }

const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

const MAX = 6;

const MODELS = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/* The rest of the product names providers, not provider ids — Settings says
   "ChatGPT", so the composer must not say "openai". */
const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude", openai: "ChatGPT", gemini: "Gemini", ollama: "Ollama",
};

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
  const draft = useStore((s) => s.draft);
  const setDraft = useStore((s) => s.setDraft);
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

  // Anything elsewhere in the app can hand the operator a half-written line by
  // setting `draft`; we take it, take the caret with it, and hand the slot back.
  useEffect(() => {
    if (!draft) return;
    setText(draft);
    setDraft("");
    requestAnimationFrame(() => { taRef.current?.focus(); grow(); });
  }, [draft, setDraft]);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, MAX - imgs.length);
    const read = await Promise.all(list.map((f) => new Promise<Pending>((res) => {
      const r = new FileReader();
      r.onload = () => { const url = String(r.result); res({ name: f.name, mimeType: f.type, data: url.slice(url.indexOf(",") + 1), preview: url }); };
      r.readAsDataURL(f);
    })));
    setImgs((prev) => [...prev, ...read].slice(0, MAX));
  };

  const empty = !text.trim() && imgs.length === 0;

  const submit = () => {
    if (empty || streaming) return;
    void send(text.trim(), imgs.map(({ name, mimeType, data }) => ({ name, mimeType, data })));
    setText(""); setImgs([]);
    requestAnimationFrame(() => { if (taRef.current) taRef.current.style.height = "auto"; });
  };

  return (
    <div className="composer-wrap">
      <div className="composer-inner">
        {/* A drag carrying files is a focus-like state, so it lights the same top
            rule. Only a file drag counts: the accent means "awaiting action now",
            and dragging selected text over the box affords nothing. dragleave
            bubbles from the textarea and buttons inside, so it only clears when
            the pointer has actually left the composer. */}
        <div className={`composer${focused || dragOver ? " focused" : ""}`}
          onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); }}>
          {imgs.length > 0 && (
            <div className="attaches">
              {imgs.map((im, i) => (
                <div className="attach-thumb" key={i}>
                  <img src={im.preview} alt={im.name} />
                  <button aria-label={`Remove ${im.name}`} title={`Remove ${im.name}`}
                    onClick={() => setImgs((p) => p.filter((_, j) => j !== i))}><IClose size={11} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="line">
            <textarea
              ref={taRef} value={text} rows={1} aria-label="Message"
              placeholder="Name, email, username, domain, or a photo"
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              onChange={(e) => { setText(e.target.value); grow(); }}
              onPaste={(e) => { const f = Array.from(e.clipboardData.files); if (f.length) void addFiles(f); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
            <div className="acts">
              <button className="icon-btn" aria-label="Attach image" title="Attach image"
                disabled={imgs.length >= MAX} onClick={() => fileRef.current?.click()}><IImage /></button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden
                onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
              {streaming
                ? <button className="send-btn stop" aria-label="Stop" title="Stop" onClick={() => void cancel()}><IStop size={12} /></button>
                : <button className="send-btn" aria-label="Send" title="Send" disabled={empty} onClick={submit}><ISend size={17} /></button>}
            </div>
          </div>
        </div>
        <div className="composer-foot">
          <label className="pick" title={`Model — ${PROVIDER_LABEL[provider] ?? provider}`}>
            <span className="k">model</span>
            {/* The wrapping label's text content swallows every option, so the
                select's accessible name has to be set explicitly. */}
            <select aria-label="Model" value={current} onChange={(e) => onPickModel(e.target.value)}>
              {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          {provider === "claude" && (
            <label className="pick" title="Reasoning effort — higher thinks longer, lower answers sooner">
              <span className="k">effort</span>
              <select aria-label="Reasoning effort" value={effort ?? "medium"} onChange={(e) => void saveSettings({ effort: e.target.value as (typeof EFFORTS)[number] })}>
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
