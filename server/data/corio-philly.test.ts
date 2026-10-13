import {
  addOrderSelections,
  getCustomerListItems,
  getOrders,
  importWeeklyCustomersCsv,
} from "./customer-store.js";
import { buildRoutePlan } from "../routing/planner.js";
import { isOrderEligible } from "../routing/scheduling.js";
import { getCycleById } from "./territories.js";

const REF = new Date("2026-09-10T12:00:00");
const csv = `restaurant_name,street,city,territory,contact_name,phone,delivery_instructions,cases,cycle
Corio,123 Main,Wayne,Western Philly Suburbs,Maria,215-555-0100,Rear dock,6,1`;

const imported = await importWeeklyCustomersCsv(csv, REF, "test.csv");
if (imported.errors.length) throw new Error(imported.errors.join("; "));
const corio = getCustomerListItems().find((c) => c.name === "Corio");
if (!corio) throw new Error("Corio not imported");

const r = addOrderSelections([{ customerId: corio.id, cases: 6 }], REF, "philadelphia-1");
if (r.errors.length) throw new Error(r.errors.join("; "));

const order = getOrders().find((o) => o.customerId === corio.id);
if (order?.cycleId !== "philadelphia-1") {
  throw new Error(`Expected philadelphia-1, got ${order?.cycleId}`);
}

const phil = getCycleById("philadelphia-1")!;
if (!isOrderEligible(order!, phil, REF)) {
  throw new Error("Order should be eligible for Philadelphia");
}

const { plan } = await buildRoutePlan("philadelphia-1", getOrders(), REF);
if (!plan.allStops.some((s) => s.customerName === "Corio")) {
  throw new Error(`Corio not on plan: ${plan.allStops.map((s) => s.customerName).join(", ")}`);
}

console.log("Corio Philadelphia test passed.");
