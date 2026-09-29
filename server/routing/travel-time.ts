import {
  AVERAGE_MPH,
  DRIVE_TIME_BUFFER_MULTIPLIER,
  SCRANTON_DEPOT,
  DRIVER_BREAK_MINUTES,
  SERVICE_MINUTES_PER_STOP,
} from "../../shared/constants.js";
import { parseDeliveryTime } from "../../shared/timeFormat.js";
import type { Depot, Stop } from "../../shared/types.js";
import { isGoogleMapsBlocked, recordGoogleMapsError } from "./google-maps-status.js";

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface LegMetrics {
  durationMinutes: number;
  distanceMeters: number;
}

export type TravelTimeSource = "google" | "osrm" | "estimated";

export interface TravelMatrix {
  source: TravelTimeSource;
  getLeg(from: GeoPoint, to: GeoPoint): LegMetrics;
  getDurationMinutes(from: GeoPoint, to: GeoPoint): number;
  getDistanceMiles(from: GeoPoint, to: GeoPoint): number;
}

const globalLegCache = new Map<string, LegMetrics>();

/** Add planning buffer to raw Google/estimated drive minutes. */
export function applyDriveTimeBuffer(minutes: number): number {
  return minutes * DRIVE_TIME_BUFFER_MULTIPLIER;
}

/**
 * Google only returns duration_in_traffic when departure_time is in the future.
 * If the planned route departure has already passed (common with the demo reference
 * week vs. real-world clock), fall back to near-current traffic.
 */
export function resolveTrafficDepartureTime(plannedDepartureUnix?: number): number {
  const now = Math.floor(Date.now() / 1000);
  if (plannedDepartureUnix != null && plannedDepartureUnix > now) {
    return plannedDepartureUnix;
  }
  return now + 60;
}

function legKey(from: GeoPoint, to: GeoPoint): string {
  return `${from.lat.toFixed(5)},${from.lng.toFixed(5)}->${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
}

function samePoint(a: GeoPoint, b: GeoPoint): boolean {
  return a.lat.toFixed(5) === b.lat.toFixed(5) && a.lng.toFixed(5) === b.lng.toFixed(5);
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateLeg(from: GeoPoint, to: GeoPoint): LegMetrics {
  const cached = globalLegCache.get(legKey(from, to));
  if (cached) return cached;

  const distanceMeters = haversineMeters(from.lat, from.lng, to.lat, to.lng);
  const rawMinutes = (distanceMeters / 1609.344 / AVERAGE_MPH) * 60;
  const metrics = {
    durationMinutes: applyDriveTimeBuffer(rawMinutes),
    distanceMeters,
  };
  globalLegCache.set(legKey(from, to), metrics);
  return metrics;
}

class TravelMatrixImpl implements TravelMatrix {
  constructor(
    readonly source: TravelTimeSource,
    private readonly legs: Map<string, LegMetrics>
  ) {}

  getLeg(from: GeoPoint, to: GeoPoint): LegMetrics {
    if (samePoint(from, to)) return { durationMinutes: 0, distanceMeters: 0 };
    return this.legs.get(legKey(from, to)) ?? estimateLeg(from, to);
  }

  getDurationMinutes(from: GeoPoint, to: GeoPoint): number {
    return this.getLeg(from, to).durationMinutes;
  }

  getDistanceMiles(from: GeoPoint, to: GeoPoint): number {
    return this.getLeg(from, to).distanceMeters / 1609.344;
  }
}

function uniquePoints(depot: Depot, stops: Stop[]): GeoPoint[] {
  const points: GeoPoint[] = [{ lat: depot.lat, lng: depot.lng }];
  const seen = new Set<string>([`${depot.lat.toFixed(5)},${depot.lng.toFixed(5)}`]);

  for (const stop of stops) {
    const key = `${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ lat: stop.lat, lng: stop.lng });
  }
  return points;
}

interface OsrmTableResponse {
  code?: string;
  durations?: (number | null)[][];
  distances?: (number | null)[][];
}

/**
 * Road durations from the public OSRM table service.
 * Used when Google Maps is not configured. Returns null if the request fails.
 */
