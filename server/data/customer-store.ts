import type {
  AddStopInput,
  AddStopResult,
  Customer,
  CustomerListItem,
  CustomerUploadSummary,
  ManualOrderInput,
  Order,
  OrderSelectionInput,
} from "../../shared/types.js";
import { parseCustomersCsv } from "./csv-parser.js";
import {
  cycleNumberFromId,
  getCycleById,
  cycleIncludesTerritory,
  getTerritoryDisplayName,
  resolveCycleId,
  resolveTerritoryInput,
} from "./territories.js";
import { defaultApprovedAt } from "../routing/scheduling.js";
import { MIN_ORDER_CASES } from "../../shared/constants.js";
import { normalizeContactFields } from "../../shared/contactFormat.js";
import { resolveCoordinates, normalizeAddressFields, consumeGeocoderAlerts, resetGeocoderAlerts } from "./geocoder.js";

let customers: Customer[] = [];
let orders: Order[] = [];
let uploadSummary: CustomerUploadSummary | null = null;
let suggestedCases: Record<string, number> = {};
let suggestedCycles: Record<string, number> = {};
let awaitingOrderSelection = false;
let fromCsvUpload = false;

export function isFromCsvUpload(): boolean {
  return fromCsvUpload;
}

export function getCustomers(): Customer[] {
  return customers;
}

export function getOrders(): Order[] {
  return orders;
}

export function getCustomerById(id: string): Customer | undefined {
  return customers.find((c) => c.id === id);
}

export function updateCustomerContact(
  customerId: string,
  contactName: string,
  contactPhone: string
): Customer | null {
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return null;
  const normalized = normalizeContactFields(contactName, contactPhone);
  customer.contactName = normalized.contactName;
  customer.contactPhone = normalized.contactPhone;
  return customer;
}

export function updateCustomerDeliveryInstructions(
  customerId: string,
  deliveryInstructions: string
): Customer | null {
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return null;
  customer.deliveryInstructions = deliveryInstructions.trim();
  return customer;
}

export function getUploadSummary(): CustomerUploadSummary | null {
  return uploadSummary;
}

export function isAwaitingOrderSelection(): boolean {
  return awaitingOrderSelection;
}

export function getCustomerListItems(): CustomerListItem[] {
  if (customers.length === 0) return [];

  const orderByCustomer = new Map(orders.map((o) => [o.customerId, o]));

  return customers.map((c) => {
    const existing = orderByCustomer.get(c.id);
    const suggested = suggestedCases[c.id];
    const hasOrder = !!existing;
    const cases = existing?.cases ?? suggested ?? 0;
    const cycle = existing
      ? cycleNumberFromId(existing.cycleId)
      : suggestedCycles[c.id];

    return {
      ...c,
      territoryName: getTerritoryDisplayName(c.territoryId),
      hasOrder,
      cases,
      cycle,
    };
  });
}

export async function importWeeklyCustomersCsv(
  csvText: string,
  referenceDate: Date,
  filename?: string
): Promise<CustomerUploadSummary> {
  const result = await parseCustomersCsv(csvText, referenceDate);

  if (result.errors.length > 0) {
    uploadSummary = {
      uploadedAt: new Date().toISOString(),
      customerCount: 0,
      orderCount: 0,
      filename,
      errors: result.errors,
      warnings: result.warnings,
      awaitingOrderSelection: false,
    };
    return uploadSummary;
  }

  customers = result.customers;
  orders = [];
  suggestedCases = result.suggestedCases;
  suggestedCycles = result.suggestedCycles;
  awaitingOrderSelection = customers.length > 0;
  fromCsvUpload = true;

  uploadSummary = {
    uploadedAt: new Date().toISOString(),
    customerCount: customers.length,
    orderCount: 0,
    filename,
    errors: [],
    warnings: result.warnings,
    awaitingOrderSelection: true,
    fromCsvUpload: true,
  };

  return uploadSummary;
}

function slugifyCustomerId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "customer";
}

function uniqueCustomerId(name: string): string {
  let id = slugifyCustomerId(name);
  let n = 1;
  while (customers.some((c) => c.id === id)) {
    id = `${slugifyCustomerId(name)}-${n++}`;
  }
  return id;
}

export function getAvailableCustomersForCycle(cycleId: string): CustomerListItem[] {
  const cycle = getCycleById(cycleId);
  if (!cycle) return [];

  const onRoute = new Set(
    orders.filter((o) => o.cycleId === cycleId).map((o) => o.customerId)
  );

  return getCustomerListItems().filter(
    (c) => cycleIncludesTerritory(cycle, c.territoryId) && !onRoute.has(c.id)
  );
}

