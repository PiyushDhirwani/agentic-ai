import { API_ROUTES } from "@/config/constants";
import { frameData, isDone, takeLines, textChunks } from "@/lib/sse";
import type { ChatStreamEvent, Conversation, Message } from "@/models";

/**
 * Browser-side access to the API. Components call these instead of holding
 * route strings and response shapes of their own.
 */

async function parseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error ?? fallback;
}

export async function listConversations(): Promise<Conversation[]> {
  const response = await fetch(API_ROUTES.conversations);
  if (!response.ok) throw new Error(await parseError(response, "Could not load conversations."));
  const data = await response.json();
  return data.conversations ?? [];
}

export async function getConversation(
  id: string,
): Promise<{ conversation: Conversation; messages: Message[] }> {
  const response = await fetch(API_ROUTES.conversation(id));
  if (!response.ok) throw new Error(await parseError(response, "Could not load that conversation."));
  return response.json();
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(API_ROUTES.conversation(id), { method: "DELETE" });
}

export interface SendMessageOptions {
  conversationId?: string;
  message: string;
  model?: string;
  signal?: AbortSignal;
}

/**
 * Sends one turn and yields the server's events as they arrive. Frames are
 * parsed with the same helpers the server encodes them with.
 */
export async function* sendMessage(
  options: SendMessageOptions,
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch(API_ROUTES.chat, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: options.conversationId,
      message: options.message,
      model: options.model,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await parseError(response, `Request failed (${response.status})`));
  }

  let buffer = "";
  for await (const chunk of textChunks(response.body)) {
    buffer += chunk;
    const { lines, rest } = takeLines(buffer);
    buffer = rest;

    for (const line of lines) {
      if (isDone(line)) return;
      const data = frameData(line);
      if (!data) continue;

      try {
        yield JSON.parse(data) as ChatStreamEvent;
      } catch {
        // A partial frame; the next chunk completes it.
      }
    }
  }
}
