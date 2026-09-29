import { BunGisError } from "../core/errors";

export type BBox = [
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number,
];

const EXPECTED = "minLon,minLat,maxLon,maxLat (e.g. 72.80,18.90,72.95,19.20)";

function invalid(reason: string, received: string): BunGisError {
  return new BunGisError(
    `Invalid bbox: ${reason}`,
    `Expected: ${EXPECTED}\nReceived: ${received}`,
  );
}

export function validateBBox(
  bbox: readonly number[],
  received = bbox.join(","),
): BBox {
  if (bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    throw invalid("need four finite numbers", received);
  }
  const [minLon, minLat, maxLon, maxLat] = bbox as unknown as BBox;
  if (Math.abs(minLon) > 180 || Math.abs(maxLon) > 180) {
    throw invalid("longitude must be within -180..180", received);
  }
  if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) {
    throw invalid("latitude must be within -90..90", received);
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    throw invalid("min must be smaller than max", received);
  }
  return [minLon, minLat, maxLon, maxLat];
}

export const intersects = (a: readonly number[], b: readonly number[]): boolean =>
  a[0]! <= b[2]! && a[2]! >= b[0]! && a[1]! <= b[3]! && a[3]! >= b[1]!;

export function parseBBox(input: string): BBox {
  // Spaces are accepted too: PowerShell turns an unquoted `a,b,c,d` into separate words.
  const parts = input.trim().split(/\s*,\s*|\s+/);
  if (parts.some((p) => p === "")) {
    throw invalid("empty value", input);
  }
  return validateBBox(parts.map(Number), input);
}
