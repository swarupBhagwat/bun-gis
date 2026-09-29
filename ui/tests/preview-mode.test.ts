import { describe, expect, test } from "bun:test";
import type { PreviewSidecar } from "../server/preview";
import { FULL_PREVIEW_BYTES, choosePreview, describeEstimate, isGeoJSON } from "../src/preview";

const sidecar = { count: 1, bytes: 1, bbox: [0, 0, 1, 1], sample: [], grid: { cols: 1, rows: 1, counts: [0] } } as PreviewSidecar;

describe("choosePreview", () => {
  test("small files are drawn in full, with or without a sidecar", () => {
    expect(choosePreview("a.geojson", FULL_PREVIEW_BYTES, sidecar)).toBe("full");
    expect(choosePreview("a.geojson", 1)).toBe("full");
  });
  test("big files use the sidecar when there is one, otherwise they are blocked", () => {
    expect(choosePreview("a.geojson", FULL_PREVIEW_BYTES + 1, sidecar)).toBe("sample");
    expect(choosePreview("a.geojson", FULL_PREVIEW_BYTES + 1)).toBe("blocked");
  });
});

describe("choosePreview for other formats", () => {
  const small = { ...sidecar, count: 3, sample: [1, 2, 3] } as unknown as PreviewSidecar;
  const big = { ...sidecar, count: 5000, sample: new Array(2000).fill(0) } as unknown as PreviewSidecar;
  test("a sidecar holding every feature draws them all; a partial one draws the sample; none means no preview", () => {
    expect(choosePreview("a.parquet", 10, small)).toBe("all");
    expect(choosePreview("a.kml", 10 * FULL_PREVIEW_BYTES, big)).toBe("sample");
    expect(choosePreview("a.geojsonl", 10)).toBe("blocked");
  });
  test("only .geojson counts as GeoJSON", () => {
    expect(isGeoJSON("a.geojson")).toBe(true);
    expect(isGeoJSON("a.geojsonl")).toBe(false);
    expect(isGeoJSON("a.parquet")).toBe(false);
  });
});

describe("describeEstimate", () => {
  const base = { parts: 1, rowGroups: 2, maxRows: 38068, readBytes: 9.6 * 1024 ** 2 };
  test("small areas: plain sentence, singular file, upper-bound wording", () => {
    const { text, large } = describeEstimate(base);
    expect(large).toBe(false);
    expect(text).toContain("9.6 MB");
    expect(text).toContain("(1 file)");
    expect(text).toContain("at most 38,068 features");
  });
  test("big reads are flagged as large", () => {
    const result = describeEstimate({ ...base, parts: 3, readBytes: 300 * 1024 ** 2 });
    expect(result.large).toBe(true);
    expect(result.text).toContain("(3 files)");
    expect(result.text).toContain("sample");
  });
  test("no parts → says there is no data", () => {
    expect(describeEstimate({ parts: 0, rowGroups: 0, maxRows: 0, readBytes: 0 }).text).toContain("No Overture data");
  });
});
