import type { Customer, Order } from "../../shared/types.js";

function c(
  base: Omit<Customer, "contactName" | "contactPhone" | "deliveryInstructions"> & {
    contactName?: string;
    contactPhone?: string;
    deliveryInstructions?: string;
  }
): Customer {
  return {
    ...base,
    contactName: base.contactName ?? "On-site manager",
    contactPhone: base.contactPhone ?? "555-000-0000",
    deliveryInstructions: base.deliveryInstructions ?? "Standard dock delivery",
  };
}

export const CUSTOMERS: Customer[] = [
  c({ id: "c1", name: "Blue Table Restaurant", address: "123 Market St", city: "Philadelphia", territoryId: "philadelphia", lat: 39.9526, lng: -75.1652, contactName: "Maria Santos", contactPhone: "215-555-0101", deliveryInstructions: "Rear loading dock; ring bell at gate" }),
  c({ id: "c2", name: "Rittenhouse Wine Bar", address: "456 Walnut St", city: "Philadelphia", territoryId: "philadelphia", lat: 39.9493, lng: -75.171, contactName: "Tom Reed", contactPhone: "215-555-0102", deliveryInstructions: "Deliver before noon if possible" }),
  c({ id: "c3", name: "Main Line Bistro", address: "789 Lancaster Ave", city: "Wayne", territoryId: "western-philly", lat: 40.044, lng: -75.3877 }),
  c({ id: "c4", name: "Media Tavern", address: "12 State St", city: "Media", territoryId: "western-philly", lat: 39.9168, lng: -75.3877 }),
  c({ id: "c5", name: "Doylestown Inn", address: "55 Main St", city: "Doylestown", territoryId: "northern-philly", lat: 40.3101, lng: -75.1299 }),
  c({ id: "c6", name: "Harrisburg Grill", address: "200 Market St", city: "Harrisburg", territoryId: "southern-susquehanna", lat: 40.2732, lng: -76.8867 }),
  c({ id: "c7", name: "York Steakhouse", address: "88 George St", city: "York", territoryId: "southern-susquehanna", lat: 39.9626, lng: -76.7277 }),
  c({ id: "c8", name: "Strip District Market", address: "2100 Penn Ave", city: "Pittsburgh", territoryId: "pittsburgh", lat: 40.451, lng: -79.98, contactName: "James Wu", contactPhone: "412-555-0202", deliveryInstructions: "Call 30 min ahead; gate code 4521" }),
  c({ id: "c9", name: "Oakland Cafe", address: "400 Forbes Ave", city: "Pittsburgh", territoryId: "pittsburgh", lat: 40.4387, lng: -79.9536 }),
  c({ id: "c10", name: "Squirrel Hill Deli", address: "1800 Murray Ave", city: "Pittsburgh", territoryId: "pittsburgh", lat: 40.426, lng: -79.922 }),
  c({ id: "c11", name: "Scranton Supper Club", address: "300 Mulberry St", city: "Scranton", territoryId: "northeast-pa", lat: 41.4089, lng: -75.6624 }),
  c({ id: "c12", name: "Wilkes-Barre Kitchen", address: "45 Public Square", city: "Wilkes-Barre", territoryId: "northeast-pa", lat: 41.2459, lng: -75.8813 }),
  c({ id: "c13", name: "Allentown Eatery", address: "700 Hamilton St", city: "Allentown", territoryId: "lehigh-valley", lat: 40.6084, lng: -75.4902 }),
  c({ id: "c14", name: "Bethlehem Brewpub", address: "520 Main St", city: "Bethlehem", territoryId: "lehigh-valley", lat: 40.6259, lng: -75.3705 }),
  c({ id: "c15", name: "Williamsport Lodge", address: "100 Pine St", city: "Williamsport", territoryId: "northern-susquehanna", lat: 41.2412, lng: -77.0011 }),
  c({ id: "c16", name: "Sunbury Inn", address: "22 Market St", city: "Sunbury", territoryId: "northern-susquehanna", lat: 40.862, lng: -76.7941 }),
  c({ id: "c17", name: "Lawrenceville Tap", address: "3600 Butler St", city: "Pittsburgh", territoryId: "pittsburgh", lat: 40.466, lng: -79.961 }),
  c({ id: "c18", name: "South Side Works", address: "2800 Sidney St", city: "Pittsburgh", territoryId: "pittsburgh", lat: 40.428, lng: -79.969 }),
  c({ id: "c19", name: "Center City Cellars", address: "1500 Chestnut St", city: "Philadelphia", territoryId: "philadelphia", lat: 39.951, lng: -75.1665 }),
  c({ id: "c20", name: "King of Prussia Hotel", address: "1000 Mall Blvd", city: "King of Prussia", territoryId: "northern-philly", lat: 40.0893, lng: -75.3802 }),
  c({ id: "c21", name: "Shadyside Wine Shop", address: "540 S Millvale Ave", city: "Pittsburgh", territoryId: "pittsburgh", lat: 40.456, lng: -79.935 }),
  c({ id: "c22", name: "Mt. Lebanon Market", address: "300 Mt Lebanon Blvd", city: "Mt. Lebanon", territoryId: "pittsburgh", lat: 40.355, lng: -80.045 }),
];

