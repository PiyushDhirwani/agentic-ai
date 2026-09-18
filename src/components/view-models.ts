import type { Message, Role } from "@/models";

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
  pending?: boolean;
}

/** Maps a stored message into its view form. System rows are not rendered. */
export function toUiMessage(message: Message): UiMessage {
  return {
    id: String(message.id),
    role: message.role as UiMessage["role"],
    content: message.content ?? "",
    model: message.model,
  };
}

export function toUiMessages(messages: Message[]): UiMessage[] {
  return messages.filter((message) => message.role !== "system").map(toUiMessage);
}
