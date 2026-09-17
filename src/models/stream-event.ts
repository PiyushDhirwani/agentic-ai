import type { Completion } from "./completion";
import type { Usage } from "./usage";

/** Events the OpenRouter streaming client yields internally. */
export type ProviderStreamEvent =
  | { type: "model"; model: string }
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "done"; completion: Completion };

/**
 * The SSE contract between `POST /api/chat` and the browser. Both sides import
 * this, so the wire format cannot drift between them.
 */
export type ChatStreamEvent =
  | { type: "start"; conversationId: string; historyMessages: number }
  | { type: "model"; model: string }
  | { type: "reasoning"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; conversationId: string; messageId: number; model: string; usage: Usage }
  | { type: "error"; error: string; conversationId?: string };
