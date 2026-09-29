import { describe, expect, test } from "bun:test";
import type { RowGroup } from "hyparquet";
import { BunGisError } from "../src/core/errors";
import { download } from "../src/core/download";
import { GeoJSONWriter } from "../src/geojson/writer";
import { rowToFeature } from "../src/providers/overture/convert";
import { createEstimator } from "../src/providers/overture/estimate";
import { groupIntersects, groupReadBytes, rowIntersects } from "../src/providers/overture/reader";
import { prefetch } from "../src/providers/overture/prefetch";
import { OvertureSource } from "../src/providers/overture/source";
import type { OvertureRow, PartFile } from "../src/providers/overture/types";
import { describeFeatureSourceContract } from "./contract";
import { tempPath } from "./fixtures";

const polygon = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const row = (id: string, extra: Record<string, unknown> = {}): OvertureRow => ({
  id, geometry: polygon, bbox: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 }, ...extra,
});

const parts: PartFile[] = [
  { url: "https://data.test/a.parquet", bbox: [0, 0, 5, 5] },
  { url: "https://data.test/b.parquet", bbox: [0, 0, 5, 5] },
];
const read = async function* (part: PartFile): AsyncGenerator<OvertureRow> {
  yield row(`${part.url.slice(-9, -8)}1`);
  yield row(`${part.url.slice(-9, -8)}2`);
};
const overture = () => new OvertureSource({ release: async () => "R1", findParts: async () => parts }, read);
describeFeatureSourceContract("OvertureSource", overture);

describe("OvertureSource", () => {
  test("reads each part in order and converts rows to features", async () => {
    const ids: unknown[] = [];
    for await (const f of overture().download({ source: "overture", dataset: "buildings", bbox: [0, 0, 1, 1], output: "x" })) ids.push(f.id);
    expect(ids).toEqual(["a1", "a2", "b1", "b2"]);
  });

  test("no parts (bbox over open sea) → valid empty GeoJSON", async () => {
    const source = new OvertureSource({ release: async () => "R1", findParts: async () => [] }, read);
    const output = await tempPath();
    const result = await download(
      { source: "overture", dataset: "buildings", bbox: [0, 0, 1, 1], output },
      { sources: new Map([["overture", source]]), writers: new Map([["geojson" as const, new GeoJSONWriter()]]) },
    );
    expect(result.featureCount).toBe(0);
    expect(JSON.parse(await Bun.file(output).text())).toMatchObject({ type: "FeatureCollection", features: [], license: "ODbL-1.0", release: "R1" });
  });

  test("attribution points to Overture and keeps the per-feature sources requirement", async () => {
    const meta = await overture().metadata({ source: "x", dataset: "buildings", bbox: [0, 0, 1, 1], output: "x" });
    expect(meta.attribution).toContain("overturemaps.org");
    expect(meta.attribution).toContain("OpenStreetMap");
  });
});

describe("rowToFeature", () => {
  test("drops bbox, null values; makes BigInt and Date JSON-safe, recursively", () => {
    const f = rowToFeature(row("id1", {
      height: null, num_floors: 5n, huge: 2n ** 70n, version: 1,
      sources: [{ dataset: "OSM", update_time: new Date("2026-05-29T13:03:34Z"), count: 3n }],
    }));
    expect(f.id).toBe("id1");
    expect(f.properties).toEqual({
      num_floors: 5, huge: (2n ** 70n).toString(), version: 1,
      sources: [{ dataset: "OSM", update_time: "2026-05-29T13:03:34.000Z", count: 3 }],
    });
    expect(() => JSON.stringify(f)).not.toThrow();
  });

  test("refuses a row whose geometry was not decoded", () => {
    const bad = { id: "x", geometry: new Uint8Array([1, 2]) } as unknown as OvertureRow;
    expect(() => rowToFeature(bad)).toThrow(BunGisError);
  });
});

describe("row-group pruning", () => {
  const group = (xmin: number, xmax: number, ymin: number, ymax: number): RowGroup => {
    const col = (path: string, min: number, max: number) =>
      ({ meta_data: { path_in_schema: path.split("."), statistics: { min_value: min, max_value: max } } });
    return { columns: [col("bbox.xmin", xmin, xmax), col("bbox.xmax", xmin, xmax), col("bbox.ymin", ymin, ymax), col("bbox.ymax", ymin, ymax)] } as unknown as RowGroup;
  };
  const query: [number, number, number, number] = [10, 10, 20, 20];

  test("keeps groups overlapping the bbox, drops the rest", () => {
    expect(groupIntersects(group(15, 16, 12, 13), query)).toBe(true);
    expect(groupIntersects(group(0, 5, 12, 13), query)).toBe(false);
    expect(groupIntersects(group(15, 16, 30, 40), query)).toBe(false);
  });

  test("keeps a group when statistics are missing (never drop data on doubt)", () => {
    expect(groupIntersects({ columns: [] } as unknown as RowGroup, query)).toBe(true);
  });

  test("rowIntersects filters exactly, touching edges count", () => {
    expect(rowIntersects(row("a", { bbox: { xmin: 20, ymin: 20, xmax: 21, ymax: 21 } }), query)).toBe(true);
    expect(rowIntersects(row("a", { bbox: { xmin: 21, ymin: 20, xmax: 22, ymax: 21 } }), query)).toBe(false);
  });
});

