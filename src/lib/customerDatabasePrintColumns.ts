import type { CustomerListItem } from "@shared/types";

export type CustomerPrintColumnId =
  | "name"
  | "lid"
  | "address"
  | "city"
  | "territory"
  | "contactName"
  | "contactPhone"
  | "email"
  | "payment"
  | "instructions"
  | "teamMembers"
  | "onOrder"
  | "orderRoute"
  | "cases";

export interface CustomerPrintColumnDef {
  id: CustomerPrintColumnId;
  label: string;
  defaultSelected: boolean;
}

export const CUSTOMER_PRINT_COLUMNS: CustomerPrintColumnDef[] = [
  { id: "name", label: "Restaurant", defaultSelected: true },
  { id: "lid", label: "LID", defaultSelected: true },
  { id: "address", label: "Address", defaultSelected: true },
  { id: "city", label: "City", defaultSelected: false },
  { id: "territory", label: "Territory", defaultSelected: true },
  { id: "contactName", label: "Contact name", defaultSelected: true },
  { id: "contactPhone", label: "Contact phone", defaultSelected: true },
  { id: "email", label: "Email", defaultSelected: true },
  { id: "payment", label: "N/A payment", defaultSelected: true },
  { id: "instructions", label: "Instructions", defaultSelected: true },
  { id: "teamMembers", label: "Team members", defaultSelected: false },
  { id: "onOrder", label: "On orders this week", defaultSelected: false },
  { id: "orderRoute", label: "Order route", defaultSelected: false },
  { id: "cases", label: "Cases (order)", defaultSelected: false },
];

export function defaultCustomerPrintColumnIds(): CustomerPrintColumnId[] {
  return CUSTOMER_PRINT_COLUMNS.filter((c) => c.defaultSelected).map((c) => c.id);
}

export function customerPrintCell(
  customer: CustomerListItem,
  columnId: CustomerPrintColumnId,
  routeNameById: (cycleId?: string) => string
): string {
  switch (columnId) {
    case "name":
      return customer.name;
    case "lid":
      return customer.outfieldLid || "—";
    case "address":
      return customer.address;
    case "city":
      return customer.city;
    case "territory":
      return customer.territoryName;
    case "contactName":
      return customer.contactName || "—";
    case "contactPhone":
      return customer.contactPhone || "—";
    case "email":
      return customer.contactEmail || "—";
    case "payment":
      return customer.paymentMethod || "—";
    case "instructions":
      return customer.deliveryInstructions || "—";
    case "teamMembers":
      return customer.teamMembers || "—";
    case "onOrder":
      return customer.hasOrder ? "Yes" : "No";
    case "orderRoute":
      return customer.hasOrder ? routeNameById(customer.orderCycleId) || "—" : "—";
    case "cases":
      return customer.hasOrder ? String(customer.cases) : "—";
    default:
      return "—";
  }
}

export function columnLabel(columnId: CustomerPrintColumnId): string {
  return CUSTOMER_PRINT_COLUMNS.find((c) => c.id === columnId)?.label ?? columnId;
}
