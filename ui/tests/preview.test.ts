import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { GeoJSONWriter } from "bun-gis";
import type { GeoFeature } from "bun-gis";
import { GRID_CELLS, PreviewSummary, PreviewWriter, SAMPLE_SIZE, sidecarPath } from "../server/preview";
import { features, metadata, tempPath } from "../../tests/fixtures";

const at = (lon: number, lat: number, id = 1): GeoFeature => ({
  type: "Feature", id, properties: {},
  geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + 0.0001, lat], [lon, lat + 0.0001], [lon, lat]]] },
});
const BBOX: [number, number, number, number] = [0, 0, 10, 10];

describe("PreviewSummary", () => {
  test("keeps everything below the sample size and counts every feature", () => {
    const summary = new PreviewSummary(BBOX);
    for (let i = 0; i < 5; i++) summary.add(at(1, 1, i));
    const result = summary.result(123);
    expect(result).toMatchObject({ count: 5, bytes: 123, bbox: BBOX });
    expect(result.sample).toHaveLength(5);
  });

  test("caps the sample but still counts everything; reservoir keeps late features possible", () => {
    const summary = new PreviewSummary(BBOX, () => 0);
    for (let i = 0; i < SAMPLE_SIZE + 500; i++) summary.add(at(1, 1, i));
    const result = summary.result(0);
    expect(result.count).toBe(SAMPLE_SIZE + 500);
    expect(result.sample).toHaveLength(SAMPLE_SIZE);
    expect(result.sample[0]!.id).toBe(SAMPLE_SIZE + 499); // random() = 0 always replaces slot 0
  });

  test("bins features into the grid; edges and outliers are clamped, not dropped", () => {
    const summary = new PreviewSummary(BBOX);
    summary.add(at(0, 0));          // south-west corner → cell 0
    summary.add(at(10, 10));        // north-east edge → last cell (clamped)
    summary.add(at(15, -5));        // outside the bbox → clamped to the nearest edge cell
    const { counts } = summary.result(0).grid;
    expect(counts).toHaveLength(GRID_CELLS * GRID_CELLS);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(counts[0]).toBe(1);
    expect(counts[GRID_CELLS * GRID_CELLS - 1]).toBe(1);
    expect(counts[GRID_CELLS - 1]).toBe(1);
  });

  test("uses the first vertex of any geometry type", () => {
    const summary = new PreviewSummary(BBOX);
    summary.add({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [5, 5] } });
    summary.add({ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[[[5, 5], [6, 5], [6, 6], [5, 5]]]] } });
    const cell = Math.floor((5 / 10) * GRID_CELLS) * GRID_CELLS + Math.floor((5 / 10) * GRID_CELLS);
    expect(summary.result(0).grid.counts[cell]).toBe(2);
  });
});

describe("PreviewWriter", () => {
  test("writes the same GeoJSON as the plain writer, plus a matching sidecar", async () => {
    const path = await tempPath("a.geojson");
    const plainPath = await tempPath("b.geojson");
    const config = { overwrite: false, metadata };
    const result = await new PreviewWriter(new GeoJSONWriter(), BBOX).write(features(50), { ...config, path });
    await new GeoJSONWriter().write(features(50), { ...config, path: plainPath });
    expect(await Bun.file(path).text()).toBe(await Bun.file(plainPath).text());
    const sidecar = await Bun.file(sidecarPath(path)).json();
    expect(sidecar).toMatchObject({ count: 50, bytes: result.bytes });
    expect(sidecar.sample).toHaveLength(50);
  });

  test("a failed download leaves no sidecar", async () => {
    const path = await tempPath("c.geojson");
    const failing = (async function* () { yield* features(2); throw new Error("boom"); })();
    await expect(new PreviewWriter(new GeoJSONWriter(), BBOX).write(failing, { path, overwrite: false, metadata })).rejects.toThrow("boom");
    expect(await Bun.file(sidecarPath(path)).exists()).toBe(false);
    expect(join(path)).toBeTruthy();
  });
});
