import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { PermissionRequest } from "../../shared/types";
import { ITerminal, IGlobe, IDownload, IEdit } from "./icons";

// ─────────────────────────────────────────────────────────────────────────────
// The approval prompt.
//
// At access level "ask", Aether stops here and waits. The turn is genuinely
// blocked on this dialog, so it has to be unmissable and it has to be specific:
// the operator approves THIS command or THIS url, not "shell access" in the
// abstract. The exact string is shown verbatim, in mono, and never truncated —
// a decision made on an ellipsis is not an informed one.
//
// Deliberately not dismissible by clicking away or pressing Escape. Every other
// sheet in the app closes that way; this one is a question with consequences,
// and a stray click must not answer it. Escape refuses explicitly instead.
// ─────────────────────────────────────────────────────────────────────────────

const KIND: Record<PermissionRequest["kind"], { icon: React.ReactNode; label: string; blurb: string }> = {
  shell: {
    icon: <ITerminal size={16} />,
    label: "Run a command",
    blurb: "Runs on your machine, sandboxed and fenced to Aether's workspace.",
  },
  write: {
    icon: <IEdit size={16} />,
    label: "Write a file",
    blurb: "Writes inside Aether's workspace. It cannot reach the rest of your disk.",
  },
  network: {
    icon: <IGlobe size={16} />,
    label: "Fetch from the internet",
    blurb: "A URL Aether chose. Private and loopback addresses are refused regardless.",
  },
  install: {
    icon: <IDownload size={16} />,
    label: "Install a tool",
    blurb: "Uses your package manager. Never runs as root.",
  },
};

export function PermissionPrompt() {
  const queue = useStore((s) => s.permissions);
  const answer = useStore((s) => s.answerPermission);
  const [remember, setRemember] = useState(false);
  const allowRef = useRef<HTMLButtonElement>(null);

  const req = queue[0];

  // Each question is its own decision — "don't ask again" must not carry over
  // from the previous one still being checked.
  useEffect(() => { setRemember(false); allowRef.current?.focus(); }, [req?.id]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape refuses. It does not dismiss — leaving the turn hanging on an
      // unanswered question would be worse than a clear no.
      if (e.key === "Escape") { e.preventDefault(); answer(req.id, "deny"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req?.id]);

  if (!req) return null;
  const k = KIND[req.kind] ?? KIND.shell;

  return (
    <div className="scrim perm-scrim">
      <div className="modal perm" role="alertdialog" aria-modal="true" aria-labelledby="perm-title" aria-describedby="perm-detail">
        <div className="modal-head">
          <span className="perm-icon">{k.icon}</span>
          <h2 id="perm-title">{req.title || k.label}</h2>
          {queue.length > 1 && <span className="tag">{queue.length - 1} more waiting</span>}
        </div>
        <div className="modal-body">
          <div className="perm-detail" id="perm-detail">{req.detail}</div>
          {req.reason && <p className="desc tight">{req.reason}</p>}
          <p className="desc">{k.blurb}</p>
          <label className="perm-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>
              Don't ask again for {req.kind === "network" ? "internet requests" : req.kind === "install" ? "installs" : req.kind === "write" ? "file writes" : "commands"} this session
            </span>
          </label>
        </div>
        <div className="modal-foot">
          <span className="note">Aether is waiting for an answer.</span>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => answer(req.id, "deny")}>Refuse</button>
          <button ref={allowRef} className="btn primary" onClick={() => answer(req.id, "allow", remember)}>Allow</button>
        </div>
      </div>
    </div>
  );
}
