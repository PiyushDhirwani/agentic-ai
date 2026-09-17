import type { Conversation, Message, ReasoningDetail, Role } from "@/models";

/** Raw shapes as Postgres returns them, and the mappers into domain models. */

export interface MessageRow {
  id: string | number;
  conversation_id: string;
  role: Role;
  content: string | null;
  reasoning_details: ReasoningDetail[] | null;
  model: string | null;
  created_at: string | Date;
}

export interface ConversationRow {
  id: string;
  title: string | null;
  model: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  message_count?: string | number;
}

export function toMessage(row: MessageRow): Message {
  return {
    // BIGSERIAL can arrive as a string; normalise it once, here.
    id: Number(row.id),
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    reasoningDetails: row.reasoning_details ?? null,
    model: row.model,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.message_count !== undefined ? { messageCount: Number(row.message_count) } : {}),
  };
}
