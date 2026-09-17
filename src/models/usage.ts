/** Token accounting for one completion. Null when the provider omits it. */
export interface Usage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export const EMPTY_USAGE: Usage = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
};

/** Normalises OpenRouter's snake_case usage block. */
export function toUsage(raw: unknown): Usage {
  if (!raw || typeof raw !== "object") return EMPTY_USAGE;
  const usage = raw as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === "number" ? value : null);
  return {
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    totalTokens: num(usage.total_tokens),
  };
}
