import { describe, expect, test } from "bun:test";
import { IdSet, hash53 } from "../src/validate/id-set";

describe("hash53", () => {
  test("is deterministic, below 2^53, and separates near-identical strings", () => {
    expect(hash53("abc")).toBe(hash53("abc"));
    const hashes = new Set(["", "a", "b", "ab", "ba", "f1", "f2", "f10", "cfb6b5d8-8e77-4110-90c5-609ceca20d0a"].map(hash53));
    expect(hashes.size).toBe(9);
    for (const h of hashes) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 53);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  test("handles non-ASCII text by UTF-16 code unit", () => {
    expect(hash53("日本語")).not.toBe(hash53("日本"));
    expect(hash53("😀")).toBe(hash53("😀"));
  });
});

describe("IdSet", () => {
  test("reports the second sighting, not the first", () => {
    const ids = new IdSet();
    expect(ids.addAndCheck("a")).toBe(false);
    expect(ids.addAndCheck("b")).toBe(false);
    expect(ids.addAndCheck("a")).toBe(true);
    expect(ids.addAndCheck("a")).toBe(true);
    expect(ids.count).toBe(2);
  });

  test("the empty string is an id like any other", () => {
    const ids = new IdSet();
    expect(ids.addAndCheck("")).toBe(false);
    expect(ids.addAndCheck("")).toBe(true);
  });

  test("never misses a duplicate across many table growths, and finds no phantom ones among distinct ids", () => {
    const ids = new IdSet(4); // tiny start so the table doubles many times
    const n = 200_000;
    for (let i = 0; i < n; i++) expect(ids.addAndCheck(`id-${i}`)).toBe(false);
    expect(ids.count).toBe(n);
    for (let i = 0; i < n; i += 7) expect(ids.addAndCheck(`id-${i}`)).toBe(true);
    expect(ids.count).toBe(n);
  });

  test("uuid-like ids behave the same", () => {
    const ids = new IdSet();
    const uuid = (i: number) => `${i.toString(16).padStart(8, "0")}-8e77-4110-90c5-609ceca20d0a`;
    for (let i = 0; i < 50_000; i++) expect(ids.addAndCheck(uuid(i))).toBe(false);
    for (let i = 0; i < 50_000; i += 13) expect(ids.addAndCheck(uuid(i))).toBe(true);
  });
});
