import { detailIndex, type ReasoningDetail } from "@/models";

/** Fields that identify a detail rather than accumulate across deltas. */
const IDENTITY_FIELDS = new Set(["type", "format", "id", "signature", "index"]);

/**
 * Streaming sends `reasoning_details` as partial entries keyed by `index`.
 * String fields concatenate across deltas; identity fields and non-strings
 * take the latest value.
 */
export function mergeReasoningDetails(
  accumulator: Map<number, ReasoningDetail>,
  incoming: ReasoningDetail[] | undefined | null,
): void {
  if (!Array.isArray(incoming)) return;

  for (const detail of incoming) {
    const index = detailIndex(detail, accumulator.size);
    const existing = accumulator.get(index);

    if (!existing) {
      accumulator.set(index, { ...detail, index });
      continue;
    }

    const merged: ReasoningDetail = { ...existing };
    for (const [key, value] of Object.entries(detail)) {
      const shouldAppend =
        typeof value === "string" && typeof merged[key] === "string" && !IDENTITY_FIELDS.has(key);
      if (shouldAppend) {
        merged[key] = (merged[key] as string) + value;
      } else if (value !== null && value !== undefined) {
        merged[key] = value;
      }
    }
    accumulator.set(index, merged);
  }
}

/** Flattens the accumulator back into the array shape OpenRouter expects. */
export function collectReasoningDetails(
  accumulator: Map<number, ReasoningDetail>,
): ReasoningDetail[] | null {
  if (accumulator.size === 0) return null;
  return [...accumulator.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, detail]) => detail);
}
