import { useEffect, useState, Fragment } from "react";
import type { RoutePlan, Segment, Stop } from "@shared/types";
import { DRIVER_BREAK_MINUTES } from "@shared/constants";
import { formatDateTime, formatDurationMinutes } from "@shared/timeFormat";
import { generateRoutePdf } from "../lib/generateRoutePdf";
import { generatePrintableHtml } from "../lib/printableHtml";
import ContactDisplay from "./ContactDisplay";

interface RoutePrintModalProps {
  plan: RoutePlan;
  segment: Segment;
  stops: Stop[];
  onClose: () => void;
}

export default function RoutePrintModal({
  plan,
  segment,
  stops,
  onClose,
}: RoutePrintModalProps) {
  const [downloaded, setDownloaded] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [printHtmlUrl, setPrintHtmlUrl] = useState<string | null>(null);
  const [printNotice, setPrintNotice] = useState<string | null>(null);

  const v = segment.validation;
  const breakAfterStopId =
    v.driverBreakAfterStopId ?? plan.driverBreakAfterStop?.[segment.id];
  const breakAfterStop = breakAfterStopId
    ? stops.find((s) => s.id === breakAfterStopId)
    : undefined;

  useEffect(() => {
    // 1. Generate standalone printable HTML blob
    try {
      const html = generatePrintableHtml(plan, segment, stops);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      setPrintHtmlUrl(url);
    } catch (e) {
      console.error("Failed to generate printable HTML:", e);
    }

    // 2. Generate PDF blob on mount
    try {
      const res = generateRoutePdf(plan, segment, stops, { autoDownload: true });
      setPdfBlobUrl(res.blobUrl);
      setDownloaded(true);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
    }
  }, [plan, segment, stops]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (printHtmlUrl) URL.revokeObjectURL(printHtmlUrl);
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [printHtmlUrl, pdfBlobUrl]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleDownload = () => {
    generateRoutePdf(plan, segment, stops, { autoDownload: true });
    setDownloaded(true);
  };

  const handlePrint = () => {
    // Generate fresh HTML and open print tab
    try {
      const html = generatePrintableHtml(plan, segment, stops);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      setPrintHtmlUrl(url);

      const printWin = window.open(url, "_blank");
      if (printWin) {
        setPrintNotice("print-opened");
      } else {
        // Fallback if window.open was blocked
        setPrintNotice("popup-blocked");
      }
    } catch (err) {
      console.error("Error initiating print:", err);
      setPrintNotice("popup-blocked");
    }
  };

  return (
    <div className="route-print-modal-overlay" onClick={onClose}>
      <div
        className="route-print-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-modal-title"
      >
        <div className="route-print-modal__top-bar">
          <div className="route-print-modal__title-area">
            <h2 id="print-modal-title">
              Delivery Manifest — {segment.label}
            </h2>
            <span className="route-print-modal__subtitle">
              {plan.territoryName} · {segment.deliveryDate} · {v.stopCount} stops
            </span>
          </div>

          <div className="route-print-modal__actions">
            <button
              type="button"
              className="btn btn--primary btn--compact"
              onClick={handlePrint}
              title="Open print window with automatic print dialog"
            >
              🖨️ Print
            </button>

            {printHtmlUrl && (
              <a
                href={printHtmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn--secondary btn--compact"
                title="Open clean printable manifest in a new browser tab"
              >
                Open in New Tab ↗
              </a>
            )}

            <button
              type="button"
              className="btn btn--secondary btn--compact"
              onClick={handleDownload}
              title="Save a PDF file to your computer"
            >
              {downloaded ? "✓ Downloaded PDF" : "Download PDF"}
            </button>

            <button
              type="button"
              className="btn btn--secondary btn--compact route-print-modal__close-btn"
              onClick={onClose}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {printNotice === "print-opened" && (
          <div className="route-print-modal__notice" style={{ background: "#ecfdf5", color: "#065f46", borderBottom: "1px solid #a7f3d0" }}>
            ✓ Print window opened in a new tab. If the print prompt didn&apos;t appear automatically, click &quot;Print Manifest&quot; in the new tab.
          </div>
        )}

        {printNotice === "popup-blocked" && (
          <div className="route-print-modal__notice" style={{ background: "#fffbeb", color: "#92400e", borderBottom: "1px solid #fde68a" }}>
            ⚠️ Pop-up window was blocked by your browser. Please{" "}
            <a
              href={printHtmlUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontWeight: 700, textDecoration: "underline", color: "#b45309" }}
            >
              click here to open the printable sheet in a new tab ↗
            </a>
          </div>
        )}

        <div className="route-print-modal__scroll-body">
          <div className="route-print-sheet__preview">
            <header className="route-print-sheet__header">
              <h1>
                F Magnotta Wines — Delivery Manifest
              </h1>
              <h2 style={{ fontSize: "12pt", margin: "0.25rem 0", color: "#475569" }}>
                {plan.territoryName} — {segment.label}
              </h2>
              <p className="route-print-sheet__meta">
                Delivery {segment.deliveryDate} · Batch {plan.batchId} · {v.stopCount} stop
                {v.stopCount !== 1 ? "s" : ""} · {v.totalCases} cases · {v.totalMiles} mi
              </p>
              <p className="route-print-sheet__meta">
                Depot: {plan.depot.address}, {plan.depot.city} · Printed {formatDateTime(new Date())}
              </p>
              <p className="route-print-sheet__meta route-print-sheet__locked">
                {plan.status === "locked" ? "LOCKED ROUTE · " : ""}
                {v.departureTime ? `Depart: ${v.departureTime}` : ""}
                {v.completionTime ? ` · Done by: ${v.completionTime}` : ""}
                {v.totalRouteMinutes ? ` · Total time: ${formatDurationMinutes(v.totalRouteMinutes)}` : ""}
              </p>
              {breakAfterStop && (
                <p className="route-print-segment__break" style={{ color: "#d97706", marginTop: "0.25rem" }}>
                  Driver break ({DRIVER_BREAK_MINUTES} min) after {breakAfterStop.customerName}
                </p>
              )}
            </header>

            {stops.length === 0 ? (
              <p className="route-print-segment__empty">No stops assigned to this route segment.</p>
            ) : (
              <table className="route-print-table">
                <thead>
                  <tr>
                    <th style={{ width: "32px", textAlign: "center" }}>#</th>
                    <th>Customer / Restaurant</th>
                    <th>Address</th>
                    <th>Contact</th>
                    <th style={{ width: "65px", textAlign: "center" }}>ETA</th>
                    <th style={{ width: "50px", textAlign: "center" }}>Cases</th>
                    <th>Instructions</th>
                  </tr>
                </thead>
                <tbody>
                  {stops.map((stop, idx) => (
                    <Fragment key={stop.id}>
                      <tr className="route-print-stop">
                        <td style={{ textAlign: "center", fontWeight: "bold" }}>{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>{stop.customerName}</td>
                        <td className="route-print-table__address">
                          {stop.address}, {stop.city}
                        </td>
                        <td>
                          <ContactDisplay
                            contactName={stop.contactName}
                            contactPhone={stop.contactPhone}
                          />
                        </td>
                        <td className="route-print-table__eta" style={{ textAlign: "center", fontWeight: "bold" }}>
                          {v.stopEtas[stop.id] ?? "—"}
                        </td>
                        <td style={{ textAlign: "center" }}>{stop.cases ?? "—"}</td>
                        <td className="route-print-table__instructions">
                          {stop.deliveryInstructions || "—"}
                        </td>
                      </tr>
                      {breakAfterStopId === stop.id && (
                        <tr
                          className="route-print-break"
                          style={{ background: "#fef3c7", color: "#92400e", fontWeight: "bold" }}
                        >
                          <td style={{ textAlign: "center" }}>—</td>
                          <td colSpan={6}>
                            *** {DRIVER_BREAK_MINUTES} MIN DRIVER BREAK ***
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
