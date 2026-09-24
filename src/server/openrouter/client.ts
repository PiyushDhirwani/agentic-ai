import { OPENROUTER, WEB_SEARCH } from "@/config/constants";
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

/** Options shared by both request shapes. */
function searchParameters() {
  const allowed = env.webSearch.allowedDomains;
  const excluded = env.webSearch.excludedDomains;
  return {
    max_results: env.webSearch.maxResults,
    ...(env.webSearch.engine ? { engine: env.webSearch.engine } : {}),
    ...(env.webSearch.contextSize ? { search_context_size: env.webSearch.contextSize } : {}),
    ...(env.webSearch.maxCharacters ? { max_characters: env.webSearch.maxCharacters } : {}),
    ...(allowed.length > 0 ? { allowed_domains: allowed } : {}),
    ...(excluded.length > 0 ? { excluded_domains: excluded } : {}),
  };
}

/**
 * Server tool. The model chooses whether to search, so an answer it already
 * knows costs nothing — but the model must support tool calling.
 */
function webSearchTool() {
  return {
    type: WEB_SEARCH.toolType,
    parameters: {
      ...searchParameters(),
      max_uses: env.webSearch.maxUses,
      ...(env.webSearch.maxTotalResults
        ? { max_total_results: env.webSearch.maxTotalResults }
        : {}),
    },
  };
}

/**
 * Plugin. Searches unconditionally before the model runs, so it works with any
 * model — including ones with no tool-calling support.
 */
function webSearchPlugin() {
  return { id: WEB_SEARCH.pluginId, ...searchParameters() };
}

/** Picks the request shape for the configured mode. */
function webSearchFields() {
  return env.webSearch.mode === "plugin"
    ? { plugins: [webSearchPlugin()] }
    : { tools: [webSearchTool()] };
}

function buildBody(
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  webSearch: boolean,
  tools: unknown[],
): string {
  const search = webSearch ? webSearchFields() : {};
  // Server-tool web search and MCP tools both ride the `tools` array, so they
  // must be concatenated rather than overwrite one another.
  const searchTools = (search as { tools?: unknown[] }).tools ?? [];
  const allTools = [...searchTools, ...tools];

  return JSON.stringify({
    model,
    messages,
    stream,
    ...(env.openRouter.reasoningEnabled ? { reasoning: { enabled: true } } : {}),
    ...((search as { plugins?: unknown[] }).plugins
      ? { plugins: (search as { plugins: unknown[] }).plugins }
      : {}),
    ...(allTools.length > 0 ? { tools: allTools } : {}),
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  });
}

export interface RequestOptions {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  /** Enables OpenRouter's web search for this request. Billed per search. */
  webSearch?: boolean;
  /** MCP tool definitions the model may call. */
  tools?: unknown[];
  signal?: AbortSignal;
}

/** Posts one completion request. Throws OpenRouterError on a non-2xx reply. */
export async function requestCompletion(options: RequestOptions): Promise<Response> {
  const timeout = AbortSignal.timeout(env.openRouter.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const response = await fetch(endpoint(), {
    method: "POST",
    headers: headers(),
    body: buildBody(
      options.model,
      options.messages,
      options.stream,
      options.webSearch ?? false,
      options.tools ?? [],
    ),
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
