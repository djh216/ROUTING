import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CustomerListItem } from "@shared/types";
import {
  CUSTOMER_PRINT_COLUMNS,
  columnLabel,
  customerPrintCell,
  defaultCustomerPrintColumnIds,
  type CustomerPrintColumnId,
} from "../lib/customerDatabasePrintColumns";
import {
  downloadCustomerDatabasePdf,
  generateCustomerDatabasePdf,
} from "../lib/generateCustomerDatabasePdf";
import { generateCustomerDatabasePrintHtml } from "../lib/generateCustomerDatabasePrintHtml";

interface CustomerDatabasePrintModalProps {
  customers: CustomerListItem[];
  filterSummary: string;
  totalInDatabase: number;
  filteredCount: number;
  selectedCount: number;
  printingSelectedOnly: boolean;
  routeNameById: (cycleId?: string) => string;
  onSelectAllFiltered: () => void;
  onClearAccountSelection: () => void;
  onClose: () => void;
}

type PreviewView = "table" | "pdf" | "html";

export default function CustomerDatabasePrintModal({
  customers,
  filterSummary,
  totalInDatabase,
  filteredCount,
  selectedCount,
  printingSelectedOnly,
  routeNameById,
  onSelectAllFiltered,
  onClearAccountSelection,
  onClose,
}: CustomerDatabasePrintModalProps) {
  const [selectedColumns, setSelectedColumns] = useState<Set<CustomerPrintColumnId>>(
    () => new Set(defaultCustomerPrintColumnIds())
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const [previewView, setPreviewView] = useState<PreviewView>("table");
  const [pdfArtifact, setPdfArtifact] = useState<{ filename: string; blobUrl: string } | null>(
    null
  );
  const [htmlForEmbed, setHtmlForEmbed] = useState<string>("");
  const artifactRef = useRef(pdfArtifact);
  artifactRef.current = pdfArtifact;

  const columnIds = useMemo(
    () => CUSTOMER_PRINT_COLUMNS.filter((c) => selectedColumns.has(c.id)).map((c) => c.id),
    [selectedColumns]
  );

  const exportMeta = useMemo(
    () => ({
      filterSummary,
      accountCount: customers.length,
      totalInDatabase,
      routeNameById,
    }),
    [filterSummary, customers.length, totalInDatabase, routeNameById]
  );

  const rebuildArtifacts = useCallback(() => {
    if (columnIds.length === 0) {
      setPdfArtifact((prev) => {
        if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
        return null;
      });
      setHtmlForEmbed("");
      return;
    }
    try {
      const html = generateCustomerDatabasePrintHtml(customers, columnIds, exportMeta);
      setHtmlForEmbed(html);
      const pdf = generateCustomerDatabasePdf(customers, columnIds, exportMeta);
      setPdfArtifact((prev) => {
        if (prev?.blobUrl) URL.revokeObjectURL(prev.blobUrl);
        return pdf;
      });
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to prepare export");
    }
  }, [columnIds, customers, exportMeta]);

  useEffect(() => {
    rebuildArtifacts();
  }, [rebuildArtifacts]);

  useEffect(() => {
    return () => {
      if (artifactRef.current?.blobUrl) {
        URL.revokeObjectURL(artifactRef.current.blobUrl);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const toggleColumn = (id: CustomerPrintColumnId) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllColumns = () => {
    setSelectedColumns(new Set(CUSTOMER_PRINT_COLUMNS.map((c) => c.id)));
  };

  const restoreDefaultColumns = () => {
    setSelectedColumns(new Set(defaultCustomerPrintColumnIds()));
  };

  const handlePrint = () => {
    setActionError(null);
    setPrintNotice(null);
    if (columnIds.length === 0) {
      setActionError("Select at least one column.");
      return;
    }
    setPreviewView("table");
    window.setTimeout(() => {
      window.print();
      setPrintNotice("print-dialog");
    }, 50);
  };

  const handleSavePdf = () => {
    setActionError(null);
    setPrintNotice(null);
    if (!pdfArtifact) {
      setActionError("PDF is not ready yet — try again in a moment.");
      return;
    }
    try {
      downloadCustomerDatabasePdf(pdfArtifact);
      setPrintNotice("pdf-downloaded");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleOpenPdf = () => {
    setActionError(null);
    setPrintNotice(null);
    if (!pdfArtifact) {
      setActionError("PDF is not ready yet — try again in a moment.");
      return;
    }
    setPreviewView("pdf");
    setPrintNotice("pdf-inline");
  };

  const handleOpenTable = () => {
    setActionError(null);
    setPrintNotice(null);
    if (columnIds.length === 0) {
      setActionError("Select at least one column.");
      return;
    }
    setPreviewView("html");
    setPrintNotice("html-inline");
  };

  const canExport = columnIds.length > 0;

  return (
    <div className="route-print-modal-overlay" onClick={onClose}>
      <div
        className="route-print-modal route-print-modal--customer-db"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-db-print-title"
      >
        <div className="route-print-modal__top-bar">
          <div className="route-print-modal__title-area">
            <h2 id="customer-db-print-title">Print customer database</h2>
            <span className="route-print-modal__subtitle">
              {printingSelectedOnly ? "Selected accounts only · " : "All filtered accounts · "}
              {customers.length} in export · {filterSummary}
            </span>
          </div>
          <div className="route-print-modal__actions">
            <button
              type="button"
              className="btn btn--primary btn--compact"
              disabled={!canExport}
              onClick={handlePrint}
              title="Print the table preview (landscape)"
            >
              Print
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--compact"
              disabled={!canExport || !pdfArtifact}
              onClick={handleSavePdf}
            >
              Save PDF
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--compact"
              disabled={!canExport || !pdfArtifact}
              onClick={handleOpenPdf}
            >
              Open PDF
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--compact"
              disabled={!canExport}
              onClick={handleOpenTable}
            >
              Open table
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--compact route-print-modal__close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="customer-db-print__accounts">
          <span className="customer-db-print__columns-label">Accounts</span>
          <div className="customer-db-print__column-actions">
            <button
              type="button"
              className="btn btn--ghost btn--compact"
              disabled={filteredCount === 0}
              onClick={onSelectAllFiltered}
            >
              Select all filtered ({filteredCount})
            </button>
            {selectedCount > 0 && (
              <button
                type="button"
                className="btn btn--ghost btn--compact"
                onClick={onClearAccountSelection}
              >
                Clear selection
              </button>
            )}
          </div>
          <p className="customer-db-print__accounts-hint">
            {printingSelectedOnly
              ? "Export includes checked rows only."
              : "No rows checked — export includes every account matching your filters."}
            {" "}
            Print uses this dialog (no pop-ups). Save PDF downloads a file; Open PDF / Open table show below.
          </p>
        </div>

        <div className="customer-db-print__columns">
          <span className="customer-db-print__columns-label">Columns</span>
          <div className="customer-db-print__column-actions">
            <button type="button" className="btn btn--ghost btn--compact" onClick={selectAllColumns}>
              All columns
            </button>
            <button type="button" className="btn btn--ghost btn--compact" onClick={restoreDefaultColumns}>
              Column defaults
            </button>
          </div>
          <div className="customer-db-print__column-grid">
            {CUSTOMER_PRINT_COLUMNS.map((col) => (
              <label key={col.id} className="customer-db-print__column-option">
                <input
                  type="checkbox"
                  checked={selectedColumns.has(col.id)}
                  onChange={() => toggleColumn(col.id)}
                />
                <span>{col.label}</span>
              </label>
            ))}
          </div>
        </div>

        {canExport && (
          <div className="customer-db-print__view-tabs">
            <button
              type="button"
              className={`customer-db-print__view-tab${previewView === "table" ? " customer-db-print__view-tab--active" : ""}`}
              onClick={() => setPreviewView("table")}
            >
              Table preview
            </button>
            <button
              type="button"
              className={`customer-db-print__view-tab${previewView === "pdf" ? " customer-db-print__view-tab--active" : ""}`}
              onClick={() => setPreviewView("pdf")}
              disabled={!pdfArtifact}
            >
              PDF
            </button>
            <button
              type="button"
              className={`customer-db-print__view-tab${previewView === "html" ? " customer-db-print__view-tab--active" : ""}`}
              onClick={() => setPreviewView("html")}
            >
              Full table
            </button>
          </div>
        )}

        {actionError && (
          <div className="route-print-modal__notice route-print-modal__notice--warn">{actionError}</div>
        )}
        {printNotice === "print-dialog" && (
          <div className="route-print-modal__notice route-print-modal__notice--success">
            Print dialog opened — choose landscape if prompted, or Save as PDF.
          </div>
        )}
        {printNotice === "pdf-downloaded" && (
          <div className="route-print-modal__notice route-print-modal__notice--success">
            PDF download started — check your Downloads folder.
          </div>
        )}
        {printNotice === "pdf-inline" && (
          <div className="route-print-modal__notice route-print-modal__notice--success">
            PDF shown below. Use Save PDF to download a copy.
          </div>
        )}
        {printNotice === "html-inline" && (
          <div className="route-print-modal__notice route-print-modal__notice--success">
            Full printable table shown below.
          </div>
        )}

        <div className="route-print-modal__scroll-body customer-db-print__preview-wrap">
          {previewView === "pdf" && pdfArtifact && (
            <iframe
              title="Customer database PDF"
              className="customer-db-print__embed customer-db-print__embed--pdf"
              src={pdfArtifact.blobUrl}
            />
          )}
          {previewView === "html" && htmlForEmbed && (
            <iframe
              title="Customer database table"
              className="customer-db-print__embed customer-db-print__embed--html"
              srcDoc={htmlForEmbed}
            />
          )}
          {previewView === "table" && (
            <div className="customer-db-print__preview-sheet customer-db-print__preview-sheet--printable">
              <header className="customer-db-print__preview-header">
                <h3>F Magnotta Wines — Customer Database</h3>
                <p>
                  {customers.length} accounts · {filterSummary}
                </p>
              </header>
              {columnIds.length === 0 ? (
                <p className="customer-db-print__empty">Choose at least one column above.</p>
              ) : (
                <div className="customer-db-print__table-scroll">
                  <table className="customer-db-print__table">
                    <thead>
                      <tr>
                        {columnIds.map((id) => (
                          <th key={id}>{columnLabel(id)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((c) => (
                        <tr key={c.id}>
                          {columnIds.map((id) => (
                            <td key={id}>{customerPrintCell(c, id, routeNameById)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
