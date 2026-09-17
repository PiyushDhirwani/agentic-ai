import type { NextRequest } from "next/server";
import { SSE } from "@/config/constants";
import { error, json, readJson, validationError } from "@/lib/http";
import { encodeDone, encodeFrame } from "@/lib/sse";
import * as chatService from "@/server/services/chat.service";
import { chatRequestSchema } from "@/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Must be a literal: Next statically analyses segment config, so it cannot be
// imported. Keep in step with FUNCTION_MAX_DURATION_SECONDS and vercel.json.
export const maxDuration = 60;

/**
 * POST /api/chat — one turn, streamed as SSE by default.
 *
 * This handler only adapts HTTP to `chat.service`: parse, delegate, encode.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  if (body === undefined) return error("Request body must be JSON", 400);

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const { stream: wantsStream, ...turn } = parsed.data;

  let conversationId: string;
  try {
    conversationId = await chatService.resolveConversationId(turn);
  } catch (err) {
    console.error("[chat] conversation setup failed:", err);
    return error(chatService.describeFailure(err), 500);
  }

  let prompt: chatService.Prompt;
  try {
    prompt = await chatService.buildPrompt(conversationId, turn);
  } catch (err) {
    console.error("[chat] history load failed:", err);
    return error(chatService.describeFailure(err), 500);
  }

  if (!wantsStream) {
    try {
      const result = await chatService.runTurn(conversationId, turn, prompt, request.signal);
      return json({
        conversationId: result.conversationId,
        messageId: result.messageId,
        content: result.completion.content,
        reasoning: result.completion.reasoning,
        model: result.completion.model,
        usage: result.completion.usage,
        historyMessages: result.historyMessages,
        fallbacks: result.completion.attempts,
      });
    } catch (err) {
      console.error("[chat] completion failed:", err);
      return error(chatService.describeFailure(err), 502, { conversationId });
    }
  }

  return sseResponse(chatService.streamTurn(conversationId, turn, prompt, request.signal));
}

/** Encodes a stream of domain events as an SSE response. */
function sseResponse(events: AsyncGenerator<unknown>): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(encodeFrame(event)));
        }
      } catch (err) {
        console.error("[chat] stream encoding failed:", err);
        controller.enqueue(
          encoder.encode(encodeFrame({ type: "error", error: chatService.describeFailure(err) })),
        );
      } finally {
        controller.enqueue(encoder.encode(encodeDone()));
        controller.close();
      }
    },
  });

  return new Response(body, { headers: SSE.headers });
}
