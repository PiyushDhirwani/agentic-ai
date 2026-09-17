import { SSE } from "@/config/constants";

/**
 * Minimal Server-Sent Events helpers, shared by the API route (writer) and the
 * browser (reader) so the two cannot drift apart.
 */

export function encodeFrame(payload: unknown): string {
  return `${SSE.dataPrefix} ${JSON.stringify(payload)}${SSE.frameSeparator}`;
}

export function encodeDone(): string {
  return `${SSE.dataPrefix} ${SSE.doneSentinel}${SSE.frameSeparator}`;
}

/** The data portion of one frame: its JSON, or null for comments/[DONE]. */
export function frameData(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(SSE.commentPrefix)) return null;
  if (!trimmed.startsWith(SSE.dataPrefix)) return null;

  const data = trimmed.slice(SSE.dataPrefix.length).trim();
  return data === SSE.doneSentinel ? null : data;
}

export function isDone(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith(SSE.dataPrefix)) return false;
  return trimmed.slice(SSE.dataPrefix.length).trim() === SSE.doneSentinel;
}

/**
 * Splits a growing buffer into complete lines, returning the unparsed
 * remainder. A frame can straddle two network chunks, so the tail is kept.
 */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  return { lines: parts.slice(0, -1), rest: parts[parts.length - 1] ?? "" };
}

/** Reads a Response body as decoded text chunks. */
export async function* textChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
