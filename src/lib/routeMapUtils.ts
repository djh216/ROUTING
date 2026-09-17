import type { RoutePlan } from "@shared/types";
import { buildSegmentWaypoints, type SegmentAssignmentUpdate } from "@shared/routeGeometry";
import type { SegmentUpdate } from "./segmentDrag";

export const SEGMENT_COLORS = [
  "#7c3aed",
  "#10b981",
  "#f59e0b",
  "#3b82f6",
  "#ec4899",
  "#14b8a6",
];

export type LatLng = [number, number];

export interface SegmentRoute {
  segmentId: string;
  label: string;
  color: string;
  path: LatLng[];
  stops: { stop: import("@shared/types").Stop; sequence: number }[];
}

function toTuple(path: { lat: number; lng: number }[]): LatLng[] {
  return path.map((p) => [p.lat, p.lng]);
}

export function buildSegmentRoutes(
  plan: RoutePlan,
  segmentOverrides?: SegmentUpdate[] | null,
  geometryPaths?: Map<string, LatLng[]> | null,
  options?: { freezeRoutePaths?: boolean }
): SegmentRoute[] {
  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  const overrideMap = segmentOverrides
    ? new Map(segmentOverrides.map((u) => [u.segmentId, u.stops]))
    : undefined;

  const waypointSegments = buildSegmentWaypoints(
    plan,
    segmentOverrides as SegmentAssignmentUpdate[] | null | undefined
  );

  return waypointSegments.map((seg, index) => {
    const segment = plan.segments.find((s) => s.id === seg.segmentId)!;
    const assignments = overrideMap?.get(segment.id) ?? segment.stops;
    const stops = assignments
      .map((a) => stopMap.get(a.stopId))
      .filter((s): s is NonNullable<typeof s> => !!s);

    const geometryPath = geometryPaths?.get(seg.segmentId);
    const path =
      geometryPath ??
      (options?.freezeRoutePaths ? [] : toTuple(seg.waypoints));

    return {
      segmentId: seg.segmentId,
      label: seg.label,
      color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
      path,
      stops: stops.map((stop, sequence) => ({ stop, sequence: sequence + 1 })),
    };
  });
}

export function allMapPoints(plan: RoutePlan, routes: SegmentRoute[]): LatLng[] {
  const points: LatLng[] = [[plan.depot.lat, plan.depot.lng]];
  for (const route of routes) {
    for (const { stop } of route.stops) {
      points.push([stop.lat, stop.lng]);
    }
  }
  return points;
}

export function segmentRoutesCacheKey(
  plan: RoutePlan,
  segmentOverrides?: SegmentUpdate[] | null
): string {
  const segments = buildSegmentWaypoints(
    plan,
    segmentOverrides as SegmentAssignmentUpdate[] | null | undefined
  );
  return segments
    .map((s) => `${s.segmentId}:${s.waypoints.map((p) => `${p.lat},${p.lng}`).join(";")}`)
    .join("|");
}
