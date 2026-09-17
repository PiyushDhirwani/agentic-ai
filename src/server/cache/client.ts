import { Redis } from "@upstash/redis";
import { env } from "@/config/env";

let client: Redis | null | undefined;

/**
 * Returns null when Upstash is not configured. Every caller must treat the
 * cache as optional — Postgres is always the source of truth.
 */
export function redis(): Redis | null {
  if (client !== undefined) return client;

  if (!env.redis.isConfigured) {
    console.warn("[cache] Upstash not configured; reading history from Postgres.");
    client = null;
    return client;
  }

  client = new Redis({ url: env.redis.url!, token: env.redis.token! });
  return client;
}
