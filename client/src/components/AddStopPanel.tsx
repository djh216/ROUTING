import { useCallback, useEffect, useState } from "react";
import { addStopToRoute, fetchAvailableCustomersForRoute } from "../lib/api";
import type { CustomerListItem, ManualOrderInput, RoutePlan } from "@shared/types";

interface AddStopPanelProps {
  cycleId: string;
  territoryId: string;
  territoryName: string;
  disabled?: boolean;
  onAdded: (plan: RoutePlan) => void;
}

const EMPTY_FORM: ManualOrderInput = {
  restaurantName: "",
  address: "",
  city: "",
  contactName: "",
  contactPhone: "",
  deliveryInstructions: "",
  territoryId: "",
  cycle: 1,
};

export default function AddStopPanel({
  cycleId,
  territoryId,
  territoryName,
  disabled,
  onAdded,
}: AddStopPanelProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [available, setAvailable] = useState<CustomerListItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [form, setForm] = useState<ManualOrderInput>({
    ...EMPTY_FORM,
    territoryId,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const loadAvailable = useCallback(() => {
    fetchAvailableCustomersForRoute(cycleId)
      .then((list) => {
        setAvailable(list);
        setSelectedCustomerId((prev) =>
          prev && list.some((c) => c.id === prev) ? prev : (list[0]?.id ?? "")
        );
        setMode(list.length > 0 ? "existing" : "new");
      })
      .catch(() => setError("Could not load accounts"));
  }, [cycleId]);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM, territoryId });
      loadAvailable();
    }
  }, [open, territoryId, loadAvailable]);

  function updateField<K extends keyof ManualOrderInput>(key: K, value: ManualOrderInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setWarnings([]);
    try {
      const input =
        mode === "existing"
          ? { customerId: selectedCustomerId }
          : { ...form, territoryId };

      if (mode === "existing" && !selectedCustomerId) {
        setError("Select an account to add");
        return;
      }

      const result = await addStopToRoute(cycleId, input);
      if (result.errors.length > 0) {
        setError(result.errors.join(" · "));
        return;
      }
      setWarnings(result.warnings ?? []);
      setOpen(false);
      onAdded(result.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add stop");
    } finally {
      setSaving(false);
    }
  }

  if (disabled) return null;

  return (
    <div className="add-stop-panel">
      {!open ? (
        <button type="button" className="btn btn--secondary" onClick={() => setOpen(true)}>
          + Add stop
        </button>
      ) : (
        <form className="add-stop-panel__form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="add-stop-panel__head">
            <strong>Add stop to {territoryName}</strong>
            <button
              type="button"
              className="add-stop-panel__close"
              onClick={() => {
                setOpen(false);
                setError(null);
                setWarnings([]);
              }}
            >
              ×
            </button>
          </div>

          {available.length > 0 && (
            <div className="add-stop-panel__modes">
              <label>
                <input
                  type="radio"
                  name="add-stop-mode"
                  checked={mode === "existing"}
                  onChange={() => setMode("existing")}
                />
                Existing account
              </label>
              <label>
                <input
                  type="radio"
                  name="add-stop-mode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                New account
              </label>
            </div>
          )}

          {mode === "existing" && available.length > 0 ? (
            <label className="add-stop-panel__field">
              Account
              <select
                required
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
              >
                <option value="">Select account…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.city}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="add-stop-panel__field">
                Restaurant name
                <input
                  type="text"
                  required
                  value={form.restaurantName}
                  onChange={(e) => updateField("restaurantName", e.target.value)}
                />
              </label>
              <label className="add-stop-panel__field">
                Street address
                <input
                  type="text"
                  required
                  value={form.address}
                  onChange={(e) => updateField("address", e.target.value)}
                />
              </label>
              <label className="add-stop-panel__field">
                City
                <input
                  type="text"
                  required
                  value={form.city}
                  onChange={(e) => updateField("city", e.target.value)}
                />
              </label>
              <label className="add-stop-panel__field">
                Contact first name
                <input
                  type="text"
                  required
                  value={form.contactName}
                  onChange={(e) => updateField("contactName", e.target.value)}
                />
              </label>
              <label className="add-stop-panel__field">
                Phone
                <input
                  type="tel"
                  required
                  value={form.contactPhone}
                  onChange={(e) => updateField("contactPhone", e.target.value)}
                />
              </label>
              <label className="add-stop-panel__field">
                Delivery instructions
                <textarea
                  rows={2}
                  value={form.deliveryInstructions}
                  onChange={(e) => updateField("deliveryInstructions", e.target.value)}
                />
              </label>
            </>
          )}

          <p className="add-stop-panel__hint">
            The route will be re-optimized with this stop included. Other territories are unchanged.
          </p>

          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Adding…" : "Add stop & re-optimize"}
          </button>

          {warnings.map((w) => (
            <p key={w} className="add-stop-panel__warn">
              {w}
            </p>
          ))}
          {error && <p className="add-stop-panel__error">{error}</p>}
        </form>
      )}
    </div>
  );
}
