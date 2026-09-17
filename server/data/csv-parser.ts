import type { Customer } from "../../shared/types.js";
import { normalizeContactFields } from "../../shared/contactFormat.js";
import { resolveTerritoryInput } from "./territories.js";
import { normalizeAddressFields, resolveCoordinates, consumeGeocoderAlerts, resetGeocoderAlerts } from "./geocoder.js";

/** Maps normalized header tokens to internal field names */
const HEADER_ALIASES: Record<string, string> = {
/** Maps CSV "name" column → restaurant; do not use for point of contact */
  account_name: "restaurant_name",
  restaurant_name: "restaurant_name",
  restaurant: "restaurant_name",
  name: "restaurant_name",
  street_1: "address",
  street: "address",
  address: "address",
  address_street_1: "address",
  city: "city",
  address_city: "city",
  zip: "zip",
  zip_code: "zip",
  postal_code: "zip",
  postal: "zip",
  phone_number: "phone_field",
  phone_numbers: "phone_field",
  name_phone_numbers: "phone_field",
  name_phone_number: "phone_field",
  name_and_phone_number: "phone_field",
  name_and_phone: "phone_field",
  name_and_phone_numbers: "phone_field",
  phone: "phone_field",
  contact_phone: "phone_field",
  contact_name: "contact_name",
  contact: "contact_name",
  first_name: "contact_name",
  contact_first_name: "contact_name",
  point_of_contact: "contact_name",
  poc: "contact_name",
  delivery_instructions: "delivery_instructions",
  instructions: "delivery_instructions",
  delivery_notes: "delivery_instructions",
  territory: "territory",
  lat: "lat",
  latitude: "lat",
  lng: "lng",
  lon: "lng",
  longitude: "lng",
  cases: "cases",
  case_count: "cases",
  approved_at: "approved_at",
  cycle: "cycle",
  delivery_cycle: "cycle",
};

export interface CsvImportResult {
  customers: Customer[];
  suggestedCases: Record<string, number>;
  suggestedCycles: Record<string, number>;
  errors: string[];
  warnings: string[];
}

/** Parse phone numbers column: contact first name + phone, e.g. "Maria 215-555-0101" */
export function parseContactPhoneField(raw: string): {
  contactName: string;
  contactPhone: string;
} {
  const text = raw.trim();
  if (!text) return { contactName: "", contactPhone: "" };

  const phoneMatch = text.match(
    /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/
  );
  if (phoneMatch) {
    const contactPhone = phoneMatch[0].replace(/\s+/g, " ").trim();
    const phoneStart = text.indexOf(phoneMatch[0]);
    const beforePhone = text
      .slice(0, phoneStart)
      .replace(/[\s,;|:–—-]+$/g, "")
      .trim();
    const afterPhone = text
      .slice(phoneStart + phoneMatch[0].length)
      .replace(/^[\s,;|:–—-]+/g, "")
      .trim();

    // First name from text before or after the phone number
    let contactName =
      beforePhone.split(/\s+/).filter(Boolean)[0] ||
      afterPhone.split(/\s+/).filter(Boolean)[0] ||
      "Contact";
    return normalizeContactFields(contactName, contactPhone);
  }

  const parts = text.split(/\s+/);
  const last = parts[parts.length - 1];
  const digits = last.replace(/\D/g, "");
  if (digits.length >= 10) {
    return normalizeContactFields(parts.slice(0, -1)[0] || "Contact", last);
  }

  return normalizeContactFields(text.split(/\s+/)[0] || text, "");
}

function normalizeHeader(h: string): string {
  // "account name(Restaurant)" → "account name"
  const withoutParens = h.replace(/\([^)]*\)/g, "").trim();
  const key = withoutParens
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return HEADER_ALIASES[key] ?? key;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function slugify(name: string, index: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base ? `${base}-${index}` : `customer-${index}`;
}

