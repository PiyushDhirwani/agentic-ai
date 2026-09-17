import { OPENROUTER } from "@/config/constants";
import { env } from "@/config/env";
import type { ChatMessage } from "@/models";
import { isRetryableStatus, OpenRouterError } from "./errors";

/** Transport for the OpenRouter chat-completions endpoint. */

function endpoint(): string {
  return `${env.openRouter.baseUrl}${OPENROUTER.chatCompletionsPath}`;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.openRouter.apiKey}`,
    "Content-Type": "application/json",
    // Attribution: shows the app on OpenRouter's dashboard and leaderboards.
    "HTTP-Referer": env.app.url,
    "X-Title": env.app.title,
  };
}

function buildBody(model: string, messages: ChatMessage[], stream: boolean): string {
  return JSON.stringify({
    model,
    messages,
    stream,
    ...(env.openRouter.reasoningEnabled ? { reasoning: { enabled: true } } : {}),
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  });
}

export interface RequestOptions {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  signal?: AbortSignal;
}

/** Posts one completion request. Throws OpenRouterError on a non-2xx reply. */
export async function requestCompletion(options: RequestOptions): Promise<Response> {
  const timeout = AbortSignal.timeout(env.openRouter.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: headers(),
    body: buildBody(options.model, options.messages, options.stream),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OpenRouterError(
      `${options.model}: HTTP ${response.status} ${detail.slice(0, 500)}`,
      response.status,
      isRetryableStatus(response.status),
    );
  }
  return response;
}
