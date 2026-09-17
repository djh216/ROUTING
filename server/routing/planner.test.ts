import { CUSTOMERS, ORDERS } from "../data/sample-data.js";
import { seedCustomerStoreForTests } from "../data/customer-store.js";
import { TERRITORY_CYCLES } from "../data/territories.js";
import {
  applySegmentStops,
  assignStopToTruck,
  buildRoutePlan,
  isOrderEligible,
  nearestNeighborOrder,
  optimizeStopOrder,
  reoptimizeSegments,
  setDriveMinuteOverride,
  setFirstStopTimeOverride,
  setWedThreshold,
} from "./planner.js";
import { SCRANTON_DEPOT } from "../../shared/constants.js";
import { AM_PM_TIME_PATTERN } from "../../shared/timeFormat.js";
import { createEstimatedTravelMatrix } from "./travel-time.js";

const REF = new Date("2026-09-10T12:00:00");

seedCustomerStoreForTests(CUSTOMERS, ORDERS);

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const phil1 = TERRITORY_CYCLES.find((c) => c.id === "philadelphia-1")!;
const thursdaySepa = TERRITORY_CYCLES.find((c) => c.id === "thursday-sepa")!;
const phil1Orders = ORDERS.filter((o) => isOrderEligible(o, phil1, REF));
const thursdaySepaOrders = ORDERS.filter((o) => isOrderEligible(o, thursdaySepa, REF));
assert(phil1Orders.length === 2, `Expected 2 philadelphia-1 orders, got ${phil1Orders.length}`);
assert(
  thursdaySepaOrders.length === 4,
  `Expected 4 Thursday SEPA orders, got ${thursdaySepaOrders.length}`
);
assert(thursdaySepa.name === "Thursday SEPA", "Route should be named Thursday SEPA");

const combined = TERRITORY_CYCLES.find((c) => c.id === "western-susquehanna-wed")!;
const combinedOrders = ORDERS.filter((o) => isOrderEligible(o, combined, REF));
assert(
  combinedOrders.length === 4,
  `Expected 4 combined Western/Southern orders, got ${combinedOrders.length}`
);
const { plan: combinedPlan } = await buildRoutePlan("western-susquehanna-wed", ORDERS, REF);
assert(
  combinedPlan.allStops.length === 4,
  `Expected 4 stops on combined route, got ${combinedPlan.allStops.length}`
);

const lehighNe = TERRITORY_CYCLES.find((c) => c.id === "lehigh-northeast-fri")!;
const lehighNeOrders = ORDERS.filter((o) => isOrderEligible(o, lehighNe, REF));
assert(
  lehighNeOrders.length === 4,
  `Expected 4 Lehigh/Northeast orders, got ${lehighNeOrders.length}`
);
const { plan: lehighNePlan } = await buildRoutePlan("lehigh-northeast-fri", ORDERS, REF);
assert(lehighNePlan.manualTruckAssignment === true, "Lehigh/Northeast should use manual trucks");
assert(
  lehighNePlan.segments.length >= 2 && lehighNePlan.segments.length <= 3,
  "Lehigh/Northeast should use 2–3 trucks"
);
const lehighAssigned = lehighNePlan.segments.reduce((n, s) => n + s.stops.length, 0);
assert(lehighAssigned === 4, "All Lehigh/Northeast stops should be assigned to trucks");
const lehighActiveTrucks = lehighNePlan.segments.filter((s) => s.stops.length > 0).length;
assert(
  lehighActiveTrucks >= 2,
  "Initial Lehigh/Northeast build should split across at least 2 trucks"
);
assert(
  lehighNePlan.segments.every((s) => s.validation.errors.length === 0),
  "Initial Lehigh/Northeast truck routes should meet delivery windows"
);
assert(
  lehighNePlan.allStops.length === 4,
  `Expected 4 stops on combined Lehigh/Northeast plan, got ${lehighNePlan.allStops.length}`
);

const lehighSeg0 = lehighNePlan.segments[0].id;
const lehighSeg1 = lehighNePlan.segments[1].id;
const lehighStopIds = lehighNePlan.allStops.map((s) => s.id);
const lehighMatrix = createEstimatedTravelMatrix(SCRANTON_DEPOT, lehighNePlan.allStops);
const manualLehigh = await applySegmentStops(
  lehighNePlan,
  [
    {
      segmentId: lehighSeg0,
      stops: lehighStopIds.slice(0, 2).map((stopId, i) => ({ stopId, position: i })),
    },
    {
      segmentId: lehighSeg1,
      stops: lehighStopIds.slice(2).map((stopId, i) => ({ stopId, position: i })),
    },
  ],
  lehighMatrix
);
const truck3StopId = manualLehigh.segments[0].stops[0]?.stopId;
if (truck3StopId) {
  const truck3Assigned = await assignStopToTruck(manualLehigh, truck3StopId, 3, lehighMatrix);
  assert(truck3Assigned.segments.length === 3, "Selecting truck 3 should add a third truck");
  assert(
    truck3Assigned.segments[2].stops.some((s) => s.stopId === truck3StopId),
    "Stop should move to truck 3"
  );
  assert(
    truck3Assigned.segments[0].stops.length === 1,
    "Truck 1 should lose the reassigned stop"
  );
}

