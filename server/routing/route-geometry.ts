import {
  buildSegmentWaypoints,
  waypointsCacheKey,
  type LatLng,
  type SegmentAssignmentUpdate,
  type RouteLegInfo,
  type SegmentTrafficAlert,
  type SegmentGeometry,
  type RouteGeometryResult,
  type TrafficDelayLevel,
} from "../../shared/routeGeometry.js";
import type { RoutePlan, Stop } from "../../shared/types.js";
import { deliveryDepartureTimestamp, fetchGoogleLegDuration, haversineMeters } from "./travel-time.js";
import { isGoogleMapsBlocked, recordGoogleMapsError } from "./google-maps-status.js";

export type RouteGeometrySource = "google" | "estimated";
export type { SegmentGeometry, RouteGeometryResult, RouteLegInfo, SegmentTrafficAlert, TrafficDelayLevel };

const geometryCache = new Map<string, LatLng[]>();
const REQUEST_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pointsEqual(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}

function appendPath(combined: LatLng[], segment: LatLng[]): void {
  if (segment.length === 0) return;
  const next = [...segment];
  if (combined.length > 0 && pointsEqual(combined[combined.length - 1], next[0])) {
    next.shift();
  }
  combined.push(...next);
}

/** Classify traffic delay using Distance Matrix metrics */
export function classifyTrafficDelay(trafficMinutes: number, baseMinutes: number): TrafficDelayLevel {
  if (trafficMinutes >= 8 || (trafficMinutes >= 5 && baseMinutes > 0 && trafficMinutes / baseMinutes >= 0.25)) {
    return "significant";
  }
  if (trafficMinutes >= 3) {
    return "moderate";
  }
  return "normal";
}

/** Decode Google's encoded polyline format. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

interface GoogleDirectionsResponse {
  status: string;
  error_message?: string;
  routes?: {
    overview_polyline?: { points?: string };
    legs?: {
      steps?: { polyline?: { points?: string } }[];
    }[];
  }[];
}

/** Build a detailed driving path from step polylines (falls back to overview). */
function extractDetailedPath(data: GoogleDirectionsResponse): LatLng[] {
  const route = data.routes?.[0];
  if (!route) return [];

  const path: LatLng[] = [];
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const encoded = step.polyline?.points;
      if (!encoded) continue;
      appendPath(path, decodePolyline(encoded));
    }
  }

  if (path.length > 0) return path;

  const overview = route.overview_polyline?.points;
  return overview ? decodePolyline(overview) : [];
}

