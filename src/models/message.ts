import type { Citation } from "./citation";
import type { ToolCall } from "./tool";
import type { ReasoningDetail } from "./reasoning";
import type { Role } from "./role";
import type { Usage } from "./usage";

/** A persisted message row. */
export interface Message {
  id: number;
  conversationId: string;
  role: Role;
  content: string | null;
  reasoningDetails: ReasoningDetail[] | null;
  citations: Citation[] | null;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  toolName: string | null;
  model: string | null;
  createdAt: string;
}

/** The fields needed to write a message; the rest are assigned by Postgres. */
export interface NewMessage {
  conversationId: string;
  role: Role;
  content: string | null;
  reasoningDetails?: ReasoningDetail[] | null;
  citations?: Citation[] | null;
  toolCalls?: ToolCall[] | null;
  toolCallId?: string | null;
  toolName?: string | null;
  model?: string | null;
  usage?: Usage | null;
}
