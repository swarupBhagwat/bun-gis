import { expect, test } from "bun:test";
import { checkGeoJSON } from "../src/validate/check";
import { download } from "../src/core/download";
import { GeoJSONWriter } from "../src/geojson/writer";
import { createGet } from "../src/providers/overture/http";
import { createParquetReader } from "../src/providers/overture/reader";
import { OvertureSource } from "../src/providers/overture/source";
import { StacCatalog } from "../src/providers/overture/stac";
import { tempPath } from "./fixtures";

// Reads public Overture data: run with LIVE=1 bun test
test.skipIf(!process.env.LIVE)("live: Overture buildings around Marienplatz, Munich", async () => {
  let transferred = 0;
  const counting = (async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    if (init?.method !== "HEAD") transferred += Number(response.headers.get("content-length") ?? 0);
    return response;
  }) as unknown as typeof fetch;
  const get = createGet({ fetch: counting });

  const output = await tempPath();
  const result = await download(
    { source: "overture", dataset: "buildings", bbox: [11.575, 48.137, 11.58, 48.14], output },
    {
      sources: new Map([["overture", new OvertureSource(new StacCatalog({ get }), createParquetReader(get))]]),
      writers: new Map([["geojson" as const, new GeoJSONWriter()]]),
    },
  );
  const json = JSON.parse(await Bun.file(output).text());
  console.error(`live: ${result.featureCount} features, ${result.bytes} bytes written, ${(transferred / 1e6).toFixed(1)} MB downloaded, ${(result.elapsedMs / 1000).toFixed(1)}s`);
  const report = checkGeoJSON(await Bun.file(output).text());
  const problems = report.checks.filter((c) => c.status !== "pass");
  if (problems.length) console.error(`live: validator: ${problems.map((c) => `${c.name}: ${c.detail}`).join("; ")}`);
  expect(report.failed).toBe(false);
  expect(result.featureCount).toBeGreaterThan(10);
  expect(json.features[0].geometry.type).toMatch(/Polygon/);
  expect(json.features[0].properties.sources).toBeDefined();
  expect(json.attribution).toContain("Overture");
  expect(transferred).toBeLessThan(50e6); // a part file is ~500 MB
}, 180_000);
