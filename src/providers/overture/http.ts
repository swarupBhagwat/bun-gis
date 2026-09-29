import { HttpError, RequestTimeoutError } from "../../core/errors";
import { withRetry } from "../../download/retry";
import type { RetryPolicy } from "../../download/retry";

export interface HttpOptions {
  fetch?: typeof fetch;
  retry?: RetryPolicy;
  sleep?: (ms: number) => Promise<unknown>;
  notify?: (message: string) => void;
  timeoutMs?: number;
}

export type Get = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 60_000; // per request; a row-group range request is a few MB

export function createGet({
  fetch: doFetch = globalThis.fetch,
  retry,
  sleep,
  notify,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: HttpOptions = {}): Get {
  return (url, init) =>
    withRetry(
      async () => {
        try {
          const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
          if (!response.ok) throw new HttpError("Overture", response.status);
          return response;
        } catch (error) {
          if ((error as Error).name === "TimeoutError") throw new RequestTimeoutError(new URL(url).host, timeoutMs);
          throw error;
        }
      },
      retry,
      sleep,
      notify,
    );
}
