import { describe, expect, test } from "bun:test";
import { checkGeoJSON } from "../src/validate/check";
import type { Report } from "../src/validate/check";

const CCW = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const CW = [...CCW].reverse();
const HOLE_CW = [[0.2, 0.2], [0.2, 0.4], [0.4, 0.4], [0.4, 0.2], [0.2, 0.2]];
const BOWTIE = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]; // symmetric: net signed area is exactly 0
const CROSSED = [[0, 0], [2, 0], [2, 2], [1, -2], [0, 0]]; // self-intersecting, non-zero net area

const feature = (coordinates: unknown, id?: string, type = "Polygon") => ({
  type: "Feature", ...(id ? { id } : {}), properties: {}, geometry: { type, coordinates },
});
const collection = (features: unknown[], root: object = { attribution: "© test", source: "Test" }) =>
  JSON.stringify({ type: "FeatureCollection", ...root, features });

const check = (report: Report, name: string) => report.checks.find((c) => c.name === name)!;

describe("checkGeoJSON", () => {
  test("a clean collection passes every check", () => {
    const report = checkGeoJSON(collection([feature([CCW, HOLE_CW], "a"), feature([CCW], "b")]));
    expect(report.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass", "pass", "pass"]);
    expect(report.failed || report.warned).toBe(false);
    expect(report.featureCount).toBe(2);
    expect(report.geometryTypes).toEqual({ Polygon: 2 });
  });

  test("invalid JSON fails at the structure check and stops there", () => {
    const report = checkGeoJSON("{nope");
    expect(report.failed).toBe(true);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]!.examples[0]).toContain("Invalid JSON");
  });

  test("a wrong geometry shape fails", () => {
    const report = checkGeoJSON(collection([feature([[0, 0], [1, 1]], "a", "Polygon")]));
    expect(report.failed).toBe(true);
  });

  test("an unclosed ring is a failure", () => {
    const report = checkGeoJSON(collection([feature([[[0, 0], [1, 0], [1, 1], [0, 1]]], "open")]));
    expect(report.failed).toBe(true);
  });

  test("out-of-range coordinates fail with the feature id", () => {
    const report = checkGeoJSON(collection([feature([[[0, 0], [181, 0], [181, 1], [0, 1], [0, 0]]], "far")]));
    const rules = check(report, "RFC 7946 rules");
    expect(rules.status).toBe("fail");
    expect(rules.examples[0]).toContain("far: coordinate out of range");
    expect(check(checkGeoJSON(collection([feature([[[0, 0], [1, 0], [1, 91], [0, 1], [0, 0]]], "north")])), "RFC 7946 rules").status).toBe("fail");
  });

  test("a zero-area ring fails", () => {
    const report = checkGeoJSON(collection([feature([[[0, 0], [1, 1], [2, 2], [0, 0]]], "flat")]));
    expect(check(report, "RFC 7946 rules").examples[0]).toContain("zero area");
  });

  test("wrong winding is only a warning (RFC 7946 says SHOULD)", () => {
    const report = checkGeoJSON(collection([feature([CW], "cw")]));
    expect(report.failed).toBe(false);
    expect(check(report, "Winding order").status).toBe("warn");
    expect(check(report, "Winding order").examples[0]).toBe("cw: exterior ring is clockwise");
  });

  test("a counterclockwise hole is flagged, a clockwise one is not", () => {
    const bad = checkGeoJSON(collection([feature([CCW, [...HOLE_CW].reverse()], "h")]));
    expect(check(bad, "Winding order").examples[0]).toBe("h: hole is counterclockwise");
  });

  test("a self-intersecting polygon is reported as a warning, not a failure", () => {
    const report = checkGeoJSON(collection([feature([CROSSED], "crossed")]));
    expect(check(report, "Geometry validity").status).toBe("warn");
    expect(check(report, "Geometry validity").examples[0]).toContain("crossed: 1 self-intersection");
    expect(report.failed).toBe(false);
  });

  test("a symmetric bow-tie has zero net area, so it fails, and its crossing is still reported", () => {
    const report = checkGeoJSON(collection([feature([BOWTIE], "bow")]));
    expect(check(report, "RFC 7946 rules").examples[0]).toContain("bow: ring has zero area");
    expect(check(report, "Geometry validity").status).toBe("warn");
  });

  test("duplicate ids and missing attribution are warnings", () => {
    const report = checkGeoJSON(collection([feature([CCW], "x"), feature([CCW], "x")], {}));
    expect(check(report, "Feature ids").status).toBe("warn");
    expect(check(report, "Attribution").status).toBe("warn");
    expect(report.failed).toBe(false);
  });

  test("examples are capped at five", () => {
    const many = Array.from({ length: 12 }, (_, i) => feature([CW], `f${i}`));
    const winding = check(checkGeoJSON(collection(many)), "Winding order");
    expect(winding.detail).toContain("12 ring(s)");
    expect(winding.examples).toHaveLength(5);
  });

  test("accepts a single Feature and a bare geometry", () => {
    expect(checkGeoJSON(JSON.stringify(feature([CCW], "one"))).featureCount).toBe(1);
    expect(checkGeoJSON(JSON.stringify({ type: "Polygon", coordinates: [CCW] })).failed).toBe(false);
  });

  test("checks lines and points too", () => {
    const report = checkGeoJSON(collection([
      feature([[0, 0], [1, 1]], "line", "LineString"),
      feature([5, 5], "pt", "Point"),
    ]));
    expect(report.failed).toBe(false);
    expect(report.geometryTypes).toEqual({ LineString: 1, Point: 1 });
  });
});

