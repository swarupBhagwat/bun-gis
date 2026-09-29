import { BunGisError } from "../../core/errors";
import type { GeoFeature } from "../../core/types";
import type { OvertureRow } from "./types";

const NOT_PROPERTIES = new Set(["id", "geometry", "bbox"]);

// parquet decoding yields BigInt and Date values that JSON.stringify cannot serialize.
function plain(value: unknown): unknown {
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

export function rowToFeature(row: OvertureRow): GeoFeature {
  if (typeof row.geometry?.type !== "string") {
    throw new BunGisError(`Overture feature ${row.id} has no decoded geometry`);
  }
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!NOT_PROPERTIES.has(key) && value != null) properties[key] = plain(value);
  }
  return { type: "Feature", id: row.id, geometry: row.geometry, properties };
}
