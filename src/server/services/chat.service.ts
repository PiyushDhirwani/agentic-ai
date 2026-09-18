import { LIMITS } from "@/config/constants";
import { env } from "@/config/env";
import {
  EMPTY_USAGE,
  userMessage,
  type ChatMessage,
  type ChatStreamEvent,
  type Completion,
  type Message,
  type ReasoningDetail,
  type Usage,
} from "@/models";
import { conversations as conversationsRepo } from "@/server/db";
import { complete, streamCompletion } from "@/server/openrouter";
import { getCatalogue, resolveChain } from "./models.service";
import { append, getWindow, toChatMessages } from "./history.service";

/**
 * One chat turn, end to end. Routes adapt this to HTTP; nothing here knows
 * about requests, responses or SSE.
 */

export interface TurnRequest {
  conversationId?: string;
  message: string;
  model?: string;
  systemPrompt?: string;
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
}

/**
 * Builds this turn's prompt from the cached window plus the new question.
 * Nothing is written yet — persistence waits until the model has produced
 * something, so a failed turn leaves no dangling user message behind.
 */
export async function buildPrompt(conversationId: string, request: TurnRequest): Promise<Prompt> {
  const window = await getWindow(conversationId);
  const history = toChatMessages(window, request.systemPrompt ?? env.chat.systemPrompt);
  return {
    messages: [...history, userMessage(request.message)],
    historyCount: window.length,
  };
}

interface TurnResult {
  content: string;
  reasoningDetails: ReasoningDetail[] | null;
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
  const completion = await complete(prompt.messages, chain, signal);
  const assistant = await persistTurn(conversationId, request.message, {
    content: completion.content,
    reasoningDetails: completion.reasoningDetails,
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
  yield { type: "start", conversationId, historyMessages: prompt.historyCount };

  const chain = await resolveChain(request.model);

  let content = "";
  let reasoningDetails: ReasoningDetail[] | null = null;
  let model = chain[0] ?? env.openRouter.primaryModel;
  let usage: Usage = EMPTY_USAGE;
  let completed = false;

  try {
    for await (const event of streamCompletion(prompt.messages, chain, signal)) {
      switch (event.type) {
        case "model":
          model = event.model;
          yield { type: "model", model: event.model };
          break;
        case "reasoning":
          yield { type: "reasoning", text: event.text };
          break;
        case "delta":
          content += event.text;
          yield { type: "delta", text: event.text };
          break;
        case "done":
          content = event.completion.content;
          reasoningDetails = event.completion.reasoningDetails;
          model = event.completion.model;
          usage = event.completion.usage;
          completed = true;
          break;
      }
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
