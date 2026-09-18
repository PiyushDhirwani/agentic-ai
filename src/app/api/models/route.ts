import { error, json } from "@/lib/http";
import { describeFailure } from "@/server/services/chat.service";
import { getCatalogue, refresh } from "@/server/services/models.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/models — the selectable models and the current default. */
export async function GET() {
  try {
    const catalogue = await getCatalogue();
    return json({
      defaultModel: catalogue.defaultModel,
      models: catalogue.options,
      // True when the models table was empty or unreachable and env was used.
      fromBootstrap: catalogue.fromBootstrap,
    });
  } catch (err) {
    console.error("[models] read failed:", err);
    return error(describeFailure(err), 500);
  }
}

/**
 * POST /api/models/refresh is overkill for one action, so a bare POST drops
 * the cached catalogue — use it after editing the models table by hand
 * instead of waiting out the TTL.
 */
export async function POST() {
  try {
    await refresh();
    return json({ ok: true, ...(await getCatalogue()) });
  } catch (err) {
    console.error("[models] refresh failed:", err);
    return error(describeFailure(err), 500);
  }
}
