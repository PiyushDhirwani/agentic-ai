// Build-time guard: importing this from a client component is an error.
// Nothing here carries a NEXT_PUBLIC_ prefix, so none of it may be bundled.
import "server-only";
import {
  APP,
  DEFAULTS,
  MCP,
  MEMORY,
  OPENROUTER,
  WEB_SEARCH,
  type MemoryScope,
  type SearchContextSize,
  type WebSearchEngine,
  type WebSearchMode,
} from "./constants";

/**
 * Environment-driven configuration. Every value is read lazily so importing
 * this module never requires a variable to be present — a missing optional
 * service degrades instead of breaking the build.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Reads a ratio in (0, 1]; anything else falls back. */
function ratio(name: string, fallback: number): number {
  const raw = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw !== "false" && raw !== "0";
}

function csv(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const env = {
  openRouter: {
    get apiKey() {
      return required("OPENROUTER_API_KEY");
    },
    get baseUrl() {
      return (optional("OPENROUTER_BASE_URL") ?? OPENROUTER.baseUrl).replace(/\/+$/, "");
    },
    /**
     * Bootstrap model. The catalogue in Postgres is the real source; this is
     * used only when the models table is empty or unreachable.
     */
    get primaryModel() {
      return optional("OPENROUTER_MODEL") ?? OPENROUTER.defaultModel;
    },
    /** Bootstrap fallbacks, same caveat as primaryModel. */
    get fallbackModels() {
      return csv("OPENROUTER_FALLBACK_MODELS", OPENROUTER.defaultFallbackModels);
    },
    get reasoningEnabled() {
      return bool("OPENROUTER_REASONING", DEFAULTS.reasoningEnabled);
    },
    get timeoutMs() {
      return int("OPENROUTER_TIMEOUT_MS", DEFAULTS.requestTimeoutMs);
    },
  },

  database: {
    get url() {
      return required("DATABASE_URL");
    },
  },

  redis: {
    /** A standard connection string: redis:// or rediss:// for TLS. */
    get url() {
      return optional("REDIS_URL");
    },
    get isConfigured() {
      return Boolean(this.url);
    },
    get ttlSeconds() {
      return int("CACHE_TTL_SECONDS", DEFAULTS.cacheTtlSeconds);
    },
  },

  webSearch: {
    /** Whether the UI offers the toggle at all. */
    get available() {
      return bool("WEB_SEARCH_AVAILABLE", true);
    },
    /**
     * "tool" lets the model decide when to search — cheaper and more
     * controllable, but the model must support tool calling. "plugin" always
     * searches and works with any model. See WEB_SEARCH in constants.ts.
     */
    get mode(): WebSearchMode {
      return optional("WEB_SEARCH_MODE") === "plugin" ? "plugin" : WEB_SEARCH.defaultMode;
    },
    /**
     * Whether a request with no explicit choice searches. Off by default:
     * OpenRouter bills each search even on a free model, so turning this on
     * silently puts a per-message cost on every conversation.
     */
    get defaultOn() {
      return bool("WEB_SEARCH_DEFAULT", false);
    },
    get maxResults() {
      return int("WEB_SEARCH_MAX_RESULTS", WEB_SEARCH.maxResults);
    },
    get engine(): WebSearchEngine | undefined {
      const raw = optional("WEB_SEARCH_ENGINE");
      const engines: WebSearchEngine[] = [
        "auto",
        "native",
        "exa",
        "firecrawl",
        "parallel",
        "perplexity",
      ];
      return engines.includes(raw as WebSearchEngine) ? (raw as WebSearchEngine) : undefined;
    },
    /** Hard ceiling on searches per turn; the main lever on cost. */
    get maxUses() {
      return int("WEB_SEARCH_MAX_USES", WEB_SEARCH.maxUses);
    },
    get maxTotalResults(): number | undefined {
      const raw = process.env.WEB_SEARCH_MAX_TOTAL_RESULTS;
      if (!raw) return undefined;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    },
    get contextSize(): SearchContextSize | undefined {
      const raw = optional("WEB_SEARCH_CONTEXT_SIZE");
      return raw === "low" || raw === "medium" || raw === "high" ? raw : undefined;
    },
    get maxCharacters(): number | undefined {
      const raw = process.env.WEB_SEARCH_MAX_CHARACTERS;
      if (!raw) return undefined;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    },
    /** Restricts search to these domains. Empty means no restriction. */
    get allowedDomains() {
      return csv("WEB_SEARCH_ALLOWED_DOMAINS", "");
    },
    get excludedDomains() {
      return csv("WEB_SEARCH_EXCLUDED_DOMAINS", "");
    },
  },

  tools: {
    /**
     * Whether MCP tools are offered to the model. Requires a tool-calling
     * model — verify with:
     *   curl -s https://openrouter.ai/api/v1/models | jq -r \
     *     '.data[] | select(.supported_parameters|index("tools")) | .id'
     */
    get enabled() {
      return bool("MCP_ENABLED", false);
    },
    get maxIterations() {
      return int("MCP_MAX_ITERATIONS", MCP.maxIterations);
    },
    /** How long a server's tool listing is cached. */
    get listTtlSeconds() {
      return int("MCP_TOOLS_TTL_SECONDS", 300);
    },
  },

  memory: {
    /**
     * off          - no semantic recall (default)
     * conversation - recall older turns of the SAME conversation only
     * global       - recall from every conversation in the database
     *
     * `global` shares one person's past messages into another's prompt. With
     * no authentication that means any visitor's content can surface in any
     * other visitor's chat, so it is opt-in and never the default.
     */
    get scope(): MemoryScope {
      const raw = optional("MEMORY_SCOPE");
      return raw === "conversation" || raw === "global" ? raw : "off";
    },
    get enabled() {
      return this.scope !== "off";
    },
    /**
     * The embedding model. Independent of the chat models in the `models`
     * table — changing which LLM answers does not affect embeddings at all.
     *
     * Changing THIS value is safe but not free: vectors from a different model
     * are not comparable, so searches ignore them and the corpus re-embeds
     * itself in the background. Recall is thin until that catches up.
     */
    get model() {
      return optional("EMBEDDING_MODEL") ?? MEMORY.defaultModel;
    },
    /**
     * Requests a narrower vector from a Matryoshka-capable model, so a wider
     * model still fits the VECTOR(n) column and pgvector's index limit. Only
     * sent when set explicitly, since models that cannot truncate reject it.
     */
    get dimensions(): number | undefined {
      const raw = process.env.EMBEDDING_DIMENSIONS;
      if (!raw) return undefined;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    },
    get topK() {
      return int("MEMORY_TOP_K", MEMORY.topK);
    },
    get minSimilarity() {
      return ratio("MEMORY_MIN_SIMILARITY", MEMORY.minSimilarity);
    },
    get minChars() {
      return int("MEMORY_MIN_CHARS", MEMORY.minChars);
    },
    /**
     * Ask OpenRouter to route only to providers that do not retain prompts.
     * On by default: embedding a transcript sends it to a third party.
     */
    get denyDataCollection() {
      return bool("EMBEDDING_DENY_DATA_COLLECTION", true);
    },
  },

  chat: {
    /** Exchanges replayed as context. */
    get historyTurns() {
      return int("HISTORY_TURNS", DEFAULTS.historyTurns);
    },
    /** Each exchange is a user message plus an assistant message. */
    get historyMessages() {
      return this.historyTurns * 2;
    },
    get systemPrompt() {
      return optional("SYSTEM_PROMPT");
    },
  },

  app: {
    /**
     * Sent to OpenRouter as HTTP-Referer for attribution. Read on the server
     * only, so it is deliberately not NEXT_PUBLIC_ — that prefix would inline
     * the value into the browser bundle for no benefit.
     */
    get url() {
      const explicit = optional("APP_URL");
      if (explicit) return explicit;
      const vercel = optional("VERCEL_URL");
      return vercel ? `https://${vercel}` : APP.localUrl;
    },
    get title() {
      return optional("APP_TITLE") ?? APP.name;
    },
  },
};
