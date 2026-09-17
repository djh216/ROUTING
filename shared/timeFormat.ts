/** Format a duration in minutes as "2h 15m" or "45 min". */
export function formatDurationMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m} min`;
}

/** Format minutes since midnight as "10:00 AM" / "2:30 PM". */
export function formatMinutesAsTime(minutes: number): string {
  const normalized = ((Math.floor(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(normalized / 60);
  const m = normalized % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Format "HH:MM" (24h) as "10:00 AM" / "2:30 PM". */
export function formatTimeOfDay(time: string): string {
  const [h, min] = time.split(":").map(Number);
  return formatMinutesAsTime(h * 60 + (min ?? 0));
}

export const DISPLAY_DATETIME: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

export function formatDateTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString("en-US", DISPLAY_DATETIME);
}

/** Match formatted times like "10:00 AM" or "2:30 PM". */
export const AM_PM_TIME_PATTERN = /^\d{1,2}:\d{2} (AM|PM)$/;

/** Parse "HH:MM" (24h) to minutes since midnight. */
export function parseDeliveryTime(time: string): number | null {
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

/** Format minutes since midnight as "HH:MM" for time inputs. */
export function minutesToTimeInputValue(minutes: number): string {
  const normalized = ((Math.floor(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Parse "10:00 AM" / "2:30 PM" to minutes since midnight. */
export function parseFormattedTimeToMinutes(formatted: string): number | null {
  const match = formatted.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + m;
}
