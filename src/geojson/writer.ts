import type { GeoWriter, WriterConfig } from "../core/ports";
import { textOutput, writeAtomically } from "../core/output-file";
import type { GeoFeature, WriteResult } from "../core/types";

export class GeoJSONWriter implements GeoWriter {
  async write(
    features: AsyncIterable<GeoFeature>,
    { path, overwrite, metadata }: WriterConfig,
  ): Promise<WriteResult> {
    let bytes = 0;
    let featureCount = 0;
    await writeAtomically(path, overwrite, async (sink) => {
      const out = textOutput(sink);
      const root = { type: "FeatureCollection", ...metadata };
      out.put(`${JSON.stringify(root).slice(0, -1)},"features":[`);
      for await (const feature of features) {
        out.put((featureCount++ ? "," : "") + JSON.stringify(feature));
      }
      out.put("]}");
      bytes = out.bytes;
    });
    return { featureCount, bytes };
  }
}
