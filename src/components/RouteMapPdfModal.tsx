import { useEffect, useState } from "react";
import { formatDateTime } from "@shared/timeFormat";
import type { MapPdfExport } from "../lib/generateMapPdf";

interface RouteMapPdfModalProps {
  exports: MapPdfExport[];
  routeName: string;
  deliveryDate: string;
  onClose: () => void;
}

export default function RouteMapPdfModal({
  exports,
  routeName,
  deliveryDate,
  onClose,
}: RouteMapPdfModalProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const printedAt = formatDateTime(new Date());
  const active = exports[activeIndex] ?? exports[0];
  const multi = exports.length > 1;

  useEffect(() => {
    setActiveIndex(0);
  }, [exports]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!active) return null;

  const downloadBlob = (item: MapPdfExport) => {
    const link = document.createElement("a");
    link.href = item.blobUrl;
    link.download = item.filename;
    link.rel = "noopener";
    link.click();
  };

  const handleDownload = () => downloadBlob(active);

  const handleDownloadAll = () => {
    exports.forEach((item, index) => {
      window.setTimeout(() => downloadBlob(item), index * 400);
    });
  };

  const handlePrint = () => {
    setPrintNotice(null);
    const printWin = window.open(active.blobUrl, "_blank");
    if (printWin) {
      printWin.addEventListener("load", () => {
        try {
          printWin.print();
        } catch {
          setPrintNotice("print-manual");
        }
      });
      setPrintNotice("print-opened");
    } else {
      setPrintNotice("popup-blocked");
    }
  };

  const subtitle = multi
    ? `${routeName} · Delivery ${deliveryDate} · ${exports.length} truck maps`
    : `${routeName} · Delivery ${deliveryDate} · ${active.stopCount} stop${active.stopCount === 1 ? "" : "s"}`;

  const sheetSubtitle = multi
    ? `${routeName} · ${active.label} · Delivery ${deliveryDate} · ${active.stopCount} stop${active.stopCount === 1 ? "" : "s"} · Printed ${printedAt}`
    : `${routeName} · Delivery ${deliveryDate} · ${active.stopCount} stop${active.stopCount === 1 ? "" : "s"} · Printed ${printedAt}`;

  return (
    <div className="route-print-modal-overlay" onClick={onClose}>
      <div
        className="route-print-modal route-print-modal--map-pdf"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-pdf-modal-title"
      >
        <div className="route-print-modal__top-bar">
          <div className="route-print-modal__title-area">
            <h2 id="map-pdf-modal-title">
              {multi ? "Route Map PDFs" : "Route Map PDF"}
            </h2>
            <span className="route-print-modal__subtitle">{subtitle}</span>
          </div>

          <div className="route-print-modal__actions">
            {multi && (
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                onClick={handleDownloadAll}
                title="Download a separate PDF for each truck"
              >
                Save all PDFs
              </button>
            )}
            <button
              type="button"
              className="btn btn--primary btn--compact"
              onClick={handlePrint}
              title="Open the PDF and print"
            >
              Print
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--compact"
              onClick={handleDownload}
              title="Save this PDF to your computer"
            >
              {multi ? `Save ${active.label}` : "Save PDF"}
            </button>
            <a
              href={active.blobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--secondary btn--compact"
              title="Open the PDF in a new browser tab"
            >
              Open PDF Tab
            </a>
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

        {multi && (
          <div className="route-map-pdf-modal__tabs" role="tablist">
            {exports.map((item, index) => (
              <button
                key={item.segmentId}
                type="button"
                role="tab"
                aria-selected={index === activeIndex}
                className={`route-map-pdf-modal__tab${index === activeIndex ? " route-map-pdf-modal__tab--active" : ""}`}
                onClick={() => setActiveIndex(index)}
              >
                {item.label}
                <span className="route-map-pdf-modal__tab-count">{item.stopCount}</span>
              </button>
            ))}
          </div>
        )}

        {printNotice === "print-opened" && (
          <div className="route-print-modal__notice route-print-modal__notice--success">
            PDF opened in a new tab — use the browser print menu if the dialog did not appear.
          </div>
        )}
        {printNotice === "print-manual" && (
          <div className="route-print-modal__notice route-print-modal__notice--warn">
            Use Print in the PDF tab to print this map.
          </div>
        )}
        {printNotice === "popup-blocked" && (
          <div className="route-print-modal__notice route-print-modal__notice--warn">
            Pop-up blocked — use Save PDF or Open PDF Tab, then print from there.
          </div>
        )}

        <div className="route-print-modal__scroll-body route-map-pdf-modal__scroll-body">
          <div className="route-map-pdf-modal__sheet">
            <header className="route-map-pdf-modal__header">
              <h3>F Magnotta Wines — Route Map</h3>
              <p>{sheetSubtitle}</p>
              <p className="route-map-pdf-modal__footnote">
                Stop numbers match the route board{multi ? ` (${active.label})` : ""}.
              </p>
            </header>
            {active.mapPreviewDataUrl ? (
              <img
                src={active.mapPreviewDataUrl}
                alt={`Route map — ${active.label}`}
                className="route-map-pdf-modal__preview-img"
              />
            ) : (
              <p className="route-map-pdf-modal__empty">
                Map preview unavailable — you can still save or open the PDF.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
