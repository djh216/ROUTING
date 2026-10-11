import type { RoutePlan, Stop } from "@shared/types";
import {
  buildSegmentWaypoints,
  type SegmentAssignmentUpdate,
  type RouteLegInfo,
  type SegmentTrafficAlert,
  type TrafficDelayLevel,
} from "@shared/routeGeometry";
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

export interface SegmentLegRoute {
  legIndex: number;
  fromName: string;
  toName: string;
  fromStopId?: string;
  toStopId?: string;
  path: LatLng[];
  driveMinutes?: number;
  baseMinutes?: number;
  trafficMinutes?: number;
  delayLevel: TrafficDelayLevel;
  delayPercentage?: number;
}

export interface SegmentRoute {
  segmentId: string;
  label: string;
  color: string;
  path: LatLng[];
  legs: SegmentLegRoute[];
  trafficAlert?: SegmentTrafficAlert;
  stops: { stop: Stop; sequence: number }[];
}

function toTuple(path: { lat: number; lng: number }[]): LatLng[] {
  return path.map((p) => [p.lat, p.lng]);
}

export function buildSegmentRoutes(
  plan: RoutePlan,
  segmentOverrides?: SegmentUpdate[] | null,
  geometrySegments?: Map<string, { path: LatLng[]; legs?: RouteLegInfo[]; trafficAlert?: SegmentTrafficAlert }> | null,
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

    const geoData = geometrySegments?.get(seg.segmentId);
    const path =
      geoData?.path ??
      (options?.freezeRoutePaths ? [] : toTuple(seg.waypoints));

    let legs: SegmentLegRoute[] = [];
    if (geoData?.legs && geoData.legs.length > 0) {
      legs = geoData.legs.map((l) => ({
        legIndex: l.legIndex,
        fromName: l.fromName,
        toName: l.toName,
        fromStopId: l.fromStopId,
        toStopId: l.toStopId,
        path: l.path.map((p) => [p.lat, p.lng] as LatLng),
        driveMinutes: l.driveMinutes,
        baseMinutes: l.baseMinutes,
        trafficMinutes: l.trafficMinutes,
        delayLevel: l.delayLevel,
        delayPercentage: l.delayPercentage,
      }));
    } else if (seg.waypoints.length >= 2) {
      const startsAtDepot = segment.startLocation === "Scranton";
      const legCount = seg.waypoints.length - 1;
      // Build default straight legs with validation traffic data
      for (let i = 0; i < legCount; i++) {
        const fromP = seg.waypoints[i];
        const toP = seg.waypoints[i + 1];
        let fromName: string;
        let toName: string;
        let fromStopId: string | undefined;
        let toStopId: string | undefined;

        if (startsAtDepot && i === 0) {
          fromName = "Scranton Depot";
          toStopId = stops[0]?.id;
          toName = stops[0]?.customerName ?? "Stop 1";
        } else if (
          segment.endLocation === "Scranton" &&
          i === legCount - 1 &&
          stops.length > 0
        ) {
          fromStopId = stops[stops.length - 1]?.id;
          fromName = stops[stops.length - 1]?.customerName ?? "Last Stop";
          toName = "Scranton Depot (Return)";
        } else {
          const fromIdx = startsAtDepot ? i - 1 : i;
          const toIdx = startsAtDepot ? i : i + 1;
          fromStopId = stops[fromIdx]?.id;
          fromName = stops[fromIdx]?.customerName ?? `Stop ${fromIdx + 1}`;
          toStopId = stops[toIdx]?.id;
          toName = stops[toIdx]?.customerName ?? `Stop ${toIdx + 1}`;
        }

        const scheduledDrive = toStopId
          ? segment.validation.stopDriveMinutes?.[toStopId]
          : segment.validation.returnDriveMinutes;
        const trafficM = toStopId && segment.validation.stopTrafficMinutes?.[toStopId] != null
          ? segment.validation.stopTrafficMinutes[toStopId]
          : 0;
        const baseM = toStopId && segment.validation.stopBaseDriveMinutes?.[toStopId] != null
          ? segment.validation.stopBaseDriveMinutes[toStopId]
          : scheduledDrive != null
          ? scheduledDrive
          : 0;
        const driveM = scheduledDrive != null ? scheduledDrive : baseM + trafficM;

        let delayLevel: TrafficDelayLevel = "normal";
        if (trafficM >= 8 || (trafficM >= 5 && baseM > 0 && trafficM / baseM >= 0.25)) {
          delayLevel = "significant";
        } else if (trafficM >= 3) {
          delayLevel = "moderate";
        }

        legs.push({
          legIndex: i,
          fromName,
          toName,
          fromStopId,
          toStopId,
          path: [[fromP.lat, fromP.lng], [toP.lat, toP.lng]],
          driveMinutes: driveM,
          baseMinutes: baseM,
          trafficMinutes: trafficM,
          delayLevel,
          delayPercentage: baseM > 0 ? Math.round((trafficM / baseM) * 100) : 0,
        });
      }
    }

    return {
      segmentId: seg.segmentId,
      label: seg.label,
      color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
      path,
      legs,
      trafficAlert: geoData?.trafficAlert,
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
