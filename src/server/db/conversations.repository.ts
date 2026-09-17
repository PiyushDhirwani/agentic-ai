import { LIMITS } from "@/config/constants";
import type { Conversation } from "@/models";
import { sql } from "./client";
import { type ConversationRow, toConversation } from "./rows";

export async function create(
  title?: string | null,
  model?: string | null,
): Promise<Conversation> {
  const rows = (await sql()`
    INSERT INTO conversations (title, model)
    VALUES (${title ?? null}, ${model ?? null})
    RETURNING id, title, model, created_at, updated_at
  `) as ConversationRow[];
  return toConversation(rows[0]);
}

export async function findById(id: string): Promise<Conversation | null> {
  const rows = (await sql()`
    SELECT id, title, model, created_at, updated_at
    FROM conversations WHERE id = ${id}
  `) as ConversationRow[];
  return rows.length ? toConversation(rows[0]) : null;
}

/**
 * Returns the conversation, creating it under this exact id if absent — lets a
 * client mint a conversation id and start chatting in one round trip.
 */
export async function ensure(id: string, title?: string | null): Promise<Conversation> {
  const rows = (await sql()`
    INSERT INTO conversations (id, title)
    VALUES (${id}, ${title ?? null})
    ON CONFLICT (id) DO UPDATE
      SET title = COALESCE(conversations.title, EXCLUDED.title)
    RETURNING id, title, model, created_at, updated_at
  `) as ConversationRow[];
  return toConversation(rows[0]);
}

export async function list(
  limit: number = LIMITS.conversationsPerPage,
  offset = 0,
): Promise<Conversation[]> {
  const rows = (await sql()`
    SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
           COUNT(m.id) AS message_count
    FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `) as ConversationRow[];
  return rows.map(toConversation);
}

export async function remove(id: string): Promise<boolean> {
  const rows = (await sql()`
    DELETE FROM conversations WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

export async function rename(id: string, title: string): Promise<boolean> {
  const rows = (await sql()`
    UPDATE conversations SET title = ${title}, updated_at = now()
    WHERE id = ${id} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

export async function touch(id: string, model?: string | null): Promise<void> {
  await sql()`
    UPDATE conversations
    SET updated_at = now(), model = COALESCE(${model ?? null}, model)
    WHERE id = ${id}
  `;
}

/** Sets the title only while it is still empty, so auto-titling never clobbers. */
export async function setTitleIfEmpty(id: string, title: string): Promise<void> {
  await sql()`
    UPDATE conversations SET title = ${title}
    WHERE id = ${id} AND (title IS NULL OR title = '')
  `;
}
