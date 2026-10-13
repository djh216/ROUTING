import { useCallback, useEffect, useState, type ReactNode } from "react";
import { addOrderSelections, updateCustomerAccount } from "../lib/api";
import { MIN_ORDER_CASES } from "@shared/constants";
import type { CustomerListItem, TerritoryCycle } from "@shared/types";
import { deliveryRunLabel } from "@shared/deliveryRuns";
import { routeOptionsForPicker } from "../lib/deliveryRoutes";
import { sanitizeTeamMembers } from "@shared/teamMembers";
import ContactDisplay from "./ContactDisplay";

function displayTeamMembers(raw?: string): string {
  return sanitizeTeamMembers(raw ?? "");
}

interface CustomerAccountModalProps {
  customer: CustomerListItem;
  deliveryRoutes?: TerritoryCycle[];
  onClose: () => void;
  onSaved: (customer: CustomerListItem) => void;
  onRouteChanged?: (cycleId: string) => void;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="customer-account-modal__row">
      <dt className="customer-account-modal__label">{label}</dt>
      <dd className="customer-account-modal__value">{value}</dd>
    </div>
  );
}

function FieldRow({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="customer-account-modal__row">
      <label className="customer-account-modal__label" htmlFor={id}>
        {label}
      </label>
      <div className="customer-account-modal__value">{children}</div>
    </div>
  );
}

const inputClass = "customer-account-modal__input";

