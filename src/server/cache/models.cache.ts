import { DEFAULTS } from "@/config/constants";
import type { ModelOption } from "@/models";
import { redis } from "./client";
import { cacheKeys } from "./keys";

/**
 * The model catalogue changes rarely but is read on every turn, so it is
 * cached with a short TTL — long enough to spare Postgres, short enough that
 * toggling a model takes effect without flushing anything by hand.
 */

export async function read(): Promise<ModelOption[] | null> {
  const client = redis();
  if (!client) return null;

  try {
    const raw = await client.get(cacheKeys.models());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ModelOption[]) : null;
  } catch (error) {
    console.error("[cache] model catalogue read failed:", error);
    return null;
  }
}

export async function write(models: ModelOption[]): Promise<void> {
  const client = redis();
  if (!client) return;
  try {
    await client.set(
      cacheKeys.models(),
      JSON.stringify(models),
      "EX",
      DEFAULTS.modelsCacheTtlSeconds,
    );
  } catch (error) {
    console.error("[cache] model catalogue write failed:", error);
  }
}

export async function invalidate(): Promise<void> {
  const client = redis();
  if (!client) return;
  try {
    await client.del(cacheKeys.models());
  } catch (error) {
    console.error("[cache] model catalogue invalidate failed:", error);
  }
}
