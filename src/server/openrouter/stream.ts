import { frameData, isDone, takeLines, textChunks } from "@/lib/sse";
import {
  EMPTY_USAGE,
  mergeCitations,
  toCitations,
  type ChatMessage,
  type Citation,
  type FailedAttempt,
  type ToolCall,
  type ProviderStreamEvent,
  type ReasoningDetail,
  type Usage,
  toUsage,
} from "@/models";
import { requestCompletion } from "./client";
import { OpenRouterError } from "./errors";
import { collectReasoningDetails, mergeReasoningDetails } from "./reasoning";
import { collectToolCalls, mergeToolCalls } from "./tool-calls";

/** Everything accumulated while reading one model's stream. */
interface Accumulator {
  content: string;
  reasoning: string;
  model: string;
  usage: Usage;
  details: Map<number, ReasoningDetail>;
  citations: Citation[];
  toolCalls: Map<number, ToolCall>;
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

      const choice = frame.choices?.[0];
      // Sources can arrive on the delta or on the finished message, depending
      // on the provider; take them from wherever they appear, once each.
      const incoming = toCitations(choice?.delta?.annotations ?? choice?.message?.annotations);
      if (incoming.length > 0) {
        const before = acc.citations.length;
        acc.citations = mergeCitations(acc.citations, incoming);
        if (acc.citations.length > before) {
          yield { type: "citations", citations: acc.citations };
        }
      }

      const delta = choice?.delta;
      if (!delta) continue;

      mergeToolCalls(acc.toolCalls, delta.tool_calls);

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
 * Streams a completion across the given model chain, which the caller
 * resolves (see models.service).
 *
 * Fallback only applies *before* anything has been emitted. Once tokens have
 * reached the caller, a mid-stream failure is surfaced rather than restarted,
 * so a reader never sees two half-answers concatenated.
 */
export async function* streamCompletion(
  messages: ChatMessage[],
  chain: string[],
  options: { webSearch?: boolean; tools?: unknown[]; signal?: AbortSignal } = {},
): AsyncGenerator<ProviderStreamEvent> {
  const { webSearch = false, tools = [], signal } = options;
  const attempts: FailedAttempt[] = [];
  let lastError: unknown;

  if (chain.length === 0) throw new OpenRouterError("No models are configured");

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const acc: Accumulator = {
      content: "",
      reasoning: "",
      model,
      usage: EMPTY_USAGE,
      details: new Map(),
      citations: [],
      toolCalls: new Map(),
    };
    let emitted = false;

    try {
      const response = await requestCompletion({
        model,
        messages,
        stream: true,
        webSearch,
        tools,
        signal,
      });
      if (!response.body) {
        throw new OpenRouterError(`${model}: no response body`, undefined, true);
      }

      yield { type: "model", model };

      for await (const event of readStream(response.body, acc)) {
        emitted = true;
        yield event;
      }
      // Tool-call fragments are not yielded, so mark them as emitted too:
      // retrying another model after them would duplicate the request.
      if (acc.toolCalls.size > 0) emitted = true;

      const toolCalls = collectToolCalls(acc.toolCalls);

      // A turn that only asks for tools carries no text; that is not empty.
      if (acc.content.length === 0 && acc.reasoning.length === 0 && toolCalls.length === 0) {
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
          citations: acc.citations,
          toolCalls,
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
