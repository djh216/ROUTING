import type { RoutePlan } from "@shared/types";

export type SegmentUpdate = {
  segmentId: string;
  stops: { stopId: string; position: number }[];
};

function findSegmentForStop(plan: RoutePlan, stopId: string): string | null {
  for (const seg of plan.segments) {
    if (seg.stops.some((s) => s.stopId === stopId)) return seg.id;
  }
  return null;
}

/** Compute new segment assignments when dragging a stop over a target. */
export function computeSegmentUpdate(
  plan: RoutePlan,
  activeStopId: string,
  overId: string
): SegmentUpdate[] | null {
  const fromSegmentId = findSegmentForStop(plan, activeStopId);
  if (!fromSegmentId) return null;

  let toSegmentId = fromSegmentId;
  let toIndex = 0;

  if (overId.startsWith("segment-")) {
    toSegmentId = overId.replace("segment-", "");
    const targetSeg = plan.segments.find((s) => s.id === toSegmentId);
    if (!targetSeg) return null;
    toIndex = targetSeg.stops.length;
  } else {
    toSegmentId = findSegmentForStop(plan, overId) ?? fromSegmentId;
    const targetSeg = plan.segments.find((s) => s.id === toSegmentId);
    if (!targetSeg) return null;
    toIndex = targetSeg.stops.findIndex((s) => s.stopId === overId);
    if (toIndex < 0) toIndex = targetSeg.stops.length;
    if (fromSegmentId === toSegmentId) {
      const fromIndex = targetSeg.stops.findIndex((s) => s.stopId === activeStopId);
      if (fromIndex >= 0 && fromIndex < toIndex) toIndex -= 1;
    }
  }

  return plan.segments.map((seg) => {
    let stops = seg.stops.filter((s) => s.stopId !== activeStopId);
    if (seg.id === toSegmentId) {
      stops = [...stops];
      stops.splice(toIndex, 0, { stopId: activeStopId, position: toIndex });
    }
    return {
      segmentId: seg.id,
      stops: stops.map((s, i) => ({ stopId: s.stopId, position: i })),
    };
  });
}

export function applySegmentUpdates(plan: RoutePlan, updates: SegmentUpdate[]): RoutePlan {
  const updateMap = new Map(updates.map((u) => [u.segmentId, u.stops]));
  return {
    ...plan,
    segments: plan.segments.map((seg) => {
      const stops = updateMap.get(seg.id);
      return stops ? { ...seg, stops } : seg;
    }),
  };
}

export function segmentUpdatesFromPlan(plan: RoutePlan): SegmentUpdate[] {
  return plan.segments.map((seg) => ({
    segmentId: seg.id,
    stops: seg.stops.map((s, position) => ({ stopId: s.stopId, position })),
  }));
}
