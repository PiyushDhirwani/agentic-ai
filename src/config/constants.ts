/**
 * Fixed values used across the app. Nothing here reads the environment —
 * anything an operator should be able to change lives in `config/env.ts`,
 * and these are its defaults.
 */

export const APP = {
  name: "agentic-ai",
  description:
    "A chat service on OpenRouter, with Neon-backed history and a Redis sliding window.",
  localUrl: "http://localhost:3000",
} as const;

export const OPENROUTER = {
  baseUrl: "https://openrouter.ai/api/v1",
  chatCompletionsPath: "/chat/completions",
  embeddingsPath: "/embeddings",
  /** Bootstrap only: used when the models table is empty or unreachable. */
  defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
  defaultFallbackModels: "nvidia/nemotron-3.5-lightning:free,deepseek/deepseek-v4-flash-0731:free",
  /** Statuses where advancing to the next model in the chain is worthwhile. */
  retryableStatuses: [402, 408, 409, 429] as readonly number[],
} as const;

export const DEFAULTS = {
  /** User/assistant exchanges replayed as context. */
  historyTurns: 50,
  cacheTtlSeconds: 60 * 60 * 24,
  /**
   * The model catalogue is cached briefly, not for a day: enabling or
   * disabling a model should take effect within about a minute without a
   * deploy or a manual cache flush.
   */
  modelsCacheTtlSeconds: 60,
  /**
   * In-process memo in front of Redis, so repeated reads inside one warm
   * container cost nothing. Short, because a container cannot be invalidated
   * remotely: POST /api/models clears Redis and the container that served it,
   * and every other container catches up within this window.
   */
  modelsMemoTtlSeconds: 30,
  /** Bootstrap results are memoised briefly so recovery is quick. */
  modelsBootstrapMemoTtlSeconds: 5,
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

/**
 * Semantic recall over past messages.
 *
 * `scope` decides whose history a question may pull from, and is deliberately
 * off by default — see MEMORY_SCOPE in .env.example. `dimensions` must match
 * the VECTOR(n) column in db/schema.sql; a mismatch is rejected at runtime
 * rather than written as a corrupt row.
 */
export const MEMORY = {
  defaultModel: "openai/text-embedding-3-small",
  /** Must match VECTOR(n) in db/schema.sql. */
  dimensions: 1536,
  /**
   * pgvector's ceiling for an HNSW index on the `vector` type. A wider model
   * must be narrowed with EMBEDDING_DIMENSIONS, or the column switched to
   * halfvec, which reaches 4000.
   */
  maxIndexableDimensions: 2000,
  /** Messages shorter than this carry too little meaning to embed. */
  minChars: 40,
  /** Passages injected into a prompt. */
  topK: 4,
  /** Cosine similarity below this is noise, not recall. */
  minSimilarity: 0.75,
  /** Ceiling on messages embedded per background pass. */
  batchSize: 32,
  /** Characters of each recalled passage shown to the model. */
  excerptChars: 600,
} as const;

export type MemoryScope = "off" | "conversation" | "global";

/**
 * OpenRouter offers web search in two shapes, and the difference matters.
 *
 * "tool"   - `tools: [{ type: "openrouter:web_search" }]`. A server tool: the
 *            MODEL decides whether a search is warranted, so a question it can
 *            already answer costs nothing. Richer controls (domain filters,
 *            max_uses, context size). Requires a tool-calling model.
 *
 * "plugin" - `plugins: [{ id: "web" }]`. Search runs unconditionally before
 *            the model sees the prompt, so it works with ANY model including
 *            ones with no tool-calling support — at the cost of searching (and
 *            being billed) every time.
 *
 * Either way OpenRouter bills each search, even on a free model.
 */
export type WebSearchMode = "tool" | "plugin";

export type WebSearchEngine =
  | "auto"
  | "native"
  | "exa"
  | "firecrawl"
  | "parallel"
  | "perplexity";

export type SearchContextSize = "low" | "medium" | "high";

export const WEB_SEARCH = {
  /** Server-tool type, for mode "tool". */
  toolType: "openrouter:web_search",
  /** Plugin id, for mode "plugin". */
  pluginId: "web",
  defaultMode: "tool" as WebSearchMode,
  maxResults: 5,
  /** Searches the model may run per turn — the main cost ceiling. */
  maxUses: 3,
} as const;

/**
 * MCP client settings. Only remote (Streamable HTTP) servers are reachable
 * from a serverless function, so there is no stdio transport here.
 */
export const MCP = {
  protocolVersion: "2025-06-18",
  clientName: "agentic-ai",
  clientVersion: "0.1.0",
  timeoutMs: 20_000,
  /** A tool result longer than this is truncated before the model sees it. */
  maxResultChars: 8_000,
  /**
   * Tool round trips allowed per turn. Each one is another model call plus an
   * external request, and the function budget is 60s.
   */
  maxIterations: 3,
} as const;

export const CACHE_KEYS = {
  prefix: "chat:conv",
  modelsKey: "chat:models",
  toolsKey: "chat:mcp:tools",
} as const;

/**
 * Connection tuning for a serverless caller. Every timeout is short on
 * purpose: a slow cache must degrade to Postgres rather than spend the
 * function's budget waiting.
 */
export const REDIS = {
  connectTimeoutMs: 5_000,
  commandTimeoutMs: 3_000,
  maxRetriesPerRequest: 1,
  maxReconnectAttempts: 2,
  keepAliveMs: 30_000,
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

/** Page routes. A conversation is addressable so its URL can be shared. */
export const ROUTES = {
  newChat: "/",
  conversation: (id: string) => `/c/${id}`,
} as const;

/** Client-side paths. Keeps route strings out of components. */
export const API_ROUTES = {
  chat: "/api/chat",
  models: "/api/models",
  conversations: "/api/conversations",
  conversation: (id: string) => `/api/conversations/${id}`,
  health: "/api/health",
  memory: "/api/memory",
} as const;

/**
 * Serverless budget in seconds. Next requires `maxDuration` in a route to be a
 * literal, so this cannot be imported there — it is the single place that
 * records the intended value, and it must match the literal in
 * src/app/api/chat/route.ts and vercel.json. `DEFAULTS.requestTimeoutMs` sits
 * below it so the model call aborts before the platform kills the function.
 */
export const FUNCTION_MAX_DURATION_SECONDS = 60;