async function fetchDirectionsBetween(
  from: LatLng,
  to: LatLng,
  departureTime: number | undefined,
  apiKey: string
): Promise<LatLng[]> {
  const cacheKey = waypointsCacheKey([from, to], departureTime);
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    mode: "driving",
    key: apiKey,
  });

  const now = Math.floor(Date.now() / 1000);
  if (departureTime && departureTime > now) {
    params.set("departure_time", String(departureTime));
    params.set("traffic_model", "best_guess");
  }

  const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Directions HTTP ${res.status}`);
  }

  const data = (await res.json()) as GoogleDirectionsResponse;
  if (data.status !== "OK") {
    throw new Error(data.error_message ?? `Google Directions: ${data.status}`);
  }

  const path = extractDetailedPath(data);
  if (path.length === 0) {
    throw new Error("Google Directions returned no path");
  }

  geometryCache.set(cacheKey, path);
  return path;
}

/** Fetch road-following path through waypoints in order, one Google leg at a time. */
async function buildSegmentDetails(
  seg: { segmentId: string; label: string; deliveryDate: string; waypoints: LatLng[] },
  plan: RoutePlan,
  stopMap: Map<string, Stop>,
  departureTime: number,
  apiKey: string | undefined,
  isGoogleAvailable: boolean
): Promise<{ path: LatLng[]; legs: RouteLegInfo[]; trafficAlert: SegmentTrafficAlert }> {
  const segment = plan.segments.find((s) => s.id === seg.segmentId);
  const stops = (segment?.stops ?? [])
    .map((a) => stopMap.get(a.stopId))
    .filter((s): s is Stop => !!s);

  const waypoints = seg.waypoints;
  const combinedPath: LatLng[] = [];
  const legs: RouteLegInfo[] = [];

  if (waypoints.length < 2) {
    return {
      path: waypoints,
      legs: [],
      trafficAlert: {
        hasSignificantDelay: false,
        maxDelayMinutes: 0,
        totalDelayMinutes: 0,
        delayedLegsCount: 0,
        alerts: [],
      },
    };
  }

  for (let i = 0; i < waypoints.length - 1; i++) {
    const fromCoords = waypoints[i];
    const toCoords = waypoints[i + 1];

    let fromName: string;
    let fromStopId: string | undefined;
    let toName: string;
    let toStopId: string | undefined;

    if (i === 0) {
      fromName = segment?.startLocation === "Scranton" ? "Scranton Depot" : "Start Location";
      toStopId = stops[0]?.id;
      toName = stops[0] ? `${stops[0].customerName} (${stops[0].city})` : "Stop 1";
    } else if (i <= stops.length - 1) {
      fromStopId = stops[i - 1]?.id;
      fromName = stops[i - 1] ? `${stops[i - 1].customerName} (${stops[i - 1].city})` : `Stop ${i}`;
      toStopId = stops[i]?.id;
      toName = stops[i] ? `${stops[i].customerName} (${stops[i].city})` : `Stop ${i + 1}`;
    } else {
      fromStopId = stops[stops.length - 1]?.id;
      fromName = stops[stops.length - 1] ? `${stops[stops.length - 1].customerName} (${stops[stops.length - 1].city})` : "Last Stop";
      toName = "Scranton Depot (Return)";
    }

    let legPath: LatLng[];
    if (isGoogleAvailable && apiKey) {
      try {
        legPath = await fetchDirectionsBetween(fromCoords, toCoords, departureTime, apiKey);
      } catch (err) {
        legPath = [fromCoords, toCoords];
      }
    } else {
      legPath = [fromCoords, toCoords];
    }
    appendPath(combinedPath, legPath);

    let trafficMinutes = 0;
    let baseMinutes = 0;
    let driveMinutes = 0;

    const scheduledDrive = toStopId
      ? segment?.validation.stopDriveMinutes?.[toStopId]
      : segment?.validation.returnDriveMinutes;

    if (scheduledDrive != null) {
      driveMinutes = Math.round(scheduledDrive);
      trafficMinutes =
        toStopId && segment?.validation.stopTrafficMinutes?.[toStopId] != null
          ? Math.max(0, Math.round(segment.validation.stopTrafficMinutes[toStopId]))
          : 0;
      baseMinutes =
        toStopId && segment?.validation.stopBaseDriveMinutes?.[toStopId] != null
          ? Math.round(segment.validation.stopBaseDriveMinutes[toStopId])
          : driveMinutes;
    } else if (isGoogleAvailable && apiKey) {
      const liveDuration = await fetchGoogleLegDuration(fromCoords, toCoords, departureTime, apiKey);
      if (liveDuration) {
        trafficMinutes = Math.max(0, Math.round(liveDuration.trafficMinutes));
        baseMinutes = Math.round(liveDuration.baseMinutes);
        driveMinutes = Math.round(liveDuration.driveMinutes);
      } else {
        const estMinutes = Math.round(
          (haversineMeters(fromCoords.lat, fromCoords.lng, toCoords.lat, toCoords.lng) / 1609.344 / 45) * 60
        );
        baseMinutes = estMinutes;
        driveMinutes = estMinutes;
        trafficMinutes = 0;
      }
    } else {
      const estMinutes = Math.round(
        (haversineMeters(fromCoords.lat, fromCoords.lng, toCoords.lat, toCoords.lng) / 1609.344 / 45) * 60
      );
      baseMinutes = estMinutes;
      driveMinutes = estMinutes;
      trafficMinutes = 0;
    }

    const delayLevel = classifyTrafficDelay(trafficMinutes, baseMinutes);
    const delayPercentage = baseMinutes > 0 ? Math.round((trafficMinutes / baseMinutes) * 100) : 0;

    legs.push({
      legIndex: i,
      segmentId: seg.segmentId,
      fromName,
      toName,
      fromStopId,
      toStopId,
      fromCoords,
      toCoords,
      path: legPath,
      driveMinutes,
      baseMinutes,
      trafficMinutes,
      delayLevel,
      delayPercentage,
    });

    if (i < waypoints.length - 2 && isGoogleAvailable) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const delayedLegs = legs.filter((l) => l.delayLevel === "significant" || l.delayLevel === "moderate");
  const significantLegs = legs.filter((l) => l.delayLevel === "significant");
  const totalDelayMinutes = legs.reduce((sum, l) => sum + (l.trafficMinutes ?? 0), 0);
  const maxDelayMinutes = Math.max(0, ...legs.map((l) => l.trafficMinutes ?? 0));

  const trafficAlert: SegmentTrafficAlert = {
    hasSignificantDelay: significantLegs.length > 0,
    maxDelayMinutes,
    totalDelayMinutes,
    delayedLegsCount: delayedLegs.length,
    alerts: delayedLegs.map((l) => ({
      legIndex: l.legIndex,
      fromName: l.fromName,
      toName: l.toName,
      delayMinutes: l.trafficMinutes ?? 0,
      driveMinutes: l.driveMinutes ?? 0,
      baseMinutes: l.baseMinutes ?? 0,
      delayLevel: l.delayLevel,
    })),
  };

  return { path: combinedPath, legs, trafficAlert };
}

export async function buildRouteGeometry(
  plan: RoutePlan,
  segmentOverrides?: SegmentAssignmentUpdate[] | null,
  options?: { apiKey?: string }
): Promise<RouteGeometryResult> {
  const apiKey = options?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const segmentDefs = buildSegmentWaypoints(plan, segmentOverrides);
  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  const isGoogleAvailable = !(!apiKey || isGoogleMapsBlocked());

  const segments: SegmentGeometry[] = [];

  try {
    for (const seg of segmentDefs) {
      const departureTime = deliveryDepartureTimestamp(seg.deliveryDate, 10);
      const details = await buildSegmentDetails(
        seg,
        plan,
        stopMap,
        departureTime,
        apiKey,
        isGoogleAvailable
      );
      segments.push({
        segmentId: seg.segmentId,
        path: details.path,
        legs: details.legs,
        trafficAlert: details.trafficAlert,
      });
      if (isGoogleAvailable) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    const allAlerts = segments.flatMap((s) =>
      (s.legs ?? [])
        .filter((l) => l.delayLevel === "significant" || l.delayLevel === "moderate")
        .map((l) => {
          const segLabel = plan.segments.find((seg) => seg.id === s.segmentId)?.label ?? s.segmentId;
          return {
            segmentId: s.segmentId,
            segmentLabel: segLabel,
            fromName: l.fromName,
            toName: l.toName,
            delayMinutes: l.trafficMinutes ?? 0,
            driveMinutes: l.driveMinutes ?? 0,
            baseMinutes: l.baseMinutes ?? 0,
            delayLevel: l.delayLevel,
          };
        })
    );

    const hasSignificantDelay = allAlerts.some((a) => a.delayLevel === "significant");
    const totalTrafficDelayMinutes = allAlerts.reduce((sum, a) => sum + a.delayMinutes, 0);
    const delayedSegmentsCount = new Set(allAlerts.map((a) => a.segmentId)).size;

    return {
      source: isGoogleAvailable ? "google" : "estimated",
      segments,
      trafficSummary: {
        hasSignificantDelay,
        totalTrafficDelayMinutes,
        delayedSegmentsCount,
        alerts: allAlerts,
      },
    };
  } catch (err) {
    recordGoogleMapsError("buildRouteGeometry", err);
    return {
      source: "estimated",
      segments: segmentDefs.map((seg) => ({
        segmentId: seg.segmentId,
        path: seg.waypoints,
        legs: [],
      })),
      trafficSummary: {
        hasSignificantDelay: false,
        totalTrafficDelayMinutes: 0,
        delayedSegmentsCount: 0,
        alerts: [],
      },
    };
  }
}

export function clearRouteGeometryCache(): void {
  geometryCache.clear();
}
