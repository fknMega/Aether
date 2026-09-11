import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../shared/types";
import { useStore } from "../state/store";
import { AttachmentImg } from "./AttachmentImg";
import { ToolCard } from "./ToolCard";

/** Wall-clock, 24h, tabular — a turn stamp an analyst can cite. `ago()` drifts
 *  under the reader and cannot be quoted, so the transcript does not use it. */
export const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

/** "1" -> "01". Turn numbers are the address of everything below them. */
export const turnNo = (n: number) => String(n).padStart(2, "0");

/** The leader row that opens a turn: number, speaker, rule, stamp. */
export function TurnHead({ n, who, value }: { n: number; who: string; value: React.ReactNode }) {
  return (
    <div className="row turn-head">
      <span className="gut">{turnNo(n)}</span>
      <span className="who">{who}</span>
      <span className="lead" />
      <span className="val">{value}</span>
    </div>
  );
}

const MD: Components = {
  // Wide tables are the dominant OSINT output shape; they scroll in their own
  // box instead of forcing the transcript column wider than the window.
  table: ({ node, ...props }) => <div className="table-scroll"><table {...props} /></div>,
  // The shell has no navigation of its own — a link must leave for the browser
  // or the whole app would be replaced by the page.
  a: ({ node, href, children, ...props }) => (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      {children}
    </a>
  ),
};

/** Does the source break off inside a plain paragraph? Only then can the caret
 *  be handed to that paragraph; a turn cut short inside a list, a table or a
 *  fence has no trailing paragraph to ride. */
const endsInParagraph = (s: string) => {
  const last = s.trimEnd().split(/\n{2,}/).pop() ?? "";
  return last !== "" && !/^\s*(?:[-*+>#]|\d+[.)]|\||`{3}|~{3})/.test(last);
};

/** Aether's words: sans, set against the margin rule. */
export function Prose({ text, streaming }: { text: string; streaming?: boolean }) {
  // Markdown renders block elements, so a caret placed as their sibling drops
  // onto a line of its own instead of trailing the sentence being written. It
  // is rendered INSIDE the closing paragraph whenever there is one.
  const end = text.trimEnd().length;
  const inline = !!streaming && endsInParagraph(text);
  const components = React.useMemo<Components>(
    () => inline
      ? {
          ...MD,
          p: ({ node, children, ...props }) => (
            <p {...props}>
              {children}
              {(node?.position?.end.offset ?? -1) >= end && <span className="caret" />}
            </p>
          ),
        }
      : MD,
    [inline, end],
  );

  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
      {streaming && !inline && <span className="caret" />}
    </div>
  );
}

export function MessageBubble({ msg, index }: { msg: Message; index: number }) {
  const owner = useStore((s) => s.settings?.ownerName);
  const isUser = msg.role === "user";
  const stamp = clock(msg.createdAt);
  const cost = msg.costUsd != null && msg.costUsd > 0 ? `$${msg.costUsd.toFixed(4)}` : null;

  return (
    <div className={`turn${isUser ? " user" : ""}`}>
      <TurnHead
        n={index}
        who={isUser ? (owner?.trim() || "You") : "Aether"}
        value={cost ? <>{stamp} <span className="sep">·</span> {cost}</> : stamp}
      />
      {msg.attachments.length > 0 && (
        <div className="msg-imgs">
          {msg.attachments.map((a) => <AttachmentImg key={a.id} id={a.id} />)}
        </div>
      )}
      {!isUser && msg.tools && msg.tools.length > 0 && (
        <div className="tool-log">
          {msg.tools.map((t, i) => <ToolCard key={t.id} tool={t} index={`${turnNo(index)}.${i + 1}`} />)}
        </div>
      )}
      {msg.content && (
        isUser
          ? <div className="verbatim">{msg.content}</div>
          : <Prose text={msg.content} />
      )}
    </div>
  );
}
