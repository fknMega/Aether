import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { ToolManager } from "./ToolManager";

// ─────────────────────────────────────────────────────────────────────────────
// First run.
//
// Recommended, not required. Aether's search, recon and graph tools work the
// moment it opens; this only covers the bundled modules that drive a program on
// the machine. So the sheet is fully dismissible — Escape, the backdrop, or the
// button — and it does not appear at all when there is nothing to install.
//
// It also never installs on its own. Installing two dozen security tools
// unattended, before anyone has clicked anything, is a surprise rather than a
// setup screen. One button does the whole set; pressing it stays the user's
// choice.
// ─────────────────────────────────────────────────────────────────────────────
export function Setup() {
  const tools = useStore((s) => s.tools);
  const installingAll = useStore((s) => s.installingAll);
  const save = useStore((s) => s.saveSettings);
  const refresh = useStore((s) => s.refreshTools);
  const [dismissed, setDismissed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { void refresh(); }, []);

  const missing = tools.filter((t) => t.state === "missing").length;
  const busy = installingAll || tools.some((t) => t.state === "installing");

  const finish = () => {
    if (busy) return;                 // never yank the sheet out from under a running install
    setDismissed(true);
    void save({ setupDone: true });
  };

  // Escape closes it, like any other sheet in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  useEffect(() => { closeRef.current?.focus(); }, []);

  // Nothing to offer — mark setup done and stay out of the way. A first-run
  // sheet whose only content is "everything is fine" is a speed bump.
  useEffect(() => {
    if (tools.length > 0 && missing === 0 && !busy && !dismissed) finish();
  }, [tools.length, missing, busy, dismissed]);

  if (dismissed || (tools.length > 0 && missing === 0)) return null;

  return (
    <div className="scrim" onClick={finish}>
      <div
        className="modal setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="setup-title">Install the bundled tools?</h2>
          <span className="tag">Optional</span>
        </div>
        <div className="modal-body">
          <p className="desc">
            Aether's search, recon and graph tools already work. Some bundled modules also drive a
            program on your machine — <b>maigret</b>, <b>subfinder</b>, <b>nuclei</b>, <b>nmap</b> and
            others — and those need the program installed first.
          </p>
          <p className="desc">
            Recommended, but you can skip it and do this any time from Settings → Modules.
          </p>
          <ToolManager compact />
        </div>
        <div className="modal-foot">
          <span className="note">Nothing installs without a click, and nothing needs your password.</span>
          <span className="spacer" />
          <button ref={closeRef} className="btn ghost" disabled={busy} onClick={finish}>
            {busy ? "Installing…" : "Not now"}
          </button>
        </div>
      </div>
    </div>
  );
}
