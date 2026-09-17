import { env } from "@/config/env";
import type { Message } from "@/models";
import { redis } from "./client";
import { cacheKeys } from "./keys";

/**
 * The Redis half of the sliding window. Every operation is best-effort: a
 * failure logs and reports a miss so the caller falls back to Postgres.
 */

function deserialize(raw: unknown): Message | null {
  try {
    // Upstash auto-parses JSON, so a value may already be an object.
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (value && typeof value === "object" && "role" in value) return value as Message;
    return null;
  } catch {
    return null;
  }
}

/** Returns null on a miss — distinct from [] which is a real empty window. */
export async function read(conversationId: string): Promise<Message[] | null> {
  const client = redis();
  if (!client) return null;

  try {
    const [warm, raw] = await Promise.all([
      client.exists(cacheKeys.warm(conversationId)),
      client.lrange<unknown>(cacheKeys.window(conversationId), -env.chat.historyMessages, -1),
    ]);
    if (!warm) return null;
    return (raw ?? []).map(deserialize).filter((m): m is Message => m !== null);
  } catch (error) {
    console.error("[cache] read failed:", error);
    return null;
  }
}

/** Replaces the cached window wholesale, after loading it from Postgres. */
export async function fill(conversationId: string, messages: Message[]): Promise<void> {
  const client = redis();
  if (!client) return;

  try {
    const windowKey = cacheKeys.window(conversationId);
    const pipeline = client.pipeline();
    pipeline.del(windowKey);
    if (messages.length > 0) {
      pipeline.rpush(windowKey, ...messages.map((m) => JSON.stringify(m)));
      pipeline.expire(windowKey, env.redis.ttlSeconds);
    }
    pipeline.set(cacheKeys.warm(conversationId), 1, { ex: env.redis.ttlSeconds });
    await pipeline.exec();
  } catch (error) {
    console.error("[cache] fill failed:", error);
  }
}

/**
 * Appends one message and trims back to the window size. Skipped when the
 * window is not hydrated, since extending a cold list would make it look warm
 * while holding only part of the history.
 */
export async function append(conversationId: string, message: Message): Promise<void> {
  const client = redis();
  if (!client) return;

  try {
    const warmKey = cacheKeys.warm(conversationId);
    if (!(await client.exists(warmKey))) return;

    const windowKey = cacheKeys.window(conversationId);
    const pipeline = client.pipeline();
    pipeline.rpush(windowKey, JSON.stringify(message));
    pipeline.ltrim(windowKey, -env.chat.historyMessages, -1);
    pipeline.expire(windowKey, env.redis.ttlSeconds);
    pipeline.expire(warmKey, env.redis.ttlSeconds);
    await pipeline.exec();
  } catch (error) {
    console.error("[cache] append failed; Postgres already has the message:", error);
  }
}

export async function invalidate(conversationId: string): Promise<void> {
  const client = redis();
  if (!client) return;
  try {
    await client.del(cacheKeys.window(conversationId), cacheKeys.warm(conversationId));
  } catch (error) {
    console.error("[cache] invalidate failed:", error);
  }
}
