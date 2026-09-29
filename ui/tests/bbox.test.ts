import { describe, expect, test } from "bun:test";
import { DEFAULT_BBOX, areaKm2, formatBytes, formatCoord, readBBox, sizeWarning } from "../src/bbox";

describe("readBBox", () => {
  test("accepts four valid numbers", () => {
    expect(readBBox(["11.575", "48.137", "11.58", "48.14"])).toEqual({ bbox: [11.575, 48.137, 11.58, 48.14] });
    expect(readBBox([" -0.5 ", "51.3", "0.3", "51.7"]).bbox).toEqual([-0.5, 51.3, 0.3, 51.7]);
  });

  test.each([
    [["", "1", "2", "3"], "Enter four numbers"],
    [["a", "1", "2", "3"], "Enter four numbers"],
    [["-181", "0", "1", "1"], "Longitude"],
    [["0", "0", "181", "1"], "Longitude"],
    [["0", "-91", "1", "1"], "Latitude"],
    [["0", "0", "1", "91"], "Latitude"],
    [["10", "0", "5", "1"], "smaller"],
    [["0", "5", "1", "5"], "smaller"],
  ])("rejects %j", (fields, message) => {
    expect(readBBox(fields).error).toContain(message);
  });
});

describe("areaKm2 and sizeWarning", () => {
  test("the default Marienplatz box is small", () => {
    expect(areaKm2(DEFAULT_BBOX)).toBeGreaterThan(0.1);
    expect(areaKm2(DEFAULT_BBOX)).toBeLessThan(0.5);
    expect(sizeWarning(DEFAULT_BBOX)).toBeUndefined();
  });

  test("one degree of latitude at the equator is about 111 km", () => {
    expect(areaKm2([0, 0, 0.01, 1])).toBeCloseTo(1.11 * 111.32, 0);
  });

  test("longitude shrinks with latitude", () => {
    expect(areaKm2([0, 60, 1, 61])).toBeLessThan(areaKm2([0, 0, 1, 1]) * 0.55);
  });

  test("warns above the measured memory threshold", () => {
    const fiveKm: [number, number, number, number] = [11.55, 48.12, 11.6, 48.17]; // ~ 25 km², the measured case
    const big: [number, number, number, number] = [11.4, 48.0, 11.8, 48.3]; // ~ 900 km²
    expect(sizeWarning(fiveKm)).toBeUndefined();
    expect(sizeWarning(big)).toContain("Overture");
  });
});

test("formatCoord trims to five decimals without trailing zeros", () => {
  expect(formatCoord(11.5750001)).toBe("11.575");
  expect(formatCoord(48.1)).toBe("48.1");
  expect(formatCoord(-0.123456789)).toBe("-0.12346");
});

test("formatBytes", () => {
  expect(formatBytes(999)).toBe("999 B");
  expect(formatBytes(116_884)).toBe("114.1 KB");
});
