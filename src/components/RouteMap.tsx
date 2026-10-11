import { useEffect, useMemo, useState } from "react";
import { generateMapPdfExports, type MapPdfExport } from "../lib/generateMapPdf";
import RouteMapPdfModal from "./RouteMapPdfModal";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { RoutePlan } from "@shared/types";
import type { SegmentUpdate } from "../lib/segmentDrag";
import { allMapPoints, buildSegmentRoutes } from "../lib/routeMapUtils";
import type { RouteLegInfo, SegmentTrafficAlert, RouteGeometryResult } from "@shared/routeGeometry";
import "leaflet/dist/leaflet.css";

interface RouteMapProps {
  plan: RoutePlan;
  previewSegments?: SegmentUpdate[] | null;
  activeStopId?: string | null;
  geometrySegments?: Map<string, { path: [number, number][]; legs?: RouteLegInfo[]; trafficAlert?: SegmentTrafficAlert }> | null;
  geometryPaths?: Map<string, [number, number][]> | null;
  trafficSummary?: RouteGeometryResult["trafficSummary"];
  geometrySource?: "google" | "estimated" | null;
  geometryLoading?: boolean;
  trafficRefreshPending?: boolean;
  refreshingTraffic?: boolean;
  trafficRefreshError?: string | null;
  onRefreshTraffic?: () => void;
  pendingRouteOrder?: boolean;
  routeLocked?: boolean;
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

/** React Strict Mode can leave OSM tiles stuck at opacity 0 after load. */
function EnsureVisibleTiles() {
  const map = useMap();

  useEffect(() => {
    const revealTiles = () => {
      map
        .getContainer()
        .querySelectorAll<HTMLImageElement>(".leaflet-tile-pane img.leaflet-tile-loaded")
        .forEach((img) => {
          img.style.opacity = "1";
        });
    };

    map.on("tileload", revealTiles);
    map.on("load", revealTiles);
    map.whenReady(revealTiles);

    return () => {
      map.off("tileload", revealTiles);
      map.off("load", revealTiles);
    };
  }, [map]);

  return null;
}

export default function RouteMap({
  plan,
  previewSegments,
  activeStopId,
  geometrySegments,
  geometrySource,
  geometryLoading,
  trafficRefreshPending,
  refreshingTraffic,
  trafficRefreshError,
  onRefreshTraffic,
  pendingRouteOrder,
  routeLocked,
}: RouteMapProps) {
  const [exportingMapPdf, setExportingMapPdf] = useState(false);
  const [mapPdfExports, setMapPdfExports] = useState<MapPdfExport[] | null>(null);

  const closeMapPdfModal = () => {
    setMapPdfExports((prev) => {
      prev?.forEach((item) => URL.revokeObjectURL(item.blobUrl));
      return null;
    });
  };

  const routes = useMemo(
    () =>
      buildSegmentRoutes(plan, previewSegments, geometrySegments, {
        freezeRoutePaths: plan.manualTruckAssignment === true,
      }),
    [plan, previewSegments, geometrySegments]
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
        fadeAnimation={false}
        zoomAnimation={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          crossOrigin="anonymous"
          opacity={1}
        />
        <EnsureVisibleTiles />
        <FitBounds points={boundsPoints} />

        <Marker position={[plan.depot.lat, plan.depot.lng]} icon={depotIcon()}>
          <Popup>
            <div className="route-map-popup">
              <strong>{plan.depot.name}</strong>
              <div className="route-map-popup__sub">
                {plan.depot.address}, {plan.depot.city}
              </div>
              <div className="route-map-popup__badge">Depot Location</div>
            </div>
          </Popup>
        </Marker>

        {routes.map((route) => {
          if (route.legs && route.legs.length > 0) {
            return route.legs.map((leg) => {
              if (leg.path.length === 0) return null;

              return (
                <Polyline
                  key={`${route.segmentId}-leg-${leg.legIndex}`}
                  positions={leg.path}
                  smoothFactor={0.5}
                  pathOptions={{
                    color: route.color,
                    weight: 4,
                    opacity: isPreview ? 0.85 : 0.92,
                    lineCap: "round",
                    lineJoin: "round",
                    dashArray: isPreview ? "8 6" : undefined,
                  }}
                >
                  <Popup>
                    <div className="route-map-leg-popup">
                      <div className="route-map-leg-popup__header">
                        <span className="route-map-leg-popup__truck">{route.label}</span>
                      </div>
                      <div className="route-map-leg-popup__route">
                        <strong>{leg.fromName}</strong>
                        <span className="arrow">→</span>
                        <strong>{leg.toName}</strong>
                      </div>
                      {leg.driveMinutes != null && (
                        <div className="route-map-leg-popup__metrics">
                          <div className="route-map-leg-popup__metric">
                            <span className="label">Drive time:</span>
                            <span className="value">{leg.driveMinutes} min</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </Popup>
                </Polyline>
              );
            });
          }

          return route.path.length > 0 ? (
            <Polyline
              key={route.segmentId}
              positions={route.path}
              smoothFactor={0.5}
              pathOptions={{
                color: route.color,
                weight: 4,
                opacity: isPreview ? 0.85 : 0.92,
                lineCap: "round",
                lineJoin: "round",
                dashArray: isPreview ? "8 6" : undefined,
              }}
            />
          ) : null;
        })}

        {routes.flatMap((route) =>
          route.stops.map(({ stop, sequence }) => (
            <Marker
              key={stop.id}
              position={[stop.lat, stop.lng]}
              icon={stopIcon(sequence, route.color, stop.id === activeStopId)}
            >
              <Popup>
                <div className="route-map-popup">
                  <div className="route-map-popup__title">
                    {sequence}. {stop.customerName}
                  </div>
                  <div className="route-map-popup__sub">
                    {stop.address}, {stop.city}
                  </div>
                  <div className="route-map-popup__meta">
                    <span>{route.label}</span>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))
        )}
      </MapContainer>

      <div className="route-map__legend">
        <div className="route-map__legend-row route-map__legend-row--meta">
          <span className="route-map__legend-depot">D · Scranton depot</span>
          {geometryLoading && (
            <span className="route-map__legend-pill route-map__legend-pill--loading">Updating map…</span>
          )}
          {!geometryLoading && geometrySource === "google" && (
            <span className="route-map__legend-pill">Road paths</span>
          )}
          {!geometryLoading && geometrySource === "estimated" && (
            <span className="route-map__legend-pill route-map__legend-pill--muted">Straight-line</span>
          )}
          {!geometryLoading && trafficRefreshPending && !geometrySource && (
            <span className="route-map__legend-pill route-map__legend-pill--muted">Paths not loaded</span>
          )}
        </div>

        {routes.length > 0 && (
          <div className="route-map__legend-row route-map__legend-row--segments">
            {routes.map((route) => (
              <span key={route.segmentId} className="route-map__legend-item">
                <span className="route-map__legend-swatch" style={{ background: route.color }} />
                {route.label}
              </span>
            ))}
          </div>
        )}

        <div className="route-map__legend-row route-map__legend-row--actions">
          {onRefreshTraffic && plan.travelTimeSource === "google" && (
            <button
              type="button"
              className="route-map-btn route-map-btn--secondary"
              disabled={
                routeLocked || pendingRouteOrder || refreshingTraffic || geometryLoading
              }
              title={
                pendingRouteOrder
                  ? "Apply stop order changes before refreshing the map"
                  : "Fetch live traffic for ETAs and road paths"
              }
              onClick={onRefreshTraffic}
            >
              {refreshingTraffic || geometryLoading ? "Refreshing…" : "Refresh map"}
            </button>
          )}
          <button
            type="button"
            className="route-map-btn route-map-btn--primary"
            disabled={exportingMapPdf || plan.allStops.length === 0}
            title={
              plan.manualTruckAssignment && plan.segments.filter((s) => s.stops.length > 0).length > 1
                ? "One PDF per truck with numbered stops"
                : "Save a PDF of the current map with numbered stops"
            }
            onClick={() => {
              setExportingMapPdf(true);
              void generateMapPdfExports(plan, geometrySegments ?? null, {
                useGeometry: !pendingRouteOrder,
                autoDownload: false,
              })
                .then((res) => {
                  setMapPdfExports((prev) => {
                    prev?.forEach((item) => URL.revokeObjectURL(item.blobUrl));
                    return res;
                  });
                })
                .catch((err) => console.warn("Map PDF export failed:", err))
                .finally(() => setExportingMapPdf(false));
            }}
          >
            {exportingMapPdf ? "Building PDF…" : "Map PDF"}
          </button>
        </div>
        {trafficRefreshError && (
          <p className="route-map__legend-error">{trafficRefreshError}</p>
        )}
      </div>

      {mapPdfExports && mapPdfExports.length > 0 && (
        <RouteMapPdfModal
          exports={mapPdfExports}
          routeName={plan.territoryName}
          deliveryDate={plan.deliveryDate}
          onClose={closeMapPdfModal}
        />
      )}
    </div>
  );
}
