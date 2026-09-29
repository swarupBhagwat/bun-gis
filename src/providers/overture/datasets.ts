import { BunGisError } from "../../core/errors";

export interface OvertureDataset {
  theme: string;
  type: string;
  license: string;
}

const DATASETS = new Map<string, OvertureDataset>([
  ["buildings", { theme: "buildings", type: "building", license: "ODbL-1.0" }],
]);

export function getDataset(name: string): OvertureDataset {
  const dataset = DATASETS.get(name);
  if (!dataset) {
    throw new BunGisError(
      `Unknown Overture dataset "${name}"`,
      `Available: ${[...DATASETS.keys()].join(", ")}`,
    );
  }
  return dataset;
}
