import { BunGisError } from "../core/errors";
import type { GeoWriter, WriterConfig } from "../core/ports";
import { textOutput, writeAtomically } from "../core/output-file";
import type { GeoFeature, Geometry, Position, SourceMetadata, WriteResult } from "../core/types";

// XML 1.0 forbids most control characters even when escaped, so they are dropped.
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const escapeXml = (text: string) =>
  text.replace(ILLEGAL, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const position = ([lon, lat, altitude]: Position) => (altitude === undefined ? `${lon},${lat}` : `${lon},${lat},${altitude}`);
const coordinates = (positions: Position[]) => `<coordinates>${positions.map(position).join(" ")}</coordinates>`;
const ring = (positions: Position[]) => `<LinearRing>${coordinates(positions)}</LinearRing>`;

function polygon([outer, ...holes]: Position[][]): string {
  return `<Polygon><outerBoundaryIs>${ring(outer!)}</outerBoundaryIs>${holes
    .map((hole) => `<innerBoundaryIs>${ring(hole)}</innerBoundaryIs>`)
    .join("")}</Polygon>`;
}

function geometry(g: Geometry): string {
  switch (g.type) {
    case "Point":
      return `<Point>${coordinates([g.coordinates])}</Point>`;
    case "LineString":
      return `<LineString>${coordinates(g.coordinates)}</LineString>`;
    case "Polygon":
      return polygon(g.coordinates);
    case "MultiPoint":
      return `<MultiGeometry>${g.coordinates.map((c) => geometry({ type: "Point", coordinates: c })).join("")}</MultiGeometry>`;
    case "MultiLineString":
      return `<MultiGeometry>${g.coordinates.map((c) => geometry({ type: "LineString", coordinates: c })).join("")}</MultiGeometry>`;
    case "MultiPolygon":
      return `<MultiGeometry>${g.coordinates.map(polygon).join("")}</MultiGeometry>`;
    default:
      throw new BunGisError(`KML cannot store a ${(g as { type: string }).type} geometry`);
  }
}

// KML data values are text: nested values (Overture names, sources) are kept as JSON.
const dataValue = (value: unknown) => (typeof value === "object" ? JSON.stringify(value) : String(value));

const data = (name: string, value: unknown) =>
  `<Data name="${escapeXml(name)}"><value>${escapeXml(dataValue(value))}</value></Data>`;

function placemark({ id, geometry: g, properties }: GeoFeature): string {
  const entries = Object.entries(properties).filter(([, value]) => value !== null && value !== undefined);
  return (
    "<Placemark>" +
    (id !== undefined ? `<name>${escapeXml(String(id))}</name>` : "") +
    (entries.length ? `<ExtendedData>${entries.map(([k, v]) => data(k, v)).join("")}</ExtendedData>` : "") +
    geometry(g) +
    "</Placemark>\n"
  );
}

function header({ source, attribution, license, release }: SourceMetadata): string {
  const info = Object.entries({ source, license, release, attribution }).filter(([, value]) => value);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>\n' +
    `<name>${escapeXml(source)}</name><description>${escapeXml(attribution)}</description>` +
    `<ExtendedData>${info.map(([k, v]) => data(k, v)).join("")}</ExtendedData>\n`
  );
}

export class KMLWriter implements GeoWriter {
  async write(
    features: AsyncIterable<GeoFeature>,
    { path, overwrite, metadata }: WriterConfig,
  ): Promise<WriteResult> {
    let bytes = 0;
    let featureCount = 0;
    await writeAtomically(path, overwrite, async (sink) => {
      const out = textOutput(sink);
      out.put(header(metadata));
      for await (const feature of features) {
        out.put(placemark(feature));
        featureCount++;
      }
      out.put("</Document></kml>\n");
      bytes = out.bytes;
    });
    return { featureCount, bytes };
  }
}
