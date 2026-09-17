import { frameData, isDone, takeLines, textChunks } from "@/lib/sse";
import {
  EMPTY_USAGE,
  type ChatMessage,
  type FailedAttempt,
  type ProviderStreamEvent,
  type ReasoningDetail,
  type Usage,
  toUsage,
} from "@/models";
import { requestCompletion } from "./client";
import { OpenRouterError } from "./errors";
import { modelChain } from "./model-chain";
import { collectReasoningDetails, mergeReasoningDetails } from "./reasoning";

/** Everything accumulated while reading one model's stream. */
interface Accumulator {
  content: string;
  reasoning: string;
  model: string;
  usage: Usage;
  details: Map<number, ReasoningDetail>;
}

/** Reads one model's SSE stream, yielding deltas as they arrive. */
async function* readStream(
  body: ReadableStream<Uint8Array>,
  acc: Accumulator,
): AsyncGenerator<ProviderStreamEvent> {
  let buffer = "";

  for await (const chunk of textChunks(body)) {
    buffer += chunk;
    const { lines, rest } = takeLines(buffer);
    buffer = rest;

    for (const line of lines) {
      if (isDone(line)) return;

      const data = frameData(line);
      if (!data) continue;

      let frame: any;
      try {
        frame = JSON.parse(data);
      } catch {
        continue; // a partial frame; the next chunk completes it
      }

      if (frame.error) {
        throw new OpenRouterError(
          `${acc.model}: ${frame.error.message ?? "stream error"}`,
          frame.error.code,
          true,
        );
      }

      if (frame.model) acc.model = frame.model;
      if (frame.usage) acc.usage = toUsage(frame.usage);

      const delta = frame.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
        acc.reasoning += delta.reasoning;
        yield { type: "reasoning", text: delta.reasoning };
      }
      mergeReasoningDetails(acc.details, delta.reasoning_details);

      if (typeof delta.content === "string" && delta.content.length > 0) {
        acc.content += delta.content;
        yield { type: "delta", text: delta.content };
      }
    }
  }
}

/**
 * Streams a completion across the model chain.
 *
 * Fallback only applies *before* anything has been emitted. Once tokens have
 * reached the caller, a mid-stream failure is surfaced rather than restarted,
 * so a reader never sees two half-answers concatenated.
 */
export async function* streamCompletion(
  messages: ChatMessage[],
  requestedModel?: string | null,
  signal?: AbortSignal,
): AsyncGenerator<ProviderStreamEvent> {
  const chain = modelChain(requestedModel);
  const attempts: FailedAttempt[] = [];
  let lastError: unknown;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const acc: Accumulator = {
      content: "",
      reasoning: "",
      model,
      usage: EMPTY_USAGE,
      details: new Map(),
    };
    let emitted = false;

    try {
      const response = await requestCompletion({ model, messages, stream: true, signal });
      if (!response.body) {
        throw new OpenRouterError(`${model}: no response body`, undefined, true);
      }

      yield { type: "model", model };

      for await (const event of readStream(response.body, acc)) {
        emitted = true;
        yield event;
      }

      if (acc.content.length === 0 && acc.reasoning.length === 0) {
        throw new OpenRouterError(`${model}: empty stream`, undefined, true);
      }

      yield {
        type: "done",
        completion: {
          content: acc.content,
          reasoning: acc.reasoning,
          reasoningDetails: collectReasoningDetails(acc.details),
          model: acc.model,
          usage: acc.usage,
          attempts,
        },
      };
      return;
    } catch (error) {
      lastError = error;
      attempts.push({ model, error: error instanceof Error ? error.message : String(error) });

      const fatal = error instanceof OpenRouterError && !error.retryable;
      const isLast = i === chain.length - 1;
      if (emitted || fatal || signal?.aborted || isLast) throw error;

      console.warn(`[openrouter] ${model} stream failed, trying next model.`);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new OpenRouterError("Every model in the chain failed");
}
