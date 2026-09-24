import type {
  Citation,
  Conversation,
  Message,
  ReasoningDetail,
  Role,
  ToolCall,
} from "@/models";

/** Raw shapes as Postgres returns them, and the mappers into domain models. */

export interface MessageRow {
  id: string | number;
  conversation_id: string;
  role: Role;
  content: string | null;
  reasoning_details: ReasoningDetail[] | null;
  citations: Citation[] | null;
  tool_calls: ToolCall[] | null;
  tool_call_id: string | null;
  tool_name: string | null;
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
    citations: row.citations ?? null,
    toolCalls: row.tool_calls ?? null,
    toolCallId: row.tool_call_id ?? null,
    toolName: row.tool_name ?? null,
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
