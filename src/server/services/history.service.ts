import { env } from "@/config/env";
import { assistantMessage, systemMessage, type ChatMessage, type Message, type NewMessage } from "@/models";
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
 * Shapes a window into the payload OpenRouter expects. `reasoningDetails` ride
 * along on assistant turns so a reasoning model resumes where it left off.
 *
 * Stored system rows are skipped: the system prompt is supplied fresh each
 * turn, so a change to SYSTEM_PROMPT takes effect immediately.
 */
export function toChatMessages(window: Message[], systemPrompt?: string): ChatMessage[] {
  const prompt: ChatMessage[] = [];
  if (systemPrompt) prompt.push(systemMessage(systemPrompt));

  for (const message of window) {
    if (message.role === "system") continue;
    if (message.role === "assistant") {
      prompt.push(assistantMessage(message.content ?? "", message.reasoningDetails));
    } else {
      prompt.push({ role: message.role, content: message.content ?? "" });
    }
  }
  return prompt;
}
