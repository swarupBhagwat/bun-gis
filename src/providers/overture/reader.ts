import { parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import type { RowGroup } from "hyparquet";
import { intersects } from "../../bbox/bbox";
import type { BBox } from "../../bbox/bbox";
import type { Get } from "./http";
import { rangeFile } from "./range-file";
import type { EstimatePart, OvertureRow, ReadRows } from "./types";

const compressors = { ZSTD: (input: Uint8Array) => Bun.zstdDecompressSync(input) };

function stat(group: RowGroup, column: string, which: "min_value" | "max_value"): number | undefined {
  const chunk = group.columns.find((c) => c.meta_data?.path_in_schema.join(".") === column);
  const value = chunk?.meta_data?.statistics?.[which];
  return value === undefined || value === null ? undefined : Number(value);
}

// Row groups are spatially clustered, so their bbox column statistics rule most of them out.
// Missing statistics keep the group: pruning must never drop data.
export function groupIntersects(group: RowGroup, bbox: BBox): boolean {
  const min = (column: string) => stat(group, column, "min_value");
  const max = (column: string) => stat(group, column, "max_value");
  const box = [min("bbox.xmin"), min("bbox.ymin"), max("bbox.xmax"), max("bbox.ymax")];
  return box.some((v) => v === undefined) || intersects(box as number[], bbox);
}

export function groupReadBytes(group: RowGroup): number {
  return group.columns.reduce((sum, c) => sum + Number(c.meta_data?.total_compressed_size ?? 0), 0);
}

export function rowIntersects(row: OvertureRow, bbox: BBox): boolean {
  const b = row.bbox as { xmin: number; ymin: number; xmax: number; ymax: number } | undefined;
  return !b || intersects([b.xmin, b.ymin, b.xmax, b.ymax], bbox);
}

export function createParquetReader(get: Get): ReadRows {
  return async function* (part, bbox) {
    const file = await rangeFile(part.url, get);
    const metadata = await parquetMetadataAsync(file);
    let rowStart = 0;
    for (const group of metadata.row_groups) {
      const rowEnd = rowStart + Number(group.num_rows);
      const start = rowStart;
      rowStart = rowEnd;
      if (!groupIntersects(group, bbox)) continue;
      const rows = await parquetReadObjects({ file, metadata, compressors, rowStart: start, rowEnd });
      for (const row of rows as OvertureRow[]) {
        if (rowIntersects(row, bbox)) yield row;
      }
    }
  };
}

// Footer only: no row data is fetched, so this takes a few seconds even for a huge area.
export function createParquetEstimator(get: Get): EstimatePart {
  return async (part, bbox) => {
    const { row_groups } = await parquetMetadataAsync(await rangeFile(part.url, get));
    const hit = row_groups.filter((group) => groupIntersects(group, bbox));
    return {
      rowGroups: hit.length,
      maxRows: hit.reduce((sum, g) => sum + Number(g.num_rows), 0),
      readBytes: hit.reduce((sum, g) => sum + groupReadBytes(g), 0),
    };
  };
}
