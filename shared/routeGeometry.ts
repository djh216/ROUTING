import type { Depot, RoutePlan, Segment, Stop, StopAssignment } from "./types";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface SegmentWaypoints {
  segmentId: string;
  label: string;
  deliveryDate: string;
  waypoints: LatLng[];
}

function resolveSegmentStops(
  segment: Segment,
  stopMap: Map<string, Stop>,
  overrides?: Map<string, StopAssignment[]>
): Stop[] {
  const assignments = overrides?.get(segment.id) ?? segment.stops;
  return assignments
    .map((a) => stopMap.get(a.stopId))
    .filter((s): s is Stop => !!s);
}

function segmentStartPoint(
  segment: Segment,
  depot: Depot,
  previousLastStop?: Stop
): LatLng | null {
  if (segment.startLocation === "Scranton") return { lat: depot.lat, lng: depot.lng };
  if (
    (segment.startLocation === "overnight" || segment.startLocation === "previous_stop") &&
    previousLastStop
  ) {
    return { lat: previousLastStop.lat, lng: previousLastStop.lng };
  }
  return null;
}

function buildSegmentWaypointsList(
  segment: Segment,
  stops: Stop[],
  depot: Depot,
  previousLastStop?: Stop
): LatLng[] {
  const waypoints: LatLng[] = [];
  const start = segmentStartPoint(segment, depot, previousLastStop);
  if (start) waypoints.push(start);

  for (const stop of stops) {
    waypoints.push({ lat: stop.lat, lng: stop.lng });
  }

  if (segment.endLocation === "Scranton" && stops.length > 0) {
    waypoints.push({ lat: depot.lat, lng: depot.lng });
  }

  return waypoints;
}

export type SegmentAssignmentUpdate = {
  segmentId: string;
  stops: StopAssignment[];
};

export function buildSegmentWaypoints(
  plan: RoutePlan,
  segmentOverrides?: SegmentAssignmentUpdate[] | null
): SegmentWaypoints[] {
  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  const overrideMap = segmentOverrides
    ? new Map(segmentOverrides.map((u) => [u.segmentId, u.stops]))
    : undefined;

  const segments: SegmentWaypoints[] = [];
  let previousLastStop: Stop | undefined;

  for (const segment of plan.segments) {
    const stops = resolveSegmentStops(segment, stopMap, overrideMap);
    segments.push({
      segmentId: segment.id,
      label: segment.label,
      deliveryDate: segment.deliveryDate,
      waypoints: buildSegmentWaypointsList(segment, stops, plan.depot, previousLastStop),
    });
    if (stops.length > 0) previousLastStop = stops[stops.length - 1];
  }

  return segments;
}

export function waypointsCacheKey(waypoints: LatLng[], departureTime?: number): string {
  const points = waypoints.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
  return departureTime ? `${points}@${departureTime}` : points;
}
