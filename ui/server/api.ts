import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  BunGisError,
  checkGeoJSON,
  checkGeoJSONFile,
  checkGeoJSONStream,
  createEstimate,
  createSources,
  FORMATS,
  OUTPUT_FORMATS,
  attributionPath,
  createWriters,
  download,
  extensionOf,
  formatOfFile,
  isFailure,
  isOutputFormat,
  validateBBox,
} from "bun-gis";
import type { OutputFormat } from "bun-gis";
import pkg from "../../package.json";
import { PreviewWriter, sidecarPath } from "./preview";
import type { PreviewSidecar } from "./preview";
import { eventStream } from "./sse";

export interface DownloadBody {
  provider: string;
  dataset: string;
  bbox: [number, number, number, number];
  filename: string;
  format?: OutputFormat;
  overwrite?: boolean;
  retries?: number;
  release?: string;
  verbose?: boolean;
}

export interface EstimateBody {
  provider: string;
  dataset: string;
  bbox: [number, number, number, number];
  release?: string;
}

export interface ApiOptions {
  outputDir: string;
  makeSources?: typeof createSources;
  makeEstimate?: typeof createEstimate;
  heartbeatMs?: number;
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (error: unknown, status = 400) =>
  json(
    {
      error: {
        message: error instanceof Error ? error.message : String(error),
        hint: error instanceof BunGisError ? error.hint : undefined,
      },
    },
    status,
  );

const CONTENT_TYPES: Record<OutputFormat, string> = {
  geojson: "application/geo+json",
  geojsonseq: "application/x-ndjson",
  geoparquet: "application/vnd.apache.parquet",
  kml: "application/vnd.google-earth.kml+xml",
};

// Only plain file names inside the output directory are ever accepted. With a `format` the name gets that format's
// extension; without one (looking a saved file up) any known extension is kept and a bare name means GeoJSON.
export function safeName(name: unknown, format?: OutputFormat): string {
  const value = typeof name === "string" ? name.trim() : "";
  const extension = extensionOf(format ?? formatOfFile(value) ?? "geojson");
  const withExtension = value.endsWith(extension) ? value : `${value}${extension}`;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(withExtension) || basename(withExtension) !== withExtension) {
    throw new BunGisError(
      `Invalid file name "${value}"`,
      `Use letters, digits, dot, dash and underscore only, e.g. munich-buildings${extension}.`,
    );
  }
  return withExtension;
}

