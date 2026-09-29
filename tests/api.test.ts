import { expect, test } from "bun:test";
import { download } from "../src/api";
import { GeoJSONWriter } from "../src/geojson/writer";
import { fakeSource, tempPath } from "./fixtures";

test("download() wires defaults and accepts custom sources/writers", async () => {
  const output = await tempPath();
  const result = await download(
    { source: "mine", dataset: "buildings", bbox: [0, 0, 1, 1], output },
    { sources: new Map([["mine", fakeSource(2)]]), writers: new Map([["geojson" as const, new GeoJSONWriter()]]) },
  );
  expect(result.featureCount).toBe(2);
});

test("with no overrides, the only built-in source is overture", async () => {
  const error = await download({ source: "nope", dataset: "buildings", bbox: [0, 0, 1, 1], output: await tempPath() }).catch((e) => e);
  expect(error.hint).toBe("Available: overture");
});
