import {
  getCyclesForTerritory,
  LEHIGH_NORTHEAST_FRI_CYCLE_ID,
  LEHIGH_NORTHEAST_TUE_CYCLE_ID,
  resolveCycleId,
  TERRITORY_CYCLES,
} from "./territories.js";
import { isOrderEligible } from "../routing/scheduling.js";

const lehighRouteNames = TERRITORY_CYCLES.filter((c) =>
  (c.territoryIds ?? [c.territoryId]).includes("lehigh-valley")
).map((c) => c.name);
if (!lehighRouteNames.includes("NEPA (Tuesday)")) {
  throw new Error("Tuesday NEPA route missing from delivery cycles");
}
if (!lehighRouteNames.includes("NEPA (Friday)")) {
  throw new Error("Friday NEPA route missing from delivery cycles");
}

const lehighCycles = getCyclesForTerritory("lehigh-valley");
if (lehighCycles.length !== 2) {
  throw new Error(`Expected 2 Lehigh routes, got ${lehighCycles.length}`);
}
const northernCycles = getCyclesForTerritory("northern-susquehanna");
if (northernCycles.length !== 1 || northernCycles[0]!.id !== LEHIGH_NORTHEAST_FRI_CYCLE_ID) {
  throw new Error("Northern Susquehanna should only belong to NEPA (Friday)");
}
if (!lehighCycles.some((c) => c.id === LEHIGH_NORTHEAST_TUE_CYCLE_ID)) {
  throw new Error("Missing Tuesday Lehigh/Northeast route");
}
if (!lehighCycles.some((c) => c.id === LEHIGH_NORTHEAST_FRI_CYCLE_ID)) {
  throw new Error("Missing Friday Lehigh/Northeast route");
}

if (resolveCycleId("northeast-pa", 1) !== LEHIGH_NORTHEAST_TUE_CYCLE_ID) {
  throw new Error("Northeast PA cycle 1 should be Tuesday route");
}
if (resolveCycleId("lehigh-valley", 2) !== LEHIGH_NORTHEAST_FRI_CYCLE_ID) {
  throw new Error("Lehigh Valley cycle 2 should be Friday route");
}

const sunday = new Date("2026-10-11T12:00:00");
if (resolveCycleId("lehigh-valley", undefined, sunday) !== LEHIGH_NORTHEAST_TUE_CYCLE_ID) {
  throw new Error("Lehigh default on Sunday should be Tuesday route");
}
if (resolveCycleId("philadelphia", undefined, sunday) !== "philadelphia-1") {
  throw new Error("Philadelphia default on Sunday should be Wednesday route");
}

const westernPhillyRoutes = getCyclesForTerritory("western-philly").map((c) => c.id);
if (!westernPhillyRoutes.includes("philadelphia-1")) {
  throw new Error("Western Philly should be eligible for Philadelphia (Wednesday) route");
}
if (!westernPhillyRoutes.includes("western-susquehanna-wed")) {
  throw new Error("Western Philly should remain on Western Philly & Southern Susquehanna route");
}

const ref = new Date("2026-09-10T12:00:00");
if (resolveCycleId("western-philly", 1, ref) !== "western-susquehanna-wed") {
  throw new Error("Western Philly cycle 1 should default to Western Philly & Southern Susquehanna");
}
if (resolveCycleId("western-philly", undefined, ref) !== "western-susquehanna-wed") {
  throw new Error("Western Philly default route should be Western Philly & Southern Susquehanna");
}

const philCycle = TERRITORY_CYCLES.find((c) => c.id === "philadelphia-1")!;
const westernOrder = {
  id: "o-test",
  customerId: "c-test",
  territoryId: "western-philly",
  cycleId: "philadelphia-1",
  cases: 6,
  approvedAt: "2026-09-08T13:00:00",
  status: "approved" as const,
};
if (!isOrderEligible(westernOrder, philCycle, ref)) {
  throw new Error("Western Philly order on Philadelphia (Wednesday) should be eligible");
}

console.log("Territory cycle tests passed.");
