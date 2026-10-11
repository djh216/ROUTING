import {
  BASE_MULTI_DAY_SEGMENT_COUNT,
  BASE_TRUCK_SEGMENT_COUNT,
} from "./constants";
import type { RoutePlan, Segment } from "./types";

/** True when this column is an added truck/day with no stops and may be removed. */
export function canRemoveEmptySegment(
  plan: RoutePlan,
  segment: Segment,
  segmentIndex: number
): boolean {
  if (segment.stops.length > 0) return false;
  if (segment.segmentType === "day") {
    return segmentIndex >= BASE_MULTI_DAY_SEGMENT_COUNT;
  }
  if (segment.segmentType === "truck") {
    return segmentIndex >= BASE_TRUCK_SEGMENT_COUNT;
  }
  return false;
}
