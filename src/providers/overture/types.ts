import type { BBox } from "../../bbox/bbox";
import type { Geometry } from "../../core/types";
import type { OvertureDataset } from "./datasets";

export interface PartFile {
  url: string;
  bbox: BBox;
}

export interface OvertureCatalog {
  release(): Promise<string>;
  findParts(dataset: OvertureDataset, bbox: BBox): Promise<PartFile[]>;
}

export type OvertureRow = Record<string, unknown> & { id: string; geometry: Geometry };

export type ReadRows = (part: PartFile, bbox: BBox) => AsyncIterable<OvertureRow>;

/** What a download would read, from Parquet footers alone. `maxRows` is an upper bound: whole row groups are counted. */
export interface Estimate {
  parts: number;
  rowGroups: number;
  maxRows: number;
  readBytes: number;
}

export type EstimatePart = (part: PartFile, bbox: BBox) => Promise<Omit<Estimate, "parts">>;
