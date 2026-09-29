import type { GeoWriter, WriterConfig } from "../core/ports";
import { textOutput, writeAtomically } from "../core/output-file";
import type { GeoFeature, SourceMetadata, WriteResult } from "../core/types";

export const attributionPath = (path: string) => `${path}.attribution.txt`;

// Newline-delimited files have no root object to hold the collection-level attribution, so it goes in a text file beside them.
function attributionText({ source, license, release, attribution }: SourceMetadata): string {
  const lines = [
    `Source: ${source}`,
    license && `License: ${license}`,
    release && `Release: ${release}`,
    `Attribution: ${attribution}`,
  ];
  return `${lines.filter(Boolean).join("\n")}\n`;
}

// One feature per line (RFC 8142 without record separators, as GDAL and tippecanoe read it).
export class GeoJSONSeqWriter implements GeoWriter {
  async write(
    features: AsyncIterable<GeoFeature>,
    { path, overwrite, metadata }: WriterConfig,
  ): Promise<WriteResult> {
    let bytes = 0;
    let featureCount = 0;
    await writeAtomically(path, overwrite, async (sink) => {
      const out = textOutput(sink);
      for await (const feature of features) {
        out.put(`${JSON.stringify(feature)}\n`);
        featureCount++;
      }
      bytes = out.bytes;
    });
    await Bun.write(attributionPath(path), attributionText(metadata));
    return { featureCount, bytes };
  }
}
