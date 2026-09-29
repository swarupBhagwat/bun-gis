export const FORMATS = {
  geojson: { label: "GeoJSON", extension: ".geojson" },
  geojsonseq: { label: "GeoJSONSeq (one feature per line)", extension: ".geojsonl" },
  geoparquet: { label: "GeoParquet", extension: ".parquet" },
  kml: { label: "KML", extension: ".kml" },
} as const;

export type OutputFormat = keyof typeof FORMATS;

export const OUTPUT_FORMATS = Object.keys(FORMATS) as OutputFormat[];

export const isOutputFormat = (value: string): value is OutputFormat => Object.hasOwn(FORMATS, value);

export const extensionOf = (format: OutputFormat): string => FORMATS[format].extension;

/** The format a file name belongs to, judged by its extension. */
export const formatOfFile = (name: string): OutputFormat | undefined =>
  OUTPUT_FORMATS.find((format) => name.endsWith(FORMATS[format].extension));
