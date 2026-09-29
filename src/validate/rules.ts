import kinks from "@turf/kinks";
import type { Geometry, Position } from "./structure";

// A feature's geometry split once into the pieces every rule needs, instead of each rule re-walking the coordinates.
export interface Parts {
  polygons: Position[][][];
  lines: Position[][];
  points: Position[];
}

export function collectParts(geometry: Geometry, parts: Parts = { polygons: [], lines: [], points: [] }): Parts {
  switch (geometry.type) {
    case "Point":
      parts.points.push(geometry.coordinates);
      break;
    case "MultiPoint":
      for (const point of geometry.coordinates) parts.points.push(point);
      break;
    case "LineString":
      parts.lines.push(geometry.coordinates);
      break;
    case "MultiLineString":
      for (const line of geometry.coordinates) parts.lines.push(line);
      break;
    case "Polygon":
      parts.polygons.push(geometry.coordinates);
      break;
    case "MultiPolygon":
      for (const polygon of geometry.coordinates) parts.polygons.push(polygon);
      break;
    case "GeometryCollection":
      for (const member of geometry.geometries!) collectParts(member, parts);
      break;
  }
  return parts;
}

// Written independently of the converters under test: the shoelace sign for x = lon, y = lat.
// Positive = counterclockwise.
function area(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  }
  return sum / 2;
}

const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];

function ringProblem(ring: Position[]): string | undefined {
  if (ring.length < 4) return "ring with fewer than 4 positions";
  if (!same(ring[0]!, ring[ring.length - 1]!)) return "ring is not closed";
  if (area(ring) === 0) return "ring has zero area";
}

const outOfRange = ([lon, lat]: Position) => Math.abs(lon!) > 180 || Math.abs(lat!) > 90;

// A rule inspects one geometry and returns its problems (or nothing); adding a rule means adding an entry here.
export interface Rule {
  name: string;
  passDetail: string;
  status: "warn" | "fail";
  noun: string;
  inspect(parts: Parts, geometry: Geometry): string[] | undefined;
}

export const RULES: Rule[] = [
  {
    name: "RFC 7946 rules",
    passDetail: "closed rings, coordinate ranges, minimum positions",
    status: "fail",
    noun: "violation(s)",
    inspect({ polygons, lines, points }) {
      const found: string[] = [];
      let far: Position | undefined = points.find(outOfRange);
      for (const line of lines) {
        far ??= line.find(outOfRange);
        if (line.length < 2) found.push("line with fewer than 2 positions");
      }
      for (const polygon of polygons) {
        for (const ring of polygon) {
          far ??= ring.find(outOfRange);
          const problem = ringProblem(ring);
          if (problem) found.push(problem);
        }
      }
      if (far) found.unshift(`coordinate out of range [${far[0]}, ${far[1]}]`);
      return found.length ? found : undefined;
    },
  },
  {
    name: "Winding order",
    passDetail: "exterior counterclockwise, holes clockwise",
    status: "warn",
    noun: "ring(s) against the right-hand rule (a SHOULD in RFC 7946)",
    inspect({ polygons }) {
      let found: string[] | undefined;
      for (const polygon of polygons) {
        for (let r = 0; r < polygon.length; r++) {
          const ring = polygon[r]!;
          if (ringProblem(ring)) continue; // already reported by the RFC 7946 rules
          if (area(ring) > 0 !== (r === 0)) {
            (found ??= []).push(r === 0 ? "exterior ring is clockwise" : "hole is counterclockwise");
          }
        }
      }
      return found;
    },
  },
  {
    name: "Geometry validity",
    passDetail: "no self-intersections",
    status: "warn",
    noun: "feature(s) with possible self-intersections (may include rings that merely touch)",
    // ponytail: @turf/kinks compares every segment pair, O(n^2) per geometry. Fine for buildings (median 6 vertices,
    // ~0.25 s for 1.5 M vertices); a grid index or sweep line is the upgrade for coastline-sized polygons.
    inspect({ polygons, lines }, geometry) {
      if (!polygons.length && !lines.length) return;
      try {
        const n = kinks(geometry as never).features.length;
        if (n) return [`${n} self-intersection point(s)`];
      } catch {
        return ["could not be checked"];
      }
    },
  },
];
