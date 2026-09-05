import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../shared/types";
import { AttachmentImg } from "./AttachmentImg";
import { ago } from "../lib/time";

export function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`msg ${isUser ? "user" : "ai"}`}>
      {!isUser && (
        <div className="ai-eyebrow">
          <span className="who">Aether</span>
          <span className="when">{ago(msg.createdAt)}</span>
        </div>
      )}
      <div className="bubble">
        {msg.attachments.length > 0 && (
          <div className="msg-imgs">{msg.attachments.map((a) => <AttachmentImg key={a.id} id={a.id} />)}</div>
        )}
        {msg.content && (
          isUser
            ? <div className="bubble-content" style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
            : <div className="bubble-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div>
        )}
        {msg.costUsd != null && msg.costUsd > 0 && <div className="cost">${msg.costUsd.toFixed(4)}</div>}
      </div>
    </div>
  );
}
