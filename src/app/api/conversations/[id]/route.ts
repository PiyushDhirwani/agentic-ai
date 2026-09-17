import type { NextRequest } from "next/server";
import { error, json, readJson, validationError } from "@/lib/http";
import { conversations as conversationsRepo, messages as messagesRepo } from "@/server/db";
import { describeFailure } from "@/server/services/chat.service";
import { invalidate } from "@/server/services/history.service";
import { conversationIdSchema, renameConversationSchema } from "@/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Route params are async in Next 16. */
type RouteContext = { params: Promise<{ id: string }> };

async function readId(context: RouteContext) {
  const { id } = await context.params;
  return conversationIdSchema.safeParse(id);
}

/** GET /api/conversations/{id} — conversation plus its full transcript. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const id = await readId(context);
  if (!id.success) return validationError(id.error);

  try {
    const conversation = await conversationsRepo.findById(id.data);
    if (!conversation) return error("Conversation not found", 404);
    return json({ conversation, messages: await messagesRepo.findAll(id.data) });
  } catch (err) {
    console.error("[conversations] read failed:", err);
    return error(describeFailure(err), 500);
  }
}

/** PATCH /api/conversations/{id} — rename. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const id = await readId(context);
  if (!id.success) return validationError(id.error);

  const body = await readJson(request);
  if (body === undefined) return error("Request body must be JSON", 400);

  const parsed = renameConversationSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const renamed = await conversationsRepo.rename(id.data, parsed.data.title);
    if (!renamed) return error("Conversation not found", 404);
    return json({ ok: true });
  } catch (err) {
    console.error("[conversations] rename failed:", err);
    return error(describeFailure(err), 500);
  }
}

/** DELETE /api/conversations/{id} — messages cascade; the cache is cleared too. */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const id = await readId(context);
  if (!id.success) return validationError(id.error);

  try {
    const deleted = await conversationsRepo.remove(id.data);
    await invalidate(id.data);
    if (!deleted) return error("Conversation not found", 404);
    return json({ ok: true });
  } catch (err) {
    console.error("[conversations] delete failed:", err);
    return error(describeFailure(err), 500);
  }
}