function pushOrderForCustomer(
  customer: Customer,
  cycleId: string,
  referenceDate: Date
): void {
  orders.push({
    id: `order-${customer.id}-${Date.now()}`,
    customerId: customer.id,
    territoryId: customer.territoryId,
    cycleId,
    cases: MIN_ORDER_CASES,
    approvedAt: defaultApprovedAt(cycleId, referenceDate),
    status: "approved",
  });
}

function buildSummaryFromErrors(
  errors: string[],
  warnings: string[]
): CustomerUploadSummary {
  return {
    uploadedAt: new Date().toISOString(),
    customerCount: customers.length,
    orderCount: orders.length,
    filename: uploadSummary?.filename,
    errors,
    warnings,
    awaitingOrderSelection: awaitingOrderSelection,
    fromCsvUpload: fromCsvUpload || customers.length > 0,
  };
}

function finalizeOrderSummary(warnings: string[]): CustomerUploadSummary {
  fromCsvUpload = true;
  awaitingOrderSelection = false;
  uploadSummary = {
    uploadedAt: new Date().toISOString(),
    customerCount: customers.length,
    orderCount: orders.length,
    filename: uploadSummary?.filename,
    errors: [],
    warnings,
    awaitingOrderSelection: false,
    fromCsvUpload: true,
  };
  return uploadSummary;
}

async function createManualCustomer(
  input: ManualOrderInput,
  forceCycleId?: string
): Promise<{ customer?: Customer; cycleId?: string; warnings: string[]; errors: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const restaurantName = input.restaurantName?.trim() ?? "";
  const address = input.address?.trim() ?? "";
  const city = input.city?.trim() ?? "";
  const deliveryInstructions = input.deliveryInstructions?.trim() ?? "";

  if (!restaurantName) errors.push("Restaurant name is required");
  if (!address) errors.push("Street address is required");
  if (!city) errors.push("City is required");

  const territoryId = resolveTerritoryInput(input.territoryId ?? "");
  if (!territoryId) {
    errors.push(`Unknown territory: ${input.territoryId || "(empty)"}`);
  }

  const { contactName, contactPhone } = normalizeContactFields(
    input.contactName?.trim() ?? "",
    input.contactPhone?.trim() ?? ""
  );
  if (!contactName) warnings.push("Contact name is missing");
  if (!contactPhone) warnings.push("Phone number is missing or could not be parsed");

  if (errors.length > 0) return { warnings, errors };

  let cycleId: string;
  try {
    cycleId = forceCycleId ?? resolveCycleId(territoryId!, input.cycle ?? 1);
  } catch {
    return {
      warnings,
      errors: [`Could not assign delivery cycle for ${restaurantName}`],
    };
  }

  const { street, city: normCity } = normalizeAddressFields(address, city);
  const coords = await resolveCoordinates(street, normCity, territoryId!, restaurantName);
  if (!coords.geocoded) {
    warnings.push(
      `${restaurantName}: address not found — using approximate territory location`
    );
  }

  const customer: Customer = {
    id: uniqueCustomerId(restaurantName),
    name: restaurantName,
    address: street,
    city: normCity,
    territoryId: territoryId!,
    lat: coords.lat,
    lng: coords.lng,
    contactName,
    contactPhone,
    deliveryInstructions,
  };

  customers.push(customer);
  return { customer, cycleId, warnings, errors };
}

export async function addManualOrder(
  input: ManualOrderInput,
  referenceDate: Date
): Promise<CustomerUploadSummary> {
  const created = await createManualCustomer(input);
  if (created.errors.length > 0) {
    return buildSummaryFromErrors(created.errors, created.warnings);
  }

  pushOrderForCustomer(created.customer!, created.cycleId!, referenceDate);
  return finalizeOrderSummary(created.warnings);
}