export async function parseCustomersCsv(
  csvText: string,
  referenceDate: Date
): Promise<CsvImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const customers: Customer[] = [];
  const suggestedCases: Record<string, number> = {};
  const suggestedCycles: Record<string, number> = {};

  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      customers,
      suggestedCases,
      suggestedCycles,
      errors: ["CSV must include a header row and at least one customer."],
      warnings,
    };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const required = [
    "restaurant_name",
    "address",
    "city",
    "territory",
    "phone_field",
    "delivery_instructions",
  ];
  const requiredLabels: Record<string, string> = {
    restaurant_name: "name (Restaurant account name)",
    address: "street 1 (Address - Street 1)",
    city: "City (Address - City)",
    territory: "Territory",
    phone_field: "phone numbers (contact first name + phone)",
    delivery_instructions: "Delivery instructions",
  };
  for (const col of required) {
    if (!headers.includes(col)) {
      errors.push(`Missing required column: ${requiredLabels[col] ?? col}`);
    }
  }
  if (errors.length > 0) return { customers, suggestedCases, suggestedCycles, errors, warnings };

  resetGeocoderAlerts();
  const seenIds = new Set<string>();

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const values = parseCsvLine(lines[rowIdx]);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i]?.trim() ?? "";
    });

    const name = row.restaurant_name;
    if (!name) {
      warnings.push(`Row ${rowIdx + 1}: skipped — missing restaurant name`);
      continue;
    }

    const territoryId = resolveTerritoryInput(row.territory ?? "");
    if (!territoryId) {
      errors.push(`Row ${rowIdx + 1} (${name}): unknown territory "${row.territory}"`);
      continue;
    }

    const parsedContact = parseContactPhoneField(row.phone_field ?? "");
    const { contactName, contactPhone } = normalizeContactFields(
      row.contact_name?.trim() || parsedContact.contactName,
      parsedContact.contactPhone
    );
    if (!contactPhone) {
      warnings.push(`Row ${rowIdx + 1} (${name}): could not parse phone number from "${row.phone_field}"`);
    }
    if (!contactName) {
      warnings.push(`Row ${rowIdx + 1} (${name}): missing contact name`);
    }

    let lat = Number(row.lat);
    let lng = Number(row.lng);
    let geocodedFromAddress = false;

    const { street, city: normCity, zip } = normalizeAddressFields(
      row.address,
      row.city,
      row.zip
    );

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      const coords = await resolveCoordinates(street, normCity, territoryId, name, zip);
      lat = coords.lat;
      lng = coords.lng;
      geocodedFromAddress = coords.geocoded;
      if (!coords.geocoded) {
        warnings.push(
          `Row ${rowIdx + 1} (${name}): address not found — using approximate territory location`
        );
      }
      // Rate-limit external geocoders during bulk import
      if (!process.env.GOOGLE_MAPS_API_KEY?.trim()) {
        await new Promise((r) => setTimeout(r, 250));
      } else {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    let id = slugify(name, rowIdx);
    while (seenIds.has(id)) id = `${id}-${rowIdx}`;
    seenIds.add(id);

    customers.push({
      id,
      name,
      address: street,
      city: normCity,
      territoryId,
      lat,
      lng,
      contactName,
      contactPhone,
      deliveryInstructions: row.delivery_instructions,
    });

    if (!geocodedFromAddress && !row.lat) {
      /* geocode warning already added */
    }

    const cases = Number(row.cases ?? "0");
    if (!Number.isNaN(cases) && cases > 0) {
      suggestedCases[id] = cases;
      const cycleNum = Number(row.cycle ?? "1");
      if (!Number.isNaN(cycleNum)) suggestedCycles[id] = cycleNum;
    }
  }

  for (const alert of consumeGeocoderAlerts()) {
    if (!warnings.includes(alert)) warnings.unshift(alert);
  }

  return { customers, suggestedCases, suggestedCycles, errors, warnings };
}
