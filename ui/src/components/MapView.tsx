import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { GeoJSON, MapContainer, Rectangle, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { PreviewSidecar } from "../../server/preview";
import type { BBox, Flagged, GeoJSONData } from "../types";

interface Props {
  bbox?: BBox;
  drawing: boolean;
  zoomToken: number;
  preview?: { key: string; data?: GeoJSONData; sidecar?: PreviewSidecar };
  flagged?: Flagged[];
  onDraw(bbox: BBox): void;
}

const toBounds = ([w, s, e, n]: BBox): L.LatLngBoundsExpression => [[s, w], [n, e]];

// Popup content is built with textContent: Overture names and tags are user-supplied text.
function popupFor(properties: Record<string, unknown> | null): HTMLElement {
  const box = document.createElement("div");
  box.className = "popup";
  const entries = Object.entries(properties ?? {}).slice(0, 12);
  if (!entries.length) box.textContent = "No properties";
  for (const [key, value] of entries) {
    const row = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = `${key}: `;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    row.append(label, document.createTextNode(text.length > 80 ? `${text.slice(0, 80)}…` : text));
    box.append(row);
  }
  return box;
}

function DrawRectangle({ active, onDraw }: { active: boolean; onDraw(bbox: BBox): void }) {
  const map = useMap();
  const start = useRef<L.LatLng | undefined>(undefined);
  // Handlers are re-registered after render; reading through a ref means a drag right after clicking "Draw" is not missed.
  const activeRef = useRef(active);
  activeRef.current = active;
  const [dragged, setDragged] = useState<L.LatLngBounds>();

  // Panning is off for the whole draw mode, so the drag can only draw.
  useEffect(() => {
    map.getContainer().style.cursor = active ? "crosshair" : "";
    if (active) {
      map.closePopup(); // an open popup would swallow the start of the drag
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
    start.current = undefined;
    setDragged(undefined);
    return () => {
      map.getContainer().style.cursor = "";
      map.dragging.enable();
    };
  }, [active, map]);

  useMapEvents({
    mousedown(event) {
      if (activeRef.current) start.current = event.latlng;
    },
    mousemove(event) {
      if (activeRef.current && start.current) setDragged(L.latLngBounds(start.current, event.latlng));
    },
    mouseup(event) {
      if (!activeRef.current || !start.current) return;
      const bounds = L.latLngBounds(start.current, event.latlng);
      start.current = undefined;
      setDragged(undefined);
      if (bounds.getWest() === bounds.getEast() || bounds.getSouth() === bounds.getNorth()) return; // a click, not a drag
      onDraw([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
    },
  });

  return dragged ? <Rectangle bounds={dragged} interactive={false} pathOptions={{ dashArray: "6", weight: 2 }} /> : null;
}

function Fit({ bbox, token }: { bbox?: BBox; token: number }) {
  const map = useMap();
  useEffect(() => {
    if (bbox) map.fitBounds(toBounds(bbox), { padding: [40, 40], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the token changes, not on every keystroke
  }, [token, map]);
  return null;
}

function FitPreview({ data }: { data: GeoJSONData }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.geoJSON(data as never).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
  }, [data, map]);
  return null;
}

// One click handler for the whole layer instead of a popup closure per feature.
function FeatureLayer({ data }: { data: GeoJSONData }) {
  const map = useMap();
  return (
    <GeoJSON
      data={data as never}
      bubblingMouseEvents // so a bbox can still be drawn over previewed buildings
      style={{ color: "#2563eb", weight: 1, fillOpacity: 0.35 }}
      eventHandlers={{
        click(event) {
          const properties = (event.propagatedFrom as { feature?: { properties: Record<string, unknown> | null } })?.feature?.properties;
          if (properties !== undefined) L.popup().setLatLng(event.latlng).setContent(popupFor(properties)).openOn(map);
        },
      }}
    />
  );
}

// Feature counts per grid cell, drawn as shaded rectangles; the sample is drawn on top of it.
function DensityLayer({ sidecar }: { sidecar: PreviewSidecar }) {
  const map = useMap();
  useEffect(() => {
    const { bbox, grid } = sidecar;
    const [west, south, east, north] = bbox;
    const max = grid.counts.reduce((a, b) => Math.max(a, b), 1);
    const group = L.featureGroup();
    grid.counts.forEach((count, i) => {
      if (!count) return;
      const row = Math.floor(i / grid.cols);
      const col = i % grid.cols;
      L.rectangle(
        [
          [south + ((north - south) * row) / grid.rows, west + ((east - west) * col) / grid.cols],
          [south + ((north - south) * (row + 1)) / grid.rows, west + ((east - west) * (col + 1)) / grid.cols],
        ],
        { stroke: false, fillColor: "#2563eb", fillOpacity: 0.08 + 0.55 * Math.sqrt(count / max), interactive: false },
      ).addTo(group);
    });
    group.addTo(map).bringToBack();
    map.fitBounds(toBounds(bbox), { padding: [30, 30] });
    return () => {
      group.remove();
    };
  }, [sidecar, map]);
  return null;
}

const SEVERITY_COLOR = { fail: "#e5484d", warn: "#f59e0b" } as const;

function flagPopup({ label, severity, problems }: Flagged): HTMLElement {
  const box = document.createElement("div");
  box.className = "popup";
  const title = document.createElement("strong");
  title.textContent = `${severity === "fail" ? "✗ Error" : "⚠ Warning"}: ${label}`;
  box.append(title);
  for (const problem of problems) {
    const row = document.createElement("div");
    row.textContent = problem;
    box.append(row);
  }
  return box;
}

const plausible = (point: L.LatLng) => Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

// Problem geometry from a validation report, drawn over the map: red = error, orange = warning.
// A ring around each feature keeps a single building visible when zoomed out.
function FlaggedLayer({ items }: { items: Flagged[] }) {
  const map = useMap();
  useEffect(() => {
    const group = L.featureGroup();
    const fit = L.featureGroup();
    for (const item of items) {
      const color = SEVERITY_COLOR[item.severity];
      const shape = L.geoJSON(item.geometry as never, {
        style: { color, weight: 3, fillColor: color, fillOpacity: 0.35 },
        pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius: 6, color, weight: 3, fillOpacity: 0.35 }),
      });
      const center = shape.getBounds().getCenter();
      const ring = L.circleMarker(center, { radius: 14, color, weight: 2, fill: false });
      for (const layer of [shape, ring]) layer.bindPopup(() => flagPopup(item)).addTo(group);
      if (plausible(center)) ring.addTo(fit); // a coordinate error such as lon 200 would otherwise zoom out to the whole world
    }
    group.addTo(map).bringToFront();
    const bounds = fit.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18 });
    return () => {
      group.remove();
    };
  }, [items, map]);
  return null;
}

export function MapView({ bbox, drawing, zoomToken, preview, flagged, onDraw }: Props) {
  return (
    <MapContainer center={[48.138, 11.577]} zoom={16} preferCanvas className="map">
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      {bbox && <Rectangle bounds={toBounds(bbox)} interactive={false} pathOptions={{ color: "#e5484d", weight: 2, fillOpacity: 0.05 }} />}
      {preview?.data && <FeatureLayer key={preview.key} data={preview.data} />}
      {preview?.data && <FitPreview key={`fit-${preview.key}`} data={preview.data} />}
      {preview?.sidecar && <DensityLayer key={`density-${preview.key}`} sidecar={preview.sidecar} />}
      {preview?.sidecar && <FeatureLayer key={preview.key} data={{ type: "FeatureCollection", features: preview.sidecar.sample }} />}
      {flagged && <FlaggedLayer items={flagged} />}
      <DrawRectangle active={drawing} onDraw={onDraw} />
      <Fit bbox={bbox} token={zoomToken} />
    </MapContainer>
  );
}
