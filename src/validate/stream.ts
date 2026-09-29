import { Checker, checkGeoJSON } from "./check";
import type { Report } from "./check";
import { FeatureSplitter, ScanError } from "./splitter";
import { rootTypeProblem } from "./structure";

type Source = AsyncIterable<Uint8Array | string>;

// Validates a FeatureCollection while it is being read: each feature is cut out, checked and dropped, so memory is
// proportional to the largest feature rather than to the file. Anything that is not a FeatureCollection with a
// "features" array (a single Feature, a bare geometry, broken JSON) is small by nature and is checked as a whole.
export async function checkGeoJSONStream(source: Source): Promise<Report> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const checker = new Checker();
  const members: Record<string, unknown> = {};
  let elements = 0;
  let bytes = 0;
  let scanError: ScanError | undefined;
  // Text seen before the features array starts, kept only for the whole-document fallback.
  let prologue: string[] | null = [];

  const splitter = new FeatureSplitter({
    member: (key, value) => {
      members[key] = value;
    },
    element: (text, index) => {
      elements++;
      let feature: unknown;
      try {
        feature = JSON.parse(text);
      } catch (error) {
        checker.addUnreadableFeature(index, `Invalid JSON: ${(error as Error).message}`);
        return;
      }
      checker.addFeature(feature, index);
    },
  });

  const feed = (text: string) => {
    if (prologue) prologue.push(text);
    if (scanError) return;
    try {
      splitter.push(text);
    } catch (error) {
      if (!(error instanceof ScanError)) throw error;
      scanError = error;
    }
    if (splitter.inFeatures) prologue = null;
  };

  for await (const chunk of source) {
    bytes += typeof chunk === "string" ? encoder.encode(chunk).byteLength : chunk.byteLength;
    feed(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    if (scanError && prologue === null) break; // broken inside the features: nothing more to learn, stop reading
  }
  const tail = decoder.decode();
  if (tail && !(scanError && prologue === null)) feed(tail);

  if (!splitter.inFeatures) return checkGeoJSON(prologue!.join(""));

  if (!scanError) {
    try {
      splitter.end();
    } catch (error) {
      if (!(error instanceof ScanError)) throw error;
      scanError = error;
    }
  }
  if (scanError) {
    checker.addStructureProblem(`Invalid JSON: ${scanError.message}, after ${elements} feature(s)`);
  } else {
    const problem = rootTypeProblem(members.type);
    if (problem) checker.addStructureProblem(problem);
  }
  return checker.finish(bytes, members);
}

export const checkGeoJSONFile = (path: string): Promise<Report> => checkGeoJSONStream(Bun.file(path).stream());
