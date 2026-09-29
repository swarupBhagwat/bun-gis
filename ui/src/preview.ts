import type { PreviewSidecar } from "../server/preview";
import { formatBytes } from "./bbox";
import type { Estimate } from "./types";

// Parsing the file and turning every feature into a Leaflet layer is what makes the map slow, so big files get a sample instead.
export const FULL_PREVIEW_BYTES = 25 * 1024 ** 2;
const LARGE_READ_BYTES = 100 * 1024 ** 2;

/** Only GeoJSON files can be loaded whole into the map, and only GeoJSON files can be validated. */
export const isGeoJSON = (name: string) => name.endsWith(".geojson");

// "all" = the sidecar sample already holds every feature, which is how files in other formats are drawn.
export type PreviewMode = "full" | "all" | "sample" | "blocked";

export function choosePreview(name: string, size: number, sidecar?: PreviewSidecar): PreviewMode {
  if (isGeoJSON(name)) return size <= FULL_PREVIEW_BYTES ? "full" : sidecar ? "sample" : "blocked";
  if (!sidecar) return "blocked";
  return sidecar.count <= sidecar.sample.length ? "all" : "sample";
}

export function describeEstimate(estimate: Estimate): { text: string; large: boolean } {
  if (estimate.parts === 0) return { text: "No Overture data found in this area.", large: false };
  const large = estimate.readBytes > LARGE_READ_BYTES;
  const text =
    `Reads about ${formatBytes(estimate.readBytes)} from Overture (${estimate.parts} file${estimate.parts === 1 ? "" : "s"}), ` +
    `at most ${estimate.maxRows.toLocaleString("en-US")} features.` +
    (large ? " Large: this will take a while and the map will show a sample." : "");
  return { text, large };
}
