import { useCallback, useEffect, useState } from "react";
import { addManualOrder, fetchTerritories } from "../lib/api";
import type { ManualOrderInput } from "@shared/types";

interface ManualOrderFormProps {
  onAdded: () => void;
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

export default function ManualOrderForm({ onAdded }: ManualOrderFormProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ManualOrderInput>(EMPTY_FORM);
  const [territories, setTerritories] = useState<{ territoryId: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const loadTerritories = useCallback(() => {
    fetchTerritories()
      .then(setTerritories)
      .catch(() => setError("Could not load territories"));
  }, []);

  useEffect(() => {
    if (open) loadTerritories();
  }, [open, loadTerritories]);

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
      const payload: ManualOrderInput = {
        ...form,
        cycle: form.territoryId === "philadelphia" ? (form.cycle ?? 1) : undefined,
      };
      const result = await addManualOrder(payload);
      if (result.errors.length > 0) {
        setError(result.errors.join(" · "));
        return;
      }
      setWarnings(result.warnings ?? []);
      setForm(EMPTY_FORM);
      setOpen(false);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add order");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="manual-order">
      <h2>Add order manually</h2>
      {!open ? (
        <>
          <p className="manual-order__hint">
            Enter account details directly — same fields as the weekly CSV.
          </p>
          <button type="button" className="btn btn--secondary btn--block" onClick={() => setOpen(true)}>
            Add order
          </button>
        </>
      ) : (
        <form className="manual-order__form" onSubmit={(e) => void handleSubmit(e)}>
          <label className="manual-order__field">
            Restaurant name
            <input
              type="text"
              required
              value={form.restaurantName}
              onChange={(e) => updateField("restaurantName", e.target.value)}
              placeholder="Blue Table Restaurant"
            />
          </label>

          <label className="manual-order__field">
            Street address
            <input
              type="text"
              required
              value={form.address}
              onChange={(e) => updateField("address", e.target.value)}
              placeholder="123 Market St"
            />
          </label>

          <label className="manual-order__field">
            City
            <input
              type="text"
              required
              value={form.city}
              onChange={(e) => updateField("city", e.target.value)}
              placeholder="Philadelphia"
            />
          </label>

          <label className="manual-order__field">
            Contact first name
            <input
              type="text"
              required
              value={form.contactName}
              onChange={(e) => updateField("contactName", e.target.value)}
              placeholder="Maria"
            />
          </label>

          <label className="manual-order__field">
            Phone
            <input
              type="tel"
              required
              value={form.contactPhone}
              onChange={(e) => updateField("contactPhone", e.target.value)}
              placeholder="215-555-0101"
            />
          </label>

          <label className="manual-order__field">
            Delivery instructions
            <textarea
              rows={2}
              value={form.deliveryInstructions}
              onChange={(e) => updateField("deliveryInstructions", e.target.value)}
              placeholder="Use rear loading dock before 11am"
            />
          </label>

          <label className="manual-order__field">
            Territory
            <select
              required
              value={form.territoryId}
              onChange={(e) => updateField("territoryId", e.target.value)}
            >
              <option value="">Select territory…</option>
              {territories.map((t) => (
                <option key={t.territoryId} value={t.territoryId}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {form.territoryId === "philadelphia" && (
            <label className="manual-order__field">
              Delivery run
              <select
                value={form.cycle ?? 1}
                onChange={(e) => updateField("cycle", Number(e.target.value))}
              >
                <option value={1}>Wednesday</option>
                <option value={2}>Thursday</option>
              </select>
            </label>
          )}

          <div className="manual-order__actions">
            <button type="submit" className="btn btn--primary btn--block" disabled={saving}>
              {saving ? "Adding…" : "Add order & build route"}
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--block"
              disabled={saving}
              onClick={() => {
                setOpen(false);
                setError(null);
                setWarnings([]);
              }}
            >
              Cancel
            </button>
          </div>

          {warnings.map((w) => (
            <p key={w} className="manual-order__warn">
              {w}
            </p>
          ))}
          {error && <p className="manual-order__error">{error}</p>}
        </form>
      )}
    </section>
  );
}
