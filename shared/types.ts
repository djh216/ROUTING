export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type SegmentType = "day" | "truck";

export type RoutePlanStatus = "draft" | "locked";

export interface Depot {
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
}

export interface TerritoryCycle {
  id: string;
  territoryId: string;
  /** When set, orders from any listed territory belong to this route cycle. */
  territoryIds?: string[];
  name: string;
  cutoffDay: DayOfWeek;
  cutoffTime: string;
  deliveryDay: DayOfWeek;
  deliveryStart: string;
  deliveryEnd: string;
  cycle: number;
  multiDay: boolean;
  overflowDay?: DayOfWeek;
  noReturnBetweenDays?: boolean;
  /** User splits stops across truck columns manually. */
  manualTruckAssignment?: boolean;
  initialTruckCount?: number;
  /** Initial auto-split uses at least this many trucks (when manualTruckAssignment). */
  manualTruckMin?: number;
  /** Initial auto-split uses at most this many trucks (when manualTruckAssignment). */
  manualTruckMax?: number;
}

export interface Customer {
  id: string;
  name: string;
  address: string;
  city: string;
  territoryId: string;
  lat: number;
  lng: number;
  contactName: string;
  contactPhone: string;
  deliveryInstructions: string;
}

export interface CustomerUploadSummary {
  uploadedAt: string;
  customerCount: number;
  orderCount: number;
  filename?: string;
  errors: string[];
  warnings: string[];
  /** True when customers are loaded but orders must be selected manually */
  awaitingOrderSelection?: boolean;
  /** True when the active customer list came from a CSV upload */
  fromCsvUpload?: boolean;
}

/** Customer row for order selection UI */
export interface CustomerListItem extends Customer {
  territoryName: string;
  hasOrder: boolean;
  cases: number;
  /** Philadelphia only: 1 = Wed run, 2 = Thu run */
  cycle?: number;
}

export interface OrderSelectionInput {
  customerId: string;
  cases: number;
  cycle?: number;
}

/** Manual order entry — same fields as weekly CSV rows */
export interface ManualOrderInput {
  restaurantName: string;
  address: string;
  city: string;
  contactName: string;
  contactPhone: string;
  deliveryInstructions: string;
  territoryId: string;
  /** Philadelphia only: 1 = Wed run, 2 = Thu run */
  cycle?: number;
  /** Existing multi-day or multi-truck segment to append this order to. */
  segmentId?: string;
}

/** Add an existing account or new manual entry to a specific route cycle */
export type AddStopInput =
  | ManualOrderInput
  | { customerId: string; segmentId?: string };

export interface AddStopResult {
  summary: CustomerUploadSummary;
  errors: string[];
  warnings: string[];
}

export interface Order {
  id: string;
  customerId: string;
  territoryId: string;
  cycleId: string;
  cases: number;
  approvedAt: string;
  status: "approved" | "batched" | "delivered";
}

export interface Stop {
  id: string;
  customerId: string;
  customerName: string;
  address: string;
  city: string;
  territoryId: string;
  cycleId: string;
  cases: number;
  lat: number;
  lng: number;
  orderIds: string[];
  contactName: string;
  contactPhone: string;
  deliveryInstructions: string;
}

export interface StopAssignment {
  stopId: string;
  position: number;
}

export interface SegmentValidation {
  departureTime?: string;
  completionTime?: string;
  totalCases: number;
  stopCount: number;
  totalMiles: number;
  /** Total driving minutes (depot/start → stops → return if applicable) */
  totalDriveMinutes?: number;
  /** Total minutes from departure through last stop/return (drive + service + break) */
  totalRouteMinutes?: number;
  /** Mid-route driver break minutes included in this segment (0 if none) */
  driverBreakMinutes?: number;
  /** Stop after which the driver break occurs */
  driverBreakAfterStopId?: string;
  /** Google Maps (or estimated) drive minutes from previous location to each stop */
  stopDriveMinutes?: Record<string, number>;
  /** Drive minutes from the last stop back to the depot, when this segment returns */
  returnDriveMinutes?: number;
  /** Typical (non-traffic) drive minutes per stop when Google traffic data exists */
  stopBaseDriveMinutes?: Record<string, number>;
  /** Extra drive minutes vs typical (non-traffic) for each stop when Google traffic data exists */
  stopTrafficMinutes?: Record<string, number>;
  warnings: string[];
  errors: string[];
  stopEtas: Record<string, string>;
  /** Total route minutes if stops are ordered by optimization algorithm */
  optimizedRouteMinutes?: number;
  /** Total drive minutes if stops are ordered by optimization algorithm */
  optimizedDriveMinutes?: number;
  /** Difference in total route minutes between current manual route and optimized route (>0 means manual is longer) */
  timeDiffMinutes?: number;
  /** Whether current stops match the optimal stop order */
  isOptimizedOrder?: boolean;
}

export interface Segment {
  id: string;
  label: string;
  segmentType: SegmentType;
  sequence: number;
  deliveryDate: string;
  startLocation: "Scranton" | "overnight" | "previous_stop";
  endLocation: "Scranton" | "overnight" | "last_stop";
  truckCapacity: number;
  stops: StopAssignment[];
  validation: SegmentValidation;
}

export interface RoutePlan {
  id: string;
  territoryId: string;
  territoryName: string;
  cycleId: string;
  batchId: string;
  deliveryDate: string;
  depot: Depot;
  segments: Segment[];
  allStops: Stop[];
  suggestedWedThreshold?: number;
  status: RoutePlanStatus;
  /** Whether drive times came from Google Maps or straight-line estimates */
  travelTimeSource?: "google" | "osrm" | "estimated";
  /** ETAs used per-leg Google traffic at rolling departure times */
  rollingTrafficApplied?: boolean;
  /** Manual drive minutes to each stop, by segment then stop id */
  driveMinuteOverrides?: Record<string, Record<string, number>>;
  /** Manual service minutes at each stop (default 10), by segment then stop id */
  serviceMinuteOverrides?: Record<string, Record<string, number>>;
  /** Manual first-stop arrival time per segment, 24h "HH:MM" */
  firstStopTimeOverrides?: Record<string, string>;
  /** Stop id after which each segment's driver break is placed */
  driverBreakAfterStop?: Record<string, string>;
  /** User assigns stops to trucks manually. */
  manualTruckAssignment?: boolean;
  /** Total route minutes across all segments in the current plan */
  totalRouteMinutes?: number;
  /** Total route minutes if all segments were in optimized stop order */
  optimizedRouteMinutes?: number;
  /** Difference in minutes between total current route and total optimized route */
  timeDiffMinutes?: number;
  /** True if any segment order differs from optimized order */
  hasManualOrder?: boolean;
}

export interface BatchSummary {
  id: string;
  cycleId: string;
  territoryId: string;
  territoryName: string;
  cutoffAt: string;
  deliveryDate: string;
  orderCount: number;
  stopCount: number;
  totalCases: number;
  multiDay?: boolean;
  routePlanId?: string;
}
