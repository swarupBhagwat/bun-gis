import type { Estimate, Flagged, Report } from "bun-gis";

export type { Estimate, Flagged, Report };
export type BBox = [number, number, number, number];

export interface Provider {
  id: string;
  label: string;
  datasets: string[];
}

export interface FormatInfo {
  id: string;
  label: string;
  extension: string;
}

export interface Info {
  version: string;
  providers: Provider[];
  formats: FormatInfo[];
  defaults: { retries: number };
}

export interface SavedFile {
  name: string;
  size: number;
  modified: number;
}

export interface LogLine {
  level: "info" | "warn" | "debug" | "error";
  text: string;
  hint?: string;
}

export interface DownloadOutcome {
  filename: string;
  source: string;
  dataset: string;
  featureCount: number;
  bytes: number;
  elapsedMs: number;
}

export interface ValidationOutcome {
  label: string;
  report: Report;
  failed: boolean;
}

export interface GeoJSONData {
  type: "FeatureCollection";
  features: unknown[];
}
