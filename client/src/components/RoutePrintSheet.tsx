import { Fragment } from "react";
import { DRIVER_BREAK_MINUTES } from "@shared/constants";
import type { BatchSummary, RoutePlan, Stop } from "@shared/types";
import { formatDateTime } from "@shared/timeFormat";
import ContactDisplay from "./ContactDisplay";

interface RoutePrintSheetProps {
  plan: RoutePlan;
  batch: BatchSummary;
}

export default function RoutePrintSheet({ plan, batch }: RoutePrintSheetProps) {
  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  const printedAt = formatDateTime(new Date());

  return (
    <div className="route-print-sheet" aria-hidden="true">
      {plan.segments.map((segment) => {
        const stops = segment.stops
          .map((a) => stopMap.get(a.stopId))
          .filter((s): s is Stop => !!s);
        const v = segment.validation;
        const breakAfterStopId =
          v.driverBreakAfterStopId ?? plan.driverBreakAfterStop?.[segment.id];
        const breakAfterStop = breakAfterStopId
          ? stops.find((s) => s.id === breakAfterStopId)
          : undefined;

        return (
          <section
            key={segment.id}
            className="route-print-segment"
            data-segment-id={segment.id}
          >
            <header className="route-print-sheet__header">
              <h1>
                {plan.territoryName} — {segment.label}
              </h1>
              <p className="route-print-sheet__meta">
                Delivery {segment.deliveryDate} · Batch {plan.batchId} · {v.stopCount} stop
                {v.stopCount !== 1 ? "s" : ""}
              </p>
              <p className="route-print-sheet__meta">
                Depot: {plan.depot.address}, {plan.depot.city} · Cutoff{" "}
                {formatDateTime(batch.cutoffAt)}
                {segment.endLocation === "overnight"
                  ? " · Overnight route"
                  : segment.startLocation === "overnight"
                    ? " · Continues from overnight"
                    : " · Same-day return to Scranton"}
              </p>
              <p className="route-print-sheet__meta route-print-sheet__locked">
                {plan.status === "locked" ? "LOCKED ROUTE · " : ""}Printed {printedAt}
              </p>
            </header>

            <div className="route-print-segment__head">
              <p>
                {v.departureTime ? `Depart ${v.departureTime}` : ""}
                {v.completionTime && v.stopCount > 0 ? ` · Done by ${v.completionTime}` : ""}
                {v.stopCount > 0 && (
                  <>
                    {" · "}
                    {v.totalMiles} mi
                    {v.driverBreakMinutes
                      ? ` · ${v.driverBreakMinutes} min driver break`
                      : ""}
                  </>
                )}
              </p>
              {breakAfterStop && (
                <p className="route-print-segment__break">
                  Driver break ({DRIVER_BREAK_MINUTES} min) after {breakAfterStop.customerName}
                </p>
              )}
              {segment.startLocation === "overnight" && (
                <p className="route-print-segment__note">Starts overnight (no warehouse return)</p>
              )}
              {segment.endLocation === "overnight" && (
                <p className="route-print-segment__note">Ends overnight near territory</p>
              )}
            </div>

            {stops.length === 0 ? (
              <p className="route-print-segment__empty">No stops</p>
            ) : (
              <table className="route-print-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Restaurant</th>
                    <th>Address</th>
                    <th>Contact</th>
                    <th>ETA</th>
                    <th>Delivery instructions</th>
                  </tr>
                </thead>
                <tbody>
                  {stops.map((stop, idx) => (
                    <Fragment key={stop.id}>
                      <tr className="route-print-stop">
                        <td>{idx + 1}</td>
                        <td>{stop.customerName}</td>
                        <td className="route-print-table__address">
                          {stop.address}, {stop.city}
                        </td>
                        <td>
                          <ContactDisplay
                            contactName={stop.contactName}
                            contactPhone={stop.contactPhone}
                          />
                        </td>
                        <td className="route-print-table__eta">{v.stopEtas[stop.id] ?? "—"}</td>
                        <td className="route-print-table__instructions">
                          {stop.deliveryInstructions || "—"}
                        </td>
                      </tr>
                      {breakAfterStopId === stop.id && (
                        <tr className="route-print-break">
                          <td>—</td>
                          <td colSpan={5}>{DRIVER_BREAK_MINUTES} min driver break</td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
