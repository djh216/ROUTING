import { useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { RoutePlan } from "@shared/types";
import type { SegmentUpdate } from "../lib/segmentDrag";
import { allMapPoints, buildSegmentRoutes } from "../lib/routeMapUtils";
import "leaflet/dist/leaflet.css";

interface RouteMapProps {
  plan: RoutePlan;
  previewSegments?: SegmentUpdate[] | null;
  activeStopId?: string | null;
  geometryPaths?: Map<string, [number, number][]> | null;
  geometrySource?: "google" | "estimated" | null;
  geometryLoading?: boolean;
}

function depotIcon(): L.DivIcon {
  return L.divIcon({
    className: "route-map-marker route-map-marker--depot",
    html: `<span>D</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function stopIcon(sequence: number, color: string, active: boolean): L.DivIcon {
  return L.divIcon({
    className: `route-map-marker route-map-marker--stop${active ? " route-map-marker--active" : ""}`,
    html: `<span style="background:${color}">${sequence}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const pointsKey = useMemo(() => points.map((p) => p.join(",")).join("|"), [points]);

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 12 });
  }, [map, points, pointsKey]);

  return null;
}

export default function RouteMap({
  plan,
  previewSegments,
  activeStopId,
  geometryPaths,
  geometrySource,
  geometryLoading,
}: RouteMapProps) {
  const routes = useMemo(
    () =>
      buildSegmentRoutes(plan, previewSegments, geometryPaths, {
        freezeRoutePaths: plan.manualTruckAssignment === true,
      }),
    [plan, previewSegments, geometryPaths]
  );
  const boundsPoints = useMemo(() => allMapPoints(plan, routes), [plan, routes]);
  const isPreview = !!previewSegments;

  if (plan.allStops.length === 0) {
    return (
      <div className="route-map route-map--empty">
        <p>No stops to map — apply orders to build a route.</p>
      </div>
    );
  }

  return (
    <div className={`route-map${isPreview ? " route-map--preview" : ""}`}>
      <MapContainer
        center={[plan.depot.lat, plan.depot.lng]}
        zoom={8}
        className="route-map__canvas"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={boundsPoints} />

        <Marker position={[plan.depot.lat, plan.depot.lng]} icon={depotIcon()}>
          <Popup>
            <strong>{plan.depot.name}</strong>
            <br />
            {plan.depot.address}, {plan.depot.city}
          </Popup>
        </Marker>

        {routes.map((route) =>
          route.path.length > 0 ? (
            <Polyline
              key={route.segmentId}
              positions={route.path}
              smoothFactor={0.5}
              pathOptions={{
                color: route.color,
                weight: isPreview ? 4 : 4,
                opacity: isPreview ? 0.85 : 0.92,
                lineCap: "round",
                lineJoin: "round",
                dashArray: isPreview ? "8 6" : undefined,
              }}
            />
          ) : null
        )}

        {routes.flatMap((route) =>
          route.stops.map(({ stop, sequence }) => (
            <Marker
              key={stop.id}
              position={[stop.lat, stop.lng]}
              icon={stopIcon(sequence, route.color, stop.id === activeStopId)}
            >
              <Popup>
                <strong>
                  {sequence}. {stop.customerName}
                </strong>
                <br />
                {stop.address}, {stop.city}
                <br />
                {route.label}
              </Popup>
            </Marker>
          ))
        )}
      </MapContainer>

      <div className="route-map__legend">
        <span className="route-map__legend-depot">D = Scranton depot</span>
        {geometrySource === "google" && (
          <span className="route-map__legend-traffic">Road routes · Google Directions</span>
        )}
        {geometrySource === "estimated" && (
          <span className="route-map__legend-traffic">Straight-line fallback</span>
        )}
        {geometryLoading && (
          <span className="route-map__legend-loading">Updating routes…</span>
        )}
        {routes.map((route) => (
          <span key={route.segmentId} className="route-map__legend-item">
            <span className="route-map__legend-swatch" style={{ background: route.color }} />
            {route.label}
          </span>
        ))}
      </div>
    </div>
  );
}
