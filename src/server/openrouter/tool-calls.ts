import type { ToolCall } from "@/models";

/**
 * Streaming sends `tool_calls` as partial entries keyed by `index`: the id and
 * name arrive once, while `arguments` accumulates as JSON text across deltas.
 */
export function mergeToolCalls(
  accumulator: Map<number, ToolCall>,
  incoming: any[] | undefined | null,
): void {
  if (!Array.isArray(incoming)) return;

  for (const entry of incoming) {
    const index = typeof entry?.index === "number" ? entry.index : accumulator.size;
    const existing = accumulator.get(index);

    if (!existing) {
      accumulator.set(index, {
        id: entry?.id ?? `call_${index}`,
        type: "function",
        function: {
          name: entry?.function?.name ?? "",
          arguments: entry?.function?.arguments ?? "",
        },
      });
      continue;
    }

    accumulator.set(index, {
      id: entry?.id ?? existing.id,
      type: "function",
      function: {
        name: entry?.function?.name ?? existing.function.name,
        // Argument fragments concatenate into one JSON document.
        arguments: existing.function.arguments + (entry?.function?.arguments ?? ""),
      },
    });
  }
}

export function collectToolCalls(accumulator: Map<number, ToolCall>): ToolCall[] {
  return [...accumulator.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => call)
    .filter((call) => call.function.name.length > 0);
}

/** Normalises the non-streaming `message.tool_calls` array. */
export function toToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry: any) => entry?.function?.name)
    .map((entry: any, index: number) => ({
      id: entry.id ?? `call_${index}`,
      type: "function" as const,
      function: {
        name: entry.function.name,
        arguments: entry.function.arguments ?? "",
      },
    }));
}
