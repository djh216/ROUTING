import { CUSTOMERS, ORDERS } from "../data/sample-data.js";
import { seedCustomerStoreForTests } from "../data/customer-store.js";
import { TERRITORY_CYCLES } from "../data/territories.js";
import {
  appendDaySegment,
  appendStopToSegment,
  applySegmentStops,
  assignStopToDay,
  assignStopToTruck,
  buildRoutePlan,
  flipSegmentStops,
  isOrderEligible,
  nearestNeighborOrder,
  optimizeStopOrder,
  reoptimizeSegments,
  setDriveMinuteOverride,
  setFirstStopTimeOverride,
  setWedThreshold,
  swapSegmentRoutes,
} from "./planner.js";
import { NEW_DAY_SEGMENT_ID, SCRANTON_DEPOT } from "../../shared/constants.js";
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

// Test flipping route and comparing time difference between manual and optimized route
const originalStops = thursdaySepaPlan.segments[0].stops;
const originalFirstId = originalStops[0].stopId;
const originalLastId = originalStops[originalStops.length - 1].stopId;
const sepaMatrix = createEstimatedTravelMatrix(SCRANTON_DEPOT, thursdaySepaPlan.allStops);

const flippedSepa = await flipSegmentStops(thursdaySepaPlan, segId, sepaMatrix);
assert(
  flippedSepa.segments[0].stops[0].stopId === originalLastId,
  "Flipped route first stop should match original last stop"
);
assert(
  flippedSepa.segments[0].stops[flippedSepa.segments[0].stops.length - 1].stopId === originalFirstId,
  "Flipped route last stop should match original first stop"
);
assert(
  flippedSepa.hasManualOrder === true,
  "Flipped route should be flagged as having manual order"
);
assert(
  typeof flippedSepa.segments[0].validation.timeDiffMinutes === "number",
  "Segment should calculate time difference in minutes vs optimized"
);
assert(
  typeof flippedSepa.timeDiffMinutes === "number",
  "Plan should calculate overall time difference in minutes vs optimized"
);

// Re-optimize should restore the optimal route
const restoredSepa = await reoptimizeSegments(flippedSepa, [segId], sepaMatrix);
assert(
  restoredSepa.segments[0].validation.isOptimizedOrder === true,
  "Re-optimized route should have isOptimizedOrder = true"
);
assert(
  restoredSepa.segments[0].validation.timeDiffMinutes === 0,
  "Re-optimized route should have timeDiffMinutes = 0"
);
assert(
  restoredSepa.hasManualOrder === false,
  "Re-optimized plan should have hasManualOrder = false"
);
console.log("All route flip and time difference tests passed.");

// Multi-day route switching tests (Pittsburgh Wed ↔ Thu)
const { plan: pittsburghPlan, matrix: pittsburghRunMatrix } = await buildRoutePlan("pittsburgh", ORDERS, REF);
assert(pittsburghPlan.segments.length === 2, "Pittsburgh should have 2 segments (Wednesday & Thursday)");
const wedSegId = pittsburghPlan.segments[0].id;
const thuSegId = pittsburghPlan.segments[1].id;
const origWedStops = pittsburghPlan.segments[0].stops.map((s) => s.stopId);
const origThuStops = pittsburghPlan.segments[1].stops.map((s) => s.stopId);

const swappedPittsburgh = await swapSegmentRoutes(
  pittsburghPlan,
  wedSegId,
  thuSegId,
  pittsburghRunMatrix
);
assert(
  swappedPittsburgh.segments[0].stops.map((s) => s.stopId).join(",") === origThuStops.join(","),
  "Wednesday should now contain Thursday's stops"
);
assert(
  swappedPittsburgh.segments[1].stops.map((s) => s.stopId).join(",") === origWedStops.join(","),
  "Thursday should now contain Wednesday's stops"
);
assert(
  typeof swappedPittsburgh.segments[0].validation.timeDiffMinutes === "number",
  "Swapped day segment should calculate timeDiffMinutes"
);
assert(
  typeof swappedPittsburgh.timeDiffMinutes === "number",
  "Swapped multi-day plan should calculate overall timeDiffMinutes"
);

// Swapping again should return back to original assignment
const revertedPittsburgh = await swapSegmentRoutes(
  swappedPittsburgh,
  wedSegId,
  thuSegId,
  pittsburghRunMatrix
);
assert(
  revertedPittsburgh.segments[0].stops.map((s) => s.stopId).join(",") === origWedStops.join(","),
  "Re-swapping should restore original Wednesday stops"
);
assert(
  revertedPittsburgh.segments[1].stops.map((s) => s.stopId).join(",") === origThuStops.join(","),
  "Re-swapping should restore original Thursday stops"
);
console.log("All multi-day route switching tests passed.");

