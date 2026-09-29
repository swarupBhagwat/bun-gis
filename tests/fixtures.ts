import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FeatureSource } from "../src/core/ports";
import type { GeoFeature } from "../src/core/types";

export const metadata = {
  source: "Overture Maps Foundation",
  attribution: "Overture Maps Foundation (https://overturemaps.org)",
  license: "ODbL-1.0",
};

export const feature = (n: number): GeoFeature => ({
  type: "Feature",
  id: n,
  geometry: { type: "Point", coordinates: [n, n] },
  properties: { name: `f${n}` },
});

export async function* features(count: number): AsyncGenerator<GeoFeature> {
  for (let i = 1; i <= count; i++) yield feature(i);
}

export const tempPath = async (file = "out.geojson") =>
  join(await mkdtemp(join(tmpdir(), "bun-gis-")), file);

export const fakeSource = (count: number): FeatureSource => ({
  validateRequest() {},
  metadata: async () => metadata,
  download: () => features(count),
});
