import type { BBox } from "./types";

// Marienplatz, Munich: small enough to download in seconds, so "Download" works out of the box.
export const DEFAULT_BBOX: BBox = [11.575, 48.137, 11.58, 48.14];

export const formatCoord = (value: number) => String(Number(value.toFixed(5)));

// Mirrors the server-side rules (which are authoritative); this only gives instant feedback while typing.
export function readBBox(fields: string[]): { bbox?: BBox; error?: string } {
  const values = fields.map((field) => (field.trim() === "" ? NaN : Number(field)));
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) return { error: "Enter four numbers" };
  const [minLon, minLat, maxLon, maxLat] = values as BBox;
  if (Math.abs(minLon) > 180 || Math.abs(maxLon) > 180) return { error: "Longitude must be between -180 and 180" };
  if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) return { error: "Latitude must be between -90 and 90" };
  if (minLon >= maxLon || minLat >= maxLat) return { error: "West/South must be smaller than East/North" };
  return { bbox: [minLon, minLat, maxLon, maxLat] };
}

export function areaKm2([minLon, minLat, maxLon, maxLat]: BBox): number {
  const km = 111.32;
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  return (maxLat - minLat) * km * (maxLon - minLon) * km * Math.cos(midLat);
}

// Measured on Munich buildings: ~25 km² of Overture = 342 MB peak memory.
const LARGE_AREA_KM2 = 25;

export function sizeWarning(bbox: BBox): string | undefined {
  const area = areaKm2(bbox);
  if (area <= LARGE_AREA_KM2) return undefined;
  return `${Math.round(area)} km² is large: Overture is read a row group at a time, so memory grows (about 340 MB at 25 km²).`;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
