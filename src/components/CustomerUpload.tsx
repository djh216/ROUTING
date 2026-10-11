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
}

export default function CustomerUpload({
  onUploaded,
  onCustomersLoaded,
  refreshKey = 0,
  title = "Weekly customers",
  layout = "sidebar",
  hideLoadedStatus = false,
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
      if (result.errors.length === 0) {
        onCustomersLoaded?.();
        if (result.orderCount > 0) onUploaded();
      }
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
    if (!status?.customerCount) return;
    setUploading(true);
    setError(null);
    try {
      const result = await resetCustomers();
      setStatus(result.customerCount > 0 ? result : null);
      onCustomersLoaded?.();
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setUploading(false);
    }
  }

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
        {status && status.customerCount > 0 && (
          <>
            <button
              type="button"
              className={`btn btn--secondary${layout === "header" ? " btn--compact" : " btn--block"}`}
              disabled={uploading}
              onClick={() => void handleRegeocode()}
            >
              {layout === "header" ? "Re-geocode" : "Re-geocode addresses"}
            </button>
            <button
              type="button"
              className={`btn btn--secondary${layout === "header" ? " btn--compact" : " btn--block"}`}
              disabled={uploading}
              onClick={() => void handleClear()}
            >
              {layout === "header" ? "Clear data" : "Clear uploaded data"}
            </button>
          </>
        )}
      </div>

      {status && status.customerCount > 0 && !hideLoadedStatus && (
        <p className="customer-upload__status">
          {status.filename ? `${status.filename}: ` : ""}
          {status.customerCount} accounts loaded
          {status.orderCount > 0 ? ` · ${status.orderCount} orders` : " · select orders below"}
        </p>
      )}

      {parseIssues.length > 0 && (
        <div className="customer-upload__issues">
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
