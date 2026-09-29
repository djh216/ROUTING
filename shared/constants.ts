import type { Depot } from "./types.js";

export const SCRANTON_DEPOT: Depot = {
  name: "Scranton Warehouse",
  address: "310 Genet Street",
  city: "Scranton, PA",
  lat: 41.3905733,
  lng: -75.6788742,
};

export const DELIVERY_WINDOW = { start: "10:00", end: "16:00" };
export const SERVICE_MINUTES_PER_STOP = 10;
export const DRIVER_BREAK_MINUTES = 30;

/** Stop index (0-based) after which a mid-route driver break is inserted. */
export function driverBreakAfterStopIndex(stopCount: number): number {
  if (stopCount <= 0) return -1;
  return Math.floor((stopCount - 1) / 2);
}
export const AVERAGE_MPH = 45;
/** Planning buffer on calculated drive times (base + traffic). */
export const DRIVE_TIME_BUFFER_MULTIPLIER = 1.15;
export const DEFAULT_TRUCK_CAPACITY = 120;
export const MIN_ORDER_CASES = 3;
export const MAX_DRIVER_HOURS = 12;
export const PITTSBURGH_HAUL_MILES = 280;
/** Pittsburgh multi-day runs: Wednesday, Thursday, and an optional Friday. */
export const PITTSBURGH_MAX_DAYS = 3;
/** assign-day target that creates the next Pittsburgh day and moves the stop onto it. */
export const NEW_DAY_SEGMENT_ID = "new-day";

export const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
