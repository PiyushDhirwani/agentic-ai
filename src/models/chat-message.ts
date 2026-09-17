import type { ReasoningDetail } from "./reasoning";
import type { Role } from "./role";

/**
 * A message in the shape the OpenRouter API expects — the wire model, not the
 * storage model. See `Message` for what lives in Postgres.
 */
export interface ChatMessage {
  role: Role;
  content: string | null;
  reasoning_details?: ReasoningDetail[] | null;
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
