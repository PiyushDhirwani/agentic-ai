/** Who authored a message. Mirrors the CHECK constraint on messages.role. */
export type Role = "system" | "user" | "assistant" | "tool";

export const ROLES: readonly Role[] = ["system", "user", "assistant", "tool"] as const;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Roles a person authored or reads as conversation, i.e. what the UI shows. */
export type VisibleRole = Extract<Role, "user" | "assistant">;
