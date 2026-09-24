import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { RoutePlan } from "@shared/types";
import type { SegmentUpdate } from "../lib/segmentDrag";
import {
  allMapPoints,
  buildSegmentRoutes,
  getLegColor,
  TRAFFIC_COLORS,
  type SegmentLegRoute,
  type TrafficMapMode,
} from "../lib/routeMapUtils";
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

function MapFocusController({ focusPoints }: { focusPoints: [number, number][] | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focusPoints || focusPoints.length === 0) return;
    if (focusPoints.length === 1) {
      map.flyTo(focusPoints[0], 13);
      return;
    }
    map.flyToBounds(L.latLngBounds(focusPoints), { padding: [60, 60], maxZoom: 13, duration: 1.0 });
  }, [map, focusPoints]);

  return null;
}

export default function RouteMap({
  plan,
  previewSegments,
  activeStopId,
  geometrySegments,
  geometryPaths,
  geometrySource,
  geometryLoading,
}: RouteMapProps) {
  const [viewMode, setViewMode] = useState<TrafficMapMode>("traffic");
  const [focusPoints, setFocusPoints] = useState<[number, number][] | null>(null);
  const [showAlertDetails, setShowAlertDetails] = useState(false);

  const routes = useMemo(
    () =>
      buildSegmentRoutes(plan, previewSegments, geometrySegments, {
        freezeRoutePaths: plan.manualTruckAssignment === true,
      }),
    [plan, previewSegments, geometrySegments]
  );

  const boundsPoints = useMemo(() => allMapPoints(plan, routes), [plan, routes]);
  const isPreview = !!previewSegments;

  // Collect delayed legs across all segments
  const delayedLegs = useMemo(() => {
    const list: Array<{
      segmentId: string;
      segmentLabel: string;
      truckColor: string;
      leg: SegmentLegRoute;
    }> = [];
    for (const route of routes) {
      for (const leg of route.legs) {
        if (leg.delayLevel === "significant" || leg.delayLevel === "moderate") {
          list.push({
            segmentId: route.segmentId,
            segmentLabel: route.label,
            truckColor: route.color,
            leg,
          });
        }
      }
    }
    return list;
  }, [routes]);

  const significantLegs = useMemo(
    () => delayedLegs.filter((d) => d.leg.delayLevel === "significant"),
    [delayedLegs]
  );

  const totalDelayMinutes = useMemo(
    () => delayedLegs.reduce((sum, d) => sum + (d.leg.trafficMinutes ?? 0), 0),
    [delayedLegs]
  );

  if (plan.allStops.length === 0) {
    return (
      <div className="route-map route-map--empty">
        <p>No stops to map — apply orders to build a route.</p>
      </div>
    );
  }

  return (
    <div className={`route-map${isPreview ? " route-map--preview" : ""}`}>
      {/* Top Visual Alert & View Switcher Toolbar */}
      <div className="route-map__top-bar">
        {significantLegs.length > 0 ? (
          <div className="route-map-traffic-alert route-map-traffic-alert--significant">
            <div className="route-map-traffic-alert__header">
              <div className="route-map-traffic-alert__badge">
                <span className="route-map-traffic-alert__icon">⚠️</span>
                <span>TRAFFIC DELAY ALERT</span>
              </div>
              <div className="route-map-traffic-alert__summary">
                {significantLegs.length === 1 ? (
                  <span>
                    Significant delay of <strong>+{significantLegs[0].leg.trafficMinutes}m</strong> detected on{" "}
                    <strong>{significantLegs[0].segmentLabel}</strong> between{" "}
                    <em>{significantLegs[0].leg.fromName}</em> and <em>{significantLegs[0].leg.toName}</em>
                  </span>
                ) : (
                  <span>
                    <strong>{significantLegs.length} segments</strong> with significant delays (totaling{" "}
                    <strong>+{totalDelayMinutes}m</strong> traffic delay via Distance Matrix API)
                  </span>
                )}
              </div>
              <div className="route-map-traffic-alert__actions">
                <button
                  type="button"
                  className="route-map-btn route-map-btn--focus"
                  onClick={() => {
                    if (significantLegs.length > 0) {
                      setFocusPoints(significantLegs[0].leg.path);
                    }
                  }}
                  title="Zoom directly to the delayed road segment"
                >
                  Focus Delayed Leg
                </button>
                {focusPoints && (
                  <button
                    type="button"
                    className="route-map-btn route-map-btn--reset"
                    onClick={() => setFocusPoints(null)}
                  >
                    Reset View
                  </button>
                )}
                {delayedLegs.length > 1 && (
                  <button
                    type="button"
                    className="route-map-btn route-map-btn--details"
                    onClick={() => setShowAlertDetails((prev) => !prev)}
                  >
                    {showAlertDetails ? "Hide Delays ▲" : `All Delays (${delayedLegs.length}) ▼`}
                  </button>
                )}
              </div>
            </div>

            {showAlertDetails && (
              <div className="route-map-traffic-alert__details">
                <div className="route-map-traffic-alert__details-title">
                  Distance Matrix API · Segment Delay Breakdown
                </div>
                <div className="route-map-traffic-alert__list">
                  {delayedLegs.map((item, idx) => (
                    <div
                      key={`${item.segmentId}-${item.leg.legIndex}-${idx}`}
                      className={`route-map-traffic-alert__item route-map-traffic-alert__item--${item.leg.delayLevel}`}
                    >
                      <span
                        className="route-map-traffic-alert__dot"
                        style={{
                          background:
                            item.leg.delayLevel === "significant"
                              ? TRAFFIC_COLORS.significant
                              : TRAFFIC_COLORS.moderate,
                        }}
                      />
                      <div className="route-map-traffic-alert__item-content">
                        <div className="route-map-traffic-alert__item-top">
                          <strong>{item.segmentLabel}</strong>: {item.leg.fromName} → {item.leg.toName}
                        </div>
                        <div className="route-map-traffic-alert__item-sub">
                          In traffic: <strong>{item.leg.driveMinutes}m</strong> (Typical:{" "}
                          {item.leg.baseMinutes}m) ·{" "}
                          <span
                            className={`traffic-chip ${
                              item.leg.delayLevel === "significant" ? "traffic-chip--severe" : "traffic-chip--moderate"
                            }`}
                          >
                            +{item.leg.trafficMinutes}m delay
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="route-map-btn-link"
                        onClick={() => setFocusPoints(item.leg.path)}
                      >
                        Zoom to segment
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : delayedLegs.length > 0 ? (
          <div className="route-map-traffic-alert route-map-traffic-alert--moderate">
            <span className="route-map-traffic-alert__icon">⚡</span>
            <span>
              Moderate traffic delay on {delayedLegs[0].segmentLabel} (+{delayedLegs[0].leg.trafficMinutes}m between{" "}
              {delayedLegs[0].leg.fromName} and {delayedLegs[0].leg.toName})
            </span>
            <button
              type="button"
              className="route-map-btn-link ml-auto"
              onClick={() => setFocusPoints(delayedLegs[0].leg.path)}
            >
              Zoom to leg
            </button>
          </div>
        ) : (
          <div className="route-map-traffic-alert route-map-traffic-alert--normal">
            <span className="route-map-traffic-status-pill">
              <span className="status-indicator status-indicator--green" />
              <span>Distance Matrix API: Normal traffic flow across all segments (no significant delays)</span>
            </span>
            {focusPoints && (
              <button
                type="button"
                className="route-map-btn-link ml-auto"
                onClick={() => setFocusPoints(null)}
              >
                Reset Map View
              </button>
            )}
          </div>
        )}

        {/* View Mode Switcher */}
        <div className="route-map-mode-bar">
          <span className="route-map-mode-bar__label">Path Colors:</span>
          <div className="route-map-mode-bar__pills">
            <button
              type="button"
              className={`route-map-mode-pill ${viewMode === "traffic" ? "route-map-mode-pill--active" : ""}`}
              onClick={() => setViewMode("traffic")}
              title="Color-code route paths by Distance Matrix traffic delays"
            >
              🚦 Traffic Delays
            </button>
            <button
              type="button"
              className={`route-map-mode-pill ${viewMode === "truck" ? "route-map-mode-pill--active" : ""}`}
              onClick={() => setViewMode("truck")}
              title="Color-code route paths by truck assignment"
            >
              🚚 By Truck
            </button>
          </div>
        </div>
      </div>

      {/* Map Canvas */}
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
        <MapFocusController focusPoints={focusPoints} />

        {/* Depot Marker */}
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

        {/* Route Polylines: rendered leg-by-leg for precision traffic color coding */}
        {routes.map((route) => {
          if (route.legs && route.legs.length > 0) {
            return route.legs.map((leg) => {
              if (leg.path.length === 0) return null;
              const legColor = getLegColor(leg.delayLevel, viewMode, route.color);
              const isSignificant = leg.delayLevel === "significant";
              const isModerate = leg.delayLevel === "moderate";

              return (
                <div key={`${route.segmentId}-leg-wrapper-${leg.legIndex}`}>
                  {/* Outer alert glow halo for significant delays */}
                  {isSignificant && (
                    <Polyline
                      positions={leg.path}
                      smoothFactor={0.5}
                      pathOptions={{
                        color: TRAFFIC_COLORS.significantHalo,
                        weight: isPreview ? 12 : 11,
                        opacity: 0.95,
                        lineCap: "round",
                        lineJoin: "round",
                      }}
                    />
                  )}

                  {/* Core Leg Polyline */}
                  <Polyline
                    positions={leg.path}
                    smoothFactor={0.5}
                    pathOptions={{
                      color: legColor,
                      weight: isSignificant ? 5.5 : isModerate ? 4.5 : isPreview ? 4 : 4,
                      opacity: isPreview ? 0.85 : 0.95,
                      lineCap: "round",
                      lineJoin: "round",
                      dashArray: isSignificant ? "10 5" : isPreview ? "8 6" : undefined,
                    }}
                  >
                    <Popup>
                      <div className="route-map-leg-popup">
                        <div className="route-map-leg-popup__header">
                          <span
                            className={`route-map-badge route-map-badge--${leg.delayLevel}`}
                          >
                            {leg.delayLevel === "significant"
                              ? "⚠️ Significant Delay"
                              : leg.delayLevel === "moderate"
                              ? "⚡ Moderate Delay"
                              : "🟢 Normal Flow"}
                          </span>
                          <span className="route-map-leg-popup__truck">{route.label}</span>
                        </div>

                        <div className="route-map-leg-popup__route">
                          <strong>{leg.fromName}</strong>
                          <span className="arrow">→</span>
                          <strong>{leg.toName}</strong>
                        </div>

                        <div className="route-map-leg-popup__metrics">
                          <div className="route-map-leg-popup__metric">
                            <span className="label">Traffic Delay:</span>
                            <span
                              className={`value ${
                                leg.delayLevel === "significant"
                                  ? "value--severe"
                                  : leg.delayLevel === "moderate"
                                  ? "value--moderate"
                                  : "value--normal"
                              }`}
                            >
                              {leg.trafficMinutes != null && leg.trafficMinutes > 0
                                ? `+${leg.trafficMinutes} min`
                                : "0 min"}
                            </span>
                          </div>

                          <div className="route-map-leg-popup__metric">
                            <span className="label">In-Traffic Drive Time:</span>
                            <span className="value">
                              {leg.driveMinutes != null ? `${leg.driveMinutes} min` : "—"}
                            </span>
                          </div>

                          <div className="route-map-leg-popup__metric">
                            <span className="label">Typical Base Time:</span>
                            <span className="value">
                              {leg.baseMinutes != null ? `${leg.baseMinutes} min` : "—"}
                            </span>
                          </div>
                        </div>

                        <div className="route-map-leg-popup__footer">
                          <span>Source: Distance Matrix API</span>
                          {isSignificant && (
                            <span className="badge-tag badge-tag--alert">Action Needed</span>
                          )}
                        </div>
                      </div>
                    </Popup>
                  </Polyline>
                </div>
              );
            });
          }

          // Fallback if segment has no legs yet
          return route.path.length > 0 ? (
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
          ) : null;
        })}

        {/* Stop Markers */}
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

      {/* Map Legend */}
      <div className="route-map__legend">
        <span className="route-map__legend-depot">D = Scranton depot</span>

        {/* Traffic Color Indicators */}
        <div className="route-map__legend-traffic-group">
          <span className="route-map__legend-item">
            <span
              className="route-map__legend-swatch"
              style={{ background: TRAFFIC_COLORS.significant }}
            />
            Significant Delay (+8m+)
          </span>
          <span className="route-map__legend-item">
            <span
              className="route-map__legend-swatch"
              style={{ background: TRAFFIC_COLORS.moderate }}
            />
            Moderate (+3–7m)
          </span>
          <span className="route-map__legend-item">
            <span
              className="route-map__legend-swatch"
              style={{ background: TRAFFIC_COLORS.normal }}
            />
            Normal Flow (&lt;3m)
          </span>
        </div>

        {geometrySource === "google" && (
          <span className="route-map__legend-traffic">
            Road geometry · Google Distance Matrix API
          </span>
        )}
        {geometrySource === "estimated" && (
          <span className="route-map__legend-traffic">Straight-line fallback</span>
        )}
        {geometryLoading && (
          <span className="route-map__legend-loading">Updating traffic data…</span>
        )}

        {/* Segment / Truck Labels */}
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
