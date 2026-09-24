"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP, ROUTES } from "@/config/constants";
import * as api from "@/lib/api-client";
import type { Conversation, ModelOption } from "@/models";
import { Composer } from "./Composer";
import { Message } from "./Message";
import type { UiMessage } from "./view-models";

const SUGGESTIONS = [
  "Explain the sliding-window context trick in this app.",
  "Write a Python script that dedupes a CSV by a column.",
  "How many r's are in the word 'strawberry'?",
];

interface ChatProps {
  models: ModelOption[];
  defaultModel: string;
  /** Present when rendered at /c/<id>; absent for a new chat at /. */
  conversationId?: string;
  initialMessages?: UiMessage[];
  webSearchAvailable: boolean;
  webSearchDefault: boolean;
}

export function Chat({
  models,
  defaultModel,
  conversationId: initialConversationId,
  initialMessages = [],
  webSearchAvailable,
  webSearchDefault,
}: ChatProps) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId ?? null,
  );
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(defaultModel);
  const [webSearch, setWebSearch] = useState(webSearchDefault);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await api.listConversations());
    } catch {
      // The sidebar is a convenience; a failure here must not block chatting.
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  /** Navigates to the conversation's own URL; the server renders its thread. */
  function openConversation(id: string) {
    if (id === conversationId) return;
    abortRef.current?.abort();
    router.push(ROUTES.conversation(id));
  }

  /**
   * Starts a fresh conversation.
   *
   * The local reset is not belt-and-braces: after the first turn the address
   * bar is rewritten with replaceState, which Next's router does not observe,
   * so it still believes the pathname is "/" and `push("/")` does nothing.
   * Without clearing state here, "New chat" would keep the old thread on
   * screen and the next message would continue that conversation.
   */
  function newChat() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setErr(null);
    setInput("");
    window.history.replaceState(null, "", ROUTES.newChat);
    router.push(ROUTES.newChat);
  }

  async function removeConversation(id: string) {
    setConversations((previous) => previous.filter((c) => c.id !== id));
    await api.deleteConversation(id).catch(() => {});
    // Same trap as newChat: the open conversation may only be in the URL.
    if (id === conversationId) newChat();
    else router.refresh();
  }

  async function send(text: string) {
    const prompt = text.trim();
    if (!prompt || busy) return;

    setErr(null);
    setInput("");
    setBusy(true);

    const assistantId = `assistant-${Date.now()}`;
    setMessages((previous) => [
      ...previous,
      { id: `user-${Date.now()}`, role: "user", content: prompt },
      { id: assistantId, role: "assistant", content: "", pending: true },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    const patch = (update: Partial<UiMessage>) =>
      setMessages((previous) =>
        previous.map((message) => (message.id === assistantId ? { ...message, ...update } : message)),
      );

    let content = "";
    let reasoning = "";
    let activity: { name: string; isError?: boolean }[] = [];
    let started = false;

    try {
      for await (const event of api.sendMessage({
        conversationId: conversationId ?? undefined,
        message: prompt,
        model: model || undefined,
        webSearch,
        signal: controller.signal,
      })) {
        switch (event.type) {
          case "start":
            started = true;
            if (!conversationId) {
              setConversationId(event.conversationId);
              // replaceState, not router.replace: a navigation here would
              // remount the tree and cut the stream we are reading.
              window.history.replaceState(null, "", ROUTES.conversation(event.conversationId));
            }
            break;
          case "model":
            patch({ model: event.model });
            break;
          case "reasoning":
            reasoning += event.text;
            patch({ reasoning });
            break;
          case "delta":
            content += event.text;
            patch({ content });
            break;
          case "citations":
            patch({ citations: event.citations });
            break;
          case "tool_call":
            activity = [...activity, ...event.calls.map((call) => ({ name: call.name }))];
            patch({ activity });
            break;
          case "tool_result":
            // Mark the matching entries done, so failures are visible.
            activity = activity.map((item) => {
              const result = event.results.find((candidate) => candidate.name === item.name);
              return result ? { ...item, isError: result.isError } : item;
            });
            patch({ activity });
            break;
          case "done":
            patch({ pending: false, model: event.model });
            break;
          case "error":
            setErr(event.error);
            break;
        }
      }
      if (started) void refreshConversations();
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      if (!aborted) setErr(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      patch({ pending: false });
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <span className="dot" />
            {APP.name}
          </div>
          <button className="new-chat" onClick={newChat}>
            New chat
          </button>
        </div>

        <div className="conv-list">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className="conv"
              data-active={conversation.id === conversationId}
            >
              <button className="conv-title" onClick={() => void openConversation(conversation.id)}>
                {conversation.title ?? "Untitled"}
              </button>
              <button
                className="conv-delete"
                aria-label="Delete conversation"
                onClick={() => void removeConversation(conversation.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <label htmlFor="model">Model</label>
          <select
            id="model"
            className="model-select"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          >
            {models.map((option) => (
              <option key={option.id} value={option.id} title={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span>Falls back automatically if the chosen model is unavailable.</span>
        </div>
      </aside>

      <main className="chat">
        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty">
              <h1>What can I help with?</h1>
              <p>Every conversation is stored in Postgres and replayed from a 50-turn window.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} className="suggestion" onClick={() => void send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="thread">
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
              {err ? <div className="error-banner">{err}</div> : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => void send(input)}
          onStop={() => abortRef.current?.abort()}
          busy={busy}
          webSearch={webSearch}
          onToggleWebSearch={
            webSearchAvailable ? () => setWebSearch((previous) => !previous) : undefined
          }
        />
      </main>
    </div>
  );
}
