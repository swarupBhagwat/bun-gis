import { createSources, createWriters } from "../compose";
import type { SourceFactory } from "../compose";
import { download } from "../core/download";
import { formatOfFile } from "../core/formats";
import { BunGisError } from "../core/errors";
import { createProgress } from "../download/progress";
import { isFailure } from "../validate/check";
import { formatReport } from "../validate/format";
import { checkGeoJSONFile } from "../validate/stream";
import type { CliOptions } from "./args";
import type { Io } from "./io";

// Each command does its own work and reports through Io; main() only parses, dispatches and formats errors.
export async function runValidate(file: string, strict: boolean, io: Io): Promise<number> {
  if (!(await Bun.file(file).exists())) throw new BunGisError(`File not found: ${file}`);
  const format = formatOfFile(file);
  if (format && format !== "geojson") {
    throw new BunGisError(`validate reads GeoJSON files only, not ${format}`, "Download with --format geojson to validate the data.");
  }
  const report = await checkGeoJSONFile(file);
  io.out(formatReport(file, report, strict));
  return isFailure(report, strict) ? 1 : 0;
}

export async function runDownload(
  options: CliOptions,
  io: Io,
  makeSources: SourceFactory = createSources,
): Promise<number> {
  if (options.verbose) io.err(`[verbose] ${JSON.stringify(options)}`);
  await download(
    {
      source: options.provider,
      dataset: options.dataset,
      bbox: options.bbox,
      output: options.output,
      format: options.format,
      overwrite: options.force,
    },
    {
      sources: makeSources({
        release: options.release,
        retries: options.retries,
        warn: options.quiet ? () => {} : io.err,
      }),
      writers: createWriters(),
      progress: createProgress({ quiet: options.quiet, write: io.err }),
    },
  );
  return 0;
}
