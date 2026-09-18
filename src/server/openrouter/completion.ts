import { EMPTY_USAGE, type ChatMessage, type Completion, type FailedAttempt, toUsage } from "@/models";
import { requestCompletion } from "./client";
import { OpenRouterError } from "./errors";

/**
 * A non-streaming completion, walking the given model chain on retryable
 * failures. The chain is resolved by the caller (see models.service), so this
 * module stays unaware of where models are configured.
 */
export async function complete(
  messages: ChatMessage[],
  chain: string[],
  signal?: AbortSignal,
): Promise<Completion> {
  const attempts: FailedAttempt[] = [];
  let lastError: unknown;

  if (chain.length === 0) throw new OpenRouterError("No models are configured");

  for (const model of chain) {
    try {
      const response = await requestCompletion({ model, messages, stream: false, signal });
      const payload = await response.json();

      if (payload.error) {
        throw new OpenRouterError(
          `${model}: ${payload.error.message ?? "unknown error"}`,
          undefined,
          true,
        );
      }

      const choice = payload.choices?.[0]?.message;
      if (!choice) throw new OpenRouterError(`${model}: empty response`, undefined, true);

      return {
        content: choice.content ?? "",
        reasoning: choice.reasoning ?? "",
        reasoningDetails: choice.reasoning_details ?? null,
        model: payload.model ?? model,
        usage: payload.usage ? toUsage(payload.usage) : EMPTY_USAGE,
        attempts,
      };
    } catch (error) {
      lastError = error;
      attempts.push({ model, error: error instanceof Error ? error.message : String(error) });

      const fatal = error instanceof OpenRouterError && !error.retryable;
      if (fatal || signal?.aborted) throw error;
      console.warn(`[openrouter] ${model} failed, trying next model.`);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new OpenRouterError("Every model in the chain failed");
}
