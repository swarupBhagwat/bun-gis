import type { FeatureSource, GeoWriter } from "./core/ports";
import type { OutputFormat } from "./core/types";
import { defaultRetryPolicy } from "./download/retry";
import { GeoJSONWriter } from "./geojson/writer";
import { GeoJSONSeqWriter } from "./geojsonseq/writer";
import { GeoParquetWriter } from "./geoparquet/writer";
import { KMLWriter } from "./kml/writer";
import { createGet } from "./providers/overture/http";
import { createEstimator } from "./providers/overture/estimate";
import type { EstimateDownload } from "./providers/overture/estimate";
import { createParquetEstimator, createParquetReader } from "./providers/overture/reader";
import { OvertureSource } from "./providers/overture/source";
import { StacCatalog } from "./providers/overture/stac";

export interface SourceSettings {
  release?: string;
  retries?: number;
  warn: (message: string) => void;
}

export type SourceFactory = (settings: SourceSettings) => Map<string, FeatureSource>;

export const createEstimate = ({ release, retries, warn }: SourceSettings): EstimateDownload => {
  const retry = { ...defaultRetryPolicy, retries: retries ?? defaultRetryPolicy.retries };
  const get = createGet({ retry, notify: warn });
  return createEstimator(new StacCatalog({ release, get }), createParquetEstimator(get));
};

export const createSources: SourceFactory = ({ release, retries, warn }) => {
  const retry = { ...defaultRetryPolicy, retries: retries ?? defaultRetryPolicy.retries };
  const get = createGet({ retry, notify: warn });
  return new Map<string, FeatureSource>([
    ["overture", new OvertureSource(new StacCatalog({ release, get }), createParquetReader(get))],
  ]);
};

export const createWriters = (): Map<OutputFormat, GeoWriter> =>
  new Map<OutputFormat, GeoWriter>([
    ["geojson", new GeoJSONWriter()],
    ["geojsonseq", new GeoJSONSeqWriter()],
    ["geoparquet", new GeoParquetWriter()],
    ["kml", new KMLWriter()],
  ]);
