import { describe, expect, test } from "bun:test";
import { checkGeoJSON } from "../src/validate/check";
import type { Report } from "../src/validate/check";

const CCW = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const CROSSED = [[0, 0], [2, 0], [2, 2], [1, -2], [0, 0]];

const feature = (geometry: unknown, extra: object = {}) => ({ type: "Feature", properties: {}, geometry, ...extra });
const polygon = (coordinates: unknown) => ({ type: "Polygon", coordinates });
const collection = (features: unknown[]) => JSON.stringify({ type: "FeatureCollection", attribution: "© t", features });
const structure = (report: Report) => report.checks.find((c) => c.name.startsWith("Structure"))!;

describe("structure checks (own single pass, no syntax library)", () => {
  test.each([
    ["missing properties", { type: "Feature", geometry: polygon([CCW]) }, 'missing "properties"'],
    ["properties that is a string", feature(polygon([CCW]), { properties: "x" }), "properties must be an object"],
    ["wrong feature type", { type: "Thing", properties: {}, geometry: null }, 'type "Feature"'],
    ["missing geometry member", { type: "Feature", properties: {} }, 'missing "geometry"'],
    ["unknown geometry type", feature({ type: "Circle", coordinates: [0, 0] }), 'unknown geometry type "Circle"'],
    ["a polygon nested like a line string", feature(polygon([[0, 0], [1, 1]])), "Polygon coordinates are nested wrongly"],
    ["coordinates that are not an array", feature(polygon("nope")), "Polygon coordinates must be an array"],
    ["a text coordinate", feature(polygon([[[0, 0], [1, "x"], [1, 1], [0, 0]]])), "non-number"],
    ["a one-number position", feature({ type: "Point", coordinates: [5] }), "at least 2 numbers"],
    ["a nested collection member that is broken", feature({ type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [1, 2] }, { type: "Point", coordinates: "x" }] }), "Point coordinates must be an array"],
    ["a collection without geometries", feature({ type: "GeometryCollection" }), "needs a geometries array"],
    ["a non-object feature", 42, 'type "Feature"'],
  ])("rejects %s", (_name, bad, message) => {
    const report = checkGeoJSON(collection([bad]));
    expect(report.failed).toBe(true);
    expect(structure(report).status).toBe("fail");
    expect(structure(report).examples[0]).toContain(message);
  });

  test.each([
    ["features that is not an array", '{"type":"FeatureCollection","features":{}}', "features array"],
    ["a root array", "[]", "expected a GeoJSON object"],
    ["invalid JSON", "{nope", "Invalid JSON"],
    ["empty input", "", "Invalid JSON"],
  ])("a fatal problem (%s) returns a single failing check", (_name, text, message) => {
    const report = checkGeoJSON(text);
    expect(report.failed).toBe(true);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]!.examples[0]).toContain(message);
  });

  test("a features array makes it a collection even when the type is missing or wrong (reported, not fatal)", () => {
    const missing = checkGeoJSON('{"features":[]}');
    expect(missing.failed).toBe(true);
    expect(missing.checks.length).toBeGreaterThan(1);
    expect(structure(missing).examples[0]).toContain('missing "type"');
    const wrong = checkGeoJSON(collection([feature(polygon([CCW]))]).replace("FeatureCollection", "Nope"));
    expect(structure(wrong).examples[0]).toContain('root type is "Nope"');
    expect(wrong.featureCount).toBe(1);
  });

  test("an unknown root type is treated as a bad geometry", () => {
    const report = checkGeoJSON('{"type":"Nope","coordinates":[0,0]}');
    expect(structure(report).examples[0]).toContain('unknown geometry type "Nope"');
  });

  test("valid variants pass: null geometry, empty coordinates, geometry collection, 3D positions", () => {
    const report = checkGeoJSON(collection([
      feature(null),
      feature({ type: "MultiPoint", coordinates: [] }),
      feature({ type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [1, 2, 30] }, polygon([CCW])] }),
      feature({ type: "LineString", coordinates: [[0, 0, 5], [1, 1, 6]] }),
    ]));
    expect(structure(report).status).toBe("pass");
    expect(report.failed).toBe(false);
    expect(report.featureCount).toBe(4);
    expect(report.geometryTypes).toEqual({ MultiPoint: 1, GeometryCollection: 1, LineString: 1 });
  });

  test("a malformed feature does not stop the other features from being checked", () => {
    const report = checkGeoJSON(collection([feature(polygon("nope"), { id: "bad" }), feature(polygon([CROSSED]), { id: "crossed" })]));
    expect(structure(report).examples[0]).toContain("bad: Polygon coordinates");
    expect(report.checks.find((c) => c.name === "Geometry validity")!.examples[0]).toContain("crossed: 1 self-intersection");
    expect(report.featureCount).toBe(2);
  });

  test("problems are all counted but only the first few are kept as examples", () => {
    const report = checkGeoJSON(collection(Array.from({ length: 12 }, () => ({ type: "Feature", geometry: null }))));
    expect(structure(report).detail).toBe("12 issue(s)");
    expect(structure(report).examples).toHaveLength(5);
  });

  test("rule findings from many features are counted without storing every message", () => {
    const clockwise = [...CCW].reverse();
    const report = checkGeoJSON(collection(Array.from({ length: 50 }, () => feature(polygon([clockwise])))));
    const winding = report.checks.find((c) => c.name === "Winding order")!;
    expect(winding.detail).toContain("50 ring(s)");
    expect(winding.examples).toHaveLength(5);
  });

  test("coordinates out of range are found on points, lines and rings", () => {
    const report = checkGeoJSON(collection([
      feature({ type: "Point", coordinates: [200, 0] }, { id: "pt" }),
      feature({ type: "LineString", coordinates: [[0, 0], [0, 95]] }, { id: "ln" }),
      feature(polygon([[[0, 0], [181, 0], [1, 1], [0, 0]]]), { id: "rg" }),
    ]));
    const examples = report.checks.find((c) => c.name === "RFC 7946 rules")!.examples.join(" | ");
    expect(examples).toContain("pt: coordinate out of range [200, 0]");
    expect(examples).toContain("ln: coordinate out of range [0, 95]");
    expect(examples).toContain("rg: coordinate out of range [181, 0]");
  });
});

describe("performance", () => {
  // The previous syntax pass took ~1 s per MB; this guards against reintroducing a slow full-text pass.
  test("100,000 small polygons (about 15 MB) validate in a few seconds", () => {
    const features = Array.from({ length: 100_000 }, (_, i) => {
      const x = (i % 1000) * 0.001;
      const y = Math.floor(i / 1000) * 0.001;
      return feature(polygon([[[x, y], [x + 0.0005, y], [x + 0.0005, y + 0.0005], [x, y + 0.0005], [x, y]]]), { id: `f${i}`, properties: { name: `building ${i}`, height: 10 } });
    });
    const text = collection(features);
    expect(text.length).toBeGreaterThan(10_000_000);
    const started = performance.now();
    const report = checkGeoJSON(text);
    const seconds = (performance.now() - started) / 1000;
    expect(report.featureCount).toBe(100_000);
    expect(report.failed).toBe(false);
    expect(seconds).toBeLessThan(8);
  });
});
