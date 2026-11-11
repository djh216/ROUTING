import type { Customer } from "../../shared/types.js";
import { normalizeContactFields } from "../../shared/contactFormat.js";
import { sanitizeTeamMembers } from "../../shared/teamMembers.js";
import { resolveTerritoryInput } from "./territories.js";
import {
  normalizeAddressFields,
  normalizeCsvCoordinates,
  resolveCoordinatesApproximate,
  consumeGeocoderAlerts,
  resetGeocoderAlerts,
} from "./geocoder.js";

/** Maps normalized header tokens to internal field names */
const HEADER_ALIASES: Record<string, string> = {
  account_id: "account_id",
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
  emails: "contact_email",
  email: "contact_email",
  e_mail: "contact_email",
  email_address: "contact_email",
  email_addresses: "contact_email",
  contact_email: "contact_email",
  contact_emails: "contact_email",
  contact_name: "contact_name",
  contact: "contact_name",
  first_name: "contact_name",
  contact_first_name: "contact_name",
  point_of_contact: "contact_name",
  poc: "contact_name",
  delivery_instructions: "delivery_instructions",
  delivery_instructions_places: "delivery_instructions",
  instructions: "delivery_instructions",
  delivery_notes: "delivery_instructions",
  team_members: "team_members",
  team: "team_members",
  lid: "outfield_lid",
  outfield_lid: "outfield_lid",
  na_payment_method: "payment_method",
  payment_method: "payment_method",
  territory: "territory",
  territory_places: "territory",
  lid_places: "outfield_lid",
  na_payment_method_places: "payment_method",
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

const PHONE_FIELD_LABEL =
  /^(approvals?|main|phone|contact|tel|cell|mobile)\s*:?\s*/i;

const GENERIC_CONTACT_TOKENS = new Set([
  "approvals",
  "approval",
  "main",
  "phone",
  "contact",
  "tel",
  "cell",
  "mobile",
]);

function stripPhoneFieldLabels(raw: string): string {
  let text = raw.trim();
  while (PHONE_FIELD_LABEL.test(text)) {
    text = text.replace(PHONE_FIELD_LABEL, "").trim();
  }
  return text;
}

function pickContactName(beforePhone: string, afterPhone: string): string {
  const candidates = [
    ...beforePhone.split(/\s+/).filter(Boolean),
    ...afterPhone.split(/\s+/).filter(Boolean),
  ];
  for (const token of candidates) {
    const lower = token.replace(/:$/, "").toLowerCase();
    if (GENERIC_CONTACT_TOKENS.has(lower)) continue;
    if (/^\d/.test(token)) continue;
    return token.replace(/:$/, "");
  }
  return "Contact";
}

/** Parse phone numbers column: contact first name + phone, e.g. "Maria 215-555-0101" */
export function parseContactPhoneField(raw: string): {
  contactName: string;
  contactPhone: string;
} {
  const text = stripPhoneFieldLabels(raw.trim());
  if (!text) return { contactName: "", contactPhone: "" };

  const phoneMatch = text.match(
    /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]+\d{4}\b|(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/
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

    const contactName = pickContactName(beforePhone, afterPhone);
    return normalizeContactFields(contactName, contactPhone);
  }

  const parts = text.split(/\s+/);
  const last = parts[parts.length - 1];
  const digits = last.replace(/\D/g, "");
  if (digits.length >= 10) {
    const namePart = parts.slice(0, -1).join(" ");
    return normalizeContactFields(
      pickContactName(namePart, "") || parts[0] || "Contact",
      last
    );
  }

  const nameOnly = text.includes(":") ? text.split(":").pop()?.trim() ?? text : text;
  const firstToken = nameOnly.split(/\s+/).filter(Boolean)[0] ?? "";
  if (firstToken && !GENERIC_CONTACT_TOKENS.has(firstToken.toLowerCase())) {
    return normalizeContactFields(firstToken, "");
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

function cleanCsvCell(value: string): string {
  return value
    .replace(/\uFEFF/g, "")
    .replace(/[\u00A0\u200B-\u200D\u2060]/g, " ")
    .trim();
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
      fields.push(cleanCsvCell(current));
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(cleanCsvCell(current));
  return fields;
}

/** Parse full CSV text including quoted fields that span lines. */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cleanCsvCell(field));
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(cleanCsvCell(field));
      field = "";
      if (row.some((cell) => cell.length > 0)) records.push(row);
      row = [];
      if (ch === "\r") i++;
    } else if (ch === "\r") {
      row.push(cleanCsvCell(field));
      field = "";
      if (row.some((cell) => cell.length > 0)) records.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  row.push(cleanCsvCell(field));
  if (row.some((cell) => cell.length > 0)) records.push(row);

  return records;
}

/**
 * When unquoted commas split a row, merge extra cells back into delivery instructions
 * and keep trailing columns (LID, payment, territory on Outfield exports) aligned.
 */
function realignCsvValues(values: string[], headers: string[]): string[] {
  if (values.length <= headers.length) {
    if (values.length < headers.length) {
      return [...values, ...Array(headers.length - values.length).fill("")];
    }
    return values;
  }

  const instructionIdx = headers.indexOf("delivery_instructions");
  if (instructionIdx < 0) {
    return values.slice(0, headers.length);
  }

  const tailLen = headers.length - instructionIdx - 1;
  if (tailLen < 1) {
    return values.slice(0, headers.length);
  }

  const head = values.slice(0, instructionIdx);
  const tail = values.slice(values.length - tailLen);
  const middle = values.slice(instructionIdx, values.length - tailLen);
  const instructions = middle.join(", ");
  return [...head, instructions, ...tail];
}

function resolveTerritoryForImport(
  row: Record<string, string>,
  values: string[],
  territoryColIdx: number,
  rowNumber: number,
  name: string,
  warnings: string[]
): { territoryId: string | null; territoryRaw: string } {
  const city = cleanCsvCell(row.city ?? "");
  let territoryRaw = cleanCsvCell(row.territory ?? "");

  const tryResolve = (raw: string): string | null => {
    const cleaned = cleanCsvCell(raw);
    if (!cleaned) return resolveTerritoryInput("", city);
    return resolveTerritoryInput(cleaned, city);
  };

  let territoryId = tryResolve(territoryRaw);

  if (!territoryId && values.length > 0) {
    const last = cleanCsvCell(values[values.length - 1] ?? "");
    if (last) {
      const fromLast = tryResolve(last);
      if (fromLast) {
        territoryId = fromLast;
        territoryRaw = last;
        if (territoryColIdx < 0 || values.length - 1 !== territoryColIdx) {
          warnings.push(
            `Row ${rowNumber} (${name}): territory "${last}" read from last column — row may have extra commas (quote delivery instructions in CSV)`
          );
        }
      }
    }
  }

  if (!territoryId) {
    for (let i = values.length - 1; i >= 0; i--) {
      const candidate = cleanCsvCell(values[i] ?? "");
      if (!candidate || candidate === name) continue;
      const fromScan = resolveTerritoryInput(candidate, city);
      if (fromScan) {
        territoryId = fromScan;
        territoryRaw = candidate;
        if (i !== territoryColIdx) {
          warnings.push(
            `Row ${rowNumber} (${name}): territory "${candidate}" inferred from column ${i + 1}`
          );
        }
        break;
      }
    }
  }

  if (!territoryId && !territoryRaw.trim()) {
    territoryId = resolveTerritoryInput("", city);
    if (territoryId) {
      warnings.push(`Row ${rowNumber} (${name}): territory inferred from city "${city}"`);
    }
  }

  return { territoryId, territoryRaw };
}

/** Trim Outfield email cells; keep multiple addresses in one string when present. */
export function parseContactEmailField(raw: string): string {
  let text = raw.trim();
  if (!text) return "";
  text = text.replace(/^mailto:/i, "").trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim();
  }
  return text;
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

  const records = parseCsvRecords(csvText.replace(/^\uFEFF/, ""));

  if (records.length < 2) {
    return {
      customers,
      suggestedCases,
      suggestedCycles,
      errors: ["CSV must include a header row and at least one customer."],
      warnings,
    };
  }

  const headers = records[0]!.map(normalizeHeader);
  const territoryColIdx = headers.indexOf("territory");
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

  for (let rowIdx = 1; rowIdx < records.length; rowIdx++) {
    const values = realignCsvValues(records[rowIdx]!, headers);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });

    const name = cleanCsvCell(row.restaurant_name ?? "");
    if (!name) {
      warnings.push(`Row ${rowIdx + 1}: skipped — missing restaurant name`);
      continue;
    }
    row.restaurant_name = name;

    const rowNumber = rowIdx + 1;
    const { territoryId, territoryRaw } = resolveTerritoryForImport(
      row,
      values,
      territoryColIdx,
      rowNumber,
      name,
      warnings
    );
    if (!territoryId) {
      errors.push(
        `Row ${rowNumber} (${name}): unknown territory "${territoryRaw || "(blank)"}"`
      );
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
    let coordinateSource: Customer["coordinateSource"];

    const { street, city: normCity, zip } = normalizeAddressFields(
      row.address,
      row.city,
      row.zip
    );

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      const coords = normalizeCsvCoordinates(lat, lng);
      if (coords.valid) {
        lat = coords.lat;
        lng = coords.lng;
        coordinateSource = "outfield_csv";
        if (coords.swapped) {
          warnings.push(`Row ${rowNumber} (${name}): lat/lng columns look swapped — corrected.`);
        }
      } else {
        lat = Number.NaN;
        lng = Number.NaN;
        warnings.push(`Row ${rowNumber} (${name}): ignoring invalid lat/lng — will geocode from address.`);
      }
    }

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      const coords = resolveCoordinatesApproximate(street, normCity, territoryId, name, zip);
      lat = coords.lat;
      lng = coords.lng;
      coordinateSource = "approximate";
    }

    const outfieldAccountId = cleanCsvCell(row.account_id ?? "");
    let id = outfieldAccountId ? `outfield-${outfieldAccountId}` : slugify(name, rowIdx);
    while (seenIds.has(id)) id = `${id}-${rowIdx}`;
    seenIds.add(id);

    const teamMembersRaw = row.team_members?.trim() ?? "";
    const teamMembers = sanitizeTeamMembers(teamMembersRaw);
    const outfieldLid = row.outfield_lid?.trim() ?? "";
    const paymentMethod = row.payment_method?.trim() ?? "";
    const contactEmail = parseContactEmailField(row.contact_email ?? "");

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
      contactEmail,
      deliveryInstructions: row.delivery_instructions,
      coordinateSource,
      ...(outfieldAccountId ? { outfieldAccountId } : {}),
      ...(teamMembers ? { teamMembers } : {}),
      ...(outfieldLid ? { outfieldLid } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
    });

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
