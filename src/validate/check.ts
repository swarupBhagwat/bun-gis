import { IdSet } from "./id-set";
import { RULES, collectParts } from "./rules";
import type { Parts, Rule } from "./rules";
import { featureProblem, isObject, rootTypeProblem } from "./structure";
import type { Geometry } from "./structure";

export interface Check {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  examples: string[];
}

/** A feature with a problem, kept (with its geometry) so a map can highlight it. */
export interface Flagged {
  label: string;
  severity: "warn" | "fail";
  problems: string[];
  geometry: Geometry;
}

export interface Report {
  bytes: number;
  featureCount: number;
  geometryTypes: Record<string, number>;
  checks: Check[];
  /** Up to MAX_FLAGGED of each severity, failures first. */
  flagged: Flagged[];
  /** Features with a geometry problem, including those not kept in `flagged`. */
  flaggedCount: number;
  failed: boolean;
  warned: boolean;
}

export const isFailure = (report: Report, strict: boolean): boolean =>
  report.failed || (strict && report.warned);

export interface RootInfo {
  attribution?: unknown;
  source?: unknown;
}

const MAX_EXAMPLES = 5;
// A cap per severity (so early warnings cannot crowd out later failures) and a vertex budget keep the report small
// however large the file or a single geometry is.
const MAX_FLAGGED = 150;
const MAX_VERTICES = 2000;
const STRUCTURE = "Structure (GeoJSON syntax)";

// Counts every problem but keeps only the first few messages, so 200k warnings cost O(1) memory.
class Problems {
  count = 0;
  readonly examples: string[] = [];
  add(message: string) {
    if (this.examples.length < MAX_EXAMPLES) this.examples.push(message);
    this.count++;
  }
}

function summarize(
  { name, passDetail, status, noun }: Pick<Rule, "name" | "passDetail" | "status" | "noun">,
  { count, examples }: Problems,
): Check {
  return count === 0
    ? { name, status: "pass", detail: passDetail, examples: [] }
    : { name, status, detail: `${count} ${noun}`, examples };
}

const labelOf = (feature: { id?: unknown }, index: number) =>
  feature.id !== undefined ? String(feature.id) : `#${index}`;

const vertexCount = ({ polygons, lines, points }: Parts): number =>
  points.length + lines.reduce((n, l) => n + l.length, 0) + polygons.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0);

function collectionChecks(root: RootInfo, duplicates: Problems): Check[] {
  const attribution = typeof root.attribution === "string" ? root.attribution : undefined;
  return [
    summarize({ name: "Feature ids", passDetail: "unique", status: "warn", noun: "duplicate id(s)" }, duplicates),
    attribution
      ? { name: "Attribution", status: "pass", detail: `${root.source ?? "source"}: ${attribution}`, examples: [] }
      : { name: "Attribution", status: "warn", detail: "no root `attribution` member", examples: [] },
  ];
}

function build(
  checks: Check[],
  bytes: number,
  featureCount = 0,
  geometryTypes: Record<string, number> = {},
  flagged: Flagged[] = [],
  flaggedCount = 0,
): Report {
  return {
    bytes,
    featureCount,
    geometryTypes,
    checks,
    flagged,
    flaggedCount,
    failed: checks.some((c) => c.status === "fail"),
    warned: checks.some((c) => c.status === "warn"),
  };
}

export const fatalReport = (bytes: number, detail: string): Report =>
  build([{ name: STRUCTURE, status: "fail", detail: "1 issue(s)", examples: [detail] }], bytes);

// Accumulates the verdict feature by feature. The same engine serves a parsed document and a stream of features,
// so the two paths cannot disagree, and nothing here keeps a feature after it has been checked.
export class Checker {
  private readonly structure = new Problems();
  private readonly duplicates = new Problems();
  private readonly problems = RULES.map(() => new Problems());
  private readonly geometryTypes: Record<string, number> = {};
  private readonly ids = new IdSet();
  private readonly flagged = { fail: [] as Flagged[], warn: [] as Flagged[] };
  private flaggedCount = 0;
  private count = 0;

