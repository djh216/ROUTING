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
}

export default function CustomerUpload({ onUploaded, onCustomersLoaded, refreshKey = 0 }: CustomerUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<CustomerUploadSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUploadStatus().then(setStatus).catch(() => {});
  }, [refreshKey]);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const text = await file.text();
      const result = await uploadCustomersCsv(text, file.name);
      setStatus(result);
      if (result.errors.length > 0) {
        setError(result.errors.join(" · "));
      } else {
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

  return (
    <section className="customer-upload">
      <h2>Weekly customers</h2>
      <p className="customer-upload__hint">
        Upload your weekly export: <strong>name</strong> (restaurant), address, city, optional zip,{" "}
        <strong>phone numbers</strong> (contact first name + phone), delivery instructions,
        territory. Set <code>GOOGLE_MAPS_API_KEY</code> on the server for accurate map pins.
      </p>

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
          className="btn btn--primary btn--block"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Uploading…" : "Upload CSV"}
        </button>
        {status && status.customerCount > 0 && (
          <>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              disabled={uploading}
              onClick={() => void handleRegeocode()}
            >
              Re-geocode addresses
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              disabled={uploading}
              onClick={() => void handleClear()}
            >
              Clear uploaded data
            </button>
          </>
        )}
      </div>

      {status && status.customerCount > 0 && (
        <p className="customer-upload__status">
          {status.filename ? `${status.filename}: ` : ""}
          {status.customerCount} accounts loaded
          {status.orderCount > 0 ? ` · ${status.orderCount} orders` : " · select orders below"}
        </p>
      )}

      {status?.warnings.map((w) => (
        <p key={w} className="customer-upload__warn">
          {w}
        </p>
      ))}

      {error && <p className="customer-upload__error">{error}</p>}
      {status?.errors.map((e) => (
        <p key={e} className="customer-upload__error">
          {e}
        </p>
      ))}
    </section>
  );
}
