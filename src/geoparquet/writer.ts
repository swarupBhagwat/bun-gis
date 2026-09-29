import { ByteWriter, ParquetWriter, schemaFromColumnData } from "hyparquet-writer";
import type { ColumnSource } from "hyparquet-writer";
import type { GeoWriter, WriterConfig } from "../core/ports";
import { writeAtomically } from "../core/output-file";
import type { GeoFeature, WriteResult } from "../core/types";

const ROW_GROUP = 10_000;

// GeoParquet 1.x: WKB geometry plus a `geo` metadata entry. An empty geometry_types list means "not declared".
const GEO = JSON.stringify({
  version: "1.1.0",
  primary_column: "geometry",
  columns: { geometry: { encoding: "WKB", geometry_types: [] } },
});

const compressors = { ZSTD: (input: Uint8Array) => Bun.zstdCompressSync(input) };

function columns(rows: GeoFeature[]): ColumnSource[] {
  return [
    { name: "id", type: "STRING", data: rows.map((f) => (f.id === undefined ? null : String(f.id))) },
    { name: "geometry", type: "GEOMETRY", data: rows.map((f) => f.geometry) },
    // Kept whole as JSON: features of one file do not share a property set, and a streamed file's schema is fixed up front.
    { name: "properties", type: "JSON", data: rows.map((f) => f.properties) },
  ];
}

export class GeoParquetWriter implements GeoWriter {
  async write(
    features: AsyncIterable<GeoFeature>,
    { path, overwrite, metadata }: WriterConfig,
  ): Promise<WriteResult> {
    let bytes = 0;
    let featureCount = 0;
    await writeAtomically(path, overwrite, async (sink) => {
      // The parquet writer builds bytes in memory; after every row group they are handed to the file and dropped.
      const buffer = new ByteWriter();
      const drain = () => {
        sink.write(buffer.getBytes().slice());
        buffer.index = 0;
      };
      const writer = new ParquetWriter({
        writer: Object.assign(buffer, { flush: drain }),
        schema: schemaFromColumnData({ columnData: columns([]) }),
        codec: "ZSTD",
        compressors,
        kvMetadata: [
          { key: "geo", value: GEO },
          ...Object.entries(metadata).map(([key, value]) => ({ key: `bun-gis:${key}`, value })),
        ],
      });

      let pending: GeoFeature[] = [];
      const flush = async () => {
        if (pending.length) await writer.write({ columnData: columns(pending), rowGroupSize: ROW_GROUP });
        pending = [];
      };
      for await (const feature of features) {
        pending.push(feature);
        featureCount++;
        if (pending.length >= ROW_GROUP) await flush();
      }
      await flush();
      await writer.finish();
      drain();
      bytes = buffer.offset;
    });
    return { featureCount, bytes };
  }
}
