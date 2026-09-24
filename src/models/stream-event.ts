import type { Citation } from "./citation";
import type { ToolCall, ToolResult } from "./tool";
import type { Completion } from "./completion";
import type { Usage } from "./usage";

/** Events the OpenRouter streaming client yields internally. */
export type ProviderStreamEvent =
  | { type: "model"; model: string }
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "done"; completion: Completion };

/**
 * The SSE contract between `POST /api/chat` and the browser. Both sides import
 * this, so the wire format cannot drift between them.
 */
export type ChatStreamEvent =
  | { type: "start"; conversationId: string; historyMessages: number; recalled: number }
  | { type: "model"; model: string }
  | { type: "reasoning"; text: string }
  | { type: "delta"; text: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "tool_call"; calls: { id: string; name: string }[] }
  | { type: "tool_result"; results: { name: string; isError: boolean }[] }
  | { type: "done"; conversationId: string; messageId: number; model: string; usage: Usage }
  | { type: "error"; error: string; conversationId?: string };
