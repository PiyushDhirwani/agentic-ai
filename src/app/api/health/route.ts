import { json } from "@/lib/http";
import { redis } from "@/server/cache/client";
import { sql } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckState = "ok" | "degraded" | "not_configured";

interface Check {
  state: CheckState;
  detail?: string;
}

async function checkPostgres(): Promise<Check> {
  try {
    await sql()`SELECT 1`;
    return { state: "ok" };
  } catch (err) {
    return { state: "degraded", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRedis(): Promise<Check> {
  const client = redis();
  if (!client) return { state: "not_configured", detail: "History reads fall back to Postgres." };
  try {
    // lazyConnect means this PING is what opens the connection.
    await client.ping();
    return { state: "ok" };
  } catch (err) {
    return { state: "degraded", detail: err instanceof Error ? err.message : String(err) };
  }
}

function checkOpenRouter(): Check {
  return process.env.OPENROUTER_API_KEY
    ? { state: "ok" }
    : { state: "degraded", detail: "OPENROUTER_API_KEY is not set." };
}

/** GET /api/health — readiness of each dependency. */
export async function GET() {
  const [postgres, cache] = await Promise.all([checkPostgres(), checkRedis()]);
  const openrouter = checkOpenRouter();

  // Redis being absent is a supported configuration, not a failure.
  const healthy = postgres.state === "ok" && openrouter.state === "ok";

  return json(
    { status: healthy ? "ok" : "degraded", checks: { postgres, cache, openrouter } },
    healthy ? 200 : 503,
  );
}
