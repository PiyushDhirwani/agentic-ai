import type { Citation } from "./citation";
import type { ReasoningDetail } from "./reasoning";
import type { ToolCall } from "./tool";
import type { Usage } from "./usage";

/** One model that was tried and why it did not answer. */
export interface FailedAttempt {
  model: string;
  error: string;
}

/** The finished result of a completion, streamed or not. */
export interface Completion {
  content: string;
  reasoning: string;
  reasoningDetails: ReasoningDetail[] | null;
  /** The model that actually answered, which may be a fallback. */
  model: string;
  usage: Usage;
  /** Sources returned when web search ran; empty otherwise. */
  citations: Citation[];
  /** Tools the model asked to run. Non-empty means the turn is not finished. */
  toolCalls: ToolCall[];
  attempts: FailedAttempt[];
}
