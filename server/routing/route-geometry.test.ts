import { decodePolyline } from "./route-geometry.js";
import { buildSegmentWaypoints } from "../../shared/routeGeometry.js";
import type { RoutePlan } from "../../shared/types.js";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Known encoded polyline snippet (Google example): _p~iF~ps|U_ulLnnqC_mqNvxq`@
const decoded = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
assert(decoded.length >= 2, "decodePolyline should return multiple points");
assert(Math.abs(decoded[0].lat - 38.5) < 0.01, "first decoded lat");
assert(Math.abs(decoded[0].lng + 120.2) < 0.01, "first decoded lng");

const emptyPlan: RoutePlan = {
  id: "test",
  territoryId: "t",
  territoryName: "Test",
  cycleId: "c",
  batchId: "b",
  deliveryDate: "2026-09-10",
  depot: { name: "Depot", address: "310 Genet Street", city: "Scranton, PA", lat: 41.39, lng: -75.68 },
  segments: [
    {
      id: "seg1",
      label: "Truck 1",
      segmentType: "truck",
      sequence: 0,
      deliveryDate: "2026-09-10",
      startLocation: "Scranton",
      endLocation: "Scranton",
      truckCapacity: 120,
      stops: [{ stopId: "s1", position: 0 }],
      validation: {
        totalCases: 3,
        stopCount: 1,
        totalMiles: 10,
        warnings: [],
        errors: [],
        stopEtas: {},
      },
    },
  ],
  allStops: [
    {
      id: "s1",
      customerId: "c1",
      customerName: "Test Restaurant",
      address: "123 Main",
      city: "Wilkes-Barre, PA",
      territoryId: "t",
      cycleId: "c",
      cases: 3,
      lat: 41.25,
      lng: -75.88,
      orderIds: ["o1"],
      contactName: "",
      contactPhone: "",
      deliveryInstructions: "",
    },
  ],
  status: "draft",
};

const waypoints = buildSegmentWaypoints(emptyPlan);
assert(waypoints.length === 1, "one segment");
assert(waypoints[0].waypoints.length === 3, "depot -> stop -> depot");
assert(waypoints[0].waypoints[0].lat === emptyPlan.depot.lat, "starts at depot");

console.log("Route geometry tests passed.");
