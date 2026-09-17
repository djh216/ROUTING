/** Capitalize the first letter of each word in a contact name. */
export function formatContactName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Format a phone number as xxx-xxx-xxxx when 10 (or 11 with leading 1) digits are present. */
export function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone.trim();
}

/** Display contact as "Name · xxx-xxx-xxxx", or "—" when both are missing. */
export function formatContactDisplay(contactName?: string, contactPhone?: string): string {
  const name = formatContactName(contactName ?? "");
  const phone = formatPhoneNumber(contactPhone ?? "");
  if (name && phone) return `${name} · ${phone}`;
  if (name) return name;
  if (phone) return phone;
  return "—";
}

export function normalizeContactFields(contactName: string, contactPhone: string): {
  contactName: string;
  contactPhone: string;
} {
  return {
    contactName: formatContactName(contactName),
    contactPhone: formatPhoneNumber(contactPhone),
  };
}
