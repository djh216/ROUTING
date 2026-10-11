import { daysUntilDelivery, nearestDeliveryRouteAmong } from "./nearestDeliveryRoute.js";
import type { TerritoryCycle } from "./types.js";

const tue: TerritoryCycle = {
  id: "tue",
  territoryId: "t",
  name: "Tuesday",
  cutoffDay: "monday",
  cutoffTime: "14:30",
  deliveryDay: "tuesday",
  deliveryStart: "10:00",
  deliveryEnd: "16:00",
  cycle: 1,
  multiDay: false,
};

const fri: TerritoryCycle = {
  ...tue,
  id: "fri",
  name: "Friday",
  cutoffDay: "thursday",
  deliveryDay: "friday",
  cycle: 2,
};

const sunday = new Date("2026-10-11T12:00:00");
if (daysUntilDelivery(sunday, tue) !== 2) throw new Error("Tuesday should be 2 days from Sunday");
if (nearestDeliveryRouteAmong([tue, fri], sunday)?.id !== "tue") {
  throw new Error("Nearest route from Sunday should be Tuesday");
}

console.log("Nearest delivery route tests passed.");
