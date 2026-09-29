import { describe, expect, test } from "bun:test";
import { safeName } from "../server/api";
import { applyChange, defaultName, initialForm, savedName, toDownloadBody } from "../src/form";

const AREA = ["11.575", "48.137", "11.58", "48.14"] as const;

describe("defaultName", () => {
  test("carries the source, dataset and area", () => {
    expect(defaultName("overture", "buildings", AREA)).toBe("overture-buildings-11.575_48.137_11.58_48.14.geojson");
  });

  test("a different area gives a different name, so it cannot overwrite an earlier download", () => {
    const other = ["11.55", "48.12", "11.6", "48.17"];
    expect(defaultName("overture", "buildings", other)).not.toBe(defaultName("overture", "buildings", AREA));
  });

  test("negative coordinates stay valid file names", () => {
    const name = defaultName("overture", "buildings", ["-0.5", "51.3", "0.3", "51.7"]);
    expect(name).toBe("overture-buildings--0.5_51.3_0.3_51.7.geojson");
    expect(() => safeName(name)).not.toThrow();
  });

  test("falls back to a plain name while the area is not valid", () => {
    expect(defaultName("overture", "buildings", ["", "48.137", "11.58", "48.14"])).toBe("overture-buildings.geojson");
  });

  test("every default name is accepted by the server's file-name rules", () => {
    for (const fields of [AREA, ["-180", "-90", "180", "90"], ["0", "0", "0.00001", "0.00001"]]) {
      expect(() => safeName(defaultName("overture", "buildings", fields))).not.toThrow();
    }
  });
});

describe("savedName", () => {
  test("mirrors the server, which appends the extension", () => {
    expect(savedName("a")).toBe("a.geojson");
    expect(savedName("  a.geojson ")).toBe("a.geojson");
    for (const typed of ["a", "a.geojson", "x_1.2"]) expect(savedName(typed)).toBe(safeName(typed));
  });
});

describe("applyChange", () => {
  test("the file name follows the source, dataset and area while it is still the default", () => {
    const moved = applyChange(initialForm, { fields: ["11.55", "48.12", "11.6", "48.17"] });
    expect(moved.filename).toBe("overture-buildings-11.55_48.12_11.6_48.17.geojson");
    expect(applyChange(initialForm, { dataset: "roads" }).filename).toBe("overture-roads-11.575_48.137_11.58_48.14.geojson");
  });

  test("it survives an invalid area in between", () => {
    const broken = applyChange(initialForm, { fields: ["", "48.137", "11.58", "48.14"] });
    expect(broken.filename).toBe("overture-buildings.geojson");
    expect(applyChange(broken, { fields: [...AREA] }).filename).toBe(initialForm.filename);
  });

  test("a file name the user typed is kept when the area changes", () => {
    const typed = applyChange(initialForm, { filename: "mine.geojson" });
    expect(applyChange(typed, { fields: ["11.55", "48.12", "11.6", "48.17"] }).filename).toBe("mine.geojson");
  });

  test("changing the file name itself is never overridden", () => {
    expect(applyChange(initialForm, { filename: "x.geojson", dataset: "roads" }).filename).toBe("x.geojson");
  });

  test("does not mutate the previous state", () => {
    const before = structuredClone(initialForm);
    applyChange(initialForm, { provider: "other", overwrite: true });
    expect(initialForm).toEqual(before);
  });
});

describe("toDownloadBody", () => {
  test("builds the request from a valid form", () => {
    expect(toDownloadBody(initialForm)).toEqual({
      provider: "overture",
      dataset: "buildings",
      format: "geojson",
      bbox: [11.575, 48.137, 11.58, 48.14],
      filename: "overture-buildings-11.575_48.137_11.58_48.14.geojson",
      overwrite: false,
      retries: undefined,
      release: undefined,
      verbose: false,
    });
  });

  test("is undefined while the area is invalid", () => {
    expect(toDownloadBody({ ...initialForm, fields: ["50", "48.137", "11.58", "48.14"] })).toBeUndefined();
    expect(toDownloadBody({ ...initialForm, fields: ["", "48.137", "11.58", "48.14"] })).toBeUndefined();
  });

  test("retries: empty means the server default, a number is passed through", () => {
    expect(toDownloadBody({ ...initialForm, retries: "" })!.retries).toBeUndefined();
    expect(toDownloadBody({ ...initialForm, retries: "5" })!.retries).toBe(5);
    expect(toDownloadBody({ ...initialForm, retries: "0" })!.retries).toBe(0);
  });

  test("release is trimmed, and empty means latest", () => {
    expect(toDownloadBody({ ...initialForm, release: " 2026-09-23.1 " })!.release).toBe("2026-09-23.1");
    expect(toDownloadBody({ ...initialForm, release: "   " })!.release).toBeUndefined();
  });

  test("release only applies to the overture source", () => {
    expect(toDownloadBody({ ...initialForm, provider: "other", release: "R" })!.release).toBeUndefined();
  });

  test("overwrite and verbose are passed through", () => {
    const body = toDownloadBody({ ...initialForm, overwrite: true, verbose: true })!;
    expect([body.overwrite, body.verbose]).toEqual([true, true]);
  });
});

describe("format and file extension", () => {
  test("the default name takes the format's extension and follows format changes", () => {
    expect(defaultName("overture", "buildings", AREA, ".parquet")).toBe("overture-buildings-11.575_48.137_11.58_48.14.parquet");
    const next = applyChange(initialForm, { format: "kml", extension: ".kml" });
    expect(next.filename).toBe("overture-buildings-11.575_48.137_11.58_48.14.kml");
    expect(applyChange(next, { format: "geojson", extension: ".geojson" }).filename).toBe(initialForm.filename);
  });
  test("a name the user typed is not rewritten when the format changes", () => {
    const typed = applyChange(initialForm, { filename: "mine.geojson" });
    expect(applyChange(typed, { format: "kml", extension: ".kml" }).filename).toBe("mine.geojson");
  });
  test("savedName appends the chosen extension only when missing", () => {
    expect(savedName("x", ".kml")).toBe("x.kml");
    expect(savedName(" x.kml ", ".kml")).toBe("x.kml");
    expect(savedName("x.geojson", ".kml")).toBe("x.geojson.kml");
    expect(savedName("x")).toBe("x.geojson");
  });
  test("the request carries the format", () => {
    expect(toDownloadBody({ ...initialForm, format: "geoparquet", extension: ".parquet" })?.format).toBe("geoparquet");
  });
});
