import { describe, expect, test } from "bun:test";
import { parquetMetadata, parquetReadObjects } from "hyparquet";
import { attributionPath, GeoJSONSeqWriter } from "../src/geojsonseq/writer";
import { GeoParquetWriter } from "../src/geoparquet/writer";
import { KMLWriter } from "../src/kml/writer";
import { BunGisError } from "../src/core/errors";
import { extensionOf, formatOfFile, isOutputFormat, OUTPUT_FORMATS } from "../src/core/formats";
import type { GeoWriter } from "../src/core/ports";
import type { GeoFeature } from "../src/core/types";
import { parseCli } from "../src/cli/args";
import { features, metadata, tempPath } from "./fixtures";

const config = (path: string, overwrite = false) => ({ path, overwrite, metadata });

async function* stream(list: GeoFeature[]) {
  yield* list;
}

const poly = (id: string, extra: Record<string, unknown> = {}): GeoFeature => ({
  type: "Feature",
  id,
  geometry: { type: "Polygon", coordinates: [[[11.5, 48.1], [11.6, 48.1], [11.6, 48.2], [11.5, 48.1]]] },
  properties: { height: 12.5, names: { primary: "Rathaus" }, ...extra },
});

// Behaviour every writer must share, whatever the format.
function describeWriterContract(name: string, writer: GeoWriter) {
  describe(`${name} shares the writer contract`, () => {
    test("reports the feature count and the exact file size", async () => {
      const path = await tempPath("out.bin");
      const result = await writer.write(features(5), config(path));
      expect(result.featureCount).toBe(5);
      expect(result.bytes).toBe(Bun.file(path).size);
    });

    test("refuses to overwrite unless allowed", async () => {
      const path = await tempPath("out.bin");
      await writer.write(features(1), config(path));
      await expect(writer.write(features(1), config(path))).rejects.toBeInstanceOf(BunGisError);
      await writer.write(features(2), config(path, true));
    });

    test("a failing stream leaves no output and no partial file", async () => {
      const path = await tempPath("out.bin");
      async function* broken() {
        yield* features(2);
        throw new Error("boom");
      }
      await expect(writer.write(broken(), config(path))).rejects.toThrow("boom");
      expect(await Bun.file(path).exists()).toBe(false);
      expect(await Bun.file(`${path}.part`).exists()).toBe(false);
    });

    test("an empty stream still produces a file", async () => {
      const path = await tempPath("out.bin");
      const result = await writer.write(features(0), config(path));
      expect(result.featureCount).toBe(0);
      expect(await Bun.file(path).exists()).toBe(true);
    });
  });
}

describeWriterContract("GeoJSONSeqWriter", new GeoJSONSeqWriter());
describeWriterContract("KMLWriter", new KMLWriter());
describeWriterContract("GeoParquetWriter", new GeoParquetWriter());

describe("format registry", () => {
  test("every format has a distinct extension and is recognised by it", () => {
    expect(new Set(OUTPUT_FORMATS.map(extensionOf)).size).toBe(OUTPUT_FORMATS.length);
    for (const format of OUTPUT_FORMATS) expect(formatOfFile(`a${extensionOf(format)}`)).toBe(format);
  });
  test(".geojsonl is not mistaken for .geojson; unknown names and inherited keys are refused", () => {
    expect(formatOfFile("x.geojsonl")).toBe("geojsonseq");
    expect(formatOfFile("x.geojson")).toBe("geojson");
    expect(formatOfFile("x.shp")).toBeUndefined();
    expect(isOutputFormat("toString")).toBe(false);
    expect(isOutputFormat("kml")).toBe(true);
  });
});

describe("CLI --format", () => {
  const args = (format: string[]) => ["overture", "buildings", "--bbox", "1,2,3,4", ...format];
  test("the default output name follows the format's extension", () => {
    const output = (extra: string[]) => (parseCli(args(extra)) as { options: { output: string } }).options.output;
    expect(output([])).toBe("./buildings.geojson");
    expect(output(["--format", "geoparquet"])).toBe("./buildings.parquet");
    expect(output(["--format", "kml"])).toBe("./buildings.kml");
    expect(output(["--format", "geojsonseq"])).toBe("./buildings.geojsonl");
    expect(output(["--format", "kml", "-o", "mine.xml"])).toBe("mine.xml");
  });
});

describe("GeoJSONSeqWriter", () => {
  test("writes one parseable feature per line", async () => {
    const path = await tempPath("a.geojsonl");
    await new GeoJSONSeqWriter().write(stream([poly("a"), poly("b")]), config(path));
    const lines = (await Bun.file(path).text()).split("\n");
    expect(lines.at(-1)).toBe("");
    expect(lines.slice(0, -1).map((l) => JSON.parse(l).id)).toEqual(["a", "b"]);
  });

  test("keeps the attribution in a file beside it", async () => {
    const path = await tempPath("a.geojsonl");
    await new GeoJSONSeqWriter().write(features(1), { path, overwrite: false, metadata: { ...metadata, release: "2026-09-23.1" } });
    const text = await Bun.file(attributionPath(path)).text();
    expect(text).toContain("Source: Overture Maps Foundation");
    expect(text).toContain("License: ODbL-1.0");
    expect(text).toContain("Release: 2026-09-23.1");
    expect(text).toContain(`Attribution: ${metadata.attribution}`);
  });
});

