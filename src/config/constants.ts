/**
 * Fixed values used across the app. Nothing here reads the environment —
 * anything an operator should be able to change lives in `config/env.ts`,
 * and these are its defaults.
 */

export const APP = {
  name: "agentic-ai",
  description:
    "A chat service on OpenRouter, with Neon-backed history and an Upstash sliding window.",
  localUrl: "http://localhost:3000",
} as const;

export const OPENROUTER = {
  baseUrl: "https://openrouter.ai/api/v1",
  chatCompletionsPath: "/chat/completions",
  defaultModel: "google/gemma-4-31b-it:free",
  defaultFallbackModels: "google/gemma-4-26b-a4b-it:free",
  /** Statuses where advancing to the next model in the chain is worthwhile. */
  retryableStatuses: [402, 408, 409, 429] as readonly number[],
} as const;

export const DEFAULTS = {
  /** User/assistant exchanges replayed as context. */
  historyTurns: 50,
  cacheTtlSeconds: 60 * 60 * 24,
  requestTimeoutMs: 55_000,
  reasoningEnabled: true,
} as const;

export const LIMITS = {
  messageChars: 32_000,
  systemPromptChars: 8_000,
  titleChars: 200,
  /** A conversation title is derived from the first line of the question. */
  derivedTitleChars: 80,
  modelIdChars: 200,
  conversationsPerPage: 50,
  maxConversationsPerPage: 200,
} as const;

export const CACHE_KEYS = {
  prefix: "chat:conv",
} as const;

/** Server-Sent Events wire format, shared by the route and the browser reader. */
export const SSE = {
  dataPrefix: "data:",
  commentPrefix: ":",
  doneSentinel: "[DONE]",
  frameSeparator: "\n\n",
  headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    // Tells proxies not to buffer, which would defeat streaming.
    "X-Accel-Buffering": "no",
  },
} as const;

/** Client-side paths. Keeps route strings out of components. */
export const API_ROUTES = {
  chat: "/api/chat",
  conversations: "/api/conversations",
  conversation: (id: string) => `/api/conversations/${id}`,
  health: "/api/health",
} as const;

/**
 * Serverless budget in seconds. Next requires `maxDuration` in a route to be a
 * literal, so this cannot be imported there — it is the single place that
 * records the intended value, and it must match the literal in
 * src/app/api/chat/route.ts and vercel.json. `DEFAULTS.requestTimeoutMs` sits
 * below it so the model call aborts before the platform kills the function.
 */
export const FUNCTION_MAX_DURATION_SECONDS = 60;
