import { isGoogleMapsBlocked, recordGoogleMapsError } from "../routing/google-maps-status.js";

/** Approximate center points for territory fallback geocoding */
const TERRITORY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "northeast-pa": { lat: 41.409, lng: -75.6624 },
  "lehigh-valley": { lat: 40.6084, lng: -75.4902 },
  philadelphia: { lat: 39.9526, lng: -75.1652 },
  "northern-philly": { lat: 40.152, lng: -75.221 },
  "western-philly": { lat: 39.96, lng: -75.4 },
  "southern-susquehanna": { lat: 40.2732, lng: -76.8867 },
  "northern-susquehanna": { lat: 41.2412, lng: -77.0011 },
  pittsburgh: { lat: 40.4406, lng: -79.9959 },
};

export interface NormalizedAddress {
  street: string;
  city: string;
  zip: string;
}

const geocoderAlerts = new Set<string>();
let googleGeocodeBlocked: string | null = null;

/** One-time alerts (e.g. Google API misconfiguration) to show after a batch import */
export function consumeGeocoderAlerts(): string[] {
  const alerts = [...geocoderAlerts];
  geocoderAlerts.clear();
  return alerts;
}

export function resetGeocoderAlerts(): void {
  geocoderAlerts.clear();
  googleGeocodeBlocked = null;
}

function noteGeocoderAlert(message: string): void {
  geocoderAlerts.add(message);
}

/** Clean street/city/zip fields from typical CSV quirks */
export function normalizeAddressFields(
  street: string,
  city: string,
  zip?: string
): NormalizedAddress {
  let s = street.trim();
  let c = city
    .trim()
    .replace(/,\s*PA\s*$/i, "")
    .replace(/\s+PA\s*$/i, "")
    .replace(/,\s*Pennsylvania\s*$/i, "")
    .trim();
  let z = (zip ?? "").trim();

  const zipInStreet = s.match(/(?:,\s*)?(\d{5})(?:-\d{4})?\s*(?:,\s*PA)?\s*$/i);
  if (zipInStreet) {
    if (!z) z = zipInStreet[1];
    s = s.slice(0, zipInStreet.index).replace(/,\s*$/, "").trim();
  }

  s = s.replace(/,\s*PA\s*$/i, "").replace(/,\s*Pennsylvania\s*$/i, "").trim();

  if (c && s.toLowerCase().endsWith(`, ${c.toLowerCase()}`)) {
    s = s.slice(0, -(c.length + 2)).trim();
  }

  return { street: s, city: c, zip: z };
}

function hashOffset(seed: string): { lat: number; lng: number } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const lat = ((h % 200) - 100) / 8000;
  const lng = (((h / 200) | 0) % 200 - 100) / 8000;
  return { lat, lng };
}

function cityMatchesResult(city: string, result: GoogleGeocodeResult): boolean {
  if (!city.trim()) return true;
  const target = city.trim().toLowerCase();
  for (const comp of result.address_components ?? []) {
    const types = comp.types ?? [];
    if (
      types.includes("locality") ||
      types.includes("postal_town") ||
      types.includes("sublocality") ||
      types.includes("sublocality_level_1") ||
      types.includes("neighborhood") ||
      types.includes("administrative_area_level_3")
    ) {
      if (comp.long_name.toLowerCase() === target) return true;
      if (comp.short_name.toLowerCase() === target) return true;
    }
  }
  return (result.formatted_address ?? "").toLowerCase().includes(target);
}

function isInPennsylvania(result: GoogleGeocodeResult): boolean {
  return (result.address_components ?? []).some(
    (c) =>
      c.types?.includes("administrative_area_level_1") &&
      (c.short_name === "PA" || c.long_name === "Pennsylvania")
  );
}

interface GoogleGeocodeResult {
  formatted_address?: string;
  geometry?: { location?: { lat: number; lng: number } };
  types?: string[];
  address_components?: { long_name: string; short_name: string; types: string[] }[];
}

interface GoogleGeocodeResponse {
  status: string;
  results?: GoogleGeocodeResult[];
  error_message?: string;
}

interface CensusGeocodeResponse {
  result?: {
    addressMatches?: {
      coordinates?: { x: number; y: number };
      addressComponents?: { state?: string; city?: string };
    }[];
  };
}

function formatOneLineAddress(street: string, city: string, zip: string): string {
  return [street, city, "PA", zip].filter(Boolean).join(", ");
}

