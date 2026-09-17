import type { BatchSummary } from "@shared/types";

interface RouteTabsProps {
  batches: BatchSummary[];
  selectedCycleId: string | null;
  onSelect: (cycleId: string) => void;
}

export default function RouteTabs({ batches, selectedCycleId, onSelect }: RouteTabsProps) {
  if (batches.length === 0) return null;

  return (
    <nav className="route-tabs" aria-label="Delivery routes">
      <ul className="route-tabs__list">
        {batches.map((batch) => {
          const isActive = batch.cycleId === selectedCycleId;
          return (
            <li key={batch.cycleId}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`route-tabs__tab ${isActive ? "route-tabs__tab--active" : ""}`}
                onClick={() => onSelect(batch.cycleId)}
              >
                <span className="route-tabs__label">{batch.territoryName}</span>
                <span className="route-tabs__meta">
                  {batch.deliveryDate} · {batch.stopCount} stops
                  {batch.multiDay && " · Multi-day"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
