import { LIMITS } from "@/config/constants";
import { env } from "@/config/env";
import {
  EMPTY_USAGE,
  assistantToolCallMessage,
  systemMessage,
  toolResultMessage,
  userMessage,
  type ChatMessage,
  type ChatStreamEvent,
  type Citation,
  type ToolCall,
  type ToolResult,
  type Completion,
  type Message,
  type ReasoningDetail,
  type Usage,
} from "@/models";
import { conversations as conversationsRepo } from "@/server/db";
import { complete, streamCompletion } from "@/server/openrouter";
import { getCatalogue, resolveChain } from "./models.service";
import { append, getWindow, toChatMessages } from "./history.service";
import { oldestMessageId, recall, toContextMessage } from "./memory.service";
import { executeAll, listTools, toOpenRouterTools } from "./tools.service";

/**
 * One chat turn, end to end. Routes adapt this to HTTP; nothing here knows
 * about requests, responses or SSE.
 */

export interface TurnRequest {
  conversationId?: string;
  message: string;
  model?: string;
  systemPrompt?: string;
  /** Runs OpenRouter's web plugin for this turn. Billed per search. */
  webSearch?: boolean;
}

/** Derives a conversation title from the first line of the opening question. */
export function deriveTitle(message: string): string {
  const firstLine = message.trim().split("\n")[0].trim();
  if (!firstLine) return "New chat";
  return firstLine.length > LIMITS.derivedTitleChars
    ? `${firstLine.slice(0, LIMITS.derivedTitleChars - 3)}...`
    : firstLine;
}

/** Resolves the target conversation, creating one when none was supplied. */
export async function resolveConversationId(request: TurnRequest): Promise<string> {
  if (request.conversationId) {
    return (await conversationsRepo.ensure(request.conversationId)).id;
  }
  const model = request.model ?? (await getCatalogue()).defaultModel;
  const created = await conversationsRepo.create(deriveTitle(request.message), model);
  return created.id;
}

export interface Prompt {
  messages: ChatMessage[];
  historyCount: number;
  /** How many passages semantic recall contributed. */
  recalled: number;
}

/**
 * Builds this turn's prompt: the cached window, any semantically recalled
 * passages, and the new question.
 *
 * Nothing is written yet — persistence waits until the model has produced
 * something, so a failed turn leaves no dangling user message behind.
 */
export async function buildPrompt(conversationId: string, request: TurnRequest): Promise<Prompt> {
  const window = await getWindow(conversationId);

  const passages = await recall({
    conversationId,
    question: request.message,
    oldestWindowMessageId: oldestMessageId(window),
  });

  const messages: ChatMessage[] = [];

  const systemPrompt = request.systemPrompt ?? env.chat.systemPrompt;
  if (systemPrompt) messages.push(systemMessage(systemPrompt));

  // Recalled context sits before the transcript: it is background, and should
  // not read as the most recent thing said.
  const context = toContextMessage(passages);
  if (context) messages.push(systemMessage(context));

  messages.push(...toChatMessages(window));
  messages.push(userMessage(request.message));

  return { messages, historyCount: window.length, recalled: passages.length };
}

interface TurnResult {
  content: string;
  reasoningDetails: ReasoningDetail[] | null;
  citations: Citation[];
  model: string;
  usage: Usage;
}

/** Writes the user turn then the assistant turn, and updates the conversation. */
export async function persistTurn(
  conversationId: string,
  question: string,
  result: TurnResult,
): Promise<Message> {
  await append({ conversationId, role: "user", content: question });

  const assistant = await append({
    conversationId,
    role: "assistant",
    content: result.content,
    reasoningDetails: result.reasoningDetails,
    citations: result.citations,
    model: result.model,
    usage: result.usage,
  });

  await Promise.all([
    conversationsRepo.touch(conversationId, result.model),
    conversationsRepo.setTitleIfEmpty(conversationId, deriveTitle(question)),
  ]);

  return assistant;
}

export interface CompletedTurn {
  conversationId: string;
  messageId: number;
  completion: Completion;
  historyMessages: number;
}

/** A whole turn in one call, for clients that do not want to stream. */
export async function runTurn(
  conversationId: string,
  request: TurnRequest,
  prompt: Prompt,
  signal?: AbortSignal,
): Promise<CompletedTurn> {
  const chain = await resolveChain(request.model);
  const completion = await complete(prompt.messages, chain, {
    webSearch: resolveWebSearch(request),
    signal,
  });
  const assistant = await persistTurn(conversationId, request.message, {
    content: completion.content,
    reasoningDetails: completion.reasoningDetails,
    citations: completion.citations,
    model: completion.model,
    usage: completion.usage,
  });

  return {
    conversationId,
    messageId: assistant.id,
    completion,
    historyMessages: prompt.historyCount,
  };
}

