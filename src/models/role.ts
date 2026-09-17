/** Who authored a message. Mirrors the CHECK constraint on messages.role. */
export type Role = "system" | "user" | "assistant";

export const ROLES: readonly Role[] = ["system", "user", "assistant"] as const;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