/**
 * Demo orders for reference week of 2026-09-10 (Thursday).
 * Cutoffs: Tue/Wed/Thu at 2:30 PM ET — timestamps use local-style ISO strings.
 */
export const ORDERS: Order[] = [
  // Philadelphia cycle 1 — approved by Tue 9/8 2:30 PM
  { id: "o1", customerId: "c1", territoryId: "philadelphia", cycleId: "philadelphia-1", cases: 12, approvedAt: "2026-09-08T13:00:00", status: "approved" },
  { id: "o2", customerId: "c2", territoryId: "philadelphia", cycleId: "philadelphia-1", cases: 8, approvedAt: "2026-09-08T14:00:00", status: "approved" },
  // Philadelphia cycle 2 — approved after Tue cutoff, by Wed 9/9 2:30 PM
  { id: "o3", customerId: "c19", territoryId: "philadelphia", cycleId: "thursday-sepa", cases: 15, approvedAt: "2026-09-09T14:00:00", status: "approved" },
  { id: "o3b", customerId: "c1", territoryId: "philadelphia", cycleId: "thursday-sepa", cases: 6, approvedAt: "2026-09-09T11:00:00", status: "approved" },
  // Western Philly — Tue cutoff
  { id: "o4", customerId: "c3", territoryId: "western-philly", cycleId: "western-susquehanna-wed", cases: 10, approvedAt: "2026-09-08T12:00:00", status: "approved" },
  { id: "o5", customerId: "c4", territoryId: "western-philly", cycleId: "western-susquehanna-wed", cases: 6, approvedAt: "2026-09-08T14:15:00", status: "approved" },
  // Southern Susquehanna — combined Wed route with Western Philly
  { id: "o6", customerId: "c6", territoryId: "southern-susquehanna", cycleId: "western-susquehanna-wed", cases: 18, approvedAt: "2026-09-08T10:00:00", status: "approved" },
  { id: "o7", customerId: "c7", territoryId: "southern-susquehanna", cycleId: "western-susquehanna-wed", cases: 14, approvedAt: "2026-09-08T14:20:00", status: "approved" },
  // Pittsburgh — all approved by Tue 9/8 2:30 PM (single batch, Wed + Thu overflow)
  { id: "o8", customerId: "c8", territoryId: "pittsburgh", cycleId: "pittsburgh", cases: 20, approvedAt: "2026-09-08T11:00:00", status: "approved" },
  { id: "o9", customerId: "c9", territoryId: "pittsburgh", cycleId: "pittsburgh", cases: 12, approvedAt: "2026-09-08T12:00:00", status: "approved" },
  { id: "o10", customerId: "c10", territoryId: "pittsburgh", cycleId: "pittsburgh", cases: 8, approvedAt: "2026-09-08T13:00:00", status: "approved" },
  { id: "o11", customerId: "c17", territoryId: "pittsburgh", cycleId: "pittsburgh", cases: 16, approvedAt: "2026-09-08T13:30:00", status: "approved" },
  { id: "o12", customerId: "c18", territoryId: "pittsburgh", cycleId: "pittsburgh", cases: 10, approvedAt: "2026-09-08T14:00:00", status: "approved" },
  { id: "o12b", customerId: "c21", territoryId: "pittsburgh", cycleId: "pittsburgh", cases: 9, approvedAt: "2026-09-08T14:25:00", status: "approved" },
  { id: "o12c", customerId: "c22", territoryId: "pittsburgh", cycleId: "pittsburgh", cases: 11, approvedAt: "2026-09-08T09:00:00", status: "approved" },
  // Northern Philly — Wed 9/9 2:30 PM cutoff
  { id: "o13", customerId: "c5", territoryId: "northern-philly", cycleId: "thursday-sepa", cases: 9, approvedAt: "2026-09-09T14:00:00", status: "approved" },
  { id: "o14", customerId: "c20", territoryId: "northern-philly", cycleId: "thursday-sepa", cases: 22, approvedAt: "2026-09-09T13:00:00", status: "approved" },
  // Friday territories — Thu 9/10 2:30 PM cutoff
  { id: "o15", customerId: "c11", territoryId: "northeast-pa", cycleId: "lehigh-northeast-fri", cases: 6, approvedAt: "2026-09-10T10:00:00", status: "approved" },
  { id: "o16", customerId: "c12", territoryId: "northeast-pa", cycleId: "lehigh-northeast-fri", cases: 14, approvedAt: "2026-09-10T12:00:00", status: "approved" },
  { id: "o17", customerId: "c13", territoryId: "lehigh-valley", cycleId: "lehigh-northeast-fri", cases: 11, approvedAt: "2026-09-10T11:00:00", status: "approved" },
  { id: "o18", customerId: "c14", territoryId: "lehigh-valley", cycleId: "lehigh-northeast-fri", cases: 7, approvedAt: "2026-09-10T13:00:00", status: "approved" },
  { id: "o19", customerId: "c15", territoryId: "northern-susquehanna", cycleId: "northern-susquehanna", cases: 13, approvedAt: "2026-09-10T14:00:00", status: "approved" },
  { id: "o20", customerId: "c16", territoryId: "northern-susquehanna", cycleId: "northern-susquehanna", cases: 9, approvedAt: "2026-09-10T09:30:00", status: "approved" },
];

export function getCustomerById(id: string): Customer | undefined {
  return CUSTOMERS.find((c) => c.id === id);
}
