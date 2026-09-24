import type { ReasoningDetail } from "./reasoning";
import type { ToolCall } from "./tool";
import type { Role } from "./role";

/**
 * A message in the shape the OpenRouter API expects — the wire model, not the
 * storage model. See `Message` for what lives in Postgres.
 */
export interface ChatMessage {
  role: Role;
  content: string | null;
  reasoning_details?: ReasoningDetail[] | null;
  /** On an assistant turn: the tools it asked to run. */
  tool_calls?: ToolCall[];
  /** On a tool turn: which call this answers. */
  tool_call_id?: string;
  name?: string;
}

export function userMessage(content: string): ChatMessage {
  return { role: "user", content };
}

export function systemMessage(content: string): ChatMessage {
  return { role: "system", content };
}

export function assistantMessage(
  content: string,
  reasoningDetails?: ReasoningDetail[] | null,
): ChatMessage {
  return {
    role: "assistant",
    content,
    ...(reasoningDetails?.length ? { reasoning_details: reasoningDetails } : {}),
  };
}

/** An assistant turn that requested tools, replayed on the next request. */
export function assistantToolCallMessage(
  content: string,
  toolCalls: ToolCall[],
  reasoningDetails?: ReasoningDetail[] | null,
): ChatMessage {
  return {
    role: "assistant",
    content: content || null,
    tool_calls: toolCalls,
    ...(reasoningDetails?.length ? { reasoning_details: reasoningDetails } : {}),
  };
}

/** The result of one tool call, in the shape the model expects back. */
export function toolResultMessage(
  toolCallId: string,
  name: string,
  content: string,
): ChatMessage {
  return { role: "tool", tool_call_id: toolCallId, name, content };
}
