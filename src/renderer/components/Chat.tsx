import React, { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../state/store";
import { MessageBubble } from "./MessageBubble";
import { ToolCard } from "./ToolCard";
import { Composer } from "./Composer";

const SUGGESTIONS: [string, string][] = [
  ["@", "Work this username across platforms: —"],
  ["◇", "Map the infrastructure behind a domain"],
  ["▣", "Read the EXIF on a photo I'll attach"],
  ["⌘", "Recon a HackTheBox target I'm authorized on"],
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
  }, [messages, stream?.text, stream?.tools.length, stream?.thinking, turnError]);

  return (
    <div className="chat">
      {empty ? (
        <Welcome />
      ) : (
        <div className="chat-scroll" ref={scrollRef}>
          {turnError && <div className="banner">{turnError}</div>}
          <div className="chat-inner">
            {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
            {stream && <StreamingBubble />}
          </div>
        </div>
      )}
      <Composer key={activeId ?? "new"} />
    </div>
  );
}

function StreamingBubble() {
  const stream = useStore((s) => s.stream)!;
  const hasBody = stream.text.length > 0;
  return (
    <div className="msg ai">
      <div className="ai-eyebrow">
        <span className="who">Aether</span>
        <span className="when">now</span>
      </div>
      <div className="bubble">
        {stream.tools.length > 0 && (
          <div className="tools-wrap">{stream.tools.map((t) => <ToolCard key={t.id} tool={t} />)}</div>
        )}
        {!hasBody && stream.tools.every((t) => t.status !== "running") && !stream.error && (
          <div className="thinking"><span className="orbit" />{stream.thinking ? "reasoning" : "on it"}</div>
        )}
        {hasBody && (
          <div className="bubble-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{stream.text}</ReactMarkdown>
            <span className="cursor" />
          </div>
        )}
      </div>
    </div>
  );
}

function Welcome() {
  const send = useStore((s) => s.send);
  const owner = useStore((s) => s.settings?.ownerName);
  return (
    <div className="welcome">
      <div className="welcome-card fade-in">
        <h1>{owner ? `What are we looking into, ${owner}?` : "What are we looking into?"}</h1>
        <div className="rule" />
        <p>Hand me a target and one selector — a name, an email, a username, a domain, a photo — and I'll open a case file and work it end to end.</p>
        <div className="chip-row">
          {SUGGESTIONS.map(([g, s]) => (
            <button key={s} className="chip" onClick={() => void send(s, [])}><span className="glyph">{g}</span>{s}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
