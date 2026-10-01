import { useCallback, useEffect, useState, type FormEvent } from "react";
import { addManualOrder, fetchTerritories, fetchTerritoryCycles } from "../lib/api";
import type { ManualOrderInput, RoutePlan, TerritoryCycle } from "@shared/types";

interface ManualOrderFormProps {
  activePlan?: RoutePlan | null;
  onAdded: (plan?: RoutePlan) => void;
}

function cycleIdForTerritory(
  cycles: TerritoryCycle[],
  territoryId: string,
  cycle?: number
): string | null {
  if (!territoryId) return null;
  if (territoryId === "northern-philly") {
    return cycles.find((item) => item.id === "thursday-sepa")?.id ?? null;
  }
  const matches = cycles.filter((item) =>
    (item.territoryIds ?? [item.territoryId]).includes(territoryId)
  );
  if (territoryId === "philadelphia" && cycle === 2) {
    return matches.find((item) => item.id === "thursday-sepa")?.id ?? null;
  }
  if (cycle != null) {
    const byNumber = matches.find((item) => item.cycle === cycle);
    if (byNumber) return byNumber.id;
  }
  return matches[0]?.id ?? null;
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

export default function ManualOrderForm({ activePlan, onAdded }: ManualOrderFormProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ManualOrderInput>(EMPTY_FORM);
  const [territories, setTerritories] = useState<{ territoryId: string; name: string }[]>([]);
  const [cycles, setCycles] = useState<TerritoryCycle[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const loadTerritories = useCallback(() => {
    Promise.all([fetchTerritories(), fetchTerritoryCycles()])
      .then(([territoryList, cycleList]) => {
        setTerritories(territoryList);
        setCycles(cycleList);
      })
      .catch(() => setError("Could not load territories"));
  }, []);

  useEffect(() => {
    if (open) loadTerritories();
  }, [open, loadTerritories]);

  const targetCycleId = cycleIdForTerritory(
    cycles,
    form.territoryId,
    form.territoryId === "philadelphia" ? (form.cycle ?? 1) : undefined
  );
  const matchesBuiltRoute =
    activePlan != null &&
    activePlan.segments.length > 0 &&
    activePlan.cycleId === targetCycleId;
  const placementSegments = matchesBuiltRoute && activePlan.segments.length > 1 ? activePlan.segments : [];
  const chooseSegment = placementSegments.length > 1;
  const placementKey = placementSegments.map((segment) => segment.id).join("|");
  const segmentKind = placementSegments.some((segment) => segment.segmentType === "day")
    ? "day"
    : "truck";
  const routeLocked = matchesBuiltRoute && activePlan?.status === "locked";
  const appendSegmentId = matchesBuiltRoute
    ? chooseSegment
      ? segmentId
      : activePlan.segments[0].id
    : undefined;

  useEffect(() => {
    if (!chooseSegment) return;
    const ids = placementKey.split("|").filter(Boolean);
    setSegmentId((current) => (ids.includes(current) ? current : (ids[0] ?? "")));
  }, [chooseSegment, placementKey]);

  function updateField<K extends keyof ManualOrderInput>(key: K, value: ManualOrderInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setWarnings([]);
    try {
      if (chooseSegment && !segmentId) {
        setError(segmentKind === "day" ? "Choose a day" : "Choose a truck");
        return;
      }
      const payload: ManualOrderInput = {
        ...form,
        cycle: form.territoryId === "philadelphia" ? (form.cycle ?? 1) : undefined,
        segmentId: appendSegmentId,
      };
      const result = await addManualOrder(payload);
      if (result.errors.length > 0) {
        setError(result.errors.join(" · "));
        return;
      }
      setWarnings(result.warnings ?? []);
      setForm(EMPTY_FORM);
      setOpen(false);
      onAdded(result.plan);
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
        <button type="button" className="btn btn--secondary btn--block" onClick={() => setOpen(true)}>
          Add order
        </button>
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

          {chooseSegment && (
            <label className="manual-order__field">
              {segmentKind === "day" ? "Add to day" : "Add to truck"}
              <select
                required
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                disabled={routeLocked}
              >
                {placementSegments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {matchesBuiltRoute && (
            <p className="manual-order__warn">
              {routeLocked
                ? "Unlock the route before adding an order."
                : chooseSegment
                  ? `The order is added to the end of the selected ${segmentKind}. Stops already on the route stay in their current order.`
                  : "The order is added at the end. Stops already on the route stay in their current order."}
            </p>
          )}

          <div className="manual-order__actions">
            <button
              type="submit"
              className="btn btn--primary btn--block"
              disabled={saving || routeLocked}
            >
              {saving ? "Adding…" : matchesBuiltRoute ? "Add order" : "Add order & build route"}
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
