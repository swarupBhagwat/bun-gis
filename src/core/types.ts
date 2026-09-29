import type { BBox } from "../bbox/bbox";

export type Position = number[];

export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export interface GeoFeature {
  type: "Feature";
  id?: string | number;
  geometry: Geometry;
  properties: Record<string, unknown>;
}

export type { OutputFormat } from "./formats";
import type { OutputFormat } from "./formats";

export interface DownloadRequest {
  source: string;
  dataset: string;
  bbox: BBox;
  output: string;
  format?: OutputFormat;
  overwrite?: boolean;
}

export interface SourceMetadata {
  source: string;
  attribution: string;
  license?: string;
  release?: string;
}

export interface WriteResult {
  featureCount: number;
  bytes: number;
}

export interface DownloadResult extends WriteResult {
  source: string;
  dataset: string;
  output: string;
  elapsedMs: number;
}
