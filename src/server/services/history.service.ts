import { env } from "@/config/env";
import {
  assistantMessage,
  assistantToolCallMessage,
  systemMessage,
  toolResultMessage,
  type ChatMessage,
  type Message,
  type NewMessage,
} from "@/models";
import * as windowCache from "@/server/cache/window.cache";
import { messages as messagesRepo } from "@/server/db";

/**
 * Conversation history as a sliding window, with Redis in front of Postgres.
 *
 *   read  -> cache, and on a miss load from Postgres and fill the cache
 *   write -> Postgres first, then append to the cached window and trim
 *
 * Postgres is the source of truth; the cache never changes a result, only how
 * fast it arrives.
 */

/** The last `HISTORY_TURNS` exchanges of a conversation, oldest-first. */
export async function getWindow(conversationId: string): Promise<Message[]> {
  const cached = await windowCache.read(conversationId);
  if (cached) return cached;

  const stored = await messagesRepo.findRecent(conversationId, env.chat.historyMessages);
  await windowCache.fill(conversationId, stored);
  return stored;
}

/** Persists a message and keeps the cached window in step. */
export async function append(message: NewMessage): Promise<Message> {
  const stored = await messagesRepo.insert(message);
  await windowCache.append(message.conversationId, stored);
  return stored;
}

export async function invalidate(conversationId: string): Promise<void> {
  await windowCache.invalidate(conversationId);
}

/**
 * Drops tool exchanges the window has cut in half.
 *
 * A `tool` message is only valid immediately after an assistant turn that
 * requested that call id, and an assistant turn with `tool_calls` is only
 * valid if every result follows. The sliding window cuts at a fixed message
 * count and can land in the middle of such a pair, which providers reject
 * outright — so an incomplete pair is removed rather than sent.
 */
function dropOrphanedToolMessages(window: Message[]): Message[] {
  const answered = new Set<string>();
  for (const message of window) {
    if (message.role === "tool" && message.toolCallId) answered.add(message.toolCallId);
  }

  // An assistant turn survives only if EVERY call it made was answered; a
  // partially answered request is invalid, so the whole round goes.
  const surviving = new Set<string>();
  for (const message of window) {
    if (message.role !== "assistant") continue;
    const calls = message.toolCalls ?? [];
    if (calls.length === 0) continue;
    if (calls.every((call) => answered.has(call.id))) {
      for (const call of calls) surviving.add(call.id);
    }
  }

  return window.filter((message) => {
    // Keep a result only if the request that produced it also survived —
    // checking merely that it was *requested* would leave the result of a
    // dropped round dangling with no preceding tool_calls.
    if (message.role === "tool") {
      return Boolean(message.toolCallId && surviving.has(message.toolCallId));
    }
    const calls = message.toolCalls ?? [];
    if (message.role === "assistant" && calls.length > 0) {
      return calls.every((call) => surviving.has(call.id));
    }
    return true;
  });
}

/**
 * Shapes a window into the payload OpenRouter expects. `reasoningDetails` ride
 * along on assistant turns so a reasoning model resumes where it left off, and
 * completed tool exchanges are replayed so earlier findings are not lost.
 *
 * Stored system rows are skipped: the system prompt is supplied fresh each
 * turn, so a change to SYSTEM_PROMPT takes effect immediately.
 */
export function toChatMessages(window: Message[], systemPrompt?: string): ChatMessage[] {
  const prompt: ChatMessage[] = [];
  if (systemPrompt) prompt.push(systemMessage(systemPrompt));

  for (const message of dropOrphanedToolMessages(window)) {
    if (message.role === "system") continue;

    if (message.role === "tool") {
      prompt.push(
        toolResultMessage(
          message.toolCallId ?? "",
          message.toolName ?? "tool",
          message.content ?? "",
        ),
      );
      continue;
    }

    if (message.role === "assistant") {
      const calls = message.toolCalls ?? [];
      prompt.push(
        calls.length > 0
          ? assistantToolCallMessage(message.content ?? "", calls, message.reasoningDetails)
          : assistantMessage(message.content ?? "", message.reasoningDetails),
      );
      continue;
    }

    prompt.push({ role: message.role, content: message.content ?? "" });
  }
  return prompt;
}
