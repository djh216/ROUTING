import type { AddStopInput, BatchSummary, CustomerListItem, CustomerUploadSummary, ManualOrderInput, OrderSelectionInput, RoutePlan } from "@shared/types";

const API = import.meta.env.VITE_API_URL ?? "/api";

export async function fetchBatches(): Promise<BatchSummary[]> {
  const res = await fetch(`${API}/batches`);
  if (!res.ok) throw new Error("Failed to load batches");
  return res.json();
}

export async function fetchUploadStatus(): Promise<CustomerUploadSummary | null> {
  const res = await fetch(`${API}/customers/status`);
  if (!res.ok) throw new Error("Failed to load upload status");
  return res.json();
}

export async function uploadCustomersCsv(csvText: string, filename: string): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/customers/upload?filename=${encodeURIComponent(filename)}`, {
    method: "POST",
    headers: { "Content-Type": "text/csv" },
    body: csvText,
  });
  const data = (await res.json()) as CustomerUploadSummary;
  if (!res.ok) return data;
  return data;
}

export async function resetCustomers(): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/customers/reset`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to reset customers");
  return res.json();
}

export async function regeocodeCustomers(): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/customers/regeocode`, { method: "POST" });
  const data = (await res.json()) as CustomerUploadSummary;
  if (!res.ok) throw new Error(data.errors?.[0] ?? "Failed to re-geocode addresses");
  return data;
}

export async function fetchCustomerList(): Promise<CustomerListItem[]> {
  const res = await fetch(`${API}/customers`);
  if (!res.ok) throw new Error("Failed to load customers");
  return res.json();
}

export async function fetchTerritories(): Promise<{ territoryId: string; name: string }[]> {
  const res = await fetch(`${API}/territories`);
  if (!res.ok) throw new Error("Failed to load territories");
  return res.json();
}

export async function addManualOrder(input: ManualOrderInput): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/customers/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as CustomerUploadSummary;
  if (!res.ok && data.errors?.length) return data;
  if (!res.ok) throw new Error("Failed to add manual order");
  return data;
}

export async function applyOrderSelection(
  selections: OrderSelectionInput[]
): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/orders/selection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selections }),
  });
  const data = (await res.json()) as CustomerUploadSummary;
  if (!res.ok && data.errors?.length) return data;
  if (!res.ok) throw new Error("Failed to apply order selection");
  return data;
}

export async function removeOrderForCustomer(customerId: string): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/orders/customer/${encodeURIComponent(customerId)}`, {
    method: "DELETE",
  });
  const data = (await res.json()) as CustomerUploadSummary;
  if (!res.ok && data.errors?.length) return data;
  if (!res.ok) throw new Error("Failed to remove order");
  return data;
}

export async function clearRouteOrders(cycleId: string): Promise<CustomerUploadSummary> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/orders`, {
    method: "DELETE",
  });
  const data = (await res.json()) as CustomerUploadSummary;
  if (!res.ok && data.errors?.length) return data;
  if (!res.ok) throw new Error("Failed to clear route");
  return data;
}

export async function fetchAvailableCustomersForRoute(
  cycleId: string
): Promise<CustomerListItem[]> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/available-customers`);
  if (!res.ok) throw new Error("Failed to load available customers");
  return res.json();
}

export interface AddStopResponse {
  summary: CustomerUploadSummary;
  plan: RoutePlan;
  errors: string[];
  warnings: string[];
}

export async function addStopToRoute(
  cycleId: string,
  input: AddStopInput
): Promise<AddStopResponse> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/add-stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as AddStopResponse;
  if (!res.ok && data.errors?.length) return data;
  if (!res.ok) throw new Error("Failed to add stop to route");
  return data;
}

export async function fetchRoutePlan(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}`);
  if (!res.ok) throw new Error("Failed to load route plan");
  return res.json();
}

export async function reoptimizeSegments(
  cycleId: string,
  segmentId?: string
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/reoptimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(segmentId ? { segmentId } : {}),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to re-optimize route");
  }
  return res.json();
}

export async function updateSegments(
  cycleId: string,
  segments: { segmentId: string; stops: { stopId: string; position: number }[] }[]
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/segments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segments }),
  });
  if (!res.ok) throw new Error("Failed to update segments");
  return res.json();
}

export async function setFirstStopTime(
  cycleId: string,
  segmentId: string,
  time: string | null
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/first-stop-time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentId, time }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to update first stop time");
  }
  return res.json();
}

export async function setStopDriveTime(
  cycleId: string,
  segmentId: string,
  stopId: string,
  minutes: number | null
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/drive-time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentId, stopId, minutes }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to update drive time");
  }
  return res.json();
}

export async function setDriverBreak(
  cycleId: string,
  segmentId: string,
  enabled: boolean,
  afterStopId?: string
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/driver-break`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentId, enabled, afterStopId }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to update driver break");
  }
  return res.json();
}

export async function setStopServiceTime(
  cycleId: string,
  segmentId: string,
  stopId: string,
  minutes: number | null
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/service-time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segmentId, stopId, minutes }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to update service time");
  }
  return res.json();
}

export async function setWedThreshold(cycleId: string, threshold: number): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/wed-threshold`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threshold }),
  });
  if (!res.ok) throw new Error("Failed to set threshold");
  return res.json();
}

export async function assignStopToTruck(
  cycleId: string,
  stopId: string,
  truckNumber: number
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/assign-truck`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopId, truckNumber }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to assign stop to truck");
  }
  return res.json();
}

export async function updateStopDeliveryInstructions(
  cycleId: string,
  stopId: string,
  deliveryInstructions: string
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/stop-instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopId, deliveryInstructions }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to update delivery instructions");
  }
  return res.json();
}

export async function updateStopContact(
  cycleId: string,
  stopId: string,
  contactName: string,
  contactPhone: string
): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${encodeURIComponent(cycleId)}/stop-contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopId, contactName, contactPhone }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to update contact");
  }
  return res.json();
}

export async function addTruck(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/add-truck`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to add truck");
  return res.json();
}

export async function resetRoute(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/reset`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to reset route");
  return res.json();
}

export async function unlockRoute(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/unlock`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to unlock route");
  return res.json();
}

export async function lockRoute(cycleId: string): Promise<RoutePlan> {
  const res = await fetch(`${API}/routes/${cycleId}/lock`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to lock route");
  return res.json();
}

import type {
  RouteGeometryResult,
  RouteLegInfo,
  SegmentGeometry,
  SegmentTrafficAlert,
  TrafficDelayLevel,
} from "@shared/routeGeometry";

export type { RouteLegInfo, SegmentTrafficAlert, TrafficDelayLevel };
export type RouteGeometrySegment = SegmentGeometry;
export type RouteGeometryResponse = RouteGeometryResult;

export async function fetchRouteGeometry(
  cycleId: string,
  body?: { segments: { segmentId: string; stops: { stopId: string; position: number }[] }[] },
  signal?: AbortSignal
): Promise<RouteGeometryResponse> {
  const res = await fetch(`${API}/routes/${cycleId}/geometry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!res.ok) throw new Error("Failed to load route geometry");
  return res.json();
}
