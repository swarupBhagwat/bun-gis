import { HttpError, RequestTimeoutError } from "../core/errors";

export interface RetryPolicy {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  retries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 429 || error.status >= 500;
  }
  return error instanceof RequestTimeoutError || error instanceof TypeError;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy,
  sleep: (ms: number) => Promise<unknown> = Bun.sleep,
  notify?: (message: string) => void,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= policy.retries || !isRetryable(error)) throw error;
      const backoff = policy.baseDelayMs * 2 ** attempt;
      const wait =
        error instanceof HttpError && error.retryAfterMs !== undefined
          ? error.retryAfterMs
          : backoff;
      const delay = Math.min(wait, policy.maxDelayMs);
      const reason = error instanceof HttpError ? `${error.provider} responded HTTP ${error.status}` : (error as Error).message;
      notify?.(`${reason}; retry ${attempt + 1}/${policy.retries} in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }
}
