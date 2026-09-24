import type { Citation, Message, Role } from "@/models";

/**
 * A message as the UI holds it. Distinct from the stored `Message`: it carries
 * transient view state (streaming reasoning text, an in-flight flag) and a
 * client-generated id for rows that Postgres has not assigned one to yet.
 */
export interface UiMessage {
  id: string;
  role: Extract<Role, "user" | "assistant">;
  content: string;
  reasoning?: string;
  model?: string | null;
  citations?: Citation[];
  /** Tools running or finished during this answer, for the activity line. */
  activity?: { name: string; isError?: boolean }[];
  pending?: boolean;
}

/** Maps a stored message into its view form. System rows are not rendered. */
export function toUiMessage(message: Message): UiMessage {
  return {
    id: String(message.id),
    role: message.role as UiMessage["role"],
    content: message.content ?? "",
    model: message.model,
    ...(message.citations?.length ? { citations: message.citations } : {}),
  };
}

/**
 * The transcript as a person reads it. Tool results and the assistant turns
 * that only requested tools are plumbing, not conversation, so they are left
 * out — the answer that followed already reflects them.
 */
export function toUiMessages(messages: Message[]): UiMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => !(message.toolCalls?.length && !message.content))
    .map(toUiMessage);
}