// Minimal well-formedness check: every element opened is closed in order.
function assertBalanced(xml: string) {
  const stack: string[] = [];
  for (const [, closing, name, selfClosing] of xml.matchAll(/<(\/?)([A-Za-z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (selfClosing) continue;
    if (closing) expect(stack.pop()).toBe(name);
    else stack.push(name!);
  }
  expect(stack).toEqual([]);
}

describe("KMLWriter", () => {
  const write = async (list: GeoFeature[]) => {
    const path = await tempPath("a.kml");
    await new KMLWriter().write(stream(list), config(path));
    return Bun.file(path).text();
  };

  test("a document with the attribution, one Placemark per feature, ExtendedData and JSON for nested values", async () => {
    const xml = await write([poly("a"), poly("b", { height: null })]);
    assertBalanced(xml);
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(`<description>${metadata.attribution}</description>`);
    expect(xml).toContain('<Data name="license"><value>ODbL-1.0</value></Data>');
    expect(xml.match(/<Placemark>/g)).toHaveLength(2);
    expect(xml).toContain("<name>a</name>");
    expect(xml).toContain('<Data name="height"><value>12.5</value></Data>');
    expect(xml).toContain('<Data name="names"><value>{&quot;primary&quot;:&quot;Rathaus&quot;}</value></Data>');
    expect(xml.match(/name="height"/g)).toHaveLength(1); // the null one is skipped
    expect(xml).toContain("<coordinates>11.5,48.1 11.6,48.1 11.6,48.2 11.5,48.1</coordinates>");
  });

  test("escapes markup in ids, names and values, and drops characters XML cannot hold", async () => {
    const xml = await write([poly('a&<b>"', { 'k"ey': "x < y & z\u0001" })]);
    assertBalanced(xml);
    expect(xml).toContain("<name>a&amp;&lt;b&gt;&quot;</name>");
    expect(xml).toContain('<Data name="k&quot;ey"><value>x &lt; y &amp; z</value></Data>');
    expect(xml).not.toContain("\u0001");
  });

  test("holes become innerBoundaryIs; multi geometries become MultiGeometry; altitude is kept", async () => {
    const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const xml = await write([
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring, ring] } },
      { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] } },
      { type: "Feature", properties: {}, geometry: { type: "MultiPoint", coordinates: [[1, 2], [3, 4, 5]] } },
      { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] } },
    ]);
    assertBalanced(xml);
    expect(xml).toContain("<innerBoundaryIs>");
    expect(xml.match(/<MultiGeometry>/g)).toHaveLength(3);
    expect(xml).toContain("<coordinates>3,4,5</coordinates>");
  });

  test("a geometry KML cannot hold is an error, not silent data loss", async () => {
    const bad = { type: "Feature", properties: {}, geometry: { type: "Circle", coordinates: [] } } as unknown as GeoFeature;
    await expect(write([bad])).rejects.toBeInstanceOf(BunGisError);
  });
});

describe("GeoParquetWriter", () => {
  const read = async (path: string) => {
    const bytes = await Bun.file(path).arrayBuffer();
    const compressors = { ZSTD: (input: Uint8Array) => Bun.zstdDecompressSync(input) };
    return { rows: await parquetReadObjects({ file: bytes, compressors }), meta: parquetMetadata(bytes) };
  };

  test("round-trips id, geometry (mixed types) and properties", async () => {
    const path = await tempPath("a.parquet");
    const point: GeoFeature = { type: "Feature", id: "p", properties: { n: 1 }, geometry: { type: "Point", coordinates: [11.5, 48.1] } };
    const multi: GeoFeature = {
      type: "Feature", id: "m", properties: {},
      geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
    };
    await new GeoParquetWriter().write(stream([poly("a"), point, multi]), config(path));
    const { rows } = await read(path);
    expect(rows.map((r) => r.id)).toEqual(["a", "p", "m"]);
    expect(rows[0]!.geometry).toEqual(poly("a").geometry);
    expect(rows[1]!.geometry).toEqual(point.geometry);
    expect(rows[2]!.geometry).toEqual(multi.geometry);
    expect(rows[0]!.properties).toEqual({ height: 12.5, names: { primary: "Rathaus" } });
  });

  test("declares GeoParquet metadata and keeps the attribution in the file", async () => {
    const path = await tempPath("a.parquet");
    await new GeoParquetWriter().write(features(2), { path, overwrite: false, metadata: { ...metadata, release: "R1" } });
    const { meta } = await read(path);
    const kv = Object.fromEntries((meta.key_value_metadata ?? []).map((e) => [e.key, e.value]));
    expect(JSON.parse(kv.geo!)).toMatchObject({ version: "1.1.0", primary_column: "geometry", columns: { geometry: { encoding: "WKB" } } });
    expect(kv["bun-gis:attribution"]).toBe(metadata.attribution);
    expect(kv["bun-gis:license"]).toBe("ODbL-1.0");
    expect(kv["bun-gis:release"]).toBe("R1");
  });

  test("streams big inputs as several row groups without losing or reordering rows", async () => {
    const path = await tempPath("big.parquet");
    async function* many() {
      for (let i = 0; i < 25_000; i++) yield { type: "Feature", id: `f${i}`, properties: { i }, geometry: { type: "Point", coordinates: [i / 1000, 1] } } as GeoFeature;
    }
    const result = await new GeoParquetWriter().write(many(), config(path));
    expect(result.featureCount).toBe(25_000);
    const { rows, meta } = await read(path);
    expect(meta.row_groups).toHaveLength(3);
    expect(rows).toHaveLength(25_000);
    expect(rows[0]!.id).toBe("f0");
    expect(rows[24_999]!.id).toBe("f24999");
    expect((rows[12_345]!.properties as { i: number }).i).toBe(12_345);
  });
});