export default function CustomerAccountModal({
  customer,
  deliveryRoutes = [],
  onClose,
  onSaved,
  onRouteChanged,
}: CustomerAccountModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(customer.name);
  const [address, setAddress] = useState(customer.address);
  const [city, setCity] = useState(customer.city);
  const [contactName, setContactName] = useState(customer.contactName);
  const [contactPhone, setContactPhone] = useState(customer.contactPhone);
  const [contactEmail, setContactEmail] = useState(customer.contactEmail ?? "");
  const [paymentMethod, setPaymentMethod] = useState(customer.paymentMethod ?? "");
  const [teamMembers, setTeamMembers] = useState(customer.teamMembers ?? "");
  const [outfieldLid, setOutfieldLid] = useState(customer.outfieldLid ?? "");
  const [deliveryInstructions, setDeliveryInstructions] = useState(
    customer.deliveryInstructions ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [movingRoute, setMovingRoute] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const routeOptions = routeOptionsForPicker(deliveryRoutes);
  const routeNameById = new Map(deliveryRoutes.map((r) => [r.id, r.name]));

  const resetFormFromCustomer = useCallback((c: CustomerListItem) => {
    setName(c.name);
    setAddress(c.address);
    setCity(c.city);
    setContactName(c.contactName);
    setContactPhone(c.contactPhone);
    setContactEmail(c.contactEmail ?? "");
    setPaymentMethod(c.paymentMethod ?? "");
    setTeamMembers(displayTeamMembers(c.teamMembers));
    setOutfieldLid(c.outfieldLid ?? "");
    setDeliveryInstructions(c.deliveryInstructions ?? "");
    setError(null);
    setNotice(null);
  }, []);

  useEffect(() => {
    resetFormFromCustomer(customer);
    setIsEditing(false);
  }, [customer, resetFormFromCustomer]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || saving) return;
      if (isEditing) {
        resetFormFromCustomer(customer);
        setIsEditing(false);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving, isEditing, customer, resetFormFromCustomer]);

  const deliveryRun =
    customer.hasOrder && customer.cycle != null
      ? deliveryRunLabel(customer.territoryId, customer.cycle)
      : null;

  function handleCancelEdit() {
    resetFormFromCustomer(customer);
    setIsEditing(false);
  }

  async function handleRouteChange(cycleId: string) {
    if (!customer.hasOrder || cycleId === customer.orderCycleId) return;
    setMovingRoute(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addOrderSelections(
        [
          {
            customerId: customer.id,
            cases: customer.cases > 0 ? customer.cases : MIN_ORDER_CASES,
          },
        ],
        cycleId
      );
      if (result.errors.length > 0) {
        setError(result.errors.join(" · "));
        return;
      }
      setNotice(`Moved to ${routeNameById.get(cycleId) ?? cycleId}. Rebuild the route to update stops.`);
      onRouteChanged?.(cycleId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change route");
    } finally {
      setMovingRoute(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { customer: updated, warnings } = await updateCustomerAccount(customer.id, {
        name,
        address,
        city,
        contactName,
        contactPhone,
        contactEmail,
        paymentMethod,
        teamMembers,
        outfieldLid,
        deliveryInstructions,
      });
      if (warnings.length > 0) setNotice(warnings.join(" · "));
      onSaved(updated);
      setIsEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleOverlayClick() {
    if (saving) return;
    if (isEditing) resetFormFromCustomer(customer);
    onClose();
  }

  return (
    <div className="customer-account-modal-overlay" onClick={handleOverlayClick}>
      <div
        className="customer-account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-account-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="customer-account-modal__header">
          <div>
            <h2 id="customer-account-modal-title">{customer.name}</h2>
            {customer.hasOrder && (
              <span className="customer-database__on-order-badge">On orders this week</span>
            )}
          </div>
          <div className="customer-account-modal__header-actions">
            {!isEditing && (
              <button
                type="button"
                className="btn btn--primary btn--compact"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="btn btn--secondary btn--compact"
              disabled={saving}
              onClick={() => {
                if (isEditing) resetFormFromCustomer(customer);
                onClose();
              }}
            >
              Close
            </button>
          </div>
        </header>

        {!isEditing ? (
          <dl className="customer-account-modal__details">
            <DetailRow label="LID" value={customer.outfieldLid || "—"} />
            <DetailRow
              label="Address"
              value={
                <>
                  {customer.address}
                  <br />
                  {customer.city}
                </>
              }
            />
            <DetailRow label="Territory" value={customer.territoryName} />
            {deliveryRun && <DetailRow label="Delivery run" value={deliveryRun} />}
            <DetailRow
              label="Contact"
              value={
                <ContactDisplay
                  contactName={customer.contactName}
                  contactPhone={customer.contactPhone}
                />
              }
            />
            <DetailRow label="Email" value={customer.contactEmail || "—"} />
            <DetailRow label="N/A Payment" value={customer.paymentMethod || "—"} />
            {displayTeamMembers(customer.teamMembers) ? (
              <DetailRow
                label="Team members"
                value={displayTeamMembers(customer.teamMembers)}
              />
            ) : null}
            <DetailRow
              label="Delivery instructions"
              value={customer.deliveryInstructions || "—"}
            />
            {customer.hasOrder ? (
              <>
                <DetailRow
                  label="Order"
                  value={`${customer.cases} case${customer.cases !== 1 ? "s" : ""} this week`}
                />
                <div className="customer-account-modal__row">
                  <dt className="customer-account-modal__label">Delivery route</dt>
                  <dd className="customer-account-modal__value">
                    {routeOptions.length > 0 ? (
                      <select
                        className="customer-account-modal__input"
                        value={customer.orderCycleId ?? ""}
                        disabled={movingRoute || saving}
                        onChange={(e) => void handleRouteChange(e.target.value)}
                      >
                        {routeOptions.map((route) => (
                          <option key={route.id} value={route.id}>
                            {route.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      routeNameById.get(customer.orderCycleId ?? "") ??
                      customer.orderCycleId ??
                      "—"
                    )}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        ) : (
          <form
            className="customer-account-modal__form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <FieldRow label="Restaurant" id="account-name">
              <input
                id="account-name"
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </FieldRow>
            <FieldRow label="LID" id="account-lid">
              <input
                id="account-lid"
                className={inputClass}
                value={outfieldLid}
                onChange={(e) => setOutfieldLid(e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Street" id="account-address">
              <input
                id="account-address"
                className={inputClass}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
              />
            </FieldRow>
            <FieldRow label="City" id="account-city">
              <input
                id="account-city"
                className={inputClass}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
              />
            </FieldRow>
            <div className="customer-account-modal__row customer-account-modal__row--readonly">
              <span className="customer-account-modal__label">Territory</span>
              <span className="customer-account-modal__value">{customer.territoryName}</span>
            </div>
            {deliveryRun && (
              <div className="customer-account-modal__row customer-account-modal__row--readonly">
                <span className="customer-account-modal__label">Delivery run</span>
                <span className="customer-account-modal__value">{deliveryRun}</span>
              </div>
            )}
            <FieldRow label="Contact name" id="account-contact-name">
              <input
                id="account-contact-name"
                className={inputClass}
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Contact phone" id="account-contact-phone">
              <input
                id="account-contact-phone"
                className={inputClass}
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Email" id="account-email">
              <input
                id="account-email"
                className={inputClass}
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </FieldRow>
            <FieldRow label="N/A Payment" id="account-payment">
              <input
                id="account-payment"
                className={inputClass}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Team members" id="account-team">
              <input
                id="account-team"
                className={inputClass}
                value={teamMembers}
                onChange={(e) => setTeamMembers(e.target.value)}
              />
            </FieldRow>
            <FieldRow label="Delivery instructions" id="account-instructions">
              <textarea
                id="account-instructions"
                className={`${inputClass} customer-account-modal__textarea`}
                rows={4}
                value={deliveryInstructions}
                onChange={(e) => setDeliveryInstructions(e.target.value)}
              />
            </FieldRow>
            {customer.hasOrder && (
              <div className="customer-account-modal__row customer-account-modal__row--readonly">
                <span className="customer-account-modal__label">Order</span>
                <span className="customer-account-modal__value">
                  {customer.cases} case{customer.cases !== 1 ? "s" : ""} this week
                </span>
              </div>
            )}

            {notice && <p className="customer-account-modal__notice">{notice}</p>}
            {error && <p className="customer-account-modal__error">{error}</p>}

            <div className="customer-account-modal__actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={saving}
                onClick={handleCancelEdit}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