async function fetchOsrmTable(points: GeoPoint[]): Promise<Map<string, LegMetrics> | null> {
  if (points.length < 2 || points.length > 80) return null;

  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "PA-Wine-Routing/1.0 (Scranton warehouse)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as OsrmTableResponse;
    if (data.code !== "Ok" || !data.durations || !data.distances) return null;

    const legs = new Map<string, LegMetrics>();
    for (let i = 0; i < points.length; i++) {
      for (let j = 0; j < points.length; j++) {
        if (i === j) continue;
        const seconds = data.durations[i]?.[j];
        const meters = data.distances[i]?.[j];
        if (seconds == null || meters == null || !Number.isFinite(seconds) || !Number.isFinite(meters)) {
          legs.set(legKey(points[i], points[j]), estimateLeg(points[i], points[j]));
          continue;
        }
        legs.set(legKey(points[i], points[j]), {
          durationMinutes: seconds / 60,
          distanceMeters: meters,
        });
      }
    }
    return legs;
  } catch {
    return null;
  }
}

async function createRoadOrEstimatedMatrix(depot: Depot, stops: Stop[]): Promise<TravelMatrix> {
  const points = uniquePoints(depot, stops);
  const osrmLegs = await fetchOsrmTable(points);
  if (osrmLegs && osrmLegs.size > 0) {
    return new TravelMatrixImpl("osrm", osrmLegs);
  }
  return createEstimatedTravelMatrix(depot, stops);
}

/** Straight-line estimate matrix (tests / fallback when road routing is unavailable). */
export function createEstimatedTravelMatrix(depot: Depot, stops: Stop[]): TravelMatrix {
  const legs = new Map<string, LegMetrics>();
  const points = uniquePoints(depot, stops);

  for (const from of points) {
    for (const to of points) {
      if (samePoint(from, to)) continue;
      const metrics = estimateLeg(from, to);
      legs.set(legKey(from, to), metrics);
    }
  }

  return new TravelMatrixImpl("estimated", legs);
}

const BATCH_SIZE = 10;
const REQUEST_DELAY_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GoogleMatrixElement {
  status: string;
  duration?: { value: number };
  duration_in_traffic?: { value: number };
  distance?: { value: number };
}

interface GoogleMatrixResponse {
  rows?: {
    elements?: GoogleMatrixElement[];
  }[];
  status: string;
  error_message?: string;
}

export interface GoogleLegDuration {
  /** Typical drive time without traffic delay (buffered). */
  baseMinutes: number;
  driveMinutes: number;
  /** Extra minutes vs typical duration at this departure time (0 if unknown). */
  trafficMinutes: number;
}

function parseGoogleLegDuration(element: GoogleMatrixElement): GoogleLegDuration | null {
  if (element.status !== "OK" || !element.duration) return null;

  const typicalMinutes = element.duration.value / 60;
  const inTrafficMinutes = (element.duration_in_traffic?.value ?? element.duration.value) / 60;
  const baseMinutes = applyDriveTimeBuffer(typicalMinutes);
  const driveMinutes = applyDriveTimeBuffer(inTrafficMinutes);
  const trafficMinutes = Math.max(0, Math.round(driveMinutes - baseMinutes));

  return {
    baseMinutes,
    driveMinutes,
    trafficMinutes,
  };
}

