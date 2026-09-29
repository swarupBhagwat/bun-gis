import { validateBBox } from "../bbox/bbox";
import { BunGisError } from "./errors";
import type { FeatureSource, GeoWriter, Progress } from "./ports";
import type { DownloadRequest, DownloadResult, OutputFormat } from "./types";

export interface DownloadDeps {
  sources: ReadonlyMap<string, FeatureSource>;
  writers: ReadonlyMap<OutputFormat, GeoWriter>;
  progress?: Progress;
}

function lookup<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const found = map.get(key);
  if (!found) {
    throw new BunGisError(
      `Unknown ${what} "${String(key)}"`,
      `Available: ${[...map.keys()].join(", ")}`,
    );
  }
  return found;
}

export async function download(
  request: DownloadRequest,
  { sources, writers, progress = { phase() {}, done() {} } }: DownloadDeps,
): Promise<DownloadResult> {
  const started = performance.now();
  validateBBox(request.bbox);
  const source = lookup(sources, request.source, "source");
  const writer = lookup(writers, request.format ?? "geojson", "format");
  source.validateRequest(request);

  progress.phase(`${request.source} ${request.dataset}`);
  const { featureCount, bytes } = await writer.write(source.download(request), {
    path: request.output,
    overwrite: request.overwrite ?? false,
    metadata: await source.metadata(request),
  });

  const result: DownloadResult = {
    source: request.source,
    dataset: request.dataset,
    output: request.output,
    featureCount,
    bytes,
    elapsedMs: performance.now() - started,
  };
  progress.done(result);
  return result;
}
