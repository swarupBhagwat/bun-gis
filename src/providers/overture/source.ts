import type { FeatureSource } from "../../core/ports";
import type { DownloadRequest, GeoFeature, SourceMetadata } from "../../core/types";
import { rowToFeature } from "./convert";
import { getDataset } from "./datasets";
import { prefetch } from "./prefetch";
import type { OvertureCatalog, OvertureRow, ReadRows } from "./types";

const PART_CONCURRENCY = 4;
const ROW_BUFFER = 2000;

const ATTRIBUTION =
  "Overture Maps Foundation (https://overturemaps.org). Includes data © OpenStreetMap contributors (ODbL) and other sources; each feature's own `sources` property lists its origin and must be kept.";

export class OvertureSource implements FeatureSource {
  constructor(
    private readonly catalog: OvertureCatalog,
    private readonly read: ReadRows,
  ) {}

  validateRequest({ dataset }: DownloadRequest): void {
    getDataset(dataset);
  }

  async metadata({ dataset }: DownloadRequest): Promise<SourceMetadata> {
    return {
      source: "Overture Maps Foundation",
      attribution: ATTRIBUTION,
      license: getDataset(dataset).license,
      release: await this.catalog.release(),
    };
  }

  async *download({ dataset, bbox }: DownloadRequest): AsyncGenerator<GeoFeature> {
    const parts = await this.catalog.findParts(getDataset(dataset), bbox);
    // Later parts are read ahead with a bounded buffer each; output stays in part order.
    const streams = new Map<number, ReturnType<typeof prefetch<OvertureRow>>>();
    const start = (i: number) => {
      if (i < parts.length && !streams.has(i)) streams.set(i, prefetch(this.read(parts[i]!, bbox), ROW_BUFFER));
    };
    try {
      for (let i = 0; i < PART_CONCURRENCY; i++) start(i);
      for (let i = 0; i < parts.length; i++) {
        for await (const row of streams.get(i)!) yield rowToFeature(row);
        streams.delete(i);
        start(i + PART_CONCURRENCY);
      }
    } finally {
      await Promise.all([...streams.values()].map((s) => s.close()));
    }
  }
}
