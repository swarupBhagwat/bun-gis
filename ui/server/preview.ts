import type { BBox, GeoFeature, GeoWriter, Geometry, WriteResult, WriterConfig } from "bun-gis";

export const SAMPLE_SIZE = 2000;
export const GRID_CELLS = 64;

export interface PreviewSidecar {
  count: number;
  bytes: number;
  bbox: BBox;
  sample: GeoFeature[];
  grid: { cols: number; rows: number; counts: number[] };
}

// One vertex stands in for a whole feature: buildings are tiny next to a density cell.
function anchor(geometry: Geometry): number[] | undefined {
  let node: unknown = geometry.coordinates;
  while (Array.isArray(node) && Array.isArray(node[0])) node = node[0];
  return Array.isArray(node) && typeof node[0] === "number" ? (node as number[]) : undefined;
}

// Built while the download streams past, so a huge file never has to be read again to draw a preview.
export class PreviewSummary {
  private count = 0;
  private readonly sample: GeoFeature[] = [];
  private readonly counts = new Array<number>(GRID_CELLS * GRID_CELLS).fill(0);

  constructor(private readonly bbox: BBox, private readonly random: () => number = Math.random) {}

  add(feature: GeoFeature): void {
    this.count++;
    // Reservoir sampling: every feature ends up in the sample with equal probability.
    if (this.sample.length < SAMPLE_SIZE) this.sample.push(feature);
    else {
      const slot = Math.floor(this.random() * this.count);
      if (slot < SAMPLE_SIZE) this.sample[slot] = feature;
    }
    const position = anchor(feature.geometry);
    if (!position) return;
    const [w, s, e, n] = this.bbox;
    const cell = (value: number, min: number, max: number) =>
      Math.min(GRID_CELLS - 1, Math.max(0, Math.floor(((value - min) / (max - min)) * GRID_CELLS)));
    this.counts[cell(position[1]!, s, n) * GRID_CELLS + cell(position[0]!, w, e)]!++;
  }

  result(bytes: number): PreviewSidecar {
    return {
      count: this.count,
      bytes,
      bbox: this.bbox,
      sample: this.sample,
      grid: { cols: GRID_CELLS, rows: GRID_CELLS, counts: this.counts },
    };
  }
}

export const sidecarPath = (geojsonPath: string) => `${geojsonPath}.preview.json`;

// Decorates a writer: same output file, plus a small preview sidecar written only after the file is safely in place.
export class PreviewWriter implements GeoWriter {
  constructor(private readonly inner: GeoWriter, private readonly bbox: BBox) {}

  async write(features: AsyncIterable<GeoFeature>, config: WriterConfig): Promise<WriteResult> {
    const summary = new PreviewSummary(this.bbox);
    const tapped = (async function* () {
      for await (const feature of features) {
        summary.add(feature);
        yield feature;
      }
    })();
    const result = await this.inner.write(tapped, config);
    await Bun.write(sidecarPath(config.path), JSON.stringify(summary.result(result.bytes)));
    return result;
  }
}