export async function addStopToRoute(
  cycleId: string,
  input: AddStopInput,
  referenceDate: Date
): Promise<AddStopResult> {
  const cycle = getCycleById(cycleId);
  if (!cycle) {
    const errors = ["Unknown route"];
    return { summary: buildSummaryFromErrors(errors, []), errors, warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if ("customerId" in input && input.customerId) {
    const customer = getCustomerById(input.customerId);
    if (!customer) {
      errors.push("Customer not found");
    } else if (!cycleIncludesTerritory(cycle, customer.territoryId)) {
      errors.push(`${customer.name} is not in this territory`);
    } else if (orders.some((o) => o.customerId === customer.id && o.cycleId === cycleId)) {
      errors.push(`${customer.name} is already on this route`);
    } else {
      pushOrderForCustomer(customer, cycleId, referenceDate);
    }
  } else {
    const manual = input as ManualOrderInput;
    const territoryId = resolveTerritoryInput(manual.territoryId ?? "");
    if (!territoryId || !cycleIncludesTerritory(cycle, territoryId)) {
      errors.push("Territory must match the current route");
    } else {
      const created = await createManualCustomer(manual, cycleId);
      warnings.push(...created.warnings);
      errors.push(...created.errors);
      if (created.errors.length === 0 && created.customer) {
        pushOrderForCustomer(created.customer, cycleId, referenceDate);
      }
    }
  }

  if (errors.length > 0) {
    return { summary: buildSummaryFromErrors(errors, warnings), errors, warnings };
  }

  return {
    summary: finalizeOrderSummary(warnings),
    errors: [],
    warnings,
  };
}

export function applyOrderSelection(
  selections: OrderSelectionInput[],
  referenceDate: Date
): CustomerUploadSummary {
  const errors: string[] = [];
  orders = [];

  selections.forEach((sel, idx) => {
    const customer = getCustomerById(sel.customerId);
    if (!customer) {
      errors.push(`Unknown customer: ${sel.customerId}`);
      return;
    }
    try {
      const cycleId = resolveCycleId(customer.territoryId, sel.cycle ?? 1);
      orders.push({
        id: `order-${customer.id}-${idx}`,
        customerId: customer.id,
        territoryId: customer.territoryId,
        cycleId,
        cases: sel.cases ?? 1,
        approvedAt: defaultApprovedAt(cycleId, referenceDate),
        status: "approved",
      });
    } catch {
      errors.push(`Could not assign cycle for ${customer.name}`);
    }
  });

  suggestedCases = {};
  suggestedCycles = {};
  awaitingOrderSelection = false;

  uploadSummary = {
    uploadedAt: new Date().toISOString(),
    customerCount: customers.length,
    orderCount: orders.length,
    filename: uploadSummary?.filename,
    errors,
    warnings: [],
    awaitingOrderSelection: false,
    fromCsvUpload: true,
  };

  return uploadSummary;
}

function ordersToSelections(): OrderSelectionInput[] {
  return orders.map((o) => ({
    customerId: o.customerId,
    cases: o.cases,
    cycle: cycleNumberFromId(o.cycleId),
  }));
}

export function removeOrderForCustomer(
  customerId: string,
  referenceDate: Date
): CustomerUploadSummary {
  const remaining = ordersToSelections().filter((s) => s.customerId !== customerId);
  return applyOrderSelection(remaining, referenceDate);
}

export function clearOrdersForCycle(cycleId: string, referenceDate: Date): CustomerUploadSummary {
  const remaining = ordersToSelections().filter((s) => {
    const customer = getCustomerById(s.customerId);
    if (!customer) return true;
    try {
      return resolveCycleId(customer.territoryId, s.cycle ?? 1) !== cycleId;
    } catch {
      return true;
    }
  });
  return applyOrderSelection(remaining, referenceDate);
}

export function clearCustomerData(): CustomerUploadSummary {
  customers = [];
  orders = [];
  suggestedCases = {};
  suggestedCycles = {};
  awaitingOrderSelection = false;
  fromCsvUpload = false;
  uploadSummary = null;
  return {
    uploadedAt: new Date().toISOString(),
    customerCount: 0,
    orderCount: 0,
    errors: [],
    warnings: [],
    awaitingOrderSelection: false,
    fromCsvUpload: false,
  };
}

export async function regeocodeAllCustomers(): Promise<CustomerUploadSummary> {
  const warnings: string[] = [];
  let geocoded = 0;
  let approximate = 0;

  resetGeocoderAlerts();

  for (const customer of customers) {
    const { street, city, zip } = normalizeAddressFields(customer.address, customer.city);
    customer.address = street;
    customer.city = city;

    const coords = await resolveCoordinates(
      street,
      city,
      customer.territoryId,
      customer.name,
      zip
    );
    customer.lat = coords.lat;
    customer.lng = coords.lng;

    if (coords.geocoded) geocoded++;
    else {
      approximate++;
      warnings.push(
        `${customer.name}: address not found — using approximate territory location`
      );
    }

    if (!process.env.GOOGLE_MAPS_API_KEY?.trim()) {
      await new Promise((r) => setTimeout(r, 250));
    } else {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  for (const alert of consumeGeocoderAlerts()) {
    if (!warnings.includes(alert)) warnings.unshift(alert);
  }

  if (customers.length > 0) {
    warnings.unshift(
      `Re-geocoded ${geocoded} of ${customers.length} addresses` +
        (approximate > 0 ? ` (${approximate} approximate)` : "")
    );
  }

  return {
    uploadedAt: new Date().toISOString(),
    customerCount: customers.length,
    orderCount: orders.length,
    filename: uploadSummary?.filename,
    errors: [],
    warnings,
    awaitingOrderSelection,
    fromCsvUpload,
  };
}

/** Seeds the in-memory store for unit tests only. */
export function seedCustomerStoreForTests(testCustomers: Customer[], testOrders: Order[]): void {
  customers = [...testCustomers];
  orders = [...testOrders];
  suggestedCases = {};
  suggestedCycles = {};
  awaitingOrderSelection = false;
  fromCsvUpload = false;
  uploadSummary = null;
}
