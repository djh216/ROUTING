import { AVERAGE_MPH, DRIVE_TIME_BUFFER_MULTIPLIER, SCRANTON_DEPOT } from "../../shared/constants.js";
import {
  applyDriveTimeBuffer,
  createEstimatedTravelMatrix,
  haversineMeters,
  resolveTrafficDepartureTime,
} from "./travel-time.js";

if (applyDriveTimeBuffer(100) !== 100 * DRIVE_TIME_BUFFER_MULTIPLIER) {
  throw new Error("Drive time buffer should match multiplier");
}

const now = Math.floor(Date.now() / 1000);
const future = now + 3600;
if (resolveTrafficDepartureTime(future) !== future) {
  throw new Error("Future planned departure should be used for traffic");
}
if (resolveTrafficDepartureTime(now - 3600) <= now) {
  throw new Error("Past planned departure should fall back to near-current traffic");
}

const matrix = createEstimatedTravelMatrix(SCRANTON_DEPOT, [
  {
    id: "stop-a",
    customerId: "a",
    customerName: "A",
    address: "1 Main",
    city: "Philadelphia",
    territoryId: "philadelphia",
    cycleId: "philadelphia-1",
    cases: 3,
    lat: 39.9526,
    lng: -75.1652,
    orderIds: [],
    contactName: "",
    contactPhone: "",
    deliveryInstructions: "",
  },
]);

const from = { lat: SCRANTON_DEPOT.lat, lng: SCRANTON_DEPOT.lng };
const to = { lat: 39.9526, lng: -75.1652 };
const minutes = matrix.getDurationMinutes(from, to);
const rawMinutes =
  (haversineMeters(from.lat, from.lng, to.lat, to.lng) / 1609.344 / AVERAGE_MPH) * 60;
const expected = applyDriveTimeBuffer(rawMinutes);

if (Math.abs(minutes - expected) > 0.01) {
  throw new Error(`Expected buffered drive time ${expected}, got ${minutes}`);
}

console.log("travel-time.test.ts OK");
