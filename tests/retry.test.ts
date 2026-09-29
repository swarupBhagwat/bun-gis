import { describe, expect, test } from "bun:test";
import { HttpError, RequestTimeoutError } from "../src/core/errors";
import { withRetry } from "../src/download/retry";

const policy = { retries: 3, baseDelayMs: 100, maxDelayMs: 1000 };

function flaky(failures: number, error: () => unknown) {
  let calls = 0;
  const fn = async () => {
    if (calls++ < failures) throw error();
    return "ok";
  };
  return { fn, calls: () => calls };
}

describe("withRetry", () => {
  test("retries retryable errors with exponential backoff", async () => {
    const waits: number[] = [];
    const { fn, calls } = flaky(2, () => new HttpError("Overture", 429));
    expect(await withRetry(fn, policy, async (ms) => void waits.push(ms))).toBe("ok");
    expect(calls()).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  test("honors Retry-After, capped by maxDelayMs", async () => {
    const waits: number[] = [];
    const { fn } = flaky(1, () => new HttpError("Overture", 429, 999_999));
    await withRetry(fn, policy, async (ms) => void waits.push(ms));
    expect(waits).toEqual([1000]);
  });

  test("reports each retry with its reason, attempt and delay", async () => {
    const notes: string[] = [];
    const { fn } = flaky(2, () => new HttpError("Overture", 429, 30_000));
    await withRetry(fn, { ...policy, maxDelayMs: 60_000 }, async () => {}, (m) => notes.push(m));
    expect(notes).toEqual([
      "Overture responded HTTP 429; retry 1/3 in 30s",
      "Overture responded HTTP 429; retry 2/3 in 30s",
    ]);
  });

  test("gives up after policy.retries", async () => {
    const { fn, calls } = flaky(99, () => new HttpError("Overture", 503));
    await expect(withRetry(fn, policy, async () => {})).rejects.toBeInstanceOf(HttpError);
    expect(calls()).toBe(4);
  });

  test("does not retry non-retryable errors", async () => {
    const { fn, calls } = flaky(99, () => new HttpError("Overture", 400));
    await expect(withRetry(fn, policy, async () => {})).rejects.toBeInstanceOf(HttpError);
    expect(calls()).toBe(1);
  });

  test("retries request timeouts", async () => {
    const { fn, calls } = flaky(1, () => new RequestTimeoutError("a.test", 60_000));
    expect(await withRetry(fn, policy, async () => {})).toBe("ok");
    expect(calls()).toBe(2);
  });

  test("retries network TypeErrors", async () => {
    const { fn, calls } = flaky(1, () => new TypeError("fetch failed"));
    expect(await withRetry(fn, policy, async () => {})).toBe("ok");
    expect(calls()).toBe(2);
  });
});