async function fetchGoogleMatrixBatch(
  origins: GeoPoint[],
  destinations: GeoPoint[],
  apiKey: string,
  departureTime?: number
): Promise<Map<string, LegMetrics>> {
  const params = new URLSearchParams({
    origins: origins.map((p) => `${p.lat},${p.lng}`).join("|"),
    destinations: destinations.map((p) => `${p.lat},${p.lng}`).join("|"),
    mode: "driving",
    units: "imperial",
    key: apiKey,
  });

  params.set("departure_time", String(resolveTrafficDepartureTime(departureTime)));
  params.set("traffic_model", "best_guess");

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Distance Matrix HTTP ${res.status}`);
  }

  const data = (await res.json()) as GoogleMatrixResponse;
  if (data.status !== "OK") {
    throw new Error(data.error_message ?? `Google Distance Matrix: ${data.status}`);
  }

  const legs = new Map<string, LegMetrics>();
  for (let i = 0; i < origins.length; i++) {
    const row = data.rows?.[i]?.elements ?? [];
    for (let j = 0; j < destinations.length; j++) {
      const element = row[j];
      if (!element || element.status !== "OK" || !element.duration || !element.distance) {
        continue;
      }
      const from = origins[i];
      const to = destinations[j];
      const parsed = parseGoogleLegDuration(element);
      const metrics = {
        durationMinutes: parsed?.driveMinutes ?? applyDriveTimeBuffer(element.duration.value / 60),
        distanceMeters: element.distance.value,
      };
      legs.set(legKey(from, to), metrics);
      globalLegCache.set(legKey(from, to), metrics);
    }
  }

  return legs;
}

export function deliveryDepartureTimestamp(deliveryDate: string, hour = 10): number {
  return departureTimestampFromMinutes(deliveryDate, hour * 60);
}

/** Unix timestamp for a local Eastern delivery-day clock time. */
export function departureTimestampFromMinutes(
  deliveryDate: string,
  minutesSinceMidnight: number
): number {
  const [y, m, d] = deliveryDate.split("-").map(Number);
  const normalized = ((Math.floor(minutesSinceMidnight) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  // Eastern Time — EDT in routing season (Mar–Nov). Good enough for traffic estimates.
  const offset = "-04:00";
  const local = new Date(
    `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`
  );
  return Math.floor(local.getTime() / 1000);
}

const ROLLING_REQUEST_DELAY_MS = 80;

function parseWindowStartMinutes(windowStart: string): number {
  const [h, m] = windowStart.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

/** Fetch one driving leg with traffic for a specific departure time. */
export async function fetchGoogleLegDuration(
  from: GeoPoint,
  to: GeoPoint,
  departureTimeUnix: number | undefined,
  apiKey: string
): Promise<GoogleLegDuration | null> {
  if (isGoogleMapsBlocked()) return null;

  const params = new URLSearchParams({
    origins: `${from.lat},${from.lng}`,
    destinations: `${to.lat},${to.lng}`,
    mode: "driving",
    units: "imperial",
    key: apiKey,
  });

  params.set("departure_time", String(resolveTrafficDepartureTime(departureTimeUnix)));
  params.set("traffic_model", "best_guess");

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as GoogleMatrixResponse;
  if (data.status !== "OK") {
    recordGoogleMapsError("fetchGoogleLegDuration", data.error_message ?? data.status);
    return null;
  }

  const element = data.rows?.[0]?.elements?.[0];
  if (!element) return null;

  return parseGoogleLegDuration(element);
}

export interface RollingSegmentDriveResult {
  stopDriveMinutes: Record<string, number>;
  stopBaseDriveMinutes: Record<string, number>;
  stopTrafficMinutes: Record<string, number>;
  returnDriveMinutes?: number;
}

/** Drive minutes per stop using departure times that roll forward with the route schedule. */
export async function computeRollingSegmentDriveTimes(options: {
  stopIds: string[];
  getStop: (stopId: string) => Stop | undefined;
  start: GeoPoint;
  deliveryDate: string;
  windowStart: string;
  firstStopTime?: string;
  driveOverrides?: Record<string, number>;
  serviceOverrides?: Record<string, number>;
  breakAfterStopId?: string;
  fallbackMatrix: TravelMatrix;
  returnToDepot: boolean;
  depot: GeoPoint;
  apiKey?: string;
}): Promise<RollingSegmentDriveResult> {
  const apiKey = options.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const stopDriveMinutes: Record<string, number> = {};
  const stopBaseDriveMinutes: Record<string, number> = {};
  const stopTrafficMinutes: Record<string, number> = {};

  if (!apiKey || isGoogleMapsBlocked() || options.stopIds.length === 0) {
    return { stopDriveMinutes, stopBaseDriveMinutes, stopTrafficMinutes };
  }

  const winStart = parseWindowStartMinutes(options.windowStart);
  const firstArrival =
    (options.firstStopTime ? parseDeliveryTime(options.firstStopTime) : null) ?? winStart;

  let cur = options.start;
  /** Minutes since midnight when the vehicle leaves `cur` for the next stop. */
  let leaveAtMinutes = firstArrival;
  const breakAfterIndex = options.breakAfterStopId
    ? options.stopIds.indexOf(options.breakAfterStopId)
    : -1;

  for (let i = 0; i < options.stopIds.length; i++) {
    const stopId = options.stopIds[i];
    const stop = options.getStop(stopId);
    if (!stop) continue;

    const to: GeoPoint = { lat: stop.lat, lng: stop.lng };
    let drive: number;

    if (options.driveOverrides?.[stopId] != null) {
      drive = Math.max(0, options.driveOverrides[stopId]!);
    } else {
      if (i === 0) {
        const estimate = options.fallbackMatrix.getDurationMinutes(cur, to);
        leaveAtMinutes = firstArrival - estimate;
      }
      const departureUnix = departureTimestampFromMinutes(
        options.deliveryDate,
        leaveAtMinutes
      );
      const fetched = await fetchGoogleLegDuration(cur, to, departureUnix, apiKey);
      drive = fetched?.driveMinutes ?? options.fallbackMatrix.getDurationMinutes(cur, to);
      if (fetched) {
        stopBaseDriveMinutes[stopId] = Math.round(fetched.baseMinutes);
        stopTrafficMinutes[stopId] = fetched.trafficMinutes;
      }
      if (i < options.stopIds.length - 1 || options.returnToDepot) {
        await sleep(ROLLING_REQUEST_DELAY_MS);
      }
    }

    stopDriveMinutes[stopId] = Math.round(drive);

    const serviceMinutes =
      options.serviceOverrides?.[stopId] != null
        ? Math.max(SERVICE_MINUTES_PER_STOP, Math.round(options.serviceOverrides[stopId]!))
        : SERVICE_MINUTES_PER_STOP;
    const arriveAtMinutes = i === 0 ? firstArrival : leaveAtMinutes + drive;
    leaveAtMinutes = arriveAtMinutes + serviceMinutes;
    if (breakAfterIndex === i) {
      leaveAtMinutes += DRIVER_BREAK_MINUTES;
    }
    cur = to;
  }

  let returnDriveMinutes: number | undefined;
  if (options.returnToDepot && options.stopIds.length > 0) {
    const departureUnix = departureTimestampFromMinutes(
      options.deliveryDate,
      leaveAtMinutes
    );
    const returnLeg = await fetchGoogleLegDuration(cur, options.depot, departureUnix, apiKey);
    returnDriveMinutes = Math.round(
      returnLeg?.driveMinutes ??
        options.fallbackMatrix.getDurationMinutes(cur, options.depot)
    );
  }

  return { stopDriveMinutes, stopBaseDriveMinutes, stopTrafficMinutes, returnDriveMinutes };
}

export async function buildTravelMatrix(
  depot: Depot,
  stops: Stop[],
  options?: { departureTime?: number; apiKey?: string }
): Promise<TravelMatrix> {
  const apiKey = options?.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const points = uniquePoints(depot, stops);

  if (!apiKey || isGoogleMapsBlocked() || points.length <= 1) {
    return createRoadOrEstimatedMatrix(depot, stops);
  }

  const legs = new Map<string, LegMetrics>();

  try {
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      for (let j = 0; j < points.length; j += BATCH_SIZE) {
        const origins = points.slice(i, i + BATCH_SIZE);
        const destinations = points.slice(j, j + BATCH_SIZE);
        const batch = await fetchGoogleMatrixBatch(
          origins,
          destinations,
          apiKey,
          options?.departureTime
        );
        for (const [key, value] of batch) {
          legs.set(key, value);
        }
        if (i + BATCH_SIZE < points.length || j + BATCH_SIZE < points.length) {
          await sleep(REQUEST_DELAY_MS);
        }
      }
    }
  } catch (err) {
    recordGoogleMapsError("buildTravelMatrix", err);
    return createRoadOrEstimatedMatrix(depot, stops);
  }

  // Fill any missing pairs with straight-line estimates.
  for (const from of points) {
    for (const to of points) {
      if (samePoint(from, to)) continue;
      const key = legKey(from, to);
      if (!legs.has(key)) {
        legs.set(key, estimateLeg(from, to));
      }
    }
  }

  return new TravelMatrixImpl("google", legs);
}

export function clearTravelTimeCache(): void {
  globalLegCache.clear();
}

export { SCRANTON_DEPOT };
