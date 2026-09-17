import { z } from "zod";
import { LIMITS } from "@/config/constants";

export const conversationIdSchema = z.uuid("Invalid conversation id");

export const chatRequestSchema = z.object({
  /** Omit to start a new conversation; pass a UUID to continue one. */
  conversationId: conversationIdSchema.optional(),
  message: z.string().min(1, "message is required").max(LIMITS.messageChars),
  /** Overrides the primary model; the configured fallbacks still apply. */
  model: z.string().min(1).max(LIMITS.modelIdChars).optional(),
  systemPrompt: z.string().max(LIMITS.systemPromptChars).optional(),
  stream: z.boolean().optional().default(true),
});

export const createConversationSchema = z.object({
  title: z.string().min(1).max(LIMITS.titleChars).optional(),
  model: z.string().min(1).max(LIMITS.modelIdChars).optional(),
});

export const renameConversationSchema = z.object({
  title: z.string().min(1).max(LIMITS.titleChars),
});

export const paginationSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(LIMITS.maxConversationsPerPage)
    .default(LIMITS.conversationsPerPage),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
