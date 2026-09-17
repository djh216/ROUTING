import {
  DEFAULT_TRUCK_CAPACITY,
  DRIVER_BREAK_MINUTES,
  MAX_DRIVER_HOURS,
  SCRANTON_DEPOT,
  SERVICE_MINUTES_PER_STOP,
  driverBreakAfterStopIndex,
} from "../../shared/constants.js";
import {
  formatMinutesAsTime,
  formatTimeOfDay,
  parseDeliveryTime,
} from "../../shared/timeFormat.js";
import type {
  Depot,
  Order,
  RoutePlan,
  Segment,
  SegmentValidation,
  Stop,
  StopAssignment,
  TerritoryCycle,
} from "../../shared/types.js";
import { getCustomerById } from "../data/customer-store.js";
import { getCycleById } from "../data/territories.js";
import {
  cutoffDateTime,
  deliveryDateForCycle,
  isOrderEligible,
} from "./scheduling.js";
import {
  buildTravelMatrix,
  computeRollingSegmentDriveTimes,
  createEstimatedTravelMatrix,
  deliveryDepartureTimestamp,
  type GeoPoint,
  type TravelMatrix,
} from "./travel-time.js";
import { getStopPriorityFilter } from "./route-priorities.js";

export { cutoffDateTime, deliveryDateForCycle, isOrderEligible } from "./scheduling.js";

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseTime(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(minutes: number): string {
  return formatMinutesAsTime(minutes);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function stopPoint(stop: Stop): GeoPoint {
  return { lat: stop.lat, lng: stop.lng };
}

export function ordersToStops(orders: Order[]): Stop[] {
  const byCustomer = new Map<string, Order[]>();
  for (const order of orders) {
    const list = byCustomer.get(order.customerId) ?? [];
    list.push(order);
    byCustomer.set(order.customerId, list);
  }

  const stops: Stop[] = [];
  for (const [customerId, customerOrders] of byCustomer) {
    const customer = getCustomerById(customerId);
    if (!customer) continue;
    stops.push({
      id: `stop-${customerId}`,
      customerId,
      customerName: customer.name,
      address: customer.address,
      city: customer.city,
      territoryId: customer.territoryId,
      cycleId: customerOrders[0].cycleId,
      cases: customerOrders.reduce((s, o) => s + o.cases, 0),
      lat: customer.lat,
      lng: customer.lng,
      orderIds: customerOrders.map((o) => o.id),
      contactName: customer.contactName,
      contactPhone: customer.contactPhone,
      deliveryInstructions: customer.deliveryInstructions,
    });
  }
  return stops;
}

function nearestNeighborFrom(
  stops: Stop[],
  start: GeoPoint,
  matrix: TravelMatrix
): Stop[] {
  if (stops.length === 0) return [];
  const remaining = [...stops];
  const ordered: Stop[] = [];
  let cur = start;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestCost = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cost = legVehicleMinutes(cur, stopPoint(remaining[i]), matrix);
      if (cost < bestCost) {
        bestCost = cost;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    cur = stopPoint(next);
  }
  return ordered;
}

function nearestNeighborOrder(stops: Stop[], depot: Depot, matrix: TravelMatrix): Stop[] {
  return nearestNeighborFrom(stops, { lat: depot.lat, lng: depot.lng }, matrix);
}

export { nearestNeighborOrder };

function routeVehicleMinutes(
  stops: Stop[],
  start: GeoPoint,
  returnToDepot: boolean,
  depot: Depot,
  matrix: TravelMatrix
): number {
  if (stops.length === 0) return 0;
  let total = stops.length * SERVICE_MINUTES_PER_STOP;
  let cur = start;
  for (const s of stops) {
    total += matrix.getDurationMinutes(cur, stopPoint(s));
    cur = stopPoint(s);
  }
  if (returnToDepot) {
    total += matrix.getDurationMinutes(cur, { lat: depot.lat, lng: depot.lng });
  }
  return total;
}

/** Marginal vehicle time to visit a stop from the current location (drive + unload). */
function legVehicleMinutes(from: GeoPoint, to: GeoPoint, matrix: TravelMatrix): number {
  return matrix.getDurationMinutes(from, to) + SERVICE_MINUTES_PER_STOP;
}

function routeDistanceMiles(
  stops: Stop[],
  start: GeoPoint,
  returnToDepot: boolean,
  depot: Depot,
  matrix: TravelMatrix
): number {
  if (stops.length === 0) return 0;
  let total = 0;
  let cur = start;
  for (const s of stops) {
    total += matrix.getDistanceMiles(cur, stopPoint(s));
    cur = stopPoint(s);
  }
  if (returnToDepot) {
    total += matrix.getDistanceMiles(cur, { lat: depot.lat, lng: depot.lng });
  }
  return total;
}

function twoOptSwap(route: Stop[], i: number, j: number): Stop[] {
  const next = route.slice(0, i);
  const reversed = route.slice(i, j + 1).reverse();
  const tail = route.slice(j + 1);
  return [...next, ...reversed, ...tail];
}

function twoOptImprove(
  route: Stop[],
  start: GeoPoint,
  returnToDepot: boolean,
  depot: Depot,
  matrix: TravelMatrix
): Stop[] {
  if (route.length < 3) return route;
  let best = [...route];
  let bestCost = routeVehicleMinutes(best, start, returnToDepot, depot, matrix);
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = twoOptSwap(best, i, j);
        const cost = routeVehicleMinutes(candidate, start, returnToDepot, depot, matrix);
        if (cost + 0.01 < bestCost) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

/** Find stop order that minimizes total time in the delivery vehicle (drive + delivery at each stop). */
function optimizeStopOrderCore(
  stops: Stop[],
  start: GeoPoint,
  depot: Depot,
  returnToDepot: boolean,
  matrix: TravelMatrix
): Stop[] {
  if (stops.length <= 1) return [...stops];

  let bestRoute = nearestNeighborFrom(stops, start, matrix);
  bestRoute = twoOptImprove(bestRoute, start, returnToDepot, depot, matrix);
  let bestCost = routeVehicleMinutes(bestRoute, start, returnToDepot, depot, matrix);

  for (const first of stops) {
    const rest = stops.filter((s) => s.id !== first.id);
    const restOrdered = nearestNeighborFrom(rest, stopPoint(first), matrix);
    let candidate = [first, ...restOrdered];
    candidate = twoOptImprove(candidate, start, returnToDepot, depot, matrix);
    const cost = routeVehicleMinutes(candidate, start, returnToDepot, depot, matrix);
    if (cost + 0.01 < bestCost) {
      bestCost = cost;
      bestRoute = candidate;
    }
  }

  return bestRoute;
}

export function optimizeStopOrder(
  stops: Stop[],
  startLat: number,
  startLng: number,
  depot: Depot,
  returnToDepot: boolean,
  matrix: TravelMatrix,
  priorityFilter?: (stop: Stop) => boolean
): Stop[] {
  if (stops.length <= 1) return [...stops];
  const start: GeoPoint = { lat: startLat, lng: startLng };

  if (priorityFilter) {
    const priority = stops.filter(priorityFilter);
    const rest = stops.filter((s) => !priorityFilter(s));
    if (priority.length > 0 && rest.length > 0) {
      const priorityRoute = optimizeStopOrderCore(priority, start, depot, false, matrix);
      const last = priorityRoute[priorityRoute.length - 1];
      const restStart = last ? stopPoint(last) : start;
      const restRoute = optimizeStopOrderCore(rest, restStart, depot, returnToDepot, matrix);
      return [...priorityRoute, ...restRoute];
    }
  }

  return optimizeStopOrderCore(stops, start, depot, returnToDepot, matrix);
}

function assignStopsToTrucks(
  stops: Stop[],
  capacity: number,
  depot: Depot,
  matrix: TravelMatrix,
  priorityFilter?: (stop: Stop) => boolean
): Stop[][] {
  if (stops.length === 0) return [[]];

  const remaining = [...stops];
  const trucks: Stop[][] = [];

  while (remaining.length > 0) {
    const truck: Stop[] = [];
    let cases = 0;
    let cur: GeoPoint = { lat: depot.lat, lng: depot.lng };

    while (remaining.length > 0) {
      const priorityPool =
        priorityFilter && remaining.some(priorityFilter)
          ? remaining.filter(priorityFilter)
          : remaining;

      let bestIdx = -1;
      let bestCost = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        if (!priorityPool.includes(remaining[i])) continue;
        const wouldExceed = cases + remaining[i].cases > capacity && truck.length > 0;
        if (wouldExceed) continue;
        const cost = legVehicleMinutes(cur, stopPoint(remaining[i]), matrix);
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      const next = remaining.splice(bestIdx, 1)[0];
      truck.push(next);
      cases += next.cases;
      cur = stopPoint(next);
    }

    if (truck.length === 0) {
      truck.push(remaining.shift()!);
    }

    trucks.push(
      optimizeStopOrder(truck, depot.lat, depot.lng, depot, true, matrix, priorityFilter)
    );
  }

  return trucks;
}

interface LegSimulation {
  feasible: boolean;
  departureTime: number;
  completionTime: number;
  totalMiles: number;
  totalDriveMinutes: number;
  totalRouteMinutes: number;
  stopEtas: Record<string, string>;
  stopDriveMinutes: Record<string, number>;
  warnings: string[];
  errors: string[];
}

function serviceMinutesForStop(
  stopId: string,
  serviceOverrides?: Record<string, number>
): number {
  const override = serviceOverrides?.[stopId];
  if (override != null && !Number.isNaN(override)) {
    return Math.max(SERVICE_MINUTES_PER_STOP, Math.round(override));
  }
  return SERVICE_MINUTES_PER_STOP;
}

function driveMinutesForStop(
  stopId: string,
  from: GeoPoint,
  to: GeoPoint,
  matrix: TravelMatrix,
  driveOverrides?: Record<string, number>,
  rollingDriveMinutes?: Record<string, number>
): number {
  const override = driveOverrides?.[stopId];
  if (override != null && !Number.isNaN(override)) {
    return Math.max(0, override);
  }
  const rolling = rollingDriveMinutes?.[stopId];
  if (rolling != null && !Number.isNaN(rolling)) {
    return Math.max(0, rolling);
  }
  return matrix.getDurationMinutes(from, to);
}

function simulateLeg(
  stopIds: string[],
  stopMap: Map<string, Stop>,
  depot: Depot,
  windowStart: string,
  windowEnd: string,
  start: GeoPoint,
  returnToDepot: boolean,
  matrix: TravelMatrix,
  driveOverrides?: Record<string, number>,
  firstStopArrivalMinutes?: number,
  rollingDriveMinutes?: Record<string, number>,
  rollingReturnMinutes?: number,
  serviceOverrides?: Record<string, number>,
  breakAfterStopIndex = -1
): LegSimulation {
  const warnings: string[] = [];
  const errors: string[] = [];
  const stopEtas: Record<string, string> = {};
  const stopDriveMinutes: Record<string, number> = {};
  const winStart = parseTime(windowStart);
  const winEnd = parseTime(windowEnd);

  if (stopIds.length === 0) {
    return {
      feasible: true,
      departureTime: winStart,
      completionTime: winStart,
      totalMiles: 0,
      totalDriveMinutes: 0,
      totalRouteMinutes: 0,
      stopEtas,
      stopDriveMinutes,
      warnings,
      errors,
    };
  }

  const first = stopMap.get(stopIds[0])!;
  const travelToFirstMinutes = driveMinutesForStop(
    stopIds[0],
    start,
    stopPoint(first),
    matrix,
    driveOverrides,
    rollingDriveMinutes
  );
  stopDriveMinutes[stopIds[0]] = Math.round(travelToFirstMinutes);
  let totalDriveMinutes = travelToFirstMinutes;
  const firstArrival = firstStopArrivalMinutes ?? winStart;
  const departureTime = firstArrival - travelToFirstMinutes;

  const orderedStops = stopIds
    .map((id) => stopMap.get(id))
    .filter((s): s is Stop => !!s);

  let totalMiles = routeDistanceMiles(orderedStops, start, returnToDepot, depot, matrix);
  let t = firstArrival;
  stopEtas[stopIds[0]] = formatTime(firstArrival);
  if (firstArrival > winEnd) {
    errors.push(
      `${first.customerName}: ETA ${formatTime(firstArrival)} is after ${formatTimeOfDay(windowEnd)}`
    );
  } else if (firstArrival > winEnd - 30) {
    warnings.push(`${first.customerName}: tight window (ETA ${formatTime(firstArrival)})`);
  }
  if (firstArrival < winStart) {
    warnings.push(
      `First stop at ${formatTime(firstArrival)} is before the default ${formatTimeOfDay(windowStart)} window start`
    );
  }
  t += serviceMinutesForStop(stopIds[0], serviceOverrides);
  if (breakAfterStopIndex === 0) {
    t += DRIVER_BREAK_MINUTES;
  }

  let cur = stopPoint(first);

  for (let i = 1; i < stopIds.length; i++) {
    const stopId = stopIds[i];
    const stop = stopMap.get(stopId);
    if (!stop) continue;
    const driveMinutes = driveMinutesForStop(
      stopId,
      cur,
      stopPoint(stop),
      matrix,
      driveOverrides,
      rollingDriveMinutes
    );
    stopDriveMinutes[stopId] = Math.round(driveMinutes);
    totalDriveMinutes += driveMinutes;
    t += driveMinutes;
    if (t > winEnd) {
      errors.push(`${stop.customerName}: ETA ${formatTime(t)} is after ${formatTimeOfDay(windowEnd)}`);
    } else if (t > winEnd - 30) {
      warnings.push(`${stop.customerName}: tight window (ETA ${formatTime(t)})`);
    }
    stopEtas[stopId] = formatTime(t);
    t += serviceMinutesForStop(stopId, serviceOverrides);
    if (breakAfterStopIndex === i) {
      t += DRIVER_BREAK_MINUTES;
    }
    cur = stopPoint(stop);
  }

  if (returnToDepot) {
    const returnMinutes =
      rollingReturnMinutes ??
      matrix.getDurationMinutes(cur, { lat: depot.lat, lng: depot.lng });
    totalDriveMinutes += returnMinutes;
    t += returnMinutes;
  }

  const driverHours = (t - departureTime) / 60;
  if (driverHours > MAX_DRIVER_HOURS) {
    errors.push(`Driver hours (${driverHours.toFixed(1)}) exceed ${MAX_DRIVER_HOURS}h limit`);
  }

  if (departureTime < 4 * 60) {
    warnings.push(`Early departure required: ${formatTime(departureTime)}`);
  }

  return {
    feasible: errors.length === 0,
    departureTime,
    completionTime: t,
    totalMiles,
    totalDriveMinutes: Math.round(totalDriveMinutes),
    totalRouteMinutes: Math.round(t - departureTime),
    stopEtas,
    stopDriveMinutes,
    warnings,
    errors,
  };
}

export function suggestWedThreshold(
  orderedStopIds: string[],
  stopMap: Map<string, Stop>,
  depot: Depot,
  windowStart: string,
  windowEnd: string,
  matrix: TravelMatrix,
  maxDayOneDriverHours = 8
): number {
  let best = 0;
  const depotPoint = { lat: depot.lat, lng: depot.lng };
  for (let n = 1; n <= orderedStopIds.length; n++) {
    const leg = simulateLeg(
      orderedStopIds.slice(0, n),
      stopMap,
      depot,
      windowStart,
      windowEnd,
      depotPoint,
      false,
      matrix
    );
    const driverHours = (leg.completionTime - leg.departureTime) / 60;
    if (leg.feasible && driverHours <= maxDayOneDriverHours) best = n;
    else break;
  }
  return best;
}

function generateOrderedPartitions(ordered: Stop[], truckCount: number): Stop[][][] {
  const n = ordered.length;
  if (truckCount <= 0 || truckCount > n) return [];

  const results: Stop[][][] = [];

  function collect(start: number, parts: Stop[][], depth: number) {
    if (depth === truckCount - 1) {
      if (start < n) {
        results.push([...parts, ordered.slice(start)]);
      }
      return;
    }
    for (let end = start + 1; end <= n - (truckCount - depth - 1); end++) {
      collect(end, [...parts, ordered.slice(start, end)], depth + 1);
    }
  }

  collect(0, [], 0);
  return results;
}

interface TruckAssignmentEvaluation {
  feasible: boolean;
  loadSpread: number;
  stopSpread: number;
  clusterSpread: number;
  totalDrive: number;
  truckCount: number;
  groups: Stop[][];
}

function clusterMaxDiameterMiles(group: Stop[]): number {
  if (group.length <= 1) return 0;
  let max = 0;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      max = Math.max(
        max,
        haversineMiles(group[i].lat, group[i].lng, group[j].lat, group[j].lng)
      );
    }
  }
  return max;
}

function kMeansClusterStops(stops: Stop[], truckCount: number): Stop[][] {
  if (truckCount <= 0) return [];
  if (truckCount >= stops.length) return stops.map((stop) => [stop]);

  const sorted = [...stops].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  const centroids: GeoPoint[] = [];
  for (let i = 0; i < truckCount; i++) {
    const idx = Math.min(
      stops.length - 1,
      Math.floor(((i + 0.5) * stops.length) / truckCount)
    );
    centroids.push({ lat: sorted[idx].lat, lng: sorted[idx].lng });
  }

  const assignments = new Array(stops.length).fill(0);

  for (let iter = 0; iter < 24; iter++) {
    let changed = false;
    for (let i = 0; i < stops.length; i++) {
      let bestCluster = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < truckCount; c++) {
        const distance = haversineMiles(
          stops[i].lat,
          stops[i].lng,
          centroids[c].lat,
          centroids[c].lng
        );
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed) break;

    const sums = Array.from({ length: truckCount }, () => ({ lat: 0, lng: 0, count: 0 }));
    for (let i = 0; i < stops.length; i++) {
      const bucket = sums[assignments[i]];
      bucket.lat += stops[i].lat;
      bucket.lng += stops[i].lng;
      bucket.count += 1;
    }
    for (let c = 0; c < truckCount; c++) {
      if (sums[c].count > 0) {
        centroids[c] = {
          lat: sums[c].lat / sums[c].count,
          lng: sums[c].lng / sums[c].count,
        };
      }
    }
  }

  const clusters: Stop[][] = Array.from({ length: truckCount }, () => []);
  for (let i = 0; i < stops.length; i++) {
    clusters[assignments[i]].push(stops[i]);
  }
  return clusters.filter((group) => group.length > 0);
}

function evaluateTruckGroups(
  groups: Stop[][],
  stopMap: Map<string, Stop>,
  depot: Depot,
  cycle: TerritoryCycle,
  matrix: TravelMatrix,
  priorityFilter?: (stop: Stop) => boolean
): TruckAssignmentEvaluation {
  const activeGroups = groups.filter((group) => group.length > 0);
  const optimized = optimizeSegmentOrders(
    activeGroups,
    depot,
    cycle,
    matrix,
    priorityFilter
  );

  const caseLoads: number[] = [];
  const stopCounts: number[] = [];
  let totalDrive = 0;

  for (const group of optimized) {
    const cases = group.reduce((sum, stop) => sum + stop.cases, 0);
    if (cases > DEFAULT_TRUCK_CAPACITY) {
      return {
        feasible: false,
        loadSpread: Infinity,
        stopSpread: Infinity,
        clusterSpread: Infinity,
        totalDrive: Infinity,
        truckCount: optimized.length,
        groups: optimized,
      };
    }

    const leg = simulateLeg(
      group.map((stop) => stop.id),
      stopMap,
      depot,
      cycle.deliveryStart,
      cycle.deliveryEnd,
      { lat: depot.lat, lng: depot.lng },
      true,
      matrix
    );

    if (!leg.feasible) {
      return {
        feasible: false,
        loadSpread: Infinity,
        stopSpread: Infinity,
        clusterSpread: Infinity,
        totalDrive: Infinity,
        truckCount: optimized.length,
        groups: optimized,
      };
    }

    caseLoads.push(cases);
    stopCounts.push(group.length);
    totalDrive += leg.totalDriveMinutes;
  }

  const loadSpread =
    caseLoads.length > 0 ? Math.max(...caseLoads) - Math.min(...caseLoads) : 0;
  const stopSpread =
    stopCounts.length > 0 ? Math.max(...stopCounts) - Math.min(...stopCounts) : 0;
  const clusterSpread = optimized.reduce(
    (sum, group) => sum + clusterMaxDiameterMiles(group),
    0
  );

  return {
    feasible: true,
    loadSpread,
    stopSpread,
    clusterSpread,
    totalDrive,
    truckCount: optimized.length,
    groups: optimized,
  };
}

function isBetterTruckAssignment(
  candidate: TruckAssignmentEvaluation,
  best: TruckAssignmentEvaluation | null
): boolean {
  if (!best) return true;
  if (candidate.clusterSpread !== best.clusterSpread) {
    return candidate.clusterSpread < best.clusterSpread;
  }
  if (candidate.totalDrive !== best.totalDrive) {
    return candidate.totalDrive < best.totalDrive;
  }
  if (candidate.stopSpread !== best.stopSpread) {
    return candidate.stopSpread < best.stopSpread;
  }
  return candidate.truckCount < best.truckCount;
}

function geographicPartitionOrderings(stops: Stop[]): Stop[][] {
  const byLat = [...stops].sort((a, b) => b.lat - a.lat || a.lng - b.lng);
  const byLng = [...stops].sort((a, b) => a.lng - b.lng || b.lat - a.lat);
  const seen = new Set<string>();
  const orderings: Stop[][] = [];
  for (const ordering of [byLat, byLng]) {
    const key = ordering.map((stop) => stop.id).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    orderings.push(ordering);
  }
  return orderings;
}

/** Split stops across 2–3 trucks for manual-assignment routes (initial build only). */
function assignInitialManualTruckRoutes(
  stops: Stop[],
  depot: Depot,
  cycle: TerritoryCycle,
  matrix: TravelMatrix,
  priorityFilter?: (stop: Stop) => boolean
): Stop[][] {
  const minTrucks = Math.max(1, cycle.manualTruckMin ?? cycle.initialTruckCount ?? 2);
  const maxTrucks = Math.max(minTrucks, cycle.manualTruckMax ?? 3);
  const minColumns = Math.max(minTrucks, cycle.initialTruckCount ?? minTrucks);

  if (stops.length === 0) {
    return Array.from({ length: minColumns }, () => []);
  }

  const stopMap = new Map(stops.map((s) => [s.id, s]));
  const partitionOrderings = geographicPartitionOrderings(stops);

  if (stops.length === 1) {
    const groups = [stops];
    while (groups.length < minColumns) groups.push([]);
    return groups;
  }

  let best: TruckAssignmentEvaluation | null = null;

  const consider = (groups: Stop[][]) => {
    const evaluated = evaluateTruckGroups(
      groups,
      stopMap,
      depot,
      cycle,
      matrix,
      priorityFilter
    );
    if (!evaluated.feasible) return;
    if (isBetterTruckAssignment(evaluated, best)) {
      best = evaluated;
    }
  };

  for (let truckCount = minTrucks; truckCount <= maxTrucks; truckCount++) {
    if (truckCount > stops.length) continue;

    consider(kMeansClusterStops(stops, truckCount));

    for (const ordering of partitionOrderings) {
      for (const partition of generateOrderedPartitions(ordering, truckCount)) {
        consider(partition);
      }
    }
  }

  if (best) {
    while (best.groups.length < minColumns) {
      best.groups.push([]);
    }
    return best.groups;
  }

  const fallbackCount = Math.min(maxTrucks, Math.max(minTrucks, stops.length));
  const chunkSize = Math.ceil(stops.length / fallbackCount);
  const fallbackGroups: Stop[][] = [];
  const fallbackOrder = [...stops].sort((a, b) => b.lat - a.lat || a.lng - b.lng);
  for (let i = 0; i < fallbackCount; i++) {
    fallbackGroups.push(fallbackOrder.slice(i * chunkSize, (i + 1) * chunkSize));
  }
  const evaluatedFallback = evaluateTruckGroups(
    fallbackGroups.filter((g) => g.length > 0),
    stopMap,
    depot,
    cycle,
    matrix,
    priorityFilter
  );
  const groups = evaluatedFallback.groups;
  while (groups.length < minColumns) {
    groups.push([]);
  }
  return groups;
}

function optimizeSegmentOrders(
  segmentGroups: Stop[][],
  depot: Depot,
  cycle: TerritoryCycle,
  matrix: TravelMatrix,
  priorityFilter?: (stop: Stop) => boolean
): Stop[][] {
  let prevLat = depot.lat;
  let prevLng = depot.lng;

  return segmentGroups.map((group, idx) => {
    if (group.length === 0) return group;
    const isPittsburgh = cycle.multiDay;
    const startLat = idx > 0 && isPittsburgh ? prevLat : depot.lat;
    const startLng = idx > 0 && isPittsburgh ? prevLng : depot.lng;
    const returnToDepot =
      !isPittsburgh || (isPittsburgh && idx === segmentGroups.length - 1);

    const optimized = optimizeStopOrder(
      group,
      startLat,
      startLng,
      depot,
      returnToDepot,
      matrix,
      priorityFilter
    );

    const last = optimized[optimized.length - 1];
    if (last) {
      prevLat = last.lat;
      prevLng = last.lng;
    }
    return optimized;
  });
}

function validateSegment(
  segment: Omit<Segment, "validation">,
  stopMap: Map<string, Stop>,
  depot: Depot,
  cycle: TerritoryCycle,
  matrix: TravelMatrix,
  prevEndLat?: number,
  prevEndLng?: number,
  driveOverrides?: Record<string, number>,
  firstStopTime?: string,
  rollingDriveMinutes?: Record<string, number>,
  rollingReturnMinutes?: number,
  rollingBaseDriveMinutes?: Record<string, number>,
  rollingTrafficMinutes?: Record<string, number>,
  serviceOverrides?: Record<string, number>,
  breakAfterStopId?: string
): SegmentValidation {
  const stopIds = segment.stops.map((s) => s.stopId);
  const breakAfterStopIndex = breakAfterStopId
    ? stopIds.indexOf(breakAfterStopId)
    : -1;
  const start: GeoPoint =
    segment.startLocation === "Scranton"
      ? { lat: depot.lat, lng: depot.lng }
      : { lat: prevEndLat ?? depot.lat, lng: prevEndLng ?? depot.lng };

  const firstStopArrivalMinutes = firstStopTime
    ? parseDeliveryTime(firstStopTime) ?? undefined
    : undefined;

  const leg = simulateLeg(
    stopIds,
    stopMap,
    depot,
    cycle.deliveryStart,
    cycle.deliveryEnd,
    start,
    segment.endLocation === "Scranton",
    matrix,
    driveOverrides,
    firstStopArrivalMinutes,
    rollingDriveMinutes,
    rollingReturnMinutes,
    serviceOverrides,
    breakAfterStopIndex
  );

  const totalCases = stopIds.reduce((s, id) => s + (stopMap.get(id)?.cases ?? 0), 0);
  const warnings = [...leg.warnings];
  const errors = [...leg.errors];

  if (totalCases > segment.truckCapacity) {
    errors.push(
      `Segment exceeds capacity (${totalCases}/${segment.truckCapacity} cases)`
    );
  }

  return {
    departureTime: formatTime(leg.departureTime),
    completionTime: formatTime(leg.completionTime),
    totalCases,
    stopCount: stopIds.length,
    totalMiles: Math.round(leg.totalMiles * 10) / 10,
    totalDriveMinutes: leg.totalDriveMinutes,
    totalRouteMinutes: leg.totalRouteMinutes,
    stopDriveMinutes: leg.stopDriveMinutes,
    stopBaseDriveMinutes: rollingBaseDriveMinutes,
    stopTrafficMinutes: rollingTrafficMinutes,
    driverBreakMinutes: breakAfterStopIndex >= 0 ? DRIVER_BREAK_MINUTES : 0,
    driverBreakAfterStopId:
      breakAfterStopIndex >= 0 ? stopIds[breakAfterStopIndex] : undefined,
    warnings,
    errors,
    stopEtas: leg.stopEtas,
  };
}

function resolveMatrix(
  depot: Depot,
  stops: Stop[],
  travelMatrix?: TravelMatrix
): TravelMatrix {
  return travelMatrix ?? createEstimatedTravelMatrix(depot, stops);
}

/** Keep manual drive overrides attached to stops that still exist on the route. */
export function migrateDriveMinuteOverrides(
  plan: RoutePlan,
  segments: Segment[]
): Record<string, Record<string, number>> | undefined {
  const byStop = new Map<string, number>();
  for (const segOverrides of Object.values(plan.driveMinuteOverrides ?? {})) {
    for (const [stopId, mins] of Object.entries(segOverrides)) {
      byStop.set(stopId, mins);
    }
  }
  if (byStop.size === 0) return plan.driveMinuteOverrides;

  const stopToSegment = new Map<string, string>();
  for (const seg of segments) {
    for (const s of seg.stops) {
      stopToSegment.set(s.stopId, seg.id);
    }
  }

  const next: Record<string, Record<string, number>> = {};
  for (const [stopId, mins] of byStop) {
    const segmentId = stopToSegment.get(stopId);
    if (!segmentId) continue;
    next[segmentId] ??= {};
    next[segmentId][stopId] = mins;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

/** Keep manual service overrides attached to stops that still exist on the route. */
export function migrateServiceMinuteOverrides(
  plan: RoutePlan,
  segments: Segment[]
): Record<string, Record<string, number>> | undefined {
  const byStop = new Map<string, number>();
  for (const segOverrides of Object.values(plan.serviceMinuteOverrides ?? {})) {
    for (const [stopId, mins] of Object.entries(segOverrides)) {
      byStop.set(stopId, mins);
    }
  }
  if (byStop.size === 0) return plan.serviceMinuteOverrides;

  const stopToSegment = new Map<string, string>();
  for (const seg of segments) {
    for (const s of seg.stops) {
      stopToSegment.set(s.stopId, seg.id);
    }
  }

  const next: Record<string, Record<string, number>> = {};
  for (const [stopId, mins] of byStop) {
    const segmentId = stopToSegment.get(stopId);
    if (!segmentId) continue;
    next[segmentId] ??= {};
    next[segmentId][stopId] = mins;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

/** Keep driver break placement on stops that still exist on the route. */
export function migrateDriverBreakAfterStop(
  plan: RoutePlan,
  segments: Segment[]
): Record<string, string> | undefined {
  if (!plan.driverBreakAfterStop) return undefined;

  const stopToSegment = new Map<string, string>();
  for (const seg of segments) {
    for (const s of seg.stops) {
      stopToSegment.set(s.stopId, seg.id);
    }
  }

  const next: Record<string, string> = {};
  for (const stopId of Object.values(plan.driverBreakAfterStop)) {
    const segmentId = stopToSegment.get(stopId);
    if (!segmentId) continue;
    next[segmentId] = stopId;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export async function revalidatePlanSegments(
  plan: RoutePlan,
  segments: Segment[],
  matrix: TravelMatrix,
  apiKey?: string
): Promise<{ segments: Segment[]; rollingTrafficApplied: boolean }> {
  const cycle = getCycleById(plan.cycleId);
  if (!cycle) throw new Error("Invalid cycle");

  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  const updated = segments.map((seg) => ({ ...seg }));
  let prevLat = SCRANTON_DEPOT.lat;
  let prevLng = SCRANTON_DEPOT.lng;
  let rollingTrafficApplied = false;
  const googleKey = apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const useRollingTraffic = matrix.source === "google" && !!googleKey;

  for (let i = 0; i < updated.length; i++) {
    const prevEnd =
      i > 0
        ? (() => {
            const prevSeg = updated[i - 1];
            const lastStopId = prevSeg.stops[prevSeg.stops.length - 1]?.stopId;
            const last = lastStopId ? stopMap.get(lastStopId) : undefined;
            return last ? { lat: last.lat, lng: last.lng } : { lat: prevLat, lng: prevLng };
          })()
        : undefined;

    const start: GeoPoint =
      updated[i].startLocation === "Scranton"
        ? { lat: SCRANTON_DEPOT.lat, lng: SCRANTON_DEPOT.lng }
        : { lat: prevEnd?.lat ?? prevLat, lng: prevEnd?.lng ?? prevLng };

    const stopIds = updated[i].stops.map((s) => s.stopId);
    let rollingDriveMinutes: Record<string, number> | undefined;
    let rollingReturnMinutes: number | undefined;
    let rollingBaseDriveMinutes: Record<string, number> | undefined;
    let rollingTrafficMinutes: Record<string, number> | undefined;

    if (useRollingTraffic && stopIds.length > 0) {
      const manualOverrides = plan.driveMinuteOverrides?.[updated[i].id];
      const rolling = await computeRollingSegmentDriveTimes({
        stopIds,
        getStop: (id) => stopMap.get(id),
        start,
        deliveryDate: updated[i].deliveryDate,
        windowStart: cycle.deliveryStart,
        firstStopTime: plan.firstStopTimeOverrides?.[updated[i].id],
        driveOverrides: manualOverrides,
        serviceOverrides: plan.serviceMinuteOverrides?.[updated[i].id],
        breakAfterStopId: plan.driverBreakAfterStop?.[updated[i].id],
        fallbackMatrix: matrix,
        returnToDepot: updated[i].endLocation === "Scranton",
        depot: { lat: SCRANTON_DEPOT.lat, lng: SCRANTON_DEPOT.lng },
        apiKey: googleKey,
      });
      rollingDriveMinutes = rolling.stopDriveMinutes;
      rollingReturnMinutes = rolling.returnDriveMinutes;
      rollingBaseDriveMinutes =
        Object.keys(rolling.stopBaseDriveMinutes).length > 0
          ? rolling.stopBaseDriveMinutes
          : undefined;
      rollingTrafficMinutes =
        Object.keys(rolling.stopTrafficMinutes).length > 0
          ? rolling.stopTrafficMinutes
          : undefined;
      rollingTrafficApplied = true;
    }

    updated[i].validation = validateSegment(
      updated[i],
      stopMap,
      SCRANTON_DEPOT,
      cycle,
      matrix,
      prevEnd?.lat,
      prevEnd?.lng,
      plan.driveMinuteOverrides?.[updated[i].id],
      plan.firstStopTimeOverrides?.[updated[i].id],
      rollingDriveMinutes,
      rollingReturnMinutes,
      rollingBaseDriveMinutes,
      rollingTrafficMinutes,
      plan.serviceMinuteOverrides?.[updated[i].id],
      plan.driverBreakAfterStop?.[updated[i].id]
    );

    const lastId = updated[i].stops[updated[i].stops.length - 1]?.stopId;
    const lastStop = lastId ? stopMap.get(lastId) : undefined;
    if (lastStop) {
      prevLat = lastStop.lat;
      prevLng = lastStop.lng;
    }
  }

  return { segments: updated, rollingTrafficApplied };
}

export async function buildRoutePlan(
  cycleId: string,
  orders: Order[],
  referenceDate: Date,
  existingSegmentOverrides?: StopAssignment[][],
  travelMatrix?: TravelMatrix
): Promise<{ plan: RoutePlan; matrix: TravelMatrix }> {
  const cycle = getCycleById(cycleId);
  if (!cycle) throw new Error(`Unknown cycle: ${cycleId}`);

  const eligible = orders.filter((o) => isOrderEligible(o, cycle, referenceDate));
  const stops = ordersToStops(eligible);
  const stopMap = new Map(stops.map((s) => [s.id, s]));

  const deliveryDate = deliveryDateForCycle(referenceDate, cycle);
  const batchId = `batch-${cycle.id}-${deliveryDate}`;

  const matrix =
    travelMatrix ??
    (await buildTravelMatrix(SCRANTON_DEPOT, stops, {
      departureTime: deliveryDepartureTimestamp(deliveryDate),
    }));

  const priorityFilter = existingSegmentOverrides?.length
    ? undefined
    : getStopPriorityFilter(cycle.id);

  let segmentGroups: Stop[][];

  if (cycle.multiDay && cycle.overflowDay) {
    const globallyOptimized = optimizeStopOrder(
      stops,
      SCRANTON_DEPOT.lat,
      SCRANTON_DEPOT.lng,
      SCRANTON_DEPOT,
      false,
      matrix
    );
    const orderedIds = globallyOptimized.map((s) => s.id);
    const threshold = suggestWedThreshold(
      orderedIds,
      stopMap,
      SCRANTON_DEPOT,
      cycle.deliveryStart,
      cycle.deliveryEnd,
      matrix
    );
    const wedCount = threshold > 0 ? threshold : Math.min(1, orderedIds.length);
    if (existingSegmentOverrides?.length === 2) {
      segmentGroups = optimizeSegmentOrders(
        existingSegmentOverrides.map((seg) =>
          seg.flatMap((a) => {
            const s = stopMap.get(a.stopId);
            return s ? [s] : [];
          })
        ),
        SCRANTON_DEPOT,
        cycle,
        matrix,
        priorityFilter
      );
    } else {
      segmentGroups = optimizeSegmentOrders(
        [globallyOptimized.slice(0, wedCount), globallyOptimized.slice(wedCount)],
        SCRANTON_DEPOT,
        cycle,
        matrix,
        priorityFilter
      );
    }
  } else if (existingSegmentOverrides?.length) {
    segmentGroups = existingSegmentOverrides.map((seg) =>
      seg.flatMap((a) => {
        const s = stopMap.get(a.stopId);
        return s ? [s] : [];
      })
    );
    segmentGroups = optimizeSegmentOrders(
      segmentGroups,
      SCRANTON_DEPOT,
      cycle,
      matrix,
      priorityFilter
    );
  } else if (cycle.manualTruckAssignment) {
    segmentGroups = assignInitialManualTruckRoutes(
      stops,
      SCRANTON_DEPOT,
      cycle,
      matrix,
      priorityFilter
    );
  } else {
    segmentGroups = assignStopsToTrucks(
      stops,
      DEFAULT_TRUCK_CAPACITY,
      SCRANTON_DEPOT,
      matrix,
      priorityFilter
    );
  }

  const orderedIds = segmentGroups.flat().map((s) => s.id);

  const segments: Segment[] = segmentGroups.map((group, idx) => {
    const isPittsburgh = cycle.multiDay;
    let label: string;
    let segmentType: Segment["segmentType"] = "truck";
    let deliveryDateStr = deliveryDate;
    let startLocation: Segment["startLocation"] = "Scranton";
    let endLocation: Segment["endLocation"] = "Scranton";

    if (isPittsburgh) {
      segmentType = "day";
      if (idx === 0) {
        label = "Wednesday (primary)";
        endLocation = "overnight";
      } else {
        label = "Thursday (overflow)";
        deliveryDateStr = addDays(new Date(deliveryDate), 1).toISOString().slice(0, 10);
        startLocation = "overnight";
        endLocation = "Scranton";
      }
    } else {
      label = `Truck ${idx + 1}`;
    }

    const segStops: StopAssignment[] = group.map((s, pos) => ({
      stopId: s.id,
      position: pos,
    }));

    const base: Omit<Segment, "validation"> = {
      id: `${batchId}-seg-${idx}`,
      label,
      segmentType,
      sequence: idx,
      deliveryDate: deliveryDateStr,
      startLocation,
      endLocation,
      truckCapacity: DEFAULT_TRUCK_CAPACITY,
      stops: segStops,
    };

    return { ...base, validation: { stopCount: 0, totalCases: 0, totalMiles: 0, totalDriveMinutes: 0, totalRouteMinutes: 0, warnings: [], errors: [], stopEtas: {} } };
  });

  const draftPlan: RoutePlan = {
    id: `plan-${batchId}`,
    territoryId: cycle.territoryId,
    territoryName: cycle.name,
    cycleId: cycle.id,
    batchId,
    deliveryDate,
    depot: SCRANTON_DEPOT,
    segments,
    allStops: stops,
    status: "draft",
    travelTimeSource: matrix.source,
    manualTruckAssignment: cycle.manualTruckAssignment,
  };

  const { segments: validatedSegments, rollingTrafficApplied } =
    await revalidatePlanSegments(draftPlan, segments, matrix);

  const suggestedWedThreshold =
    cycle.multiDay
      ? suggestWedThreshold(
          orderedIds,
          stopMap,
          SCRANTON_DEPOT,
          cycle.deliveryStart,
          cycle.deliveryEnd,
          matrix
        )
      : undefined;

  return {
    plan: {
      ...draftPlan,
      segments: validatedSegments,
      suggestedWedThreshold,
      rollingTrafficApplied,
    },
    matrix,
  };
}

export async function applySegmentStops(
  plan: RoutePlan,
  segmentStops: { segmentId: string; stops: StopAssignment[] }[],
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  const updatedSegments = plan.segments.map((seg) => {
    const override = segmentStops.find((s) => s.segmentId === seg.id);
    const stops = (override?.stops ?? seg.stops).map((s, i) => ({ ...s, position: i }));
    return { ...seg, stops };
  });

  const driveMinuteOverrides = migrateDriveMinuteOverrides(plan, updatedSegments);
  const serviceMinuteOverrides = migrateServiceMinuteOverrides(plan, updatedSegments);
  const driverBreakAfterStop = migrateDriverBreakAfterStop(plan, updatedSegments);

  const nextPlan = {
    ...plan,
    driveMinuteOverrides,
    serviceMinuteOverrides,
    driverBreakAfterStop,
  };
  const { segments, rollingTrafficApplied } = await revalidatePlanSegments(
    nextPlan,
    updatedSegments,
    matrix
  );

  return {
    ...nextPlan,
    segments,
    rollingTrafficApplied,
    travelTimeSource: matrix.source,
  };
}

export async function setFirstStopTimeOverride(
  plan: RoutePlan,
  segmentId: string,
  time: string | null,
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const segment = plan.segments.find((s) => s.id === segmentId);
  if (!segment || segment.stops.length === 0) {
    throw new Error("Segment has no stops");
  }

  const overrides = { ...(plan.firstStopTimeOverrides ?? {}) };

  if (time == null || time.trim() === "") {
    delete overrides[segmentId];
  } else {
    const minutes = parseDeliveryTime(time.trim());
    if (minutes == null) {
      throw new Error("Invalid time — use HH:MM format");
    }
    overrides[segmentId] = time.trim();
  }

  const firstStopTimeOverrides =
    Object.keys(overrides).length > 0 ? overrides : undefined;
  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  const nextPlan = { ...plan, firstStopTimeOverrides };

  const { segments, rollingTrafficApplied } = await revalidatePlanSegments(
    nextPlan,
    plan.segments,
    matrix
  );

  return {
    ...nextPlan,
    segments,
    rollingTrafficApplied,
    travelTimeSource: matrix.source,
  };
}

export async function setDriverBreak(
  plan: RoutePlan,
  segmentId: string,
  enabled: boolean,
  travelMatrix?: TravelMatrix,
  afterStopId?: string
): Promise<RoutePlan> {
  const segment = plan.segments.find((s) => s.id === segmentId);
  if (!segment) {
    throw new Error("Segment not found");
  }

  const driverBreakAfterStop = { ...(plan.driverBreakAfterStop ?? {}) };
  if (enabled) {
    const stopIds = segment.stops.map((s) => s.stopId);
    let target = afterStopId;
    if (!target || !stopIds.includes(target)) {
      const idx = driverBreakAfterStopIndex(stopIds.length);
      target = idx >= 0 ? stopIds[idx] : undefined;
    }
    if (!target) {
      throw new Error("No stops to place break after");
    }
    driverBreakAfterStop[segmentId] = target;
  } else {
    delete driverBreakAfterStop[segmentId];
  }

  const nextBreaks =
    Object.keys(driverBreakAfterStop).length > 0 ? driverBreakAfterStop : undefined;
  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  const nextPlan = { ...plan, driverBreakAfterStop: nextBreaks };

  const { segments, rollingTrafficApplied } = await revalidatePlanSegments(
    nextPlan,
    plan.segments,
    matrix
  );

  return {
    ...nextPlan,
    segments,
    rollingTrafficApplied,
    travelTimeSource: matrix.source,
  };
}

export async function setServiceMinuteOverride(
  plan: RoutePlan,
  segmentId: string,
  stopId: string,
  minutes: number | null,
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const segment = plan.segments.find((s) => s.id === segmentId);
  if (!segment?.stops.some((s) => s.stopId === stopId)) {
    throw new Error("Stop not found on segment");
  }

  const overrides = { ...(plan.serviceMinuteOverrides ?? {}) };
  const segmentOverrides = { ...(overrides[segmentId] ?? {}) };

  if (
    minutes == null ||
    Number.isNaN(minutes) ||
    Math.round(minutes) <= SERVICE_MINUTES_PER_STOP
  ) {
    delete segmentOverrides[stopId];
  } else {
    segmentOverrides[stopId] = Math.max(
      SERVICE_MINUTES_PER_STOP,
      Math.round(minutes)
    );
  }

  if (Object.keys(segmentOverrides).length === 0) {
    delete overrides[segmentId];
  } else {
    overrides[segmentId] = segmentOverrides;
  }

  const serviceMinuteOverrides =
    Object.keys(overrides).length > 0 ? overrides : undefined;
  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  const nextPlan = { ...plan, serviceMinuteOverrides };

  const { segments, rollingTrafficApplied } = await revalidatePlanSegments(
    nextPlan,
    plan.segments,
    matrix
  );

  return {
    ...nextPlan,
    segments,
    rollingTrafficApplied,
    travelTimeSource: matrix.source,
  };
}

export async function setDriveMinuteOverride(
  plan: RoutePlan,
  segmentId: string,
  stopId: string,
  minutes: number | null,
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const segment = plan.segments.find((s) => s.id === segmentId);
  if (!segment?.stops.some((s) => s.stopId === stopId)) {
    throw new Error("Stop not found on segment");
  }

  const overrides = { ...(plan.driveMinuteOverrides ?? {}) };
  const segmentOverrides = { ...(overrides[segmentId] ?? {}) };

  if (minutes == null || Number.isNaN(minutes)) {
    delete segmentOverrides[stopId];
  } else {
    segmentOverrides[stopId] = Math.max(0, Math.round(minutes));
  }

  if (Object.keys(segmentOverrides).length === 0) {
    delete overrides[segmentId];
  } else {
    overrides[segmentId] = segmentOverrides;
  }

  const driveMinuteOverrides =
    Object.keys(overrides).length > 0 ? overrides : undefined;
  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  const nextPlan = { ...plan, driveMinuteOverrides };

  const { segments, rollingTrafficApplied } = await revalidatePlanSegments(
    nextPlan,
    plan.segments,
    matrix
  );

  return {
    ...nextPlan,
    segments,
    rollingTrafficApplied,
    travelTimeSource: matrix.source,
  };
}

function combinedStopOrder(plan: RoutePlan): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const seg of plan.segments) {
    for (const assignment of seg.stops) {
      if (!seen.has(assignment.stopId)) {
        seen.add(assignment.stopId);
        ordered.push(assignment.stopId);
      }
    }
  }
  for (const stop of plan.allStops) {
    if (!seen.has(stop.id)) ordered.push(stop.id);
  }
  return ordered;
}

export async function setWedThreshold(
  plan: RoutePlan,
  threshold: number,
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const cycle = getCycleById(plan.cycleId);
  if (!cycle?.multiDay) return plan;

  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  const orderedIds = combinedStopOrder(plan);
  const orderedStops = orderedIds
    .map((id) => stopMap.get(id))
    .filter((s): s is Stop => !!s);

  const n = Math.max(0, Math.min(threshold, orderedStops.length));
  const seg0 = plan.segments[0];
  const seg1 = plan.segments[1];
  if (!seg0 || !seg1) return plan;

  const groups = optimizeSegmentOrders(
    [orderedStops.slice(0, n), orderedStops.slice(n)],
    SCRANTON_DEPOT,
    cycle,
    matrix
  );

  return applySegmentStops(
    plan,
    [
      {
        segmentId: seg0.id,
        stops: groups[0].map((s, i) => ({ stopId: s.id, position: i })),
      },
      {
        segmentId: seg1.id,
        stops: groups[1].map((s, i) => ({ stopId: s.id, position: i })),
      },
    ],
    matrix
  );
}

export async function assignStopToTruck(
  plan: RoutePlan,
  stopId: string,
  truckNumber: number,
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const cycle = getCycleById(plan.cycleId);
  if (cycle?.multiDay) {
    throw new Error("Truck assignment is not supported on multi-day routes");
  }
  if (!Number.isInteger(truckNumber) || truckNumber < 1) {
    throw new Error("Invalid truck number");
  }

  const fromSegment = plan.segments.find((s) =>
    s.stops.some((st) => st.stopId === stopId)
  );
  if (!fromSegment) {
    throw new Error("Stop not found on route");
  }

  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  let currentPlan = plan;

  while (currentPlan.segments.length < truckNumber) {
    currentPlan = await appendTruckSegment(currentPlan, matrix);
  }

  const targetSegment = currentPlan.segments[truckNumber - 1];
  if (!targetSegment) {
    throw new Error("Truck not found");
  }
  if (fromSegment.id === targetSegment.id) {
    return currentPlan;
  }

  return moveStopBetweenSegments(
    currentPlan,
    stopId,
    fromSegment.id,
    targetSegment.id,
    targetSegment.stops.length,
    matrix
  );
}

export async function moveStopBetweenSegments(
  plan: RoutePlan,
  stopId: string,
  fromSegmentId: string,
  toSegmentId: string,
  toIndex: number,
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const segmentStops = plan.segments.map((seg) => ({
    segmentId: seg.id,
    stops: seg.stops.filter((s) => s.stopId !== stopId).map((s, i) => ({ ...s, position: i })),
  }));

  const target = segmentStops.find((s) => s.segmentId === toSegmentId);
  if (!target) return plan;

  const newStops = [...target.stops];
  newStops.splice(toIndex, 0, { stopId, position: toIndex });
  target.stops = newStops.map((s, i) => ({ ...s, position: i }));

  return applySegmentStops(plan, segmentStops, travelMatrix);
}

export async function reorderStopInSegment(
  plan: RoutePlan,
  segmentId: string,
  stopId: string,
  newIndex: number,
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const segmentStops = plan.segments.map((seg) => {
    if (seg.id !== segmentId) return { segmentId: seg.id, stops: [...seg.stops] };
    const stops = seg.stops.filter((s) => s.stopId !== stopId);
    stops.splice(newIndex, 0, { stopId, position: newIndex });
    return {
      segmentId: seg.id,
      stops: stops.map((s, i) => ({ ...s, position: i })),
    };
  });
  return applySegmentStops(plan, segmentStops, travelMatrix);
}

export async function appendTruckSegment(
  plan: RoutePlan,
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const cycle = getCycleById(plan.cycleId);
  if (!cycle || cycle.multiDay) return plan;

  const idx = plan.segments.length;
  const newSeg: Segment = {
    id: `${plan.batchId}-seg-${idx}`,
    label: `Truck ${idx + 1}`,
    segmentType: "truck",
    sequence: idx,
    deliveryDate: plan.deliveryDate,
    startLocation: "Scranton",
    endLocation: "Scranton",
    truckCapacity: DEFAULT_TRUCK_CAPACITY,
    stops: [],
    validation: {
      stopCount: 0,
      totalCases: 0,
      totalMiles: 0,
      totalDriveMinutes: 0,
      totalRouteMinutes: 0,
      warnings: [],
      errors: [],
      stopEtas: {},
    },
  };

  const combined = [...plan.segments, newSeg];
  return applySegmentStops(
    { ...plan, segments: combined },
    combined.map((s) => ({ segmentId: s.id, stops: s.stops })),
    travelMatrix
  );
}

function segmentStopGroups(plan: RoutePlan): Stop[][] {
  const stopMap = new Map(plan.allStops.map((s) => [s.id, s]));
  return plan.segments.map((seg) =>
    seg.stops
      .map((a) => stopMap.get(a.stopId))
      .filter((s): s is Stop => !!s)
  );
}

/** Re-order stops within manual truck segments for shortest drive time (membership unchanged). */
export async function reoptimizeSegments(
  plan: RoutePlan,
  segmentIds?: string[],
  travelMatrix?: TravelMatrix
): Promise<RoutePlan> {
  const cycle = getCycleById(plan.cycleId);
  const matrix = resolveMatrix(SCRANTON_DEPOT, plan.allStops, travelMatrix);
  const currentGroups = segmentStopGroups(plan);
  const targetSet = segmentIds?.length ? new Set(segmentIds) : null;
  const priorityFilter = getStopPriorityFilter(plan.cycleId);

  const groupsToOptimize: Stop[][] = [];
  const optimizeIndices: number[] = [];

  currentGroups.forEach((group, idx) => {
    const seg = plan.segments[idx];
    const shouldOptimize = !targetSet || targetSet.has(seg.id);
    if (shouldOptimize && group.length >= 2) {
      groupsToOptimize.push(group);
      optimizeIndices.push(idx);
    }
  });

  if (optimizeIndices.length === 0) return plan;

  const optimizedGroups = optimizeSegmentOrders(
    groupsToOptimize,
    SCRANTON_DEPOT,
    cycle,
    matrix,
    priorityFilter
  );

  const nextGroups = [...currentGroups];
  optimizeIndices.forEach((idx, i) => {
    nextGroups[idx] = optimizedGroups[i];
  });

  const segmentStops = plan.segments.map((seg, idx) => ({
    segmentId: seg.id,
    stops: nextGroups[idx].map((s, i) => ({ stopId: s.id, position: i })),
  }));

  return applySegmentStops(plan, segmentStops, travelMatrix);
}

export function getUnassignedStopIds(plan: RoutePlan): string[] {
  const assigned = new Set(plan.segments.flatMap((s) => s.stops.map((st) => st.stopId)));
  return plan.allStops.filter((s) => !assigned.has(s.id)).map((s) => s.id);
}

export function allStopsAssigned(plan: RoutePlan): boolean {
  return getUnassignedStopIds(plan).length === 0;
}
