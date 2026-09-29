import { describe, expect, test } from "bun:test";
import { download } from "../src/core/download";
import { BunGisError } from "../src/core/errors";
import { GeoJSONWriter } from "../src/geojson/writer";
import type { DownloadRequest } from "../src/core/types";
import { fakeSource, tempPath } from "./fixtures";

const deps = {
  sources: new Map([["overture", fakeSource(4)]]),
  writers: new Map([["geojson" as const, new GeoJSONWriter()]]),
};

const request = async (over: Partial<DownloadRequest> = {}): Promise<DownloadRequest> => ({
  source: "overture",
  dataset: "buildings",
  bbox: [72.8, 18.9, 72.95, 19.2],
  output: await tempPath(),
  ...over,
});

describe("download", () => {
  test("streams source → writer and reports the result", async () => {
    const req = await request();
    const events: unknown[] = [];
    const result = await download(req, {
      ...deps,
      progress: { phase: (l) => events.push(l), done: (r) => events.push(r) },
    });
    expect(result).toMatchObject({ source: "overture", dataset: "buildings", featureCount: 4, output: req.output });
    expect(result.bytes).toBe(Bun.file(req.output).size);
    expect(events).toEqual(["overture buildings", result]);
    expect(JSON.parse(await Bun.file(req.output).text()).attribution).toContain("Overture");
  });

  test("rejects an invalid bbox before touching the source", async () => {
    await expect(download(await request({ bbox: [10, 0, 5, 1] }), deps)).rejects.toBeInstanceOf(BunGisError);
  });

  test("rejects unknown source and lists the available ones", async () => {
    const error = await download(await request({ source: "nope" }), deps).catch((e) => e);
    expect(error).toBeInstanceOf(BunGisError);
    expect(error.hint).toBe("Available: overture");
  });

  test("unknown source keys like 'constructor' are not resolved", async () => {
    await expect(download(await request({ source: "constructor" }), deps)).rejects.toBeInstanceOf(BunGisError);
  });

  test("source validation errors propagate", async () => {
    const failing = { ...fakeSource(1), validateRequest() { throw new BunGisError("bad dataset"); } };
    const sources = new Map([["overture", failing]]);
    await expect(download(await request(), { ...deps, sources })).rejects.toThrow("bad dataset");
  });
});