// Multi-day account stop day selection tests (switch which day a stop is on)
const stopToMove = pittsburghPlan.segments[0].stops[0].stopId;
const wedStopsBefore = pittsburghPlan.segments[0].stops.length;
const thuStopsBefore = pittsburghPlan.segments[1].stops.length;

const movedToThu = await assignStopToDay(
  pittsburghPlan,
  stopToMove,
  thuSegId,
  pittsburghRunMatrix
);

assert(
  movedToThu.segments[0].stops.length === wedStopsBefore - 1,
  "Wednesday should have one fewer stop after reassignment"
);
assert(
  movedToThu.segments[1].stops.length === thuStopsBefore + 1,
  "Thursday should have one more stop after reassignment"
);
assert(
  !movedToThu.segments[0].stops.some((s) => s.stopId === stopToMove),
  "Moved stop should no longer be on Wednesday"
);
assert(
  movedToThu.segments[1].stops.some((s) => s.stopId === stopToMove),
  "Moved stop should now be on Thursday"
);
assert(
  movedToThu.segments[1].stops[movedToThu.segments[1].stops.length - 1].stopId === stopToMove,
  "Moved stop should be appended to the target day"
);

// Moving the stop back to Wednesday
const movedBackToWed = await assignStopToDay(
  movedToThu,
  stopToMove,
  wedSegId,
  pittsburghRunMatrix
);
assert(
  movedBackToWed.segments[0].stops.length === wedStopsBefore,
  "Wednesday stop count should be restored"
);
assert(
  movedBackToWed.segments[1].stops.length === thuStopsBefore,
  "Thursday stop count should be restored"
);
assert(
  movedBackToWed.segments[0].stops.some((s) => s.stopId === stopToMove),
  "Stop should be back on Wednesday"
);
console.log("All multi-day stop day selection tests passed.");

const withFriday = await appendDaySegment(pittsburghPlan, pittsburghRunMatrix);
assert(withFriday.segments.length === 3, "Adding a day should create Friday");
assert(withFriday.segments[2].label === "Friday (overflow)", "Third day should be labeled Friday");
assert(withFriday.segments[0].label === "Wednesday (primary)", "Wednesday label should stay");
assert(withFriday.segments[1].label === "Thursday (overflow)", "Thursday label should stay");
assert(withFriday.segments[1].endLocation === "overnight", "Thursday should stay out overnight once Friday exists");
assert(withFriday.segments[2].startLocation === "overnight", "Friday should start from the previous day's last stop");
assert(withFriday.segments[2].endLocation === "Scranton", "Friday should return to Scranton");
assert(withFriday.segments[2].stops.length === 0, "A manually added Friday starts empty");
assert(
  withFriday.segments[0].stops.length === pittsburghPlan.segments[0].stops.length,
  "Adding Friday should not move Wednesday stops"
);

const stillThree = await appendDaySegment(withFriday, pittsburghRunMatrix);
assert(stillThree.segments.length === 3, "Pittsburgh should not grow past three days");

const fridayStopId = withFriday.segments[0].stops[0].stopId;
const assignedFriday = await assignStopToDay(
  withFriday,
  fridayStopId,
  withFriday.segments[2].id,
  pittsburghRunMatrix
);
assert(
  assignedFriday.segments[2].stops.some((s) => s.stopId === fridayStopId),
  "Stop can be assigned to Friday"
);
assert(
  !assignedFriday.segments[0].stops.some((s) => s.stopId === fridayStopId),
  "Assigned stop should leave Wednesday"
);
const fridayFirst = assignedFriday.segments[2].stops[0]?.stopId;
if (fridayFirst) {
  assert(
    assignedFriday.segments[2].validation.stopEtas[fridayFirst] === "10:00 AM",
    "Friday first stop must be at 10:00 AM"
  );
}

const wedBeforeSwap = assignedFriday.segments[0].stops.map((s) => s.stopId);
const friBeforeSwap = assignedFriday.segments[2].stops.map((s) => s.stopId);
const swappedWithFriday = await swapSegmentRoutes(
  assignedFriday,
  assignedFriday.segments[0].id,
  assignedFriday.segments[2].id,
  pittsburghRunMatrix
);
assert(
  swappedWithFriday.segments[0].stops.map((s) => s.stopId).join(",") === friBeforeSwap.join(","),
  "Wednesday should receive Friday's stops when those days are switched"
);
assert(
  swappedWithFriday.segments[2].stops.map((s) => s.stopId).join(",") === wedBeforeSwap.join(","),
  "Friday should receive Wednesday's stops when those days are switched"
);
assert(swappedWithFriday.segments[2].label === "Friday (overflow)", "Swap should keep the Friday column");

