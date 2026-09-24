import { MEMORY } from "@/config/constants";
import type { PendingEmbedding, RecalledPassage } from "@/models";
import { sql } from "./client";

/** pgvector accepts a vector literal as text: "[0.1,0.2,...]". */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

interface SearchRow {
  message_id: string | number;
  conversation_id: string;
  conversation_title: string | null;
  role: "user" | "assistant";
  content: string;
  similarity: number | string;
  created_at: string | Date;
}

function toPassage(row: SearchRow): RecalledPassage {
  return {
    messageId: Number(row.message_id),
    conversationId: row.conversation_id,
    conversationTitle: row.conversation_title,
    role: row.role,
    content: row.content,
    similarity: Number(row.similarity),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Messages in a conversation with no embedding **for this model**.
 *
 * Scoping the join by model is what makes an embedding-model switch
 * self-healing: the new model matches nothing, so everything looks pending and
 * is re-embedded in the background as conversations are used.
 */
export async function findPending(
  conversationId: string,
  model: string,
  limit = MEMORY.batchSize,
): Promise<PendingEmbedding[]> {
  const rows = (await sql()`
    SELECT m.id AS message_id, m.conversation_id, m.content
    FROM messages m
    LEFT JOIN message_embeddings e
      ON e.message_id = m.id AND e.model = ${model}
    WHERE m.conversation_id = ${conversationId}
      AND e.message_id IS NULL
      AND m.role IN ('user', 'assistant')
      AND m.content IS NOT NULL
      AND length(m.content) >= ${MEMORY.minChars}
    ORDER BY m.id DESC
    LIMIT ${limit}
  `) as { message_id: string | number; conversation_id: string; content: string }[];

  return rows.map((row) => ({
    messageId: Number(row.message_id),
    conversationId: row.conversation_id,
    content: row.content,
  }));
}

/** Stores one embedding. Re-running is harmless. */
export async function insert(
  messageId: number,
  conversationId: string,
  embedding: number[],
  model: string,
): Promise<void> {
  await sql()`
    INSERT INTO message_embeddings
      (message_id, conversation_id, model, dimensions, embedding)
    VALUES (
      ${messageId}, ${conversationId}, ${model}, ${embedding.length},
      ${toVectorLiteral(embedding)}::vector
    )
    ON CONFLICT (message_id, model) DO NOTHING
  `;
}

/** Embedded-message counts per model, for diagnosing a switch in progress. */
export async function coverage(): Promise<{ model: string; embedded: number }[]> {
  const rows = (await sql()`
    SELECT model, COUNT(*)::int AS embedded
    FROM message_embeddings
    GROUP BY model
    ORDER BY embedded DESC
  `) as { model: string; embedded: number }[];
  return rows.map((row) => ({ model: row.model, embedded: Number(row.embedded) }));
}

/** Messages eligible for embedding, i.e. the denominator for coverage. */
export async function eligibleMessageCount(): Promise<number> {
  const rows = (await sql()`
    SELECT COUNT(*)::int AS n FROM messages
    WHERE role IN ('user', 'assistant')
      AND content IS NOT NULL
      AND length(content) >= ${MEMORY.minChars}
  `) as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/** Removes every vector for a model. The table is a cache; this is safe. */
export async function deleteByModel(model: string): Promise<number> {
  const rows = (await sql()`
    DELETE FROM message_embeddings WHERE model = ${model} RETURNING message_id
  `) as { message_id: number }[];
  return rows.length;
}

/**
 * Nearest passages from OTHER conversations.
 *
 * `<=>` is cosine distance, so similarity is 1 - distance. Ordering by the raw
 * distance is what lets the HNSW index serve the query; filtering on the
 * derived similarity afterwards would not.
 *
 * The `model` filter is load-bearing: vectors produced by different embedding
 * models occupy different spaces, so comparing them yields confident nonsense.
 * Rows from any other model are excluded rather than mixed in.
 */
export async function searchAcrossConversations(
  embedding: number[],
  model: string,
  excludeConversationId: string,
  limit: number,
  minSimilarity: number,
): Promise<RecalledPassage[]> {
  const rows = (await sql()`
    SELECT m.id AS message_id, m.conversation_id, c.title AS conversation_title,
           m.role, m.content, m.created_at,
           1 - (e.embedding <=> ${toVectorLiteral(embedding)}::vector) AS similarity
    FROM message_embeddings e
    JOIN messages m ON m.id = e.message_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE e.model = ${model}
      AND m.conversation_id <> ${excludeConversationId}
      AND 1 - (e.embedding <=> ${toVectorLiteral(embedding)}::vector) >= ${minSimilarity}
    ORDER BY e.embedding <=> ${toVectorLiteral(embedding)}::vector
    LIMIT ${limit}
  `) as SearchRow[];
  return rows.map(toPassage);
}

/**
 * Nearest passages from earlier in the SAME conversation — the part that has
 * already slid out of the context window.
 */
export async function searchWithinConversation(
  embedding: number[],
  model: string,
  conversationId: string,
  olderThanMessageId: number,
  limit: number,
  minSimilarity: number,
): Promise<RecalledPassage[]> {
  const rows = (await sql()`
    SELECT m.id AS message_id, m.conversation_id, c.title AS conversation_title,
           m.role, m.content, m.created_at,
           1 - (e.embedding <=> ${toVectorLiteral(embedding)}::vector) AS similarity
    FROM message_embeddings e
    JOIN messages m ON m.id = e.message_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE e.model = ${model}
      AND m.conversation_id = ${conversationId}
      AND m.id < ${olderThanMessageId}
      AND 1 - (e.embedding <=> ${toVectorLiteral(embedding)}::vector) >= ${minSimilarity}
    ORDER BY e.embedding <=> ${toVectorLiteral(embedding)}::vector
    LIMIT ${limit}
  `) as SearchRow[];
  return rows.map(toPassage);
}
