import { describe, expect, test } from "bun:test";
import pkg from "../package.json";
import { main } from "../src/cli/main";
import type { SourceSettings } from "../src/compose";
import { HttpError } from "../src/core/errors";
import type { FeatureSource } from "../src/core/ports";
import { fakeSource, tempPath } from "./fixtures";

const BBOX = "11.575,48.137,11.58,48.14";

function run(argv: string[], sources: () => Map<string, FeatureSource> = () => new Map([["overture", fakeSource(3)]])) {
  const out: string[] = [];
  const err: string[] = [];
  const seen: SourceSettings[] = [];
  const code = main(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, (settings) => {
    seen.push(settings);
    return sources();
  });
  return code.then((exit) => ({ exit, out: out.join("\n"), err: err.join("\n"), seen }));
}

describe("main", () => {
  test("downloads to the output file and reports like the brief", async () => {
    const output = await tempPath();
    const { exit, err } = await run(["overture", "buildings", "--bbox", BBOX, "-o", output]);
    expect(exit).toBe(0);
    expect(err).toContain("Downloading overture buildings...");
    expect(err).toContain("✓ Features: 3");
    expect(err).toContain(`✓ Saved: ${output}`);
    const json = JSON.parse(await Bun.file(output).text());
    expect(json.features).toHaveLength(3);
    expect(json.attribution).toContain("Overture");
  });

  test("--quiet prints nothing on success", async () => {
    const { exit, err, out } = await run(["overture", "buildings", "--bbox", BBOX, "-q", "-o", await tempPath()]);
    expect([exit, err, out]).toEqual([0, "", ""]);
  });

  test("passes --release and --retry to the source factory", async () => {
    const { seen } = await run(["overture", "buildings", "--bbox", BBOX, "-o", await tempPath(), "--release", "2026-09-23.1", "--retry", "5"]);
    expect(seen[0]).toMatchObject({ release: "2026-09-23.1", retries: 5 });
  });

  test("refuses to overwrite without --force, overwrites with it", async () => {
    const output = await tempPath();
    const argv = ["overture", "buildings", "--bbox", BBOX, "-q", "-o", output];
    expect((await run(argv)).exit).toBe(0);
    const second = await run(argv);
    expect(second.exit).toBe(1);
    expect(second.err).toContain("✗ Output already exists");
    expect((await run([...argv, "--force"])).exit).toBe(0);
  });

  test("errors print a ✗ line plus the hint and exit 1", async () => {
    const bad = await run(["overture", "buildings", "--bbox", "72.80,19.20,18.90,72.95"]);
    expect(bad.exit).toBe(1);
    expect(bad.err).toContain("✗ Invalid bbox");
    expect(bad.err).toContain("Received: 72.80,19.20,18.90,72.95");

    const unknown = await run(["nope", "buildings", "--bbox", BBOX, "-o", await tempPath()]);
    expect(unknown.err).toContain('✗ Unknown source "nope"');
    expect(unknown.err).toContain("Available: overture");
  });

  test("an unknown --format lists the available ones", async () => {
    const { err } = await run(["overture", "buildings", "--bbox", BBOX, "--format", "shp", "-o", await tempPath()]);
    expect(err).toContain('Unknown --format "shp"');
    expect(err).toContain("Available: geojson, geojsonseq, geoparquet, kml");
  });

  test("provider failures show the HTTP status and hint", async () => {
    const failing: FeatureSource = {
      ...fakeSource(1),
      // eslint-disable-next-line require-yield
      async *download() { throw new HttpError("Overture", 429, undefined, "Try another server."); },
    };
    const { exit, err } = await run(["overture", "buildings", "--bbox", BBOX, "-o", await tempPath()], () => new Map([["overture", failing]]));
    expect(exit).toBe(1);
    expect(err).toContain("✗ Overture request failed: HTTP 429");
    expect(err).toContain("Try another server.");
  });

  test("unexpected errors are summarized, with a stack under --verbose", async () => {
    const crashing: FeatureSource = {
      ...fakeSource(1),
      // eslint-disable-next-line require-yield
      async *download() { throw new Error("boom"); },
    };
    const argv = ["overture", "buildings", "--bbox", BBOX];
    const plain = await run([...argv, "-o", await tempPath()], () => new Map([["overture", crashing]]));
    expect(plain.err).toContain("✗ Unexpected error: boom");
    expect(plain.err).toContain("--verbose");
    const verbose = await run([...argv, "--verbose", "-o", await tempPath()], () => new Map([["overture", crashing]]));
    expect(verbose.err).toContain("[verbose]");
    expect(verbose.err).toContain("at ");
  });

  test("--help, --version and no arguments", async () => {
    expect((await run(["--version"])).out).toBe(pkg.version);
    expect((await run(["--help"])).out).toContain("Usage:");
    expect((await run([])).out).toContain("Usage:");
  });

  test("usage errors point to --help", async () => {
    const { exit, err } = await run(["overture", "buildings"]);
    expect(exit).toBe(1);
    expect(err).toContain("✗ Missing --bbox");
    expect(err).toContain("bun-gis --help");
  });
});

describe("main validate", () => {
  const CCW = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const CROSSED = [[0, 0], [2, 0], [2, 2], [1, -2], [0, 0]];
  const fc = (...rings: number[][][]) => JSON.stringify({
    type: "FeatureCollection", attribution: "© test", source: "Test",
    features: rings.map((ring, i) => ({ type: "Feature", id: `f${i}`, properties: {}, geometry: { type: "Polygon", coordinates: [ring] } })),
  });
  const file = async (text: string) => {
    const path = await tempPath("v.geojson");
    await Bun.write(path, text);
    return path;
  };

  test("a valid file exits 0 and prints the report on stdout", async () => {
    const { exit, out } = await run(["validate", await file(fc(CCW))]);
    expect(exit).toBe(0);
    expect(out).toContain("Features: 1  (Polygon 1)");
    expect(out).toContain("✓ Valid");
  });

  test("a file with a failing rule exits 1", async () => {
    const bad = [[0, 0], [999, 0], [1, 1], [0, 1], [0, 0]];
    const { exit, out } = await run(["validate", await file(fc(bad))]);
    expect(exit).toBe(1);
    expect(out).toContain("✗ RFC 7946 rules");
    expect(out).toContain("✗ Invalid");
  });

  test("warnings pass, but fail under --strict", async () => {
    const path = await file(fc(CROSSED));
    const lenient = await run(["validate", path]);
    expect([lenient.exit, lenient.out.includes("✓ Valid, with warnings")]).toEqual([0, true]);
    const strict = await run(["validate", path, "--strict"]);
    expect([strict.exit, strict.out.includes("✗ Invalid")]).toEqual([1, true]);
  });

  test("a missing file is a clear error", async () => {
    const { exit, err } = await run(["validate", "definitely-missing.geojson"]);
    expect(exit).toBe(1);
    expect(err).toContain("✗ File not found: definitely-missing.geojson");
  });

  test("a file in another output format is refused, not parsed as JSON", async () => {
    const path = await tempPath("x.parquet");
    await Bun.write(path, "PAR1");
    const { exit, err } = await run(["validate", path]);
    expect(exit).toBe(1);
    expect(err).toContain("validate reads GeoJSON files only, not geoparquet");
  });

  test("validates what the downloader wrote", async () => {
    const output = await tempPath();
    await run(["overture", "buildings", "--bbox", BBOX, "-q", "-o", output]);
    const { exit, out } = await run(["validate", output]);
    expect(exit).toBe(0);
    expect(out).toContain("Attribution: Overture");
  });
});
