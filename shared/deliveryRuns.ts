/** Territories with two delivery runs — cycle 1 vs 2 maps to route cycles in territories.ts */
export const TERRITORY_DELIVERY_RUNS: Record<
  string,
  { cycle: number; label: string }[]
> = {
  philadelphia: [
    { cycle: 1, label: "Wednesday" },
    { cycle: 2, label: "Thursday" },
  ],
  "lehigh-valley": [
    { cycle: 1, label: "Tuesday" },
    { cycle: 2, label: "Friday" },
  ],
  "northeast-pa": [
    { cycle: 1, label: "Tuesday" },
    { cycle: 2, label: "Friday" },
  ],
};

export function territoryHasDeliveryRunChoice(territoryId: string): boolean {
  return territoryId in TERRITORY_DELIVERY_RUNS;
}

export function deliveryRunLabel(territoryId: string, cycle?: number): string | null {
  const options = TERRITORY_DELIVERY_RUNS[territoryId];
  if (!options) return null;
  const n = cycle ?? 1;
  return options.find((o) => o.cycle === n)?.label ?? options[0]?.label ?? null;
}
