import React, { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import { MessageBubble, Prose, TurnHead, turnNo } from "./MessageBubble";
import { ToolCard } from "./ToolCard";
import { Composer } from "./Composer";
import { IFail, ISearch, IGraph, IImage, IKey } from "./icons";

/** Each suggestion fills the composer rather than sending — a half-written
 *  prompt fired on click is a turn the operator never chose to spend. */
const SUGGESTIONS: Array<{ icon: React.ReactNode; label: string; draft: string }> = [
  { icon: <ISearch size={13} />, label: "Username sweep", draft: "Sweep this username across platforms: " },
  { icon: <IGraph size={13} />, label: "Map a domain", draft: "Map the infrastructure behind this domain: " },
  { icon: <IImage size={13} />, label: "Read a photo's EXIF", draft: "Read the EXIF on the photo I've attached." },
  { icon: <IKey size={13} />, label: "Recon a host", draft: "Recon this host — I am authorized to test it: " },
];

export function Chat() {
  const messages = useStore((s) => s.messages);
  const stream = useStore((s) => s.stream);
  const turnError = useStore((s) => s.turnError);
  const activeId = useStore((s) => s.activeId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const empty = messages.length === 0 && !stream && !turnError;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, stream?.text, stream?.tools.length, turnError]);

  return (
    <div className="chat">
      {empty ? (
        <Welcome />
      ) : (
        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-inner">
            {/* An error is prose, not a key/value pair. The leader row truncates
                by design, which hid the half of the message that says what to do
                about it behind a hover tooltip. */}
            {turnError && (
              <div className="banner" role="alert">
                <span className="gut"><IFail size={15} /></span>
                <p>{turnError}</p>
              </div>
            )}
            {messages.map((m, i) => <MessageBubble key={m.id} msg={m} index={i + 1} />)}
            {stream && <StreamingTurn index={messages.length + 1} />}
          </div>
        </div>
      )}
      <Composer key={activeId ?? "new"} />
    </div>
  );
}

function StreamingTurn({ index }: { index: number }) {
  const stream = useStore((s) => s.stream)!;
  const hasBody = stream.text.length > 0;
  const running = stream.tools.some((t) => t.status === "running");
  const nn = turnNo(index);

  return (
    <div className="turn">
      <TurnHead n={index} who="Aether" value="now" />
      {stream.tools.length > 0 && (
        <div className="tool-log">
          {stream.tools.map((t, i) => <ToolCard key={t.id} tool={t} index={`${nn}.${i + 1}`} />)}
        </div>
      )}
      {!hasBody && !running && (
        <div className="working" role="status" aria-label="Working">
          <i /><i /><i />
        </div>
      )}
      {hasBody && <Prose text={stream.text} streaming />}
    </div>
  );
}

function Welcome() {
  const owner = useStore((s) => s.settings?.ownerName?.trim());
  const setDraft = useStore((s) => s.setDraft);

  return (
    <div className="empty">
      <div className="empty-card">
        <h1>{owner ? `What are we looking into, ${owner}?` : "What are we looking into?"}</h1>
        <div className="empty-rule" />
        <p>Give Aether one selector — a name, an email, a username, a domain, or a photo — and it opens a case and works it end to end.</p>
        <div className="suggests">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} type="button" className="row" onClick={() => setDraft(s.draft)}>
              <span className="gut">{s.icon}</span>
              <span className="lbl" title={s.label}>{s.label}</span>
              <span className="lead" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
