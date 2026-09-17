import { useCallback, useEffect, useMemo, useState } from "react";
import { applyOrderSelection, fetchCustomerList, fetchUploadStatus } from "../lib/api";
import { MIN_ORDER_CASES } from "@shared/constants";
import type { CustomerListItem } from "@shared/types";

interface OrderSelectorProps {
  onApplied: () => void;
  refreshKey?: number;
}

type SelectionState = Record<string, { selected: boolean; cycle: number }>;

export default function OrderSelector({ onApplied, refreshKey = 0 }: OrderSelectorProps) {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [selection, setSelection] = useState<SelectionState>({});
  const [territoryFilter, setTerritoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCsv, setFromCsv] = useState(false);
  const [csvFilename, setCsvFilename] = useState<string | undefined>();

  const load = useCallback(() => {
    Promise.all([fetchUploadStatus(), fetchCustomerList()])
      .then(([status, list]) => {
        const hasCustomers = list.length > 0;
        setFromCsv(hasCustomers || status?.fromCsvUpload === true);
        setCsvFilename(status?.filename);
        setCustomers(list);
        const initial: SelectionState = {};
        for (const c of list) {
          initial[c.id] = {
            selected: c.hasOrder,
            cycle: c.cycle ?? 1,
          };
        }
        setSelection(initial);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const territories = useMemo(() => {
    const names = [...new Set(customers.map((c) => c.territoryName))].sort();
    return names;
  }, [customers]);

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (territoryFilter !== "all" && c.territoryName !== territoryFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q) ||
        c.contactPhone.toLowerCase().includes(q) ||
        c.deliveryInstructions.toLowerCase().includes(q) ||
        c.territoryName.toLowerCase().includes(q)
      );
    });
  }, [customers, territoryFilter, search]);

  const selectedCount = (Object.values(selection) as Array<SelectionState[string]>).filter((s) => s.selected).length;

  function toggle(id: string) {
    setSelection((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        selected: !prev[id]?.selected,
        cycle: prev[id]?.cycle ?? 1,
      },
    }));
  }

  function setCycle(id: string, cycle: number) {
    setSelection((prev) => ({
      ...prev,
      [id]: { ...prev[id], cycle },
    }));
  }

  function selectAll() {
    setSelection((prev) => {
      const next: SelectionState = { ...prev };
      for (const c of customers) {
        next[c.id] = {
          ...next[c.id],
          selected: true,
          cycle: next[c.id]?.cycle ?? c.cycle ?? 1,
        };
      }
      return next;
    });
    setError(null);
  }

  function unselectAll() {
    setSelection((prev) => {
      const next: SelectionState = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], selected: false };
      }
      return next;
    });
    setError(null);
  }

  async function handleApply() {
    setSaving(true);
    setError(null);
    try {
      const selections = (Object.entries(selection) as [string, SelectionState[string]][])
        .filter(([, v]) => v.selected)
        .map(([customerId, v]) => ({
          customerId,
          cases: MIN_ORDER_CASES,
          cycle: v.cycle,
        }));
      if (selections.length === 0) {
        await applyOrderSelection([]);
        onApplied();
        return;
      }
      await applyOrderSelection(selections);
      onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply orders");
    } finally {
      setSaving(false);
    }
  }

  if (!fromCsv) {
    return (
      <section className="order-selector order-selector--empty">
        <h2>Orders this week</h2>
      </section>
    );
  }

  if (customers.length === 0) {
    return (
      <section className="order-selector order-selector--empty">
        <h2>Orders this week</h2>
        <p className="order-selector__hint">No accounts found in the uploaded CSV.</p>
      </section>
    );
  }

  return (
    <section className="order-selector">
      <h2>Orders this week</h2>

      <input
        type="search"
        className="order-selector__search"
        placeholder="Search name or territory…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <select
        className="order-selector__filter"
        value={territoryFilter}
        onChange={(e) => setTerritoryFilter(e.target.value)}
      >
        <option value="all">All territories</option>
        {territories.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <ul className="order-selector__list">
        {filtered.map((c) => {
          const sel = selection[c.id] ?? { selected: false, cycle: 1 };
          const isPhilly = c.territoryId === "philadelphia";
          return (
            <li
              key={c.id}
              className={`order-selector__item ${sel.selected ? "order-selector__item--selected" : ""}`}
            >
              <label className="order-selector__check">
                <input type="checkbox" checked={sel.selected} onChange={() => toggle(c.id)} />
                <span className="order-selector__name">
                  <span className="order-selector__name-label">Restaurant</span>
                  {c.name}
                  <span className="order-selector__territory">{c.territoryName}</span>
                </span>
              </label>
              {sel.selected && isPhilly && (
                <div className="order-selector__fields">
                  <label className="order-selector__cycle">
                    Run
                    <select value={sel.cycle} onChange={(e) => setCycle(c.id, Number(e.target.value))}>
                      <option value={1}>Wed</option>
                      <option value={2}>Thu</option>
                    </select>
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="order-selector__summary">
        {selectedCount} of {customers.length} account{customers.length !== 1 ? "s" : ""} selected
        {selectedCount < customers.length && (
          <button type="button" className="order-selector__clear" onClick={selectAll}>
            Select all
          </button>
        )}
        {selectedCount > 0 && (
          <button type="button" className="order-selector__clear" onClick={unselectAll}>
            Unselect all
          </button>
        )}
      </p>

      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={saving}
        onClick={() => void handleApply()}
      >
        {saving
          ? "Applying…"
          : selectedCount === 0
            ? "Clear orders & routes"
            : "Apply orders & build routes"}
      </button>

      {error && <p className="order-selector__error">{error}</p>}
    </section>
  );
}
