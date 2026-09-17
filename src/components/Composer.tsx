"use client";

import { useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
}

export function Composer({ value, onChange, onSubmit, onStop, busy }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea with its content, up to the CSS max-height.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onSubmit();
        }}
      >
        <textarea
          ref={ref}
          rows={1}
          value={value}
          placeholder="Ask anything..."
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!busy && value.trim()) onSubmit();
            }
          }}
        />
        <button
          type={busy ? "button" : "submit"}
          className="send"
          data-stop={busy}
          disabled={!busy && !value.trim()}
          onClick={busy ? onStop : undefined}
          aria-label={busy ? "Stop generating" : "Send message"}
        >
          {busy ? (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <rect width="12" height="12" rx="2" fill="currentColor" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 14V3M8 3 3.5 7.5M8 3l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          )}
        </button>
      </form>
      <p className="hint">Enter to send, Shift+Enter for a new line.</p>
    </div>
  );
}
