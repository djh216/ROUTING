import type { TerritoryCycle } from "../../shared/types.js";

/** Customer-facing territory labels (CSV / order selection). */
export const TERRITORY_DISPLAY_NAMES: Record<string, string> = {
  philadelphia: "Philadelphia",
  "western-philly": "Western Philly Suburbs",
  "southern-susquehanna": "Southern Susquehanna Valley",
  pittsburgh: "Pittsburgh",
  "northern-philly": "Northern Philly Suburbs",
  "northeast-pa": "Northeast PA",
  "lehigh-valley": "Lehigh Valley",
  "northern-susquehanna": "Northern Susquehanna Valley",
};

export const THURSDAY_SEPA_CYCLE_ID = "thursday-sepa";

/** Territory schedules from Territories and Delivery.xlsx */
export const TERRITORY_CYCLES: TerritoryCycle[] = [
  {
    id: "philadelphia-1",
    territoryId: "philadelphia",
    name: "Philadelphia",
    cutoffDay: "tuesday",
    cutoffTime: "14:30",
    deliveryDay: "wednesday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
  {
    id: "western-susquehanna-wed",
    territoryId: "western-susquehanna-wed",
    territoryIds: ["western-philly", "southern-susquehanna"],
    name: "Western Philly & Southern Susquehanna",
    cutoffDay: "tuesday",
    cutoffTime: "14:30",
    deliveryDay: "wednesday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
  {
    id: "pittsburgh",
    territoryId: "pittsburgh",
    name: "Pittsburgh",
    cutoffDay: "tuesday",
    cutoffTime: "14:30",
    deliveryDay: "wednesday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: true,
    overflowDay: "thursday",
    noReturnBetweenDays: true,
  },
  {
    id: THURSDAY_SEPA_CYCLE_ID,
    territoryId: THURSDAY_SEPA_CYCLE_ID,
    territoryIds: ["philadelphia", "northern-philly"],
    name: "Thursday SEPA",
    cutoffDay: "wednesday",
    cutoffTime: "14:30",
    deliveryDay: "thursday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 2,
    multiDay: false,
  },
  {
    id: "lehigh-northeast-fri",
    territoryId: "lehigh-northeast-fri",
    territoryIds: ["lehigh-valley", "northeast-pa"],
    name: "Lehigh Valley & Northeast PA",
    cutoffDay: "thursday",
    cutoffTime: "14:30",
    deliveryDay: "friday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
    manualTruckAssignment: true,
    initialTruckCount: 2,
    manualTruckMin: 2,
    manualTruckMax: 3,
  },
  {
    id: "northern-susquehanna",
    territoryId: "northern-susquehanna",
    name: "Northern Susquehanna Valley",
    cutoffDay: "thursday",
    cutoffTime: "14:30",
    deliveryDay: "friday",
    deliveryStart: "10:00",
    deliveryEnd: "16:00",
    cycle: 1,
    multiDay: false,
  },
];

const TERRITORY_ALIASES: Record<string, string> = {
  "northeast pa": "northeast-pa",
  "lehigh valley": "lehigh-valley",
  philadelphia: "philadelphia",
  "northern philly suburbs": "northern-philly",
  "northern philadelphia suburbs": "northern-philly",
  "western philly suburbs": "western-philly",
  "western philadelphia suburbs": "western-philly",
  "southern susquehanna valley": "southern-susquehanna",
  "southern susquenhanna valley": "southern-susquehanna",
  "northern susquehanna valley": "northern-susquehanna",
  pittsburgh: "pittsburgh",
};

export function getTerritoryIdsForCycle(cycle: TerritoryCycle): string[] {
  return cycle.territoryIds ?? [cycle.territoryId];
}

export function cycleIncludesTerritory(
  cycle: TerritoryCycle,
  territoryId: string
): boolean {
  return getTerritoryIdsForCycle(cycle).includes(territoryId);
}

/** Resolve territory name or id from CSV/manual input */
export function resolveTerritoryInput(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (TERRITORY_ALIASES[key]) return TERRITORY_ALIASES[key];
  const slug = key.replace(/\s+/g, "-");
  if (TERRITORY_DISPLAY_NAMES[slug]) return slug;
  for (const [id, name] of Object.entries(TERRITORY_DISPLAY_NAMES)) {
    if (name.toLowerCase() === key) return id;
  }
  const byName = TERRITORY_CYCLES.find((t) => t.name.toLowerCase() === key);
  if (byName && byName.territoryIds?.length === 1) return byName.territoryIds[0];
  return null;
}

export function uniqueTerritories(): { territoryId: string; name: string }[] {
  return Object.entries(TERRITORY_DISPLAY_NAMES).map(([territoryId, name]) => ({
    territoryId,
    name,
  }));
}

export function getCycleById(id: string): TerritoryCycle | undefined {
  return TERRITORY_CYCLES.find((c) => c.id === id);
}

export function getCyclesForTerritory(territoryId: string): TerritoryCycle[] {
  return TERRITORY_CYCLES.filter((c) => cycleIncludesTerritory(c, territoryId));
}

export function getTerritoryDisplayName(territoryId: string): string {
  return TERRITORY_DISPLAY_NAMES[territoryId] ?? territoryId;
}

export function resolveCycleId(territoryId: string, cycleRaw?: string | number): string {
  if (territoryId === "northern-philly") {
    return THURSDAY_SEPA_CYCLE_ID;
  }

  const cycles = getCyclesForTerritory(territoryId).sort((a, b) => a.cycle - b.cycle);
  if (cycles.length === 0) throw new Error(`No cycles for territory ${territoryId}`);

  if (cycleRaw === undefined || cycleRaw === "") return cycles[0].id;

  const n = typeof cycleRaw === "number" ? cycleRaw : Number(cycleRaw);
  if (!Number.isNaN(n)) {
    if (territoryId === "philadelphia" && n === 2) {
      return THURSDAY_SEPA_CYCLE_ID;
    }
    const match = cycles.find((c) => c.cycle === n);
    if (match) return match.id;
  }

  const byId = cycles.find((c) => c.id === String(cycleRaw).trim());
  return byId?.id ?? cycles[0].id;
}

export function cycleNumberFromId(cycleId: string): number {
  return TERRITORY_CYCLES.find((c) => c.id === cycleId)?.cycle ?? 1;
}
