import type { Stop } from "../../shared/types.js";

import { THURSDAY_SEPA_CYCLE_ID } from "../data/territories.js";

/** Normalize city for King of Prussia matching (handles "King Of Prussia", etc.) */
export function isKingOfPrussiaCity(city: string): boolean {
  return city.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ") === "king of prussia";
}

export function isKingOfPrussiaStop(stop: Stop): boolean {
  return isKingOfPrussiaCity(stop.city);
}

/** Stop ordering rules for initial route builds (not manual drag-and-drop overrides). */
export function getStopPriorityFilter(cycleId: string): ((stop: Stop) => boolean) | undefined {
  if (cycleId === THURSDAY_SEPA_CYCLE_ID) {
    return isKingOfPrussiaStop;
  }
  return undefined;
}