const reoptimizedLehigh = await reoptimizeSegments(manualLehigh, undefined, lehighMatrix);
assert(
  reoptimizedLehigh.segments[0].stops.length === 2,
  "Truck 1 should keep 2 stops after re-optimize"
);
assert(
  reoptimizedLehigh.segments[1].stops.length === 2,
  "Truck 2 should keep 2 stops after re-optimize"
);
const truck1Before = new Set(manualLehigh.segments[0].stops.map((s) => s.stopId));
const truck1After = new Set(reoptimizedLehigh.segments[0].stops.map((s) => s.stopId));
assert(
  truck1Before.size === truck1After.size &&
    [...truck1Before].every((id) => truck1After.has(id)),
  "Re-optimize should not move stops between trucks"
);

const { plan: pittsburgh, matrix } = await buildRoutePlan("pittsburgh", ORDERS, REF);
assert(pittsburgh.allStops.length === 7, `Expected 7 Pittsburgh stops, got ${pittsburgh.allStops.length}`);
assert(pittsburgh.segments.length === 2, "Pittsburgh should have Wed + Thu segments");
const wedCount = pittsburgh.segments[0].stops.length;
const thuCount = pittsburgh.segments[1].stops.length;
assert(wedCount + thuCount === 7, "All Pittsburgh stops must be assigned");
assert(wedCount > 0 && thuCount >= 0, "Wednesday must have at least one primary stop");
assert(
  (pittsburgh.suggestedWedThreshold ?? 0) === wedCount,
  "Suggested Wed threshold should match initial split"
);
const wedFirst = pittsburgh.segments[0].stops[0]?.stopId;
if (wedFirst) {
  assert(
    pittsburgh.segments[0].validation.stopEtas[wedFirst] === "10:00 AM",
    "Wednesday first stop must be at 10:00 AM"
  );
}

const moved = await setWedThreshold(pittsburgh, 3, matrix);
assert(moved.segments[0].stops.length === 3, "Wed threshold should assign 3 stops");
assert(moved.segments[1].stops.length === 4, "Thu overflow should have remaining 4 stops");

const eta = moved.segments[0].validation.departureTime ?? "";
assert(AM_PM_TIME_PATTERN.test(eta), `Departure time should be AM/PM, got ${eta}`);
const firstStopId = moved.segments[0].stops[0]?.stopId;
if (firstStopId) {
  assert(
    moved.segments[0].validation.stopEtas[firstStopId] === "10:00 AM",
    "First stop of each day must be at 10:00 AM"
  );
}
const thuFirst = moved.segments[1].stops[0]?.stopId;
if (thuFirst) {
  assert(
    moved.segments[1].validation.stopEtas[thuFirst] === "10:00 AM",
    "Thursday first stop must be at 10:00 AM"
  );
}

console.log("All planner tests passed.");

const pittsburghStops = pittsburgh.allStops;
const pittsburghMatrix = createEstimatedTravelMatrix(SCRANTON_DEPOT, pittsburghStops);
const naive = nearestNeighborOrder(pittsburghStops, SCRANTON_DEPOT, pittsburghMatrix);
const optimized = optimizeStopOrder(
  pittsburghStops,
  SCRANTON_DEPOT.lat,
  SCRANTON_DEPOT.lng,
  SCRANTON_DEPOT,
  false,
  pittsburghMatrix
);

function pathVehicleMinutes(stops: typeof pittsburghStops, m: typeof pittsburghMatrix) {
  let t = pittsburghStops.length * 10; // SERVICE_MINUTES_PER_STOP
  let cur = { lat: SCRANTON_DEPOT.lat, lng: SCRANTON_DEPOT.lng };
  for (const s of stops) {
    t += m.getDurationMinutes(cur, { lat: s.lat, lng: s.lng });
    cur = { lat: s.lat, lng: s.lng };
  }
  return t;
}

assert(
  pathVehicleMinutes(optimized, pittsburghMatrix) <= pathVehicleMinutes(naive, pittsburghMatrix) + 0.1,
  "Optimized route should minimize vehicle time vs nearest-neighbor"
);

const driveMin = moved.segments[0].validation.stopDriveMinutes?.[firstStopId ?? ""];
assert(typeof driveMin === "number" && driveMin >= 0, "Stop drive minutes should be recorded");

const { plan: thursdaySepaPlan } = await buildRoutePlan("thursday-sepa", ORDERS, REF);
assert(thursdaySepaPlan.allStops.length === 4, "Expected 4 Thursday SEPA stops");
const thursdayFirst = thursdaySepaPlan.segments[0].stops[0]?.stopId;
assert(
  thursdayFirst === "stop-c20",
  `Thursday SEPA should start at King of Prussia (stop-c20), got ${thursdayFirst}`
);

const segId = thursdaySepaPlan.segments[0].id;
const secondStop = thursdaySepaPlan.segments[0].stops[1]?.stopId;
if (secondStop) {
  const etaBefore = thursdaySepaPlan.segments[0].validation.stopEtas[secondStop];
  const adjusted = await setDriveMinuteOverride(thursdaySepaPlan, segId, secondStop, 90, matrix);
  const etaAfter = adjusted.segments[0].validation.stopEtas[secondStop];
  assert(
    adjusted.driveMinuteOverrides?.[segId]?.[secondStop] === 90,
    "Drive override should be stored on plan"
  );
  assert(etaBefore !== etaAfter, "Manual drive time should shift downstream ETAs");
}

const laterStart = await setFirstStopTimeOverride(thursdaySepaPlan, segId, "11:00", matrix);
const firstEta = laterStart.segments[0].stops[0]?.stopId;
if (firstEta) {
  assert(
    laterStart.segments[0].validation.stopEtas[firstEta] === "11:00 AM",
    "First stop time override should set arrival ETA"
  );
}
