import { MEMORY, OPENROUTER } from "@/config/constants";
import { env } from "@/config/env";
import { OpenRouterError, isRetryableStatus } from "./errors";

/**
 * Text embeddings via OpenRouter's /embeddings endpoint.
 *
 * Unlike chat, this is not streamed and has no fallback chain: a different
 * embedding model produces vectors in a different space, so silently falling
 * back would poison the index with incomparable rows.
 */

function endpoint(): string {
  return `${env.openRouter.baseUrl}${OPENROUTER.embeddingsPath}`;
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  totalTokens: number | null;
}

/** Embeds one or more texts in a single request. */
export async function embed(input: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
  if (input.length === 0) return { embeddings: [], model: env.memory.model, totalTokens: 0 };

  const timeout = AbortSignal.timeout(env.openRouter.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openRouter.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.app.url,
      "X-Title": env.app.title,
    },
    body: JSON.stringify({
      model: env.memory.model,
      input,
      encoding_format: "float",
      // Matryoshka truncation, so a wider model still fits the column.
      ...(env.memory.dimensions ? { dimensions: env.memory.dimensions } : {}),
      // Transcripts leave the building to be embedded; prefer providers that
      // do not retain them.
      ...(env.memory.denyDataCollection ? { provider: { data_collection: "deny" } } : {}),
    }),
    signal: combined,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OpenRouterError(
      `embeddings (${env.memory.model}): HTTP ${response.status} ${detail.slice(0, 500)}`,
      response.status,
      isRetryableStatus(response.status),
    );
  }

  const payload = await response.json();
  if (payload.error) {
    throw new OpenRouterError(`embeddings: ${payload.error.message ?? "unknown error"}`);
  }

  // The API may return results out of order; `index` is authoritative.
  const rows: { embedding: number[]; index: number }[] = payload.data ?? [];
  const embeddings: number[][] = new Array(input.length);
  for (const row of rows) embeddings[row.index] = row.embedding;

  for (const [position, vector] of embeddings.entries()) {
    if (!Array.isArray(vector)) {
      throw new OpenRouterError(`embeddings: no vector returned for input ${position}`);
    }
    // A width mismatch would be written as a corrupt row, or rejected by
    // Postgres with a confusing error. Fail here, where the cause is obvious.
    if (vector.length !== MEMORY.dimensions) {
      const hint =
        vector.length > MEMORY.maxIndexableDimensions
          ? `Set EMBEDDING_DIMENSIONS=${MEMORY.dimensions} if the model supports ` +
            `truncation; pgvector cannot HNSW-index more than ` +
            `${MEMORY.maxIndexableDimensions} dimensions on the vector type.`
          : `Set EMBEDDING_DIMENSIONS=${MEMORY.dimensions}, pick another model, ` +
            `or change the column width in db/schema.sql.`;
      throw new OpenRouterError(
        `embeddings: ${env.memory.model} returned ${vector.length} dimensions, ` +
          `but message_embeddings.embedding is VECTOR(${MEMORY.dimensions}). ${hint}`,
      );
    }
  }

  return {
    embeddings,
    model: payload.model ?? env.memory.model,
    totalTokens: payload.usage?.total_tokens ?? null,
  };
}

/** Convenience for the single-text case, e.g. the incoming question. */
export async function embedOne(text: string, signal?: AbortSignal): Promise<number[]> {
  const { embeddings } = await embed([text], signal);
  return embeddings[0];
}
