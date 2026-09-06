import React, { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { ToolManager } from "./ToolManager";

// ─────────────────────────────────────────────────────────────────────────────
// First run.
//
// The HTTP modules work the moment the app opens. The command modules wrap
// binaries that have to exist on the machine, and until they do those modules
// are tools that always fail. This is the one screen that fixes that, and it is
// the first thing a new user sees.
//
// It does NOT install anything on its own. Installing two dozen security tools
// unattended, on someone's machine, before they have clicked anything, is not a
// setup screen — it is a surprise. One button does the whole thing; the choice
// to press it stays theirs.
// ─────────────────────────────────────────────────────────────────────────────
export function Setup() {
  const tools = useStore((s) => s.tools);
  const installingAll = useStore((s) => s.installingAll);
  const save = useStore((s) => s.saveSettings);
  const refresh = useStore((s) => s.refreshTools);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => { void refresh(); }, []);

  const missing = tools.filter((t) => t.state === "missing").length;
  const installed = tools.filter((t) => t.state === "installed").length;
  const busy = installingAll || tools.some((t) => t.state === "installing");

  const finish = async () => {
    setDismissing(true);
    await save({ setupDone: true });
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Set up Aether">
      <div className="modal setup">
        <div className="modal-head">
          <h2>Set up your tools</h2>
        </div>
        <div className="modal-body">
          <p className="desc">
            Aether's search, recon and graph tools work right now. Some bundled modules also
            wrap a command-line program — <b>maigret</b>, <b>subfinder</b>, <b>nuclei</b>,
            <b> nmap</b> and others — and those need the program installed before Aether can
            use them.
          </p>
          <p className="desc">
            {missing > 0
              ? <>Install them in one go, or pick them off individually. You can do this later from Settings.</>
              : installed > 0
                ? <>Everything Aether can install here is already on your machine.</>
                : <>Checking what's on your machine…</>}
          </p>
          <ToolManager compact />
        </div>
        <div className="modal-foot">
          <span className="note">Nothing is installed without a click, and nothing here needs your password.</span>
          <span className="spacer" />
          <button className="btn ghost" disabled={busy || dismissing} onClick={() => void finish()}>
            {busy ? "Installing…" : missing > 0 ? "Skip for now" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