  addFeature(feature: unknown, index: number): void {
    this.count++;
    const where = labelOf(isObject(feature) ? feature : {}, index);
    const problem = featureProblem(feature);
    if (problem) {
      this.structure.add(`${where}: ${problem}`);
      return;
    }
    const valid = feature as { id?: string | number; geometry: Geometry | null };
    const duplicate = valid.id !== undefined && this.ids.addAndCheck(String(valid.id));
    if (duplicate) this.duplicates.add(`${where}: duplicate id`);
    const geometry = valid.geometry;
    if (!geometry) return;
    this.geometryTypes[geometry.type] = (this.geometryTypes[geometry.type] ?? 0) + 1;

    const parts = collectParts(geometry);
    const messages: string[] = duplicate ? ["duplicate id"] : [];
    let severity: "warn" | "fail" | undefined = duplicate ? "warn" : undefined;
    for (let k = 0; k < RULES.length; k++) {
      const found = RULES[k]!.inspect(parts, geometry);
      if (!found) continue;
      for (const message of found) this.problems[k]!.add(`${where}: ${message}`);
      messages.push(...found);
      severity = RULES[k]!.status === "fail" ? "fail" : (severity ?? "warn");
    }
    if (severity) this.flag({ label: where, severity, problems: messages, geometry }, parts);
  }

  private flag(item: Flagged, parts: Parts): void {
    this.flaggedCount++;
    const kept = this.flagged[item.severity];
    if (kept.length < MAX_FLAGGED && vertexCount(parts) <= MAX_VERTICES) kept.push(item);
  }

  addUnreadableFeature(index: number, message: string): void {
    this.count++;
    this.structure.add(`#${index}: ${message}`);
  }

  // For problems found outside a single feature (a truncated file, a wrong root type).
  addStructureProblem(message: string): void {
    this.structure.add(message);
  }

  finish(bytes: number, root: RootInfo): Report {
    return build(
      [
        this.structure.count
          ? { name: STRUCTURE, status: "fail", detail: `${this.structure.count} issue(s)`, examples: this.structure.examples }
          : { name: STRUCTURE, status: "pass", detail: "valid", examples: [] },
        ...RULES.map((rule, k) => summarize(rule, this.problems[k]!)),
        ...collectionChecks(root, this.duplicates),
      ],
      bytes,
      this.count,
      this.geometryTypes,
      [...this.flagged.fail, ...this.flagged.warn],
      this.flaggedCount,
    );
  }
}

export function checkGeoJSON(text: string): Report {
  const bytes = new TextEncoder().encode(text).byteLength;

  let root: any;
  try {
    root = JSON.parse(text);
  } catch (error) {
    return fatalReport(bytes, `Invalid JSON: ${(error as Error).message}`);
  }
  if (!isObject(root)) return fatalReport(bytes, "expected a GeoJSON object with a type");

  // A "features" array means a collection, whatever its "type" says (streaming reaches the same conclusion, see stream.ts).
  const isCollection = root.type === "FeatureCollection" || Array.isArray(root.features);
  if (!isCollection && typeof root.type !== "string") return fatalReport(bytes, "expected a GeoJSON object with a type");

  let features: unknown[];
  if (isCollection) {
    if (!Array.isArray(root.features)) return fatalReport(bytes, "FeatureCollection needs a features array");
    features = root.features;
  } else if (root.type === "Feature") {
    features = [root];
  } else {
    // A bare geometry is checked as if it were the geometry of a single feature.
    features = [{ type: "Feature", properties: null, geometry: root }];
  }

  const checker = new Checker();
  for (let i = 0; i < features.length; i++) checker.addFeature(features[i], i);
  if (isCollection) {
    const problem = rootTypeProblem(root.type);
    if (problem) checker.addStructureProblem(problem);
  }
  return checker.finish(bytes, root);
}
