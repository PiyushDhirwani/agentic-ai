import { env } from "@/config/env";

/**
 * The order models are tried in: what the caller asked for, then the
 * configured primary, then each fallback. De-duplicated so a request that
 * names the primary model does not try it twice.
 */
export function modelChain(requested?: string | null): string[] {
  const chain = [
    requested ?? env.openRouter.primaryModel,
    env.openRouter.primaryModel,
    ...env.openRouter.fallbackModels,
  ];
  return [...new Set(chain.filter(Boolean))];
}