describe("flagged features (for highlighting on a map)", () => {
  test("a clean file flags nothing", () => {
    const report = checkGeoJSON(collection([feature([CCW], "ok")]));
    expect(report.flagged).toEqual([]);
    expect(report.flaggedCount).toBe(0);
  });

  test("keeps the geometry, severity and every problem of each flagged feature", () => {
    const report = checkGeoJSON(collection([feature([CCW], "ok"), feature([CW], "cw"), feature([BOWTIE], "bad")]));
    const byLabel = Object.fromEntries(report.flagged.map((f) => [f.label, f]));
    expect(Object.keys(byLabel).sort()).toEqual(["bad", "cw"]);
    expect(byLabel.cw).toMatchObject({ severity: "warn", problems: ["exterior ring is clockwise"], geometry: { type: "Polygon", coordinates: [CW] } });
    expect(byLabel.bad!.severity).toBe("fail"); // zero-area ring is an RFC 7946 violation
    expect(report.flaggedCount).toBe(2);
  });

  test("duplicate ids flag the later feature as a warning", () => {
    const report = checkGeoJSON(collection([feature([CCW], "d"), feature([CCW], "d")]));
    expect(report.flagged).toHaveLength(1);
    expect(report.flagged[0]).toMatchObject({ label: "d", severity: "warn", problems: ["duplicate id"] });
  });

  test("a feature with a warning and a failure counts once, as a failure", () => {
    const flat = feature([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[5, 5], [5, 5], [5, 5], [5, 5]]], "both");
    const report = checkGeoJSON(collection([flat]));
    expect(report.flagged).toHaveLength(1);
    expect(report.flagged[0]!.severity).toBe("fail");
  });

  test("failures are listed first, each severity is capped, and the count stays exact", () => {
    const warns = Array.from({ length: 400 }, (_, i) => feature([CW], `w${i}`));
    const fails = Array.from({ length: 200 }, (_, i) => feature([BOWTIE], `f${i}`));
    const report = checkGeoJSON(collection([...warns, ...fails]));
    expect(report.flaggedCount).toBe(600);
    expect(report.flagged).toHaveLength(300);
    expect(report.flagged[0]!.severity).toBe("fail");
    expect(report.flagged.filter((f) => f.severity === "fail")).toHaveLength(150);
    expect(report.flagged.at(-1)!.severity).toBe("warn");
  });

  test("a huge geometry is counted but not kept", () => {
    const ring = Array.from({ length: 3000 }, (_, i) => [i / 10000, Math.sin(i) / 10]).reverse();
    const closed = [...ring, ring[0]!];
    const report = checkGeoJSON(collection([feature([closed], "huge"), feature([CW], "small")]));
    expect(report.flaggedCount).toBeGreaterThanOrEqual(2);
    expect(report.flagged.map((f) => f.label)).toEqual(["small"]);
  });

  test("points and lines with problems are flagged too", () => {
    const report = checkGeoJSON(collection([feature([200, 10], "far", "Point"), feature([[0, 0]], "short", "LineString")]));
    expect(report.flagged.map((f) => f.label).sort()).toEqual(["far", "short"]);
    expect(report.flagged.every((f) => f.severity === "fail")).toBe(true);
  });
});
