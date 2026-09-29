// Is this shaped like GeoJSON? One linear pass over already-parsed data, no syntax tree.

export type Position = number[];

export interface Geometry {
  type: string;
  coordinates?: any;
  geometries?: Geometry[];
}

export const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// How many array levels wrap the positions of each geometry type.
const DEPTH = new Map([
  ["Point", 0],
  ["MultiPoint", 1],
  ["LineString", 1],
  ["Polygon", 2],
  ["MultiLineString", 2],
  ["MultiPolygon", 3],
]);

function positionProblem(position: unknown[]): string | undefined {
  if (position.length < 2) return "position needs at least 2 numbers";
  for (const n of position) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "position contains a non-number";
  }
}

function coordinatesProblem(value: unknown, depth: number, type: string, top = true): string | undefined {
  if (!Array.isArray(value)) {
    return top ? `${type} coordinates must be an array` : `${type} coordinates are nested wrongly (a non-array where an array was expected)`;
  }
  if (depth === 0) return positionProblem(value);
  for (const item of value) {
    const problem = coordinatesProblem(item, depth - 1, type, false);
    if (problem) return problem;
  }
}

function geometryProblem(geometry: unknown): string | undefined {
  if (!isObject(geometry) || typeof geometry.type !== "string") return "geometry must be an object with a type";
  if (geometry.type === "GeometryCollection") {
    if (!Array.isArray(geometry.geometries)) return "GeometryCollection needs a geometries array";
    for (const member of geometry.geometries) {
      const problem = geometryProblem(member);
      if (problem) return problem;
    }
    return;
  }
  const depth = DEPTH.get(geometry.type);
  if (depth === undefined) return `unknown geometry type "${geometry.type}"`;
  return coordinatesProblem(geometry.coordinates, depth, geometry.type);
}

export function featureProblem(feature: unknown): string | undefined {
  if (!isObject(feature) || feature.type !== "Feature") return 'expected an object of type "Feature"';
  if (!("properties" in feature)) return 'missing "properties" member';
  if (feature.properties !== null && !isObject(feature.properties)) return "properties must be an object or null";
  if (feature.geometry === null) return; // an unlocated feature is legal
  if (feature.geometry === undefined) return 'missing "geometry" member';
  return geometryProblem(feature.geometry);
}

export function rootTypeProblem(type: unknown): string | undefined {
  if (type === "FeatureCollection") return;
  return type === undefined ? 'missing "type" member' : `root type is "${String(type)}", expected "FeatureCollection"`;
}
