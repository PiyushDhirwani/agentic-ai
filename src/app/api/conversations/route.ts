import type { NextRequest } from "next/server";
import { error, json, readJson, validationError } from "@/lib/http";
import { conversations as conversationsRepo } from "@/server/db";
import { describeFailure } from "@/server/services/chat.service";
import { createConversationSchema, paginationSchema } from "@/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/conversations — newest first. */
export async function GET(request: NextRequest) {
  const parsed = paginationSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return validationError(parsed.error);

  try {
    const { limit, offset } = parsed.data;
    return json({ conversations: await conversationsRepo.list(limit, offset) });
  } catch (err) {
    console.error("[conversations] list failed:", err);
    return error(describeFailure(err), 500);
  }
}

/** POST /api/conversations — create an empty conversation. */
export async function POST(request: NextRequest) {
  // An absent body is fine: it means "new untitled conversation".
  const parsed = createConversationSchema.safeParse((await readJson(request)) ?? {});
  if (!parsed.success) return validationError(parsed.error);

  try {
    const conversation = await conversationsRepo.create(parsed.data.title, parsed.data.model);
    return json({ conversation }, 201);
  } catch (err) {
    console.error("[conversations] create failed:", err);
    return error(describeFailure(err), 500);
  }
}
