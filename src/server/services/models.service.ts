import { DEFAULTS } from "@/config/constants";
import { env } from "@/config/env";
import type { ModelCatalogue, ModelOption } from "@/models";
import * as modelsCache from "@/server/cache/models.cache";
import { models as modelsRepo } from "@/server/db";

/**
 * The model catalogue: which model to try first, what to fall back through,
 * and what to offer in the picker.
 *
 * Postgres holds it so a model rotation is an UPDATE rather than a redeploy —
 * OpenRouter's :free ids change often. `OPENROUTER_MODEL` and
 * `OPENROUTER_FALLBACK_MODELS` remain as a bootstrap: they are used when the
 * table is empty or unreachable, so a fresh or broken database still answers.
 */

function bootstrapOptions(): ModelOption[] {
  const ids = [env.openRouter.primaryModel, ...env.openRouter.fallbackModels];
  return [...new Set(ids.filter(Boolean))].map((id, index) => ({
    id,
    label: id,
    enabled: true,
    isDefault: index === 0,
    sortOrder: (index + 1) * 10,
    notes: "From environment (models table empty or unreachable).",
  }));
}

function toCatalogue(options: ModelOption[], fromBootstrap: boolean): ModelCatalogue {
  const enabled = options.filter((option) => option.enabled);
  const chain = enabled.map((option) => option.id);
  const preferred = enabled.find((option) => option.isDefault) ?? enabled[0];

  return {
    defaultModel: preferred?.id ?? env.openRouter.primaryModel,
    chain: chain.length > 0 ? chain : [env.openRouter.primaryModel],
    options: enabled,
    fromBootstrap,
  };
}

/**
 * In-process memo, the first of three tiers:
 *
 *   memo (this container, no I/O) -> Redis (shared) -> Postgres (truth)
 *
 * Module scope survives across warm invocations, so a busy container reads the
 * catalogue from memory and never touches the network for it.
 */
interface Memo {
  catalogue: ModelCatalogue;
  expiresAt: number;
}
let memo: Memo | null = null;

function remember(catalogue: ModelCatalogue): ModelCatalogue {
  const ttl = catalogue.fromBootstrap
    ? DEFAULTS.modelsBootstrapMemoTtlSeconds
    : DEFAULTS.modelsMemoTtlSeconds;
  memo = { catalogue, expiresAt: Date.now() + ttl * 1000 };
  return catalogue;
}

/** Reads the catalogue: memo, then Redis, then Postgres, then env. */
export async function getCatalogue(): Promise<ModelCatalogue> {
  if (memo && Date.now() < memo.expiresAt) return memo.catalogue;

  const cached = await modelsCache.read();
  if (cached && cached.length > 0) return remember(toCatalogue(cached, false));

  try {
    const stored = await modelsRepo.listEnabled();
    if (stored.length > 0) {
      await modelsCache.write(stored);
      return remember(toCatalogue(stored, false));
    }
    console.warn("[models] models table is empty; using the environment bootstrap.");
  } catch (error) {
    // The catalogue is on the hot path: a database blip must not stop chat.
    console.error("[models] catalogue load failed; using the environment bootstrap:", error);
  }

  return remember(toCatalogue(bootstrapOptions(), true));
}

/**
 * The order models are tried in for one request: the caller's choice first
 * (honoured even if it is not in the catalogue), then the catalogue's chain.
 * De-duplicated, so naming the default does not try it twice.
 */
export async function resolveChain(requested?: string | null): Promise<string[]> {
  const catalogue = await getCatalogue();
  const chain = requested ? [requested, ...catalogue.chain] : catalogue.chain;
  return [...new Set(chain.filter(Boolean))];
}

/**
 * Drops the cached catalogue. Redis is shared, so every container sees the
 * change on its next miss; the memo can only be cleared here, so others catch
 * up within `modelsMemoTtlSeconds`.
 */
export async function refresh(): Promise<void> {
  memo = null;
  await modelsCache.invalidate();
}
