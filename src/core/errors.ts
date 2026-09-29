export class BunGisError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = "BunGisError";
  }
}

export class RequestTimeoutError extends BunGisError {
  constructor(readonly target: string, readonly timeoutMs: number) {
    super(`${target} did not answer within ${Math.round(timeoutMs / 1000)}s`, "The server may be overloaded. It will be retried or replaced by another server.");
    this.name = "RequestTimeoutError";
  }
}

export class HttpError extends BunGisError {
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly retryAfterMs?: number,
    hint?: string,
  ) {
    super(`${provider} request failed: HTTP ${status}`, hint);
    this.name = "HttpError";
  }
}
