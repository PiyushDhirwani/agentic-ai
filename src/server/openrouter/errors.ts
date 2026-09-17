import { OPENROUTER } from "@/config/constants";

export class OpenRouterError extends Error {
  status?: number;
  /** True when advancing to the next model in the chain is worth trying. */
  retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * Server errors and the listed client errors are worth retrying elsewhere.
 * 401/403 are not: a bad key fails identically on every model, so failing fast
 * beats burning the whole chain.
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || OPENROUTER.retryableStatuses.includes(status);
}
