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

      {message.activity?.length ? (
        <div className="activity">
          {message.activity.map((item, index) => (
            <span key={`${item.name}-${index}`} data-error={item.isError}>
              {item.name.replace("__", " · ")}
            </span>
          ))}
        </div>
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

      {!isUser && message.citations?.length ? (
        <ol className="sources">
          {message.citations.map((citation) => (
            <li key={citation.url}>
              <a href={citation.url} target="_blank" rel="noopener noreferrer">
                {citation.title ?? new URL(citation.url).hostname}
              </a>
            </li>
          ))}
        </ol>
      ) : null}

      {!isUser && message.model && !message.pending ? (
        <div className="meta">{message.model}</div>
      ) : null}
    </div>
  );
}
