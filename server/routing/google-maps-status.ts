/**
 * Shared status and health tracking for Google Maps Platform services
 * (Distance Matrix, Directions, Geocoding).
 *
 * Automatically detects when Google Maps APIs are unavailable (e.g. billing not enabled,
 * invalid API key, or quota exceeded) and seamlessly triggers internal fallbacks without
 * spamming stderr or console errors.
 */

let blockedReason: string | null = null;
let probePromise: Promise<boolean> | null = null;
let lastLoggedTime = 0;

export function isGoogleMapsBlocked(): boolean {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return true;
  return blockedReason !== null;
}

export function getGoogleMapsBlockedReason(): string | null {
  return blockedReason;
}

export function markGoogleMapsBlocked(reason: string, details?: string): void {
  const isNew = blockedReason === null;
  blockedReason = reason;

  const now = Date.now();
  if (isNew || now - lastLoggedTime > 300000) {
    lastLoggedTime = now;
    if (reason.includes("billing")) {
      console.info(
        "[Google Maps] Google Cloud project billing is not enabled on this API key. Using straight-line distance matrix and road estimates."
      );
    } else {
      console.info(
        `[Google Maps] Google Maps API unavailable (${reason}). Using straight-line distance matrix and road estimates.`
      );
    }
  }
}

export function resetGoogleMapsBlocked(): void {
  blockedReason = null;
}

export function recordGoogleMapsError(service: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const lower = message.toLowerCase();

  if (
    lower.includes("billing") ||
    lower.includes("enable billing") ||
    lower.includes("request_denied")
  ) {
    markGoogleMapsBlocked("billing_required", message);
  } else if (lower.includes("api key") || lower.includes("invalid")) {
    markGoogleMapsBlocked("invalid_api_key", message);
  } else if (lower.includes("quota") || lower.includes("over_query_limit")) {
    markGoogleMapsBlocked("quota_exceeded", message);
  } else {
    markGoogleMapsBlocked("service_unavailable", message);
  }
}

export interface GoogleMapsStatus {
  configured: boolean;
  available: boolean;
  status:
    | "active"
    | "billing_required"
    | "invalid_api_key"
    | "quota_exceeded"
    | "service_unavailable"
    | "not_configured";
  message: string;
}

export function getGoogleMapsStatus(): GoogleMapsStatus {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    return {
      configured: false,
      available: false,
      status: "not_configured",
      message: "No GOOGLE_MAPS_API_KEY configured. Using straight-line estimates.",
    };
  }

  if (blockedReason) {
    return {
      configured: true,
      available: false,
      status: blockedReason as GoogleMapsStatus["status"],
      message:
        blockedReason === "billing_required"
          ? "Google Cloud project billing is required to activate live traffic and road directions. Using built-in road estimates."
          : `Google Maps API is currently unavailable (${blockedReason}). Using built-in road estimates.`,
    };
  }

  return {
    configured: true,
    available: true,
    status: "active",
    message: "Google Maps Platform active for distance matrix and directions.",
  };
}

/**
 * Perform a lightweight check on startup/first-use so we don't throw warnings
 * during user route operations.
 */
export async function probeGoogleMapsAvailability(apiKey?: string): Promise<boolean> {
  const key = apiKey ?? process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return false;
  if (blockedReason !== null) return false;

  if (probePromise) return probePromise;

  probePromise = (async () => {
    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=41.3905,-75.6788&destinations=41.3905,-75.6788&key=${encodeURIComponent(key)}`;
      const res = await fetch(url);
      if (!res.ok) {
        recordGoogleMapsError("Probe", `HTTP ${res.status}`);
        return false;
      }
      const data = (await res.json()) as { status: string; error_message?: string };
      if (data.status === "OK") {
        return true;
      }
      recordGoogleMapsError("Probe", data.error_message ?? data.status);
      return false;
    } catch (e) {
      recordGoogleMapsError("Probe", e);
      return false;
    } finally {
      probePromise = null;
    }
  })();

  return probePromise;
}
