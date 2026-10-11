import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addOrderSelections,
  applyOrderSelection,
  fetchCustomerList,
  fetchUploadStatus,
} from "../lib/api";
import { MIN_ORDER_CASES } from "@shared/constants";
import type { CustomerListItem, CustomerUploadSummary } from "@shared/types";
import ContactDisplay from "./ContactDisplay";
import CustomerAccountModal from "./CustomerAccountModal";
import CustomerUpload from "./CustomerUpload";

type SelectionState = Record<string, { selected: boolean; cycle: number }>;

interface CustomerDatabaseDashboardProps {
  refreshKey?: number;
  onUploadComplete?: () => void;
  onOrdersApplied?: () => void;
}

export default function CustomerDatabaseDashboard({
  refreshKey = 0,
  onUploadComplete,
  onOrdersApplied,
}: CustomerDatabaseDashboardProps) {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [status, setStatus] = useState<CustomerUploadSummary | null>(null);
  const [selection, setSelection] = useState<SelectionState>({});
  const [territoryFilter, setTerritoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingOrders, setSavingOrders] = useState(false);
  const [clearingSelection, setClearingSelection] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<CustomerListItem | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchUploadStatus(), fetchCustomerList()])
      .then(([uploadStatus, list]) => {
        setStatus(uploadStatus);
        setCustomers(list);
        const initial: SelectionState = {};
        for (const c of list) {
          initial[c.id] = {
            selected: false,
            cycle: c.cycle ?? 1,
          };
        }
        setSelection(initial);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load customers"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const territories = useMemo(() => {
    return [...new Set(customers.map((c) => c.territoryName))].sort();
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
        (c.contactEmail ?? "").toLowerCase().includes(q) ||
        c.deliveryInstructions.toLowerCase().includes(q) ||
        c.territoryName.toLowerCase().includes(q) ||
        (c.outfieldLid ?? "").toLowerCase().includes(q) ||
        (c.paymentMethod ?? "").toLowerCase().includes(q)
      );
    });
  }, [customers, territoryFilter, search]);

  const selectedCount = useMemo(
    () => customers.filter((c) => !c.hasOrder && selection[c.id]?.selected).length,
    [customers, selection]
  );

  const selectedAnyCount = useMemo(
    () => customers.filter((c) => selection[c.id]?.selected).length,
    [customers, selection]
  );

  const filteredAllSelected =
    filtered.length > 0 && filtered.every((c) => selection[c.id]?.selected);

  function toggleSelected(id: string) {
    setSelection((prev) => ({
      ...prev,
      [id]: {
        selected: !prev[id]?.selected,
        cycle: prev[id]?.cycle ?? 1,
      },
    }));
    setOrderError(null);
    setOrderNotice(null);
  }

  function setCycle(id: string, cycle: number) {
    setSelection((prev) => ({
      ...prev,
      [id]: { ...prev[id], selected: prev[id]?.selected ?? false, cycle },
    }));
  }

  function selectFiltered() {
    setSelection((prev) => {
      const next = { ...prev };
      for (const c of filtered) {
        next[c.id] = {
          selected: true,
          cycle: next[c.id]?.cycle ?? c.cycle ?? 1,
        };
      }
      return next;
    });
    setOrderError(null);
    setOrderNotice(null);
  }

  async function clearSelection() {
    const selectedOnOrders = customers.filter((c) => c.hasOrder && selection[c.id]?.selected);
    setOrderError(null);
    setOrderNotice(null);

    setSelection((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = { ...next[id], selected: false };
      }
      return next;
    });

    if (selectedOnOrders.length === 0) return;

    setClearingSelection(true);
    try {
      const remaining = customers
        .filter((c) => c.hasOrder && !selection[c.id]?.selected)
        .map((c) => ({
          customerId: c.id,
          cases: c.cases > 0 ? c.cases : MIN_ORDER_CASES,
          cycle: c.cycle ?? 1,
        }));
      const result = await applyOrderSelection(remaining);
      if (result.errors.length > 0) {
        setOrderError(result.errors.join(" · "));
        load();
        return;
      }
      setStatus(result);
      load();
      onOrdersApplied?.();
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : "Failed to remove orders");
      load();
    } finally {
      setClearingSelection(false);
    }
  }

  async function handleApplyOrders() {
    setSavingOrders(true);
    setOrderError(null);
    setOrderNotice(null);
    try {
      const selections = customers
        .filter((c) => !c.hasOrder && selection[c.id]?.selected)
        .map((c) => ({
          customerId: c.id,
          cases: MIN_ORDER_CASES,
          cycle: selection[c.id]?.cycle ?? c.cycle ?? 1,
        }));
      if (selections.length === 0) return;

      const result = await addOrderSelections(selections);
      if (result.errors.length > 0) {
        setOrderError(result.errors.join(" · "));
        return;
      }
      if (result.warnings.length > 0) {
        setOrderNotice(
          result.warnings.length === 1
            ? result.warnings[0]
            : `${result.warnings.length} selected accounts were already on orders this week`
        );
      }
      setStatus(result);
      setSelection((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next)) {
          next[id] = { ...next[id], selected: false };
        }
        return next;
      });
      load();
      onOrdersApplied?.();
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : "Failed to update orders");
    } finally {
      setSavingOrders(false);
    }
  }

  return (
    <div className="customer-database">
      <header className="customer-database__header">
        <div>
          <h2>Customer information database</h2>
          <p className="customer-database__meta">
            {status?.filename ? `${status.filename} · ` : ""}
            {customers.length} account{customers.length !== 1 ? "s" : ""}
            {status?.orderCount != null && status.orderCount > 0
              ? ` · ${status.orderCount} active order${status.orderCount !== 1 ? "s" : ""}`
              : ""}
          </p>
        </div>
        <button type="button" className="btn btn--secondary btn--compact" onClick={load}>
          Refresh
        </button>
      </header>

      <div className="customer-database__upload">
        <CustomerUpload
          title="Upload Outfield accounts"
          layout="inline"
          refreshKey={refreshKey}
          onCustomersLoaded={() => {
            load();
            onUploadComplete?.();
          }}
          onUploaded={() => {
            load();
            onUploadComplete?.();
          }}
        />
        <p className="customer-database__upload-hint">
          Use your weekly Outfield export (<strong>Outfield_Accounts.csv</strong>): name, address,
          city, phone, email, team members, delivery instructions, LID, payment method, and territory.
        </p>
      </div>

      {loading && <p className="customer-database__hint">Loading customer data…</p>}
      {error && <p className="customer-database__error">{error}</p>}

      {!loading && !error && customers.length === 0 && (
        <p className="customer-database__hint">
          No accounts in the database yet. Upload a CSV above, or add orders manually from the
          Routes view.
        </p>
      )}

      {!loading && customers.length > 0 && (
        <>
          <div className="customer-database__toolbar">
            <input
              type="search"
              className="customer-database__search"
              placeholder="Search name, address, contact, territory…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="customer-database__filter"
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
          </div>

          <div className="customer-database__orders-bar">
            <p className="customer-database__orders-summary">
              {selectedCount} selected to add · {status?.orderCount ?? 0} on orders this week
            </p>
            <div className="customer-database__orders-actions">
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                disabled={filtered.length === 0 || filteredAllSelected}
                onClick={selectFiltered}
              >
                Select filtered
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                disabled={selectedAnyCount === 0 || clearingSelection || savingOrders}
                onClick={() => void clearSelection()}
              >
                {clearingSelection ? "Removing…" : "Clear selection"}
              </button>
              <button
                type="button"
                className="btn btn--primary btn--compact"
                disabled={savingOrders || clearingSelection || selectedCount === 0}
                onClick={() => void handleApplyOrders()}
              >
                {savingOrders ? "Adding…" : "Add to orders this week"}
              </button>
            </div>
          </div>
          {orderNotice && <p className="customer-database__notice">{orderNotice}</p>}
          {orderError && <p className="customer-database__error">{orderError}</p>}

          <div className="customer-database__table-wrap">
            <table className="customer-database__table">
              <colgroup>
                <col className="customer-database__col-select" />
                <col className="customer-database__col-name" />
                <col className="customer-database__col-lid" />
                <col className="customer-database__col-address" />
                <col className="customer-database__col-territory" />
                <col className="customer-database__col-contact" />
                <col className="customer-database__col-email" />
                <col className="customer-database__col-payment" />
                <col className="customer-database__col-instructions" />
              </colgroup>
              <thead>
                <tr>
                  <th className="customer-database__col-select-head" aria-label="Select for orders" />
                  <th>Restaurant</th>
                  <th className="customer-database__lid">LID</th>
                  <th>Address</th>
                  <th>Territory</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>N/A Payment</th>
                  <th>Instructions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const sel = selection[c.id] ?? { selected: false, cycle: 1 };
                  const isPhilly = c.territoryId === "philadelphia";
                  return (
                  <tr
                    key={c.id}
                    className={[
                      "customer-database__row--clickable",
                      sel.selected
                        ? "customer-database__row--selected"
                        : c.hasOrder
                          ? "customer-database__row--on-order"
                          : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setDetailCustomer(c)}
                  >
                    <td
                      className="customer-database__select"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={sel.selected}
                        aria-label={
                          c.hasOrder
                            ? `Select ${c.name} to remove from orders this week`
                            : `Select ${c.name} to add to orders this week`
                        }
                        onChange={() => toggleSelected(c.id)}
                      />
                    </td>
                    <td className="customer-database__name">
                      <button
                        type="button"
                        className="customer-database__name-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailCustomer(c);
                        }}
                      >
                        {c.name}
                      </button>
                      {c.hasOrder && (
                        <span className="customer-database__on-order-badge">On orders</span>
                      )}
                    </td>
                    <td className="customer-database__lid">{c.outfieldLid || "—"}</td>
                    <td>
                      {c.address}, {c.city}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {c.territoryName}
                      {sel.selected && isPhilly && (
                        <label className="customer-database__philly-run">
                          Run{" "}
                          <select
                            value={sel.cycle}
                            aria-label={`Philadelphia run for ${c.name}`}
                            onChange={(e) => setCycle(c.id, Number(e.target.value))}
                          >
                            <option value={1}>Wed</option>
                            <option value={2}>Thu</option>
                          </select>
                        </label>
                      )}
                    </td>
                    <td>
                      <ContactDisplay
                        contactName={c.contactName}
                        contactPhone={c.contactPhone}
                      />
                    </td>
                    <td className="customer-database__email">{c.contactEmail || "—"}</td>
                    <td>{c.paymentMethod || "—"}</td>
                    <td className="customer-database__instructions">
                      {c.deliveryInstructions || "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="customer-database__footer">
            Showing {filtered.length} of {customers.length} accounts · click a row for details
          </p>
        </>
      )}

      {detailCustomer && (
        <CustomerAccountModal
          customer={detailCustomer}
          onClose={() => setDetailCustomer(null)}
          onSaved={(updated) => {
            setCustomers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            setDetailCustomer(updated);
          }}
        />
      )}
    </div>
  );
}