/**
 * A whole turn as a sequence of domain events. Persistence happens inside, so
 * even a stream that drops mid-answer keeps what the model produced.
 */
export async function* streamTurn(
  conversationId: string,
  request: TurnRequest,
  prompt: Prompt,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  yield {
    type: "start",
    conversationId,
    historyMessages: prompt.historyCount,
    recalled: prompt.recalled,
  };

  const chain = await resolveChain(request.model);
  const tools = toOpenRouterTools(await listTools());

  // Grows as tool rounds complete, so the model sees what it already learned.
  const conversation = [...prompt.messages];

  let content = "";
  let reasoningDetails: ReasoningDetail[] | null = null;
  let citations: Citation[] = [];
  let model = chain[0] ?? env.openRouter.primaryModel;
  let usage: Usage = EMPTY_USAGE;
  let completed = false;

  try {
    // Each pass is one model call. It ends the turn unless the model asked for
    // tools, in which case they run and the loop goes round again. Bounded,
    // because every pass costs another model call plus an external request and
    // the function budget is finite.
    for (let iteration = 0; iteration <= env.tools.maxIterations; iteration++) {
      const isFinalPass = iteration === env.tools.maxIterations;
      let toolCalls: ToolCall[] = [];
      let roundContent = "";
      let roundReasoning: ReasoningDetail[] | null = null;

      for await (const event of streamCompletion(conversation, chain, {
        webSearch: resolveWebSearch(request),
        // On the last permitted pass, withhold tools so the model must answer.
        tools: isFinalPass ? [] : tools,
        signal,
      })) {
        switch (event.type) {
          case "model":
            model = event.model;
            yield { type: "model", model: event.model };
            break;
          case "reasoning":
            yield { type: "reasoning", text: event.text };
            break;
          case "citations":
            citations = event.citations;
            yield { type: "citations", citations: event.citations };
            break;
          case "delta":
            roundContent += event.text;
            content += event.text;
            yield { type: "delta", text: event.text };
            break;
          case "done":
            roundContent = event.completion.content;
            roundReasoning = event.completion.reasoningDetails;
            citations = event.completion.citations;
            model = event.completion.model;
            usage = event.completion.usage;
            toolCalls = event.completion.toolCalls;
            break;
        }
      }

      if (toolCalls.length === 0) {
        // No tools wanted: this pass is the answer.
        content = roundContent || content;
        reasoningDetails = roundReasoning;
        completed = true;
        break;
      }

      yield {
        type: "tool_call",
        calls: toolCalls.map((call) => ({ id: call.id, name: call.function.name })),
      };

      const results = await executeAll(toolCalls);

      yield {
        type: "tool_result",
        results: results.map((result) => ({ name: result.name, isError: result.isError })),
      };

      await persistToolRound(conversationId, roundContent, toolCalls, results, model);

      conversation.push(assistantToolCallMessage(roundContent, toolCalls, roundReasoning));
      for (const result of results) {
        conversation.push(toolResultMessage(result.toolCallId, result.name, result.content));
      }

      // Text produced alongside a tool request was preamble, not the answer.
      content = "";
    }
  } catch (error) {
    console.error("[chat] stream failed:", error);
    yield { type: "error", error: describeFailure(error), conversationId };
  }

  if (content.length === 0) return;

  try {
    const assistant = await persistTurn(conversationId, request.message, {
      content,
      reasoningDetails,
      citations,
      model,
      usage,
    });
    if (completed) {
      yield { type: "done", conversationId, messageId: assistant.id, model, usage };
    }
  } catch (error) {
    console.error("[chat] persist failed:", error);
    yield { type: "error", error: "Response generated but could not be saved.", conversationId };
  }
}

/** Turns a throwable into a message that is safe to show a client. */
export function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "The model took too long to respond. Try again or pick a different model.";
    }
    return error.message;
  }
  return "Unexpected error";
}

/**
 * Records one tool round so the next request can replay it. Providers reject a
 * `tool` message with no preceding assistant `tool_calls`, so both halves must
 * be written, in order.
 */
async function persistToolRound(
  conversationId: string,
  content: string,
  toolCalls: ToolCall[],
  results: ToolResult[],
  model: string,
): Promise<void> {
  await append({
    conversationId,
    role: "assistant",
    content: content || null,
    toolCalls,
    model,
  });

  for (const result of results) {
    await append({
      conversationId,
      role: "tool",
      content: result.content,
      toolCallId: result.toolCallId,
      toolName: result.name,
    });
  }
}

/** Whether this turn should search the web: explicit choice, else the default. */
function resolveWebSearch(request: TurnRequest): boolean {
  if (!env.webSearch.available) return false;
  return request.webSearch ?? env.webSearch.defaultOn;
}
