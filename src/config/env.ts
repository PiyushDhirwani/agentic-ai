// Build-time guard: importing this from a client component is an error.
// Nothing here carries a NEXT_PUBLIC_ prefix, so none of it may be bundled.
import "server-only";
import { APP, DEFAULTS, OPENROUTER } from "./constants";

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
    get primaryModel() {
      return optional("OPENROUTER_MODEL") ?? OPENROUTER.defaultModel;
    },
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
