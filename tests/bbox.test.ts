import { describe, expect, test } from "bun:test";
import { parseBBox, validateBBox } from "../src/bbox/bbox";
import { BunGisError } from "../src/core/errors";

describe("parseBBox", () => {
  test("parses a valid bbox, tolerating spaces", () => {
    expect(parseBBox("72.80, 18.90,72.95,19.20")).toEqual([72.8, 18.9, 72.95, 19.2]);
  });

  test("accepts whitespace-separated values (PowerShell splits unquoted commas)", () => {
    expect(parseBBox("11.575 48.137 11.58 48.14")).toEqual([11.575, 48.137, 11.58, 48.14]);
    expect(parseBBox("  11.575 , 48.137,11.58   48.14 ")).toEqual([11.575, 48.137, 11.58, 48.14]);
  });

  test.each([
    ["wrong count", "1,2,3"],
    ["non-numeric", "a,2,3,4"],
    ["empty value", "1,,3,4"],
    ["lon out of range", "-181,0,10,10"],
    ["lat out of range", "0,-91,10,10"],
    ["min >= max lon", "10,0,10,10"],
    ["swapped lat", "72.80,19.20,72.95,18.90"],
  ])("rejects %s", (_name, input) => {
    expect(() => parseBBox(input)).toThrow(BunGisError);
  });

  test("error shows expected and received", () => {
    try {
      parseBBox("72.80,19.20,18.90,72.95");
    } catch (e) {
      expect((e as BunGisError).hint).toContain("Received: 72.80,19.20,18.90,72.95");
      expect((e as BunGisError).hint).toContain("Expected: minLon,minLat,maxLon,maxLat");
    }
  });
});

test("validateBBox rejects NaN and Infinity", () => {
  expect(() => validateBBox([NaN, 0, 1, 1])).toThrow(BunGisError);
  expect(() => validateBBox([0, 0, Infinity, 1])).toThrow(BunGisError);
});