async function geocodeWithGoogle(
  street: string,
  city: string,
  zip: string,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> {
  if (googleGeocodeBlocked) return null;

  const address = formatOneLineAddress(street, city, zip);
  const params = new URLSearchParams({
    address,
    key: apiKey,
    region: "us",
  });

  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as GoogleGeocodeResponse;
  if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
    googleGeocodeBlocked = data.error_message ?? data.status;
    recordGoogleMapsError("Geocoding", data.error_message ?? data.status);
    noteGeocoderAlert(
      `Google Geocoding API unavailable (${data.status}): ${data.error_message ?? "check that Geocoding API is enabled for your API key"}. Using US Census geocoder instead.`
    );
    return null;
  }
  if (data.status !== "OK" || !data.results?.length) return null;

  const ranked = [...data.results].sort((a, b) => {
    const score = (r: GoogleGeocodeResult) => {
      let s = 0;
      if (r.types?.includes("street_address")) s += 10;
      if (r.types?.includes("premise")) s += 8;
      if (r.types?.includes("subpremise")) s += 6;
      if (r.types?.includes("route")) s += 2;
      if (isInPennsylvania(r)) s += 5;
      if (cityMatchesResult(city, r)) s += 5;
      return s;
    };
    return score(b) - score(a);
  });

  for (const result of ranked) {
    if (!isInPennsylvania(result)) continue;
    if (city && !cityMatchesResult(city, result)) continue;
    const loc = result.geometry?.location;
    if (loc) return { lat: loc.lat, lng: loc.lng };
  }

  const fallback = ranked.find((r) => isInPennsylvania(r) && r.geometry?.location);
  if (fallback?.geometry?.location) {
    return { lat: fallback.geometry.location.lat, lng: fallback.geometry.location.lng };
  }

  return null;
}

async function geocodeWithCensus(
  street: string,
  city: string,
  zip: string
): Promise<{ lat: number; lng: number } | null> {
  const address = formatOneLineAddress(street, city, zip);
  try {
    const params = new URLSearchParams({
      address,
      benchmark: "Public_AR_Current",
      format: "json",
    });
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = (await res.json()) as CensusGeocodeResponse;
    const matches = data.result?.addressMatches ?? [];
    if (!matches.length) return null;

    const targetCity = city.trim().toLowerCase();
    const pick = matches.find((m) => {
      if (m.addressComponents?.state !== "PA") return false;
      if (!targetCity) return true;
      const matchCity = (m.addressComponents?.city ?? "").trim().toLowerCase();
      return matchCity === targetCity;
    });

    const coords = pick?.coordinates;
    if (!coords) return null;

    return { lat: coords.y, lng: coords.x };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeWithNominatim(
  street: string,
  city: string,
  zip: string
): Promise<{ lat: number; lng: number } | null> {
  const query = formatOneLineAddress(street, city, zip);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const params = new URLSearchParams({
        q: query,
        format: "json",
        limit: "1",
        countrycodes: "us",
      });
      const url = `https://nominatim.openstreetmap.org/search?${params}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "PA-Wine-Routing/1.0 (Scranton warehouse)" },
      });
      if (res.status === 429) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (res.ok) {
        const data = (await res.json()) as { lat: string; lon: string }[];
        if (data[0]) {
          return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        }
      }
    } catch {
      // retry
    }
    await sleep(500);
  }
  return null;
}

export async function resolveCoordinates(
  street: string,
  city: string,
  territoryId: string,
  customerName: string,
  zip?: string
): Promise<{ lat: number; lng: number; geocoded: boolean }> {
  const normalized = normalizeAddressFields(street, city, zip);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();

  if (!normalized.street || !normalized.city) {
    noteGeocoderAlert(
      "Some rows are missing street or city — check CSV columns map to address and city."
    );
  } else if (apiKey && !isGoogleMapsBlocked()) {
    const google = await geocodeWithGoogle(
      normalized.street,
      normalized.city,
      normalized.zip,
      apiKey
    );
    if (google) {
      return { ...google, geocoded: true };
    }
  }

  if (normalized.street && normalized.city) {
    const census = await geocodeWithCensus(
      normalized.street,
      normalized.city,
      normalized.zip
    );
    if (census) {
      return { ...census, geocoded: true };
    }

    const nominatim = await geocodeWithNominatim(
      normalized.street,
      normalized.city,
      normalized.zip
    );
    if (nominatim) {
      return { ...nominatim, geocoded: true };
    }
  }

  const centroid = TERRITORY_CENTROIDS[territoryId] ?? TERRITORY_CENTROIDS["northeast-pa"];
  const offset = hashOffset(customerName + normalized.street);
  return {
    lat: centroid.lat + offset.lat,
    lng: centroid.lng + offset.lng,
    geocoded: false,
  };
}
