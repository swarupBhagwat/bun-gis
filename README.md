# bun-gis

Download [Overture Maps](https://overturemaps.org) data for a bounding box straight to a local file: GeoJSON, GeoJSONSeq, GeoParquet or KML. Built for [Bun](https://bun.sh); needs Bun ≥ 1.4.

```bash
bunx github:swarupBhagwat/bun-gis overture buildings --bbox 11.575,48.137,11.58,48.14
```

```text
Downloading overture buildings...
✓ Download complete
✓ Features: 158
✓ Size: 114.2 KB
✓ Time: 8.61s
✓ Saved: ./buildings.geojson
```

Only the requested area is fetched. Overture data is read from cloud GeoParquet with HTTP range requests (a ~500 m box downloads ~6.5 MB out of a ~600 MB file), and output is streamed to disk.

## Install

bun-gis is not on npm yet, so install it from GitHub (Bun ≥ 1.4 is the only requirement):

```bash
# One-off run, nothing to install (the command above)
bunx github:swarupBhagwat/bun-gis overture buildings --bbox 11.575,48.137,11.58,48.14

# In a project: adds the CLI (`bunx bun-gis …`) and the library (`import … from "bun-gis"`)
bun add github:swarupBhagwat/bun-gis

# From source (also needed for the local UI)
git clone https://github.com/swarupBhagwat/bun-gis && cd bun-gis
bun install
bun src/cli/index.ts overture buildings --bbox 11.575,48.137,11.58,48.14
```

The other examples below write `bunx bun-gis …`, which works after `bun add`; for a one-off run use `bunx github:swarupBhagwat/bun-gis …` instead.

## CLI

```text
bun-gis overture <dataset> --bbox <minLon,minLat,maxLon,maxLat> [options]
```

| Option | |
|---|---|
| `--bbox <bbox>` | Area to download, `minLon,minLat,maxLon,maxLat` (required). Quote it in PowerShell. |
| `-o, --output <path>` | Output file. Default `./<dataset>` plus the format's extension. |
| `-f, --force` | Overwrite an existing output file (refused by default). |
| `--format <format>` | `geojson` (default, `.geojson`), `geojsonseq` (`.geojsonl`), `geoparquet` (`.parquet`) or `kml` (`.kml`). See [Output formats](#output-formats). |
| `--retry <n>` | Retries after a failed request. Default 3. |
| `--release <id>` | Overture release, e.g. `2026-09-23.1`. Default: latest. |
| `-q, --quiet` | No progress output. |
| `--verbose` | Print settings and full error details. |

Datasets: `buildings`. Exit code is `0` on success and `1` on any error, with a message and a hint on stderr:

```text
✗ Invalid bbox: min must be smaller than max

Expected: minLon,minLat,maxLon,maxLat (e.g. 72.80,18.90,72.95,19.20)
Received: 72.80,19.20,18.90,72.95
```

## Validate a GeoJSON file

```bash
bunx bun-gis validate buildings.geojson          # add --strict to fail on warnings
```

Works on any GeoJSON file, not only bun-gis output. It checks:

| Check | Problem is a |
|---|---|
| Structure: valid JSON, feature and geometry shapes, coordinate nesting, numeric positions | failure |
| RFC 7946 rules: closed rings, ≥4 positions, non-zero ring area, lon −180..180, lat −90..90 | failure |
| Winding order: exterior counterclockwise, holes clockwise | warning (RFC 7946 says SHOULD) |
| Self-intersections (`@turf/kinks`) | warning |
| Duplicate feature ids, missing root `attribution` | warning |

Exit code `0` = valid (possibly with warnings), `1` = failures, or warnings under `--strict`. Warnings are not failures because source data can contain such geometry and `bun-gis` never rewrites geometry silently. Files are validated as a stream, one feature at a time, so memory does not grow with the file: a 289 MB file with 482,000 features takes about 4 s and under 100 MB, and multi-gigabyte files work. Memory grows only by a few tens of bytes per feature, for duplicate-id detection, which compares 53-bit hashes (a false "duplicate id" is theoretically possible, about 3 in 10,000 for 2.4 million ids).

## Library

```ts
import { download } from "bun-gis";

const result = await download({
  source: "overture",
  dataset: "buildings",
  bbox: [11.575, 48.137, 11.58, 48.14],
  output: "./buildings.geojson",
});
// { source, dataset, output, featureCount, bytes, elapsedMs }
```

`checkGeoJSON(text)` returns the same validation as a report object; `checkGeoJSONFile(path)` and `checkGeoJSONStream(chunks)` do it for big inputs without loading them. Options (second argument to `download`): `release`, `retries`, `warn`, `progress`, and `sources` / `writers` to plug in your own `FeatureSource` or `GeoWriter`.

## Local web UI (repository only)

A small React app for the same features: draw the area on a map, download, preview the result, and validate saved or uploaded files. It lives in the repository only, so clone it first (see [Install](#install)).

```bash
cd ui && bun install && cd ..
bun run ui             # http://127.0.0.1:3000  (PORT=… to change)
```

Downloads are saved in `ui/output/`; set `BUNGIS_UI_OUTPUT` to use another folder (automated tests should). The default file name includes the area, e.g. `overture-buildings-11.575_48.137_11.58_48.14.geojson`, so a new area never lands on an earlier download. The form shows when a name already exists, and an existing file is replaced only if "Overwrite" is ticked; that cannot be undone. The server listens on `127.0.0.1` only and runs one download at a time.

## Output formats

| Format | Extension | Notes |
|---|---|---|
| `geojson` | `.geojson` | One `FeatureCollection`. The only format `bun-gis validate` and the UI's Validate button read. |
| `geojsonseq` | `.geojsonl` | One feature per line (newline-delimited GeoJSON). No root object, so the attribution is written to `<file>.attribution.txt` beside it; keep both files together. |
| `geoparquet` | `.parquet` | GeoParquet 1.1 metadata, geometry as WKB, ZSTD-compressed, about 5x smaller than GeoJSON. Columns: `id`, `geometry` and `properties` (all remaining properties as one JSON column, because a streamed file's columns are fixed before the data is seen). Attribution is in the file's key-value metadata (`bun-gis:*`). |
| `kml` | `.kml` | One `Placemark` per feature with `ExtendedData`; nested values are JSON text. The attribution is in the document's `description`. |

## Output and attribution

For GeoJSON, a `FeatureCollection` whose root carries the source, attribution, license and the Overture `release`:

```json
{ "type": "FeatureCollection", "source": "Overture Maps Foundation", "attribution": "Overture Maps Foundation (https://overturemaps.org). Includes data © OpenStreetMap contributors (ODbL) and other sources; …", "license": "ODbL-1.0", "release": "2026-09-23.1", "features": [] }
```

Overture buildings include OpenStreetMap data (ODbL) and other sources. Each feature keeps its own `sources` property; keep it when redistributing. See <https://docs.overturemaps.org/attribution/>. You are responsible for complying with these licenses when you use or share the data.

## Behaviour worth knowing

- Every network request has a 60 s timeout. A request that times out or fails with a 5xx/429 is retried with backoff, and each wait is reported on stderr (silenced by `--quiet`).
- Overture is read one row group at a time; memory grows with the area (about 340 MB peak for a ~25 km² box of buildings).
- Output is written to `<path>.part` and renamed on success, so a failed run never leaves a truncated file.
- Not yet: more datasets, filters, caching, tiling of huge areas, place names, more formats (CSV, Shapefile, GeoPackage), flattened GeoParquet property columns.

## Development

```bash
bun install
bun test              # unit tests, no network
LIVE=1 bun test       # also reads real Overture data for a tiny bbox
bun run typecheck
```

## Support

bun-gis is free and MIT licensed. If it saved you time, you can support its maintenance at [buymeacoffee.com/swarupbhags](https://buymeacoffee.com/swarupbhags).

MIT licensed.
