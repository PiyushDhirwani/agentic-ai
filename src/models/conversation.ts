/** A chat thread. Its id is the handle clients pass to continue a chat. */
export interface Conversation {
  id: string;
  title: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  /** Only present on list queries. */
  messageCount?: number;
}