describe("OvertureSource concurrency", () => {
  test("reads parts in parallel but emits them in order", async () => {
    let active = 0, peak = 0;
    const many: PartFile[] = ["a", "b", "c", "d", "e", "f"].map((n, i) => ({ url: `https://data.test/${n}.parquet`, bbox: [0, 0, 5, 5], i } as PartFile));
    const slow = async function* (part: PartFile): AsyncGenerator<OvertureRow> {
      active++; peak = Math.max(peak, active);
      await Bun.sleep(many.indexOf(part) === 0 ? 40 : 5);
      active--;
      yield row(part.url.slice(-9, -8));
    };
    const source = new OvertureSource({ release: async () => "R1", findParts: async () => many }, slow);
    const ids: unknown[] = [];
    for await (const f of source.download({ source: "overture", dataset: "buildings", bbox: [0, 0, 1, 1], output: "x" })) ids.push(f.id);
    expect(ids).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe("prefetch", () => {
  const range = async function* (n: number, seen: { pulled: number }) {
    for (let i = 0; i < n; i++) { seen.pulled++; yield i; }
  };

  test("preserves order and stays within the buffer limit ahead of the consumer", async () => {
    const seen = { pulled: 0 };
    const out: number[] = [];
    for await (const v of prefetch(range(50, seen), 3)) {
      out.push(v);
      await Bun.sleep(1);
      expect(seen.pulled - out.length).toBeLessThanOrEqual(4);
    }
    expect(out).toEqual([...Array(50).keys()]);
  });

  test("propagates source errors after delivering earlier items", async () => {
    const failing = async function* () { yield 1; throw new Error("boom"); };
    const out: number[] = [];
    await expect((async () => { for await (const v of prefetch(failing(), 5)) out.push(v); })()).rejects.toThrow("boom");
    expect(out).toEqual([1]);
  });

  test("close() stops a stream that was never consumed", async () => {
    const seen = { pulled: 0 };
    const stream = prefetch(range(1000, seen), 3);
    await Bun.sleep(10);
    await stream.close();
    const after = seen.pulled;
    await Bun.sleep(10);
    expect(after).toBeLessThan(10);
    expect(seen.pulled).toBe(after);
  });

  test("stops pulling when the consumer quits early", async () => {
    const seen = { pulled: 0 };
    for await (const _ of prefetch(range(1000, seen), 3)) break;
    await Bun.sleep(10);
    expect(seen.pulled).toBeLessThan(10);
  });
});

describe("estimate", () => {
  const chunk = (bytes: number, name: string) => ({ meta_data: { path_in_schema: [name], total_compressed_size: BigInt(bytes) } });

  test("groupReadBytes sums the compressed size of every column chunk", () => {
    const group = { columns: [chunk(100, "a"), chunk(250, "b"), { meta_data: undefined }] } as unknown as RowGroup;
    expect(groupReadBytes(group)).toBe(350);
  });

  test("createEstimator adds up all parts and reports the part count", async () => {
    const estimate = createEstimator(
      { release: async () => "R1", findParts: async () => parts },
      async (part) => ({ rowGroups: 2, maxRows: part.url.endsWith("a.parquet") ? 10 : 5, readBytes: 100 }),
    );
    expect(await estimate({ dataset: "buildings", bbox: [0, 0, 1, 1] })).toEqual({ parts: 2, rowGroups: 4, maxRows: 15, readBytes: 200 });
  });

  test("no parts → zeros; unknown dataset is refused", async () => {
    const estimate = createEstimator({ release: async () => "R1", findParts: async () => [] }, async () => { throw new Error("unused"); });
    expect(await estimate({ dataset: "buildings", bbox: [0, 0, 1, 1] })).toEqual({ parts: 0, rowGroups: 0, maxRows: 0, readBytes: 0 });
    await expect(estimate({ dataset: "nope", bbox: [0, 0, 1, 1] })).rejects.toThrow(BunGisError);
  });
});
