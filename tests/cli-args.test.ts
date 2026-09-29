import { describe, expect, test } from "bun:test";
import { parseCli } from "../src/cli/args";
import type { CliOptions } from "../src/cli/args";
import { BunGisError } from "../src/core/errors";

const BBOX = "11.575,48.137,11.58,48.14";

function options(argv: string[]): CliOptions {
  const parsed = parseCli(argv);
  if (parsed.kind !== "download") throw new Error(`expected download, got ${parsed.kind}`);
  return parsed.options;
}

const hint = (argv: string[]) => {
  try {
    parseCli(argv);
  } catch (e) {
    return e as BunGisError;
  }
  throw new Error("expected an error");
};

describe("parseCli", () => {
  test("parses provider, dataset and bbox with defaults", () => {
    expect(options(["overture", "buildings", "--bbox", BBOX])).toEqual({
      provider: "overture", dataset: "buildings", bbox: [11.575, 48.137, 11.58, 48.14],
      output: "./buildings.geojson", format: "geojson", force: false, quiet: false, verbose: false,
      release: undefined, retries: undefined,
    });
  });

  test("short flags and values", () => {
    const o = options(["overture", "buildings", "--bbox", BBOX, "-o", "x.geojson", "-f", "-q", "--release", "2026-09-23.1", "--retry", "0"]);
    expect(o).toMatchObject({ output: "x.geojson", force: true, quiet: true, release: "2026-09-23.1", retries: 0 });
  });

  test("an optional leading `download` gives the same result", () => {
    expect(parseCli(["download", "overture", "buildings", "--bbox", BBOX])).toEqual(parseCli(["overture", "buildings", "--bbox", BBOX]));
  });

  test("no arguments or --help → help; --version → version", () => {
    expect(parseCli([])).toEqual({ kind: "help" });
    expect(parseCli(["overture", "-h"])).toEqual({ kind: "help" });
    expect(parseCli(["--version"])).toEqual({ kind: "version" });
    expect(parseCli(["-v"])).toEqual({ kind: "version" });
  });

  test.each([
    ["missing bbox", ["overture", "buildings"], "Missing --bbox"],
    ["missing dataset", ["overture", "--bbox", BBOX], "Expected: bun-gis"],
    ["extra positional", ["overture", "buildings", "x", "--bbox", BBOX], "Expected: bun-gis"],
    ["unknown option", ["overture", "buildings", "--bbox", BBOX, "--nope"], "nope"],
    ["negative retry", ["overture", "buildings", "--bbox", BBOX, "--retry=-1"], "Invalid --retry"],
    ["retry with a dashed value", ["overture", "buildings", "--bbox", BBOX, "--retry", "-1"], "ambiguous"],
    ["non-numeric retry", ["overture", "buildings", "--bbox", BBOX, "--retry", "many"], "Invalid --retry"],
  ])("rejects %s with a usage hint", (_name, argv, message) => {
    const error = hint(argv);
    expect(error).toBeInstanceOf(BunGisError);
    expect(error.message).toContain(message);
    expect(error.hint).toContain("--help");
  });

  test("a bad bbox reports expected and received", () => {
    const error = hint(["overture", "buildings", "--bbox", "72.80,19.20,18.90,72.95"]);
    expect(error.hint).toContain("Received: 72.80,19.20,18.90,72.95");
  });
});

describe("parseCli validate", () => {
  test("parses a file and --strict", () => {
    expect(parseCli(["validate", "x.geojson"])).toEqual({ kind: "validate", file: "x.geojson", strict: false });
    expect(parseCli(["validate", "x.geojson", "--strict"])).toEqual({ kind: "validate", file: "x.geojson", strict: true });
  });

  test.each([
    ["no file", ["validate"], "Expected: bun-gis validate"],
    ["two files", ["validate", "a", "b"], "Expected: bun-gis validate"],
    ["--strict on a download", ["overture", "buildings", "--bbox", "1,2,3,4", "--strict"], "only applies to validate"],
  ])("rejects %s", (_name, argv, message) => {
    const error = hint(argv);
    expect(error.message).toContain(message);
    expect(error.hint).toContain("--help");
  });
});
