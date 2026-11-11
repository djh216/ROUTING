import { useEffect, useRef, useState } from "react";
import {
  fetchUploadStatus,
  regeocodeCustomers,
  resetCustomers,
  uploadCustomersCsv,
} from "../lib/api";
import type { CustomerUploadSummary } from "@shared/types";

interface CustomerUploadProps {
  onUploaded: () => void;
  onCustomersLoaded?: () => void;
  refreshKey?: number;
  /** Section heading; omit for no title */
  title?: string;
  /** Sidebar stack, wide inline row, or compact header toolbar */
  layout?: "sidebar" | "inline" | "header";
  /** Hide loaded-account status (shown elsewhere on the page) */
  hideLoadedStatus?: boolean;
  /** When the parent already knows accounts are loaded (e.g. after a failed re-import). */
  existingCustomerCount?: number;
}

export default function CustomerUpload({
  onUploaded,
  onCustomersLoaded,
  refreshKey = 0,
  title = "Weekly customers",
  layout = "sidebar",
  hideLoadedStatus = false,
  existingCustomerCount = 0,
}: CustomerUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<CustomerUploadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parseIssuesOpen, setParseIssuesOpen] = useState(false);

  const parseIssues = [
    ...(status?.errors ?? []).map((message) => ({ kind: "error" as const, message })),
    ...(status?.warnings ?? []).map((message) => ({ kind: "warn" as const, message })),
  ];

  useEffect(() => {
    fetchUploadStatus().then(setStatus).catch(() => {});
  }, [refreshKey]);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    setParseIssuesOpen(false);
    try {
      const text = await file.text();
      const result = await uploadCustomersCsv(text, file.name);
      setStatus(result);
      onCustomersLoaded?.();
      if (result.customerCount > 0 && result.orderCount > 0) onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRegeocode() {
    if (!status?.customerCount) return;
    setUploading(true);
    setError(null);
    try {
      const result = await regeocodeCustomers();
      setStatus((prev) => ({
        ...result,
        filename: prev?.filename ?? result.filename,
      }));
      onCustomersLoaded?.();
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-geocode failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleClear() {
    if (!canClearData) return;
    setUploading(true);
    setError(null);
    setParseIssuesOpen(false);
    try {
      await resetCustomers();
      setStatus(null);
      onCustomersLoaded?.();
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setUploading(false);
    }
  }

  const loadedCount = Math.max(status?.customerCount ?? 0, existingCustomerCount);
  const hasUploadIssues = (status?.errors?.length ?? 0) > 0 || (status?.warnings?.length ?? 0) > 0;
  const canClearData = loadedCount > 0 || hasUploadIssues;
  const canRegeocode = (status?.customerCount ?? 0) > 0;
  const showClearInIssuesBar = layout === "header" && parseIssues.length > 0 && canClearData;

  const layoutClass =
    layout === "header"
      ? " customer-upload--header"
      : layout === "inline"
        ? " customer-upload--inline"
        : "";

  return (
    <section className={`customer-upload${layoutClass}`}>
      {title && layout !== "header" ? <h2>{title}</h2> : null}

      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="customer-upload__input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />

      <div className="customer-upload__actions">
        <button
          type="button"
          className={`btn btn--primary${layout === "header" ? " btn--compact" : " btn--block"}`}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Upload CSV"}
        </button>
        {(canRegeocode || canClearData) && (
          <>
            {canRegeocode ? (
              <button
                type="button"
                className={`btn btn--secondary${layout === "header" ? " btn--compact" : " btn--block"}`}
                disabled={uploading}
                onClick={() => void handleRegeocode()}
              >
                {layout === "header" ? "Re-geocode" : "Re-geocode addresses"}
              </button>
            ) : null}
            {canClearData && !showClearInIssuesBar ? (
              <button
                type="button"
                className={`btn btn--secondary${layout === "header" ? " btn--compact" : " btn--block"}`}
                disabled={uploading}
                onClick={() => void handleClear()}
                title="Remove imported accounts, orders, and failed upload state"
              >
                {layout === "header" ? "Clear data" : "Clear uploaded data"}
              </button>
            ) : null}
          </>
        )}
      </div>

      {status && status.customerCount === 0 && status.errors.length > 0 && (
        <p className="customer-upload__error customer-upload__error--import">
          {status.filename ? `${status.filename}: ` : ""}
          No accounts were imported ({status.errors.length} row
          {status.errors.length !== 1 ? "s" : ""} blocked). Use Clear data, then upload again.
        </p>
      )}

      {status && status.customerCount > 0 && (
        <p className={`customer-upload__status${hideLoadedStatus ? " customer-upload__status--compact" : ""}`}>
          {status.filename ? `${status.filename}: ` : ""}
          {status.customerCount} accounts loaded
          {status.errors.length > 0
            ? ` · ${status.errors.length} row${status.errors.length !== 1 ? "s" : ""} skipped`
            : ""}
          {!hideLoadedStatus &&
            (status.orderCount > 0 ? ` · ${status.orderCount} orders` : " · select orders below")}
          {hideLoadedStatus && status.errors.length === 0 ? " · Re-geocode if pins still look wrong" : ""}
        </p>
      )}

      {parseIssues.length > 0 && (
        <div className="customer-upload__issues">
          {showClearInIssuesBar ? (
            <button
              type="button"
              className="btn btn--secondary btn--compact"
              disabled={uploading}
              title="Remove this import, then use Upload CSV to try again"
              onClick={() => void handleClear()}
            >
              Clear data
            </button>
          ) : null}
          <button
            type="button"
            className="customer-upload__issues-toggle"
            aria-expanded={parseIssuesOpen}
            onClick={() => setParseIssuesOpen((open) => !open)}
          >
            {parseIssues.length} row{parseIssues.length !== 1 ? "s" : ""} with parse issues
            <span className="customer-upload__issues-chevron" aria-hidden>
              {parseIssuesOpen ? "▾" : "▸"}
            </span>
          </button>
          {parseIssuesOpen && (
            <ul className="customer-upload__issues-list">
              {parseIssues.map((item, index) => (
                <li
                  key={`${index}-${item.message}`}
                  className={
                    item.kind === "error"
                      ? "customer-upload__issues-item customer-upload__issues-item--error"
                      : "customer-upload__issues-item customer-upload__issues-item--warn"
                  }
                >
                  {item.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="customer-upload__error">{error}</p>}
    </section>
  );
}
