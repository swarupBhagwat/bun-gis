import { parseArgs } from "node:util";
import { parseBBox } from "../bbox/bbox";
import type { BBox } from "../bbox/bbox";
import { BunGisError } from "../core/errors";
import { FORMATS, OUTPUT_FORMATS, extensionOf, isOutputFormat } from "../core/formats";
import type { OutputFormat } from "../core/formats";

export interface CliOptions {
  provider: string;
  dataset: string;
  bbox: BBox;
  output: string;
  format: OutputFormat;
  force: boolean;
  quiet: boolean;
  verbose: boolean;
  release?: string;
  retries?: number;
}

export type Parsed =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "validate"; file: string; strict: boolean }
  | { kind: "download"; options: CliOptions };

const USAGE_HINT = "Run `bun-gis --help` for usage.";

export const HELP = `bun-gis — download Overture Maps data as GeoJSON, GeoJSONSeq, GeoParquet or KML

Usage:
  bun-gis overture <dataset> --bbox <minLon,minLat,maxLon,maxLat> [options]
       bun-gis validate <file.geojson> [--strict]

Example:
  bun-gis overture buildings --bbox 11.575,48.137,11.58,48.14 -o munich.geojson
  bun-gis validate munich.geojson

Options:
  --bbox <bbox>       Area to download: minLon,minLat,maxLon,maxLat (required; quote it in PowerShell)
  -o, --output <path> Output file (default: ./<dataset>.<extension of the format>)
  --format <format>   Output format: ${OUTPUT_FORMATS.map((f) => `${f} (${FORMATS[f].extension})`).join(", ")}; default geojson
  -f, --force         Overwrite an existing output file
  --retry <n>         Retries after a failed request (default: 3)
  --release <id>      Overture release, e.g. 2026-09-23.1 (default: latest)
  --strict            validate: treat warnings as failures
  -q, --quiet         No progress output
  --verbose           Print settings and full error details
  -v, --version       Print the version
  -h, --help          Show this help

Datasets: buildings
validate checks syntax, RFC 7946 rules, winding order and self-intersections of any GeoJSON file.
Data from Overture Maps Foundation, which includes © OpenStreetMap contributors (ODbL); attribution is written into the output file.`;

function usageError(message: string): BunGisError {
  return new BunGisError(message, USAGE_HINT);
}

export function parseCli(argv: string[]): Parsed {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        bbox: { type: "string" },
        output: { type: "string", short: "o" },
        format: { type: "string" },
        force: { type: "boolean", short: "f" },
        retry: { type: "string" },
        release: { type: "string" },
        strict: { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        verbose: { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw usageError((error as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.help || (!positionals.length && !values.version)) return { kind: "help" };
  if (values.version) return { kind: "version" };

  if (positionals[0] === "validate") {
    const [, file, ...rest] = positionals;
    if (!file || rest.length) throw usageError("Expected: bun-gis validate <file.geojson> [--strict]");
    return { kind: "validate", file, strict: values.strict ?? false };
  }
  if (values.strict) throw usageError("--strict only applies to validate");

  // `download` is accepted as an optional leading word: the command shape is still undecided.
  const [provider, dataset, ...extra] = positionals[0] === "download" ? positionals.slice(1) : positionals;
  if (!provider || !dataset || extra.length) {
    throw usageError("Expected: bun-gis overture <dataset> --bbox <bbox>");
  }
  if (!values.bbox) throw usageError("Missing --bbox");

  const format = values.format ?? "geojson";
  if (!isOutputFormat(format)) throw usageError(`Unknown --format "${format}". Available: ${OUTPUT_FORMATS.join(", ")}`);

  let retries: number | undefined;
  if (values.retry !== undefined) {
    retries = Number(values.retry);
    if (!Number.isInteger(retries) || retries < 0) throw usageError(`Invalid --retry "${values.retry}"`);
  }

  return {
    kind: "download",
    options: {
      provider,
      dataset,
      bbox: parseBBox(values.bbox),
      output: values.output ?? `./${dataset}${extensionOf(format)}`,
      format,
      force: values.force ?? false,
      quiet: values.quiet ?? false,
      verbose: values.verbose ?? false,
      release: values.release,
      retries,
    },
  };
}
