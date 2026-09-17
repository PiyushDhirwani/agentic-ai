"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UiMessage } from "./view-models";

export function Message({ message }: { message: UiMessage }) {
  const isUser = message.role === "user";

  return (
    <div className="msg" data-role={message.role}>
      {message.reasoning ? (
        <details className="reasoning">
          <summary>Reasoning</summary>
          <pre>{message.reasoning}</pre>
        </details>
      ) : null}

      <div className="bubble">
        {isUser ? (
          <div style={{ whiteSpace: "pre-wrap" }}>{message.content}</div>
        ) : (
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            {message.pending ? <span className="cursor" /> : null}
          </>
        )}
      </div>

      {!isUser && message.model && !message.pending ? (
        <div className="meta">{message.model}</div>
      ) : null}
    </div>
  );
}
