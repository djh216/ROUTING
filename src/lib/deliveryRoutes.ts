import { DAY_INDEX } from "@shared/constants";
import { nearestDeliveryRouteAmong } from "@shared/nearestDeliveryRoute";
import type { CustomerListItem, TerritoryCycle } from "@shared/types";

/** Monday-first order for sorting delivery days in the route picker. */
function deliveryDaySortKey(deliveryDay: string): number {
  const idx = DAY_INDEX[deliveryDay] ?? 9;
  return (idx + 6) % 7;
}

/** Every delivery route for the picker — one entry per cycle id, sorted by delivery day. */
export function routeOptionsForPicker(cycles: TerritoryCycle[]): TerritoryCycle[] {
  const byId = new Map<string, TerritoryCycle>();
  for (const cycle of cycles) byId.set(cycle.id, cycle);
  return [...byId.values()].sort((a, b) => {
    const dayDiff =
      deliveryDaySortKey(a.deliveryDay) - deliveryDaySortKey(b.deliveryDay);
    if (dayDiff !== 0) return dayDiff;
    return a.name.localeCompare(b.name);
  });
}

export function cycleIncludesTerritory(cycle: TerritoryCycle, territoryId: string): boolean {
  const ids = cycle.territoryIds ?? [cycle.territoryId];
  return ids.includes(territoryId);
}

/** Routes that can take every selected account on one delivery run. */
export function compatibleDeliveryRoutes(
  cycles: TerritoryCycle[],
  customers: Pick<CustomerListItem, "territoryId">[]
): TerritoryCycle[] {
  if (customers.length === 0) return [];
  let compatible = cycles.filter((cycle) =>
    cycleIncludesTerritory(cycle, customers[0]!.territoryId)
  );
  for (let i = 1; i < customers.length; i++) {
    const territoryId = customers[i]!.territoryId;
    compatible = compatible.filter((cycle) => cycleIncludesTerritory(cycle, territoryId));
  }
  return compatible.sort((a, b) => a.name.localeCompare(b.name));
}

export function defaultCycleForTerritory(
  cycles: TerritoryCycle[],
  territoryId: string,
  referenceDate: Date = new Date()
): number {
  const options = cycles.filter((c) => cycleIncludesTerritory(c, territoryId));
  const nearest = nearestDeliveryRouteAmong(options, referenceDate);
  return nearest?.cycle ?? 1;
}

export function defaultRouteAmong(
  cycles: TerritoryCycle[],
  referenceDate: Date = new Date()
): string | null {
  const nearest = nearestDeliveryRouteAmong(cycles, referenceDate);
  return nearest?.id ?? null;
}

export function defaultRouteForCustomer(
  cycles: TerritoryCycle[],
  customer: Pick<CustomerListItem, "territoryId" | "cycle" | "hasOrder">,
  referenceDate: Date = new Date()
): string | null {
  const options = compatibleDeliveryRoutes(cycles, [customer]);
  if (options.length === 0) return null;
  if (customer.hasOrder && customer.cycle != null) {
    const match = options.find((c) => c.cycle === customer.cycle);
    if (match) return match.id;
  }
  return defaultRouteAmong(options, referenceDate);
}
