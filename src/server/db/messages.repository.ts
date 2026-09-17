import type { Message, NewMessage } from "@/models";
import { sql } from "./client";
import { type MessageRow, toMessage } from "./rows";

/** Newest `limit` messages, returned oldest-first so they can be replayed. */
export async function findRecent(conversationId: string, limit: number): Promise<Message[]> {
  const rows = (await sql()`
    SELECT * FROM (
      SELECT id, conversation_id, role, content, reasoning_details, model, created_at
      FROM messages
      WHERE conversation_id = ${conversationId}
      ORDER BY id DESC
      LIMIT ${limit}
    ) recent
    ORDER BY id ASC
  `) as MessageRow[];
  return rows.map(toMessage);
}

/** Full transcript, oldest-first. For the read API, not for inference. */
export async function findAll(conversationId: string): Promise<Message[]> {
  const rows = (await sql()`
    SELECT id, conversation_id, role, content, reasoning_details, model, created_at
    FROM messages
    WHERE conversation_id = ${conversationId}
    ORDER BY id ASC
  `) as MessageRow[];
  return rows.map(toMessage);
}

export async function insert(message: NewMessage): Promise<Message> {
  const rows = (await sql()`
    INSERT INTO messages
      (conversation_id, role, content, reasoning_details, model, prompt_tokens, completion_tokens)
    VALUES (
      ${message.conversationId},
      ${message.role},
      ${message.content},
      ${message.reasoningDetails ? JSON.stringify(message.reasoningDetails) : null}::jsonb,
      ${message.model ?? null},
      ${message.usage?.promptTokens ?? null},
      ${message.usage?.completionTokens ?? null}
    )
    RETURNING id, conversation_id, role, content, reasoning_details, model, created_at
  `) as MessageRow[];
  return toMessage(rows[0]);
}