export function createApi({ outputDir, makeSources = createSources, makeEstimate = createEstimate, heartbeatMs = 10_000 }: ApiOptions) {
  let busy = false;

  const info = () =>
    json({
      version: pkg.version,
      providers: [
        { id: "overture", label: "Overture Maps", datasets: ["buildings"] },
      ],
      formats: OUTPUT_FORMATS.map((id) => ({ id, label: FORMATS[id].label, extension: FORMATS[id].extension })),
      defaults: { retries: 3 },
    });

  async function files() {
    await mkdir(outputDir, { recursive: true });
    const entries = await Promise.all(
      (await readdir(outputDir))
        .filter((name) => formatOfFile(name))
        .map(async (name) => {
          const { size, mtimeMs } = await stat(join(outputDir, name));
          return { name, size, modified: mtimeMs };
        }),
    );
    return json(entries.sort((a, b) => b.modified - a.modified));
  }

  async function file(name: string, asDownload: boolean) {
    const path = join(outputDir, safeName(decodeURIComponent(name)));
    const source = Bun.file(path);
    if (!(await source.exists())) return fail(new BunGisError(`No saved file named "${name}"`), 404);
    return new Response(source, {
      headers: {
        "Content-Type": CONTENT_TYPES[formatOfFile(basename(path))!],
        ...(asDownload ? { "Content-Disposition": `attachment; filename="${basename(path)}"` } : {}),
      },
    });
  }

  // Only a finished, plainly named file in the output folder can be removed; its preview sidecar goes with it.
  async function remove(name: string) {
    const path = join(outputDir, safeName(decodeURIComponent(name)));
    if (!(await Bun.file(path).exists())) return fail(new BunGisError(`No saved file named "${name}"`), 404);
    await rm(path);
    await rm(sidecarPath(path), { force: true });
    await rm(attributionPath(path), { force: true });
    return json({ deleted: basename(path) });
  }

  // Size plus the sidecar written at download time; a sidecar whose byte count no longer matches the file is stale and ignored.
  async function preview(name: string) {
    const path = join(outputDir, safeName(decodeURIComponent(name)));
    const source = Bun.file(path);
    if (!(await source.exists())) return fail(new BunGisError(`No saved file named "${name}"`), 404);
    const side = Bun.file(sidecarPath(path));
    const sidecar = (await side.exists()) ? ((await side.json().catch(() => undefined)) as PreviewSidecar | undefined) : undefined;
    return json({ size: source.size, sidecar: sidecar?.bytes === source.size ? sidecar : undefined });
  }

  async function estimate(request: Request) {
    const body = (await request.json()) as EstimateBody;
    if (body.provider !== "overture") throw new BunGisError(`Unknown source "${body.provider}"`);
    validateBBox(body.bbox);
    return json(await makeEstimate({ release: body.release || undefined, warn: () => {} })({ dataset: body.dataset, bbox: body.bbox }));
  }

  async function validate(request: Request) {
    const body = (await request.json()) as { text?: string; file?: string; strict?: boolean };
    let report;
    if (body.text !== undefined) {
      report = checkGeoJSON(body.text);
    } else if (body.file) {
      const path = join(outputDir, safeName(body.file));
      if (formatOfFile(path) !== "geojson") {
        throw new BunGisError("Only GeoJSON files can be validated", "Validation reads .geojson files; use Preview for the other formats.");
      }
      if (!(await Bun.file(path).exists())) throw new BunGisError(`No saved file named "${body.file}"`);
      report = await checkGeoJSONFile(path); // streamed: memory does not grow with the file size
    } else {
      throw new BunGisError("Nothing to validate", "Send `text` or the name of a saved `file`.");
    }
    return json({ report, failed: isFailure(report, body.strict ?? false) });
  }

  // The file itself is the request body, so the browser never has to read it into memory and neither does the server.
  async function validateUpload(request: Request) {
    if (!request.body) throw new BunGisError("Nothing to validate", "Send the GeoJSON file as the request body.");
    const report = await checkGeoJSONStream(request.body);
    return json({ report, failed: isFailure(report, new URL(request.url).searchParams.has("strict")) });
  }

  async function startDownload(request: Request) {
    const body = (await request.json()) as DownloadBody;
    const format = body.format ?? "geojson";
    if (!isOutputFormat(format)) throw new BunGisError(`Unknown format "${format}"`, `Available: ${OUTPUT_FORMATS.join(", ")}`);
    const filename = safeName(body.filename, format);
    if (busy) return fail(new BunGisError("Another download is still running", "Wait for it to finish."), 409);
    busy = true;

    return eventStream(async (send) => {
      const log = (level: "info" | "warn" | "debug", text: string) => send("log", { level, text });
      try {
        await mkdir(outputDir, { recursive: true });
        if (body.verbose) log("debug", JSON.stringify({ ...body, output: join(outputDir, filename) }));
        const result = await download(
          {
            source: body.provider,
            dataset: body.dataset,
            bbox: body.bbox,
            output: join(outputDir, filename),
            format,
            overwrite: body.overwrite ?? false,
          },
          {
            sources: makeSources({
              release: body.release || undefined,
              retries: body.retries,
              warn: (text) => log("warn", text),
            }),
            writers: new Map([...createWriters()].map(([id, writer]) => [id, new PreviewWriter(writer, body.bbox)])),
            progress: { phase: (label) => log("info", `Downloading ${label}...`), done() {} },
          },
        );
        send("result", { ...result, filename });
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : String(error),
          hint: error instanceof BunGisError ? error.hint : undefined,
          stack: body.verbose && error instanceof Error && !(error instanceof BunGisError) ? error.stack : undefined,
        });
      } finally {
        busy = false;
      }
    }, heartbeatMs);
  }

  return {
    info,
    files,
    file: (name: string, asDownload: boolean) => file(name, asDownload).catch(fail),
    remove: (name: string) => remove(name).catch(fail),
    preview: (name: string) => preview(name).catch(fail),
    estimate: (request: Request) => estimate(request).catch(fail),
    validate: (request: Request) => validate(request).catch(fail),
    validateUpload: (request: Request) => validateUpload(request).catch(fail),
    download: (request: Request) => startDownload(request).catch(fail),
    fail,
  };
}
