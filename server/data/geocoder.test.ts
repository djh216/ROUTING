import { normalizeAddressFields } from "./geocoder.js";

const n1 = normalizeAddressFields("123 Main St, Philadelphia, PA 19103", "Philadelphia, PA");
if (n1.street !== "123 Main St" || n1.city !== "Philadelphia" || n1.zip !== "19103") {
  throw new Error(`Expected parsed Philly address, got ${JSON.stringify(n1)}`);
}

const n2 = normalizeAddressFields("456 Oak Ave, Pittsburgh", "Pittsburgh");
if (n2.street !== "456 Oak Ave" || n2.city !== "Pittsburgh") {
  throw new Error(`Expected stripped city from street, got ${JSON.stringify(n2)}`);
}

const n3 = normalizeAddressFields("789 Market St", "York", "17401");
if (n3.zip !== "17401") {
  throw new Error(`Expected zip preserved, got ${JSON.stringify(n3)}`);
}

import { resolveCoordinates } from "./geocoder.js";
const coords = await resolveCoordinates("123 Market St", "Philadelphia", "philadelphia", "Test Bistro");
if (!coords.geocoded) {
  throw new Error(`Expected Census/Google geocode to succeed, got ${JSON.stringify(coords)}`);
}
if (coords.lat < 39.9 || coords.lat > 40.0 || coords.lng > -75.1 || coords.lng < -75.2) {
  throw new Error(`Coordinates look wrong for Philadelphia: ${JSON.stringify(coords)}`);
}

console.log("geocoder.test.ts OK");
