import { DAY_INDEX } from "../../shared/constants.js";
import type { Order, TerritoryCycle } from "../../shared/types.js";
import {
  cycleIncludesTerritory,
  getCyclesForTerritory,
  TERRITORY_CYCLES,
} from "../data/territories.js";

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export function deliveryDateForCycle(
  referenceDate: Date,
  cycle: TerritoryCycle
): string {
  const refDay = referenceDate.getDay();
  const target = DAY_INDEX[cycle.deliveryDay];
  let delta = target - refDay;
  if (delta <= 0) delta += 7;
  return addDays(referenceDate, delta).toISOString().slice(0, 10);
}

export function cutoffDateTime(referenceDate: Date, cycle: TerritoryCycle): Date {
  const refDay = referenceDate.getDay();
  const cutoffDay = DAY_INDEX[cycle.cutoffDay];
  let delta = cutoffDay - refDay;
  if (delta > 0) delta -= 7;
  const cutoff = addDays(referenceDate, delta);
  const [h, m] = cycle.cutoffTime.split(":").map(Number);
  cutoff.setHours(h, m, 0, 0);
  return cutoff;
}

export function isOrderEligible(
  order: Order,
  cycle: TerritoryCycle,
  referenceDate: Date
): boolean {
  if (order.cycleId !== cycle.id) return false;
  if (!cycleIncludesTerritory(cycle, order.territoryId)) return false;
  if (order.status === "delivered") return false;

  const approved = new Date(order.approvedAt);
  const cutoff = cutoffDateTime(referenceDate, cycle);
  if (approved > cutoff) return false;

  for (const prev of getCyclesForTerritory(order.territoryId)) {
    if (prev.id === cycle.id) continue;
    if (prev.cycle >= cycle.cycle) continue;
    const prevCutoff = cutoffDateTime(referenceDate, prev);
    if (approved <= prevCutoff) return false;
  }

  return true;
}

export function defaultApprovedAt(cycleId: string, referenceDate: Date): string {
  const cycle = TERRITORY_CYCLES.find((c) => c.id === cycleId);
  if (!cycle) return referenceDate.toISOString();
  const cutoff = cutoffDateTime(referenceDate, cycle);
  cutoff.setMinutes(cutoff.getMinutes() - 30);
  return cutoff.toISOString();
}
