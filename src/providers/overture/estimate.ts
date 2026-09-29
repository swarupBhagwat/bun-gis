import type { BBox } from "../../bbox/bbox";
import { getDataset } from "./datasets";
import type { Estimate, EstimatePart, OvertureCatalog } from "./types";

export type EstimateDownload = (request: { dataset: string; bbox: BBox }) => Promise<Estimate>;

export function createEstimator(catalog: OvertureCatalog, estimatePart: EstimatePart): EstimateDownload {
  return async ({ dataset, bbox }) => {
    const parts = await catalog.findParts(getDataset(dataset), bbox);
    const each = await Promise.all(parts.map((part) => estimatePart(part, bbox)));
    return {
      parts: parts.length,
      rowGroups: each.reduce((sum, e) => sum + e.rowGroups, 0),
      maxRows: each.reduce((sum, e) => sum + e.maxRows, 0),
      readBytes: each.reduce((sum, e) => sum + e.readBytes, 0),
    };
  };
}