const stopForNewDay =
  pittsburghPlan.segments[1].stops[0]?.stopId ?? pittsburghPlan.segments[0].stops[0].stopId;
const createdByAssign = await assignStopToDay(
  pittsburghPlan,
  stopForNewDay,
  NEW_DAY_SEGMENT_ID,
  pittsburghRunMatrix
);
assert(createdByAssign.segments.length === 3, "Choosing day 3 should add Friday");
assert(
  createdByAssign.segments[2].stops.some((s) => s.stopId === stopForNewDay),
  "Day 3 assignment should place the stop on Friday"
);

const fridayKeptId = createdByAssign.segments[2].stops[0].stopId;
const wedCountBefore = createdByAssign.segments[0].stops.length;
const afterThreshold = await setWedThreshold(
  createdByAssign,
  Math.max(0, wedCountBefore - 1),
  pittsburghRunMatrix
);
assert(afterThreshold.segments.length === 3, "Wed threshold should keep Friday");
assert(
  afterThreshold.segments[2].stops.some((s) => s.stopId === fridayKeptId),
  "Lowering the Wednesday threshold should leave Friday stops on Friday"
);
assert(
  afterThreshold.segments.flatMap((s) => s.stops).length === createdByAssign.allStops.length,
  "Threshold changes should not duplicate or drop stops"
);

const farCustomers = [0, 1].map((i) => ({
  id: `far${i}`,
  name: `Honolulu Stop ${i + 1}`,
  address: `${i + 1} Kalakaua Ave`,
  city: "Honolulu",
  territoryId: "pittsburgh",
  lat: 21.3,
  lng: -157.8 - i * 0.05,
  contactName: "Alex",
  contactPhone: "808-555-0100",
  deliveryInstructions: "",
}));
const farOrders = farCustomers.map((customer, i) => ({
  id: `ofar${i}`,
  customerId: customer.id,
  territoryId: "pittsburgh",
  cycleId: "pittsburgh",
  cases: 6,
  approvedAt: "2026-09-08T11:00:00",
  status: "approved" as const,
}));
seedCustomerStoreForTests([...CUSTOMERS, ...farCustomers], [...ORDERS, ...farOrders]);
const { plan: longPittsburgh } = await buildRoutePlan(
  "pittsburgh",
  [...ORDERS, ...farOrders],
  REF
);
assert(
  longPittsburgh.segments.length === 3,
  `Planner should add Friday when Thursday cannot finish the run, got ${longPittsburgh.segments.length} days`
);
assert(longPittsburgh.segments[2].label === "Friday (overflow)", "Auto-added day should be Friday");
assert(longPittsburgh.segments[1].endLocation === "overnight", "Thursday should not return when Friday is used");
assert(longPittsburgh.segments[2].endLocation === "Scranton", "Friday should be the day that returns to Scranton");
assert(
  longPittsburgh.segments[2].stops.length > 0,
  "Friday should receive the stops Thursday cannot cover"
);
console.log("All Pittsburgh third-day tests passed.");

