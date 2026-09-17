"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP } from "@/config/constants";
import * as api from "@/lib/api-client";
import type { Conversation } from "@/models";
import { Composer } from "./Composer";
import { Message } from "./Message";
import type { UiMessage } from "./view-models";

const SUGGESTIONS = [
  "Explain the sliding-window context trick in this app.",
  "Write a Python script that dedupes a CSV by a column.",
  "How many r's are in the word 'strawberry'?",
];

export function Chat({ models }: { models: string[] }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(models[0] ?? "");
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

  async function openConversation(id: string) {
    abortRef.current?.abort();
    setErr(null);
    setConversationId(id);
    try {
      const { messages: stored } = await api.getConversation(id);
      setMessages(
        stored
          .filter((message) => message.role !== "system")
          .map((message) => ({
            id: String(message.id),
            role: message.role as UiMessage["role"],
            content: message.content ?? "",
            model: message.model,
          })),
      );
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Could not load that conversation.");
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setErr(null);
    setInput("");
  }

  async function removeConversation(id: string) {
    setConversations((previous) => previous.filter((c) => c.id !== id));
    if (id === conversationId) newChat();
    await api.deleteConversation(id).catch(() => {});
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
    let started = false;

    try {
      for await (const event of api.sendMessage({
        conversationId: conversationId ?? undefined,
        message: prompt,
        model: model || undefined,
        signal: controller.signal,
      })) {
        switch (event.type) {
          case "start":
            started = true;
            if (!conversationId) setConversationId(event.conversationId);
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
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
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
        />
      </main>
    </div>
  );
}
