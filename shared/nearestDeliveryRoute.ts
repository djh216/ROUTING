import { DAY_INDEX } from "./constants.js";
import type { TerritoryCycle } from "./types.js";

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/** Calendar days until the next occurrence of this route's delivery day (0 = today). */
export function daysUntilDelivery(referenceDate: Date, cycle: TerritoryCycle): number {
  const refDay = referenceDate.getDay();
  const target = DAY_INDEX[cycle.deliveryDay];
  if (target === undefined) return 7;
  let delta = target - refDay;
  if (delta < 0) delta += 7;
  return delta;
}

export function nextDeliveryDate(referenceDate: Date, cycle: TerritoryCycle): Date {
  return addDays(referenceDate, daysUntilDelivery(referenceDate, cycle));
}

/** Among routes, pick the one whose delivery day is soonest (nearest to reference date). */
export function nearestDeliveryRouteAmong(
  cycles: TerritoryCycle[],
  referenceDate: Date = new Date()
): TerritoryCycle | null {
  if (cycles.length === 0) return null;
  let best = cycles[0]!;
  let bestDays = daysUntilDelivery(referenceDate, best);
  for (let i = 1; i < cycles.length; i++) {
    const cycle = cycles[i]!;
    const days = daysUntilDelivery(referenceDate, cycle);
    if (days < bestDays || (days === bestDays && cycle.cycle < best.cycle)) {
      best = cycle;
      bestDays = days;
    }
  }
  return best;
}
