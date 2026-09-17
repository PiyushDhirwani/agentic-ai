import { CACHE_KEYS } from "@/config/constants";

export const cacheKeys = {
  /** LIST of JSON messages, oldest -> newest, trimmed to the window size. */
  window: (conversationId: string) => `${CACHE_KEYS.prefix}:${conversationId}:window`,
  /** Marks a window as hydrated, so an empty list is not read as a cache miss. */
  warm: (conversationId: string) => `${CACHE_KEYS.prefix}:${conversationId}:warm`,
};