const vetriCustomer = {
  id: "vetri",
  name: "Vetri",
  address: "1312 Spruce St",
  city: "Philadelphia",
  territoryId: "philadelphia",
  lat: 39.9,
  lng: -75.17,
  contactName: "Bobby",
  contactPhone: "215-555-0199",
  deliveryInstructions: "",
};
const pizzeriaVetri = {
  id: "pizzeria-vetri",
  name: "Pizzeria Vetri - Art Museum",
  address: "1939 Callowhill Street",
  city: "Philadelphia",
  territoryId: "philadelphia",
  lat: 39.96,
  lng: -75.17,
  contactName: "Giuseppe",
  contactPhone: "215-555-0188",
  deliveryInstructions: "",
};
const vetriOrder = {
  id: "ovetri",
  customerId: "vetri",
  territoryId: "philadelphia",
  cycleId: "philadelphia-1",
  cases: 4,
  approvedAt: "2026-09-08T12:00:00",
  status: "approved" as const,
};
const pizzeriaOrder = {
  id: "opizzeria",
  customerId: "pizzeria-vetri",
  territoryId: "philadelphia",
  cycleId: "philadelphia-1",
  cases: 4,
  approvedAt: "2026-09-08T12:00:00",
  status: "approved" as const,
};
seedCustomerStoreForTests(
  [...CUSTOMERS, vetriCustomer, pizzeriaVetri],
  [...ORDERS, vetriOrder, pizzeriaOrder]
);
const { plan: philWithVetri, matrix: philMatrix } = await buildRoutePlan(
  "philadelphia-1",
  [...ORDERS, vetriOrder, pizzeriaOrder],
  REF
);
assert(
  philWithVetri.segments[0].stops[0]?.stopId !== "stop-pizzeria-vetri",
  "Pizzeria Vetri should not take the Vetri first-stop slot"
);
assert(
  philWithVetri.segments[0].stops[0]?.stopId === "stop-vetri",
  `Vetri should be the first stop, got ${philWithVetri.segments[0].stops[0]?.stopId}`
);
assert(
  philWithVetri.segments[0].validation.stopEtas["stop-vetri"] === "9:30 AM",
  `Vetri should arrive at 9:30 AM, got ${philWithVetri.segments[0].validation.stopEtas["stop-vetri"]}`
);
assert(
  !philWithVetri.segments[0].validation.warnings.some((w) => w.includes("before the default")),
  "Vetri's 9:30 arrival should not warn about the 10:00 window"
);
const philSegId = philWithVetri.segments[0].id;
const laterVetri = await setFirstStopTimeOverride(philWithVetri, philSegId, "10:15", philMatrix);
assert(
  laterVetri.segments[0].validation.stopEtas["stop-vetri"] === "10:15 AM",
  "A manual first-stop time should override Vetri's 9:30 default"
);
const resetVetri = await setFirstStopTimeOverride(laterVetri, philSegId, null, philMatrix);
assert(
  resetVetri.segments[0].validation.stopEtas["stop-vetri"] === "9:30 AM",
  "Clearing the first-stop time should return Vetri to 9:30 AM"
);
const movedOffFront = await applySegmentStops(
  resetVetri,
  [
    {
      segmentId: philSegId,
      stops: [...resetVetri.segments[0].stops.slice(1), resetVetri.segments[0].stops[0]],
    },
  ],
  philMatrix
);
assert(
  movedOffFront.segments[0].stops[0]?.stopId !== "stop-vetri",
  "Dragging Vetri off the front should be allowed"
);
const restoredVetri = await reoptimizeSegments(movedOffFront, [philSegId], philMatrix);
assert(
  restoredVetri.segments[0].stops[0]?.stopId === "stop-vetri",
  "Re-optimize should put Vetri back first"
);
assert(
  restoredVetri.segments[0].validation.stopEtas["stop-vetri"] === "9:30 AM",
  "Re-optimized Vetri should arrive at 9:30 AM"
);
console.log("All Vetri first-stop tests passed.");

const extraStop = {
  id: "stop-extra-pittsburgh",
  customerId: "extra-pittsburgh",
  customerName: "Extra Pittsburgh Stop",
  address: "1 Penn Ave",
  city: "Pittsburgh",
  territoryId: "pittsburgh",
  cycleId: "pittsburgh",
  cases: 3,
  lat: 40.44,
  lng: -79.99,
  orderIds: ["ox"],
  contactName: "Alex",
  contactPhone: "412-555-0199",
  deliveryInstructions: "",
};
const wedOrder = pittsburgh.segments[0].stops.map((s) => s.stopId).join(",");
const thuOrder = pittsburgh.segments[1].stops.map((s) => s.stopId).join(",");
const extraMatrix = createEstimatedTravelMatrix(SCRANTON_DEPOT, [
  ...pittsburgh.allStops,
  extraStop,
]);
const { plan: withExtra } = await appendStopToSegment(
  pittsburgh,
  extraStop,
  pittsburgh.segments[1].id,
  extraMatrix
);
assert(
  withExtra.segments[0].stops.map((s) => s.stopId).join(",") === wedOrder,
  "Adding a stop to Thursday should leave Wednesday's order unchanged"
);
const expectedThu = thuOrder ? `${thuOrder},${extraStop.id}` : extraStop.id;
assert(
  withExtra.segments[1].stops.map((s) => s.stopId).join(",") === expectedThu,
  "The new stop should be appended to Thursday without reordering that day"
);
assert(
  Boolean(withExtra.segments[1].validation.stopEtas[extraStop.id]),
  "The appended stop should receive an ETA"
);
console.log("All append-stop tests passed.");

