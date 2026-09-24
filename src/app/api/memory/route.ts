import type { NextRequest } from "next/server";
import { env } from "@/config/env";
import { error, json } from "@/lib/http";
import { describeFailure } from "@/server/services/chat.service";
import { forget, status } from "@/server/services/memory.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/memory — recall coverage.
 *
 * After changing EMBEDDING_MODEL this is how you watch the corpus re-embed:
 * `embedded` climbs toward `eligible`, and `byModel` shows the old vectors
 * still taking up space.
 */
export async function GET() {
  if (!env.memory.enabled) {
    return json({ scope: "off", detail: "Semantic recall is disabled (MEMORY_SCOPE=off)." });
  }
  try {
    const report = await status();
    return json({
      ...report,
      pending: Math.max(report.eligible - report.embedded, 0),
      stale: report.byModel.filter((row) => row.model !== report.model),
    });
  } catch (err) {
    console.error("[memory] status failed:", err);
    return error(describeFailure(err), 500);
  }
}

/**
 * DELETE /api/memory?model=<id> — drops every vector for one model.
 *
 * Only derived data is removed, so anything still in use re-embeds itself.
 * Intended for reclaiming space held by a model you have moved off.
 */
export async function DELETE(request: NextRequest) {
  const model = request.nextUrl.searchParams.get("model");
  if (!model) return error("A ?model= query parameter is required", 400);

  try {
    return json({ ok: true, model, deleted: await forget(model) });
  } catch (err) {
    console.error("[memory] forget failed:", err);
    return error(describeFailure(err), 500);
  }
}
