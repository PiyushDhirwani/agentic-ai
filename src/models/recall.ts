/** A past message retrieved by similarity to the current question. */
export interface RecalledPassage {
  messageId: number;
  conversationId: string;
  conversationTitle: string | null;
  role: "user" | "assistant";
  content: string;
  /** Cosine similarity in [0, 1]; higher is closer. */
  similarity: number;
  createdAt: string;
}

/** A message awaiting an embedding. */
export interface PendingEmbedding {
  messageId: number;
  conversationId: string;
  content: string;
}
