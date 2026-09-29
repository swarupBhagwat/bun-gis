import { dirname } from "node:path";
import { describe, expect, test } from "bun:test";
import { GeoJSONWriter } from "../src/geojson/writer";
import { BunGisError } from "../src/core/errors";
import { features, metadata, tempPath } from "./fixtures";

const writer = new GeoJSONWriter();
const config = (path: string, overwrite = false) => ({ path, overwrite, metadata });

describe("GeoJSONWriter", () => {
  test("writes a valid FeatureCollection with attribution and exact byte count", async () => {
    const path = await tempPath();
    const result = await writer.write(features(3), config(path));
    const text = await Bun.file(path).text();
    const json = JSON.parse(text);
    expect(json.type).toBe("FeatureCollection");
    expect(json.attribution).toBe(metadata.attribution);
    expect(json.source).toBe(metadata.source);
    expect(json.features).toHaveLength(3);
    expect(result).toEqual({ featureCount: 3, bytes: Buffer.byteLength(text) });
  });

  test("writes an empty collection", async () => {
    const path = await tempPath();
    await writer.write(features(0), config(path));
    expect(JSON.parse(await Bun.file(path).text()).features).toEqual([]);
  });

  test("refuses to overwrite unless allowed", async () => {
    const path = await tempPath();
    await writer.write(features(1), config(path));
    await expect(writer.write(features(1), config(path))).rejects.toBeInstanceOf(BunGisError);
    await writer.write(features(2), config(path, true));
    expect(JSON.parse(await Bun.file(path).text()).features).toHaveLength(2);
  });

  test("a failing stream leaves no output and no partial file", async () => {
    const path = await tempPath();
    async function* broken() {
      yield* features(2);
      throw new Error("boom");
    }
    await expect(writer.write(broken(), config(path))).rejects.toThrow("boom");
    expect(await Bun.file(path).exists()).toBe(false);
    expect(await Bun.file(`${path}.part`).exists()).toBe(false);
  });

  test("writes a bare relative path in the current directory (./out.geojson)", async () => {
    const dir = dirname(await tempPath());
    const previous = process.cwd();
    process.chdir(dir);
    try {
      await writer.write(features(1), config("./out.geojson"));
    } finally {
      process.chdir(previous);
    }
    expect(await Bun.file(`${dir}/out.geojson`).exists()).toBe(true);
  });

  test("creates missing parent directories", async () => {
    const path = (await tempPath()).replace("out.geojson", "a/b/out.geojson");
    await writer.write(features(1), config(path));
    expect(await Bun.file(path).exists()).toBe(true);
  });
});
