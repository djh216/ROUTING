import {
  buildSegmentWaypoints,
  waypointsCacheKey,
  type LatLng,
  type SegmentAssignmentUpdate,
} from "../../shared/routeGeometry.js";
import type { RoutePlan } from "../../shared/types.js";
import { deliveryDepartureTimestamp } from "./travel-time.js";
import { isGoogleMapsBlocked, recordGoogleMapsError } from "./google-maps-status.js";

export type RouteGeometrySource = "google" | "estimated";

export interface SegmentGeometry {
  segmentId: string;
  path: LatLng[];
}

export interface RouteGeometryResult {
  source: RouteGeometrySource;
  segments: SegmentGeometry[];
}

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
async function fetchDirectionsPath(
  waypoints: LatLng[],
  departureTime: number | undefined,
  apiKey: string
): Promise<LatLng[]> {
  if (waypoints.length < 2) return waypoints;

  const combined: LatLng[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const legPath = await fetchDirectionsBetween(
      waypoints[i],
      waypoints[i + 1],
      departureTime,
      apiKey
    );
    appendPath(combined, legPath);
    if (i < waypoints.length - 2) await sleep(REQUEST_DELAY_MS);
  }

  return combined;
}

export async function buildRouteGeometry(
  plan: RoutePlan,
  segmentOverrides?: SegmentAssignmentUpdate[] | null,
  options?: { apiKey?: string }
): Promise<RouteGeometryResult> {
  const apiKey = options?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const segmentDefs = buildSegmentWaypoints(plan, segmentOverrides);
  const segments: SegmentGeometry[] = [];

  if (!apiKey || isGoogleMapsBlocked()) {
    return {
      source: "estimated",
      segments: segmentDefs.map((seg) => ({
        segmentId: seg.segmentId,
        path: seg.waypoints,
      })),
    };
  }

  try {
    for (const seg of segmentDefs) {
      const departureTime = deliveryDepartureTimestamp(seg.deliveryDate, 10);
      const path = await fetchDirectionsPath(seg.waypoints, departureTime, apiKey);
      segments.push({ segmentId: seg.segmentId, path });
      await sleep(REQUEST_DELAY_MS);
    }
    return { source: "google", segments };
  } catch (err) {
    recordGoogleMapsError("buildRouteGeometry", err);
    return {
      source: "estimated",
      segments: segmentDefs.map((seg) => ({
        segmentId: seg.segmentId,
        path: seg.waypoints,
      })),
    };
  }
}

export function clearRouteGeometryCache(): void {
  geometryCache.clear();
}
