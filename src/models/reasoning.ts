/**
 * OpenRouter's `reasoning_details` payload. Deliberately opaque: the provider
 * owns its shape, we only store it and hand it back unmodified so a reasoning
 * model can continue its chain of thought on the next turn.
 */
export type ReasoningDetail = Record<string, unknown>;

/** Streaming deltas carry an `index` so partial entries can be merged. */
export function detailIndex(detail: ReasoningDetail, fallback: number): number {
  return typeof detail.index === "number" ? detail.index : fallback;
}
