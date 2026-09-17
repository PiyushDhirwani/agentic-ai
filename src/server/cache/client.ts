import Redis from "ioredis";
import { REDIS } from "@/config/constants";
import { env } from "@/config/env";

/**
 * A single Redis connection over TCP (`redis://` or `rediss://`).
 *
 * Serverless invocations reuse a warm container, so the client is cached on
 * `globalThis` — a per-invocation connection would exhaust the server's
 * client limit under load, and dev hot-reload would leak sockets.
 */

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: Redis | null | undefined;
}

function create(): Redis | null {
  const url = env.redis.url;
  if (!url) {
    console.warn("[cache] REDIS_URL not set; reading history from Postgres.");
    return null;
  }

  const client = new Redis(url, {
    // Do not dial on import: a route that never touches the cache pays nothing.
    lazyConnect: true,
    connectTimeout: REDIS.connectTimeoutMs,
    // A hung Redis must not eat the function's budget. Callers treat a
    // timeout as a cache miss and fall through to Postgres.
    commandTimeout: REDIS.commandTimeoutMs,
    maxRetriesPerRequest: REDIS.maxRetriesPerRequest,
    // Give up reconnecting rather than retrying for the life of the container.
    retryStrategy: (attempt) =>
      attempt > REDIS.maxReconnectAttempts ? null : Math.min(attempt * 200, 1000),
    keepAlive: REDIS.keepAliveMs,
    enableAutoPipelining: true,
  });

  // Without a listener, ioredis emits 'error' as an unhandled event and takes
  // the process down. Connection trouble is survivable here: log and degrade.
  client.on("error", (error: Error) => {
    console.error("[cache] connection error:", error.message);
  });

  return client;
}

/** Returns null when Redis is not configured. Postgres stays the source of truth. */
export function redis(): Redis | null {
  if (globalThis.__redisClient === undefined) {
    globalThis.__redisClient = create();
  }
  return globalThis.__redisClient;
}
