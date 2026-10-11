import type { RoutePlan, Segment } from "@shared/types";
import { buildSegmentWaypoints, isOvernightSegmentStart } from "@shared/routeGeometry";
import type { RouteLegInfo } from "@shared/routeGeometry";
import {
  buildSegmentRoutes,
  type LatLng,
  type SegmentRoute,
} from "./routeMapUtils";

type GeometryMap = Map<
  string,
  { path: LatLng[]; legs?: RouteLegInfo[] }
> | null;

/** Canvas export size — keep PDF layout in sync via MAP_EXPORT_ASPECT. */
export const MAP_EXPORT_WIDTH = 1064;
export const MAP_EXPORT_HEIGHT = 520;
export const MAP_EXPORT_ASPECT = MAP_EXPORT_WIDTH / MAP_EXPORT_HEIGHT;

const OSM_TILE_SIZE = 256;
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

type MercatorView = {
  zoom: number;
  offsetX: number;
  offsetY: number;
  worldMinX: number;
  worldMinY: number;
  worldMaxX: number;
  worldMaxY: number;
  project: (lat: number, lng: number) => [number, number];
};

function latLngToWorldPx(lat: number, lng: number, zoom: number): [number, number] {
  const scale = OSM_TILE_SIZE * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return [x, y];
}

function pickMercatorView(
  points: LatLng[],
  width: number,
  height: number,
  padding: number
): MercatorView | null {
  if (points.length === 0) return null;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  for (let zoom = 15; zoom >= 5; zoom--) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [lat, lng] of points) {
      const [x, y] = latLngToWorldPx(lat, lng, zoom);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    if (spanX <= innerW && spanY <= innerH) {
      const offsetX = padding + (innerW - spanX) / 2 - minX;
      const offsetY = padding + (innerH - spanY) / 2 - minY;
      return {
        zoom,
        offsetX,
        offsetY,
        worldMinX: minX,
        worldMinY: minY,
        worldMaxX: maxX,
        worldMaxY: maxY,
        project(lat: number, lng: number) {
          const [wx, wy] = latLngToWorldPx(lat, lng, zoom);
          return [offsetX + wx, offsetY + wy];
        },
      };
    }
  }

  const zoom = 5;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [lat, lng] of points) {
    const [x, y] = latLngToWorldPx(lat, lng, zoom);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const offsetX = padding + (innerW - spanX) / 2 - minX;
  const offsetY = padding + (innerH - spanY) / 2 - minY;
  return {
    zoom,
    offsetX,
    offsetY,
    worldMinX: minX,
    worldMinY: minY,
    worldMaxX: maxX,
    worldMaxY: maxY,
    project(lat: number, lng: number) {
      const [wx, wy] = latLngToWorldPx(lat, lng, zoom);
      return [offsetX + wx, offsetY + wy];
    },
  };
}

function loadOsmTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = OSM_TILE_URL.replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
  });
}

async function paintOsmTileBackground(
  ctx: CanvasRenderingContext2D,
  view: MercatorView
): Promise<void> {
  const padTiles = 1;
  const tMinX = Math.floor(view.worldMinX / OSM_TILE_SIZE) - padTiles;
  const tMaxX = Math.floor(view.worldMaxX / OSM_TILE_SIZE) + padTiles;
  const tMinY = Math.floor(view.worldMinY / OSM_TILE_SIZE) - padTiles;
  const tMaxY = Math.floor(view.worldMaxY / OSM_TILE_SIZE) + padTiles;
  const n = 2 ** view.zoom;
  const maxTile = n - 1;

  const jobs: Promise<void>[] = [];
  for (let tx = tMinX; tx <= tMaxX; tx++) {
    if (tx < 0 || tx > maxTile) continue;
    for (let ty = tMinY; ty <= tMaxY; ty++) {
      if (ty < 0 || ty > maxTile) continue;
      jobs.push(
        loadOsmTile(view.zoom, tx, ty).then((img) => {
          if (!img) return;
          const x = view.offsetX + tx * OSM_TILE_SIZE;
          const y = view.offsetY + ty * OSM_TILE_SIZE;
          ctx.drawImage(img, x, y, OSM_TILE_SIZE, OSM_TILE_SIZE);
        })
      );
    }
  }
  await Promise.all(jobs);
}

function drawOsmAttribution(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const text = "© OpenStreetMap contributors";
  ctx.font = "10px Helvetica, Arial, sans-serif";
  const pad = 8;
  const textW = ctx.measureText(text).width;
  const x = width - textW - pad - 6;
  const y = height - pad - 4;
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
  ctx.fillRect(x - 4, y - 12, textW + 8, 16);
  ctx.fillStyle = "#334155";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(text, x, y);
}

function pointsNear(a: LatLng, b: LatLng): boolean {
  return Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5;
}

function isDepotLatLng(plan: RoutePlan, lat: number, lng: number): boolean {
  return Math.abs(lat - plan.depot.lat) < 1e-4 && Math.abs(lng - plan.depot.lng) < 1e-4;
}

function legTouchesDepot(plan: RoutePlan, path: LatLng[]): boolean {
  if (path.length === 0) return false;
  const [a0, a1] = path[0];
  const [b0, b1] = path[path.length - 1];
  return (
    isDepotLatLng(plan, a0, a1) ||
    isDepotLatLng(plan, b0, b1)
  );
}

function trimDepotFromPath(plan: RoutePlan, path: LatLng[]): LatLng[] {
  const pts = [...path];
  while (pts.length > 1 && isDepotLatLng(plan, pts[0][0], pts[0][1])) {
    pts.shift();
  }
  while (pts.length > 1 && isDepotLatLng(plan, pts[pts.length - 1][0], pts[pts.length - 1][1])) {
    pts.pop();
  }
  return pts.length >= 2 ? pts : [];
}

function joinLegPaths(legs: SegmentRoute["legs"]): LatLng[] {
  const combined: LatLng[] = [];
  for (const leg of legs) {
    if (leg.path.length === 0) continue;
    if (combined.length === 0) {
      combined.push(...leg.path);
      continue;
    }
    const next = [...leg.path];
    if (pointsNear(combined[combined.length - 1], next[0])) {
      next.shift();
    }
    combined.push(...next);
  }
  return combined;
}

function waypointsPolyline(plan: RoutePlan, segmentId: string): LatLng[] {
  const seg = buildSegmentWaypoints(plan, null).find((s) => s.segmentId === segmentId);
  if (!seg || seg.waypoints.length < 2) return [];
  return seg.waypoints.map((p) => [p.lat, p.lng]);
}

/**
 * Polylines to draw for one segment — matches RouteMap (one polyline per leg when legs exist).
 * Avoids stitching leg paths into one line, which draws straight chords between road endpoints.
 */
export function getSegmentDrawPolylines(
  plan: RoutePlan,
  segmentId: string,
  route: SegmentRoute,
  useGeometry: boolean,
  options?: { includeDepot?: boolean }
): LatLng[][] {
  const includeDepot = options?.includeDepot !== false;

  if (route.legs.length > 0) {
    const fromLegs = route.legs
      .filter((leg) => includeDepot || !legTouchesDepot(plan, leg.path))
      .map((leg) => leg.path)
      .filter((path) => path.length >= 2);
    if (fromLegs.length > 0) return fromLegs;
  }

  if (useGeometry && route.path.length >= 2) {
    if (includeDepot) return [route.path];
    const trimmed = trimDepotFromPath(plan, route.path);
    if (trimmed.length >= 2) return [trimmed];
  }

  if (!includeDepot && route.stops.length >= 2) {
    const stopToStop: LatLng[][] = [];
    for (let i = 0; i < route.stops.length - 1; i++) {
      const a = route.stops[i].stop;
      const b = route.stops[i + 1].stop;
      stopToStop.push([
        [a.lat, a.lng],
        [b.lat, b.lng],
      ]);
    }
    if (stopToStop.length > 0) return stopToStop;
  }

  const fromWaypoints = waypointsPolyline(plan, segmentId);
  if (fromWaypoints.length >= 2) {
    if (includeDepot) return [fromWaypoints];
    const trimmed = trimDepotFromPath(plan, fromWaypoints);
    if (trimmed.length >= 2) return [trimmed];
  }

  if (route.stops.length >= 2) {
    return [route.stops.map(({ stop }) => [stop.lat, stop.lng])];
  }

  return [];
}

/** All path points for bounds (includes every leg). */
export function getSegmentPolyline(
  plan: RoutePlan,
  segmentId: string,
  route: SegmentRoute,
  _geometrySegments: GeometryMap,
  useGeometry: boolean,
  options?: { includeDepot?: boolean }
): LatLng[] {
  const polylines = getSegmentDrawPolylines(plan, segmentId, route, useGeometry, options);
  if (polylines.length === 0) return [];
  if (polylines.length === 1) return polylines[0];
  return joinLegPaths(
    polylines.map((path, legIndex) => ({
      legIndex,
      fromName: "",
      toName: "",
      path,
      delayLevel: "normal" as const,
    }))
  );
}

function projectPoints(
  points: LatLng[],
  width: number,
  height: number,
  padding: number
): {
  project: (lat: number, lng: number) => [number, number];
} {
  let minLat = points[0][0];
  let maxLat = points[0][0];
  let minLng = points[0][1];
  let maxLng = points[0][1];
  for (const [lat, lng] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  const latRange = Math.max(maxLat - minLat, 0.02);
  const lngRange = Math.max(maxLng - minLng, 0.02);
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const scale = Math.min(innerW / lngRange, innerH / latRange);
  const drawW = lngRange * scale;
  const drawH = latRange * scale;
  const offsetX = padding + (innerW - drawW) / 2;
  const offsetY = padding + (innerH - drawH) / 2;

  return {
    project(lat: number, lng: number) {
      const x = offsetX + ((lng - minLng) / lngRange) * drawW;
      const y = offsetY + drawH - ((lat - minLat) / latRange) * drawH;
      return [x, y];
    },
  };
}

function drawMapLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  color: string,
  canvasWidth: number
) {
  ctx.font = "600 12px Helvetica, Arial, sans-serif";
  const text = label;
  const padX = 10;
  const pillH = 22;
  const pillW = ctx.measureText(text).width + padX * 2;
  const x = canvasWidth - pillW - 20;
  const y = 20;
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, pillW, pillH, 4);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(x, y, pillW, pillH);
    ctx.strokeRect(x, y, pillW, pillH);
  }
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + pillH / 2);
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  path: LatLng[],
  color: string,
  project: (lat: number, lng: number) => [number, number]
) {
  if (path.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  const [x0, y0] = project(path[0][0], path[0][1]);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < path.length; i++) {
    const [x, y] = project(path[i][0], path[i][1]);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawStartMarker(
  ctx: CanvasRenderingContext2D,
  plan: RoutePlan,
  segment: Segment,
  project: (lat: number, lng: number) => [number, number],
  includeDepot: boolean
) {
  const waypoints = buildSegmentWaypoints(plan, null).find((s) => s.segmentId === segment.id)
    ?.waypoints;
  if (isOvernightSegmentStart(segment.startLocation)) return;

  const start = waypoints?.[0];
  if (!start) return;

  const atDepot =
    segment.startLocation === "Scranton" &&
    isDepotLatLng(plan, start.lat, start.lng);

  if (atDepot && !includeDepot) return;

  const [x, y] = project(start.lat, start.lng);

  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 11px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(atDepot ? "D" : "S", x, y + 0.5);
}

function drawStops(
  ctx: CanvasRenderingContext2D,
  route: SegmentRoute,
  project: (lat: number, lng: number) => [number, number]
) {
  for (const { stop, sequence } of route.stops) {
    const [x, y] = project(stop.lat, stop.lng);
    ctx.fillStyle = route.color;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(sequence), x, y + 0.5);
  }
}

function collectBoundsPoints(
  plan: RoutePlan,
  polyline: LatLng[],
  route: SegmentRoute,
  includeDepot: boolean
): LatLng[] {
  const points: LatLng[] = [];
  for (const [lat, lng] of polyline) {
    if (includeDepot || !isDepotLatLng(plan, lat, lng)) {
      points.push([lat, lng]);
    }
  }
  for (const { stop } of route.stops) {
    points.push([stop.lat, stop.lng]);
  }
  if (includeDepot) {
    const wp = buildSegmentWaypoints(plan, null).find((s) => s.segmentId === route.segmentId);
    if (wp?.waypoints[0]) {
      points.push([wp.waypoints[0].lat, wp.waypoints[0].lng]);
    }
  }
  if (points.length === 0) {
    points.push([plan.depot.lat, plan.depot.lng]);
  }
  return points;
}

async function renderSegmentCanvas(
  plan: RoutePlan,
  segment: Segment,
  route: SegmentRoute,
  geometrySegments: GeometryMap,
  useGeometry: boolean,
  width: number,
  height: number,
  options?: { includeDepot?: boolean; includeOsmBackground?: boolean }
): Promise<string | null> {
  if (route.stops.length === 0) return null;

  const includeDepot = options?.includeDepot !== false;
  const includeOsmBackground = options?.includeOsmBackground !== false;

  const polyline = getSegmentPolyline(
    plan,
    segment.id,
    route,
    geometrySegments,
    useGeometry,
    { includeDepot }
  );
  const boundsPoints = collectBoundsPoints(plan, polyline, route, includeDepot);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, 0, width, height);

  const padding = 40;
  const mercatorView = includeOsmBackground
    ? pickMercatorView(boundsPoints, width, height, padding)
    : null;
  const project =
    mercatorView?.project ??
    projectPoints(boundsPoints, width, height, padding).project;

  if (mercatorView) {
    await paintOsmTileBackground(ctx, mercatorView);
    drawOsmAttribution(ctx, width, height);
  } else {
    const inset = 12;
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(inset, inset, width - inset * 2, height - inset * 2);
  }

  const drawPaths = getSegmentDrawPolylines(plan, segment.id, route, useGeometry, {
    includeDepot,
  });
  for (const path of drawPaths) {
    drawPolyline(ctx, path, route.color, project);
  }
  drawStartMarker(ctx, plan, segment, project, includeDepot);
  drawStops(ctx, route, project);

  drawMapLabel(ctx, route.label, route.color, width);

  return canvas.toDataURL("image/jpeg", 0.92);
}

/** Map image for one day/truck segment (manifest PDF). */
export async function renderSegmentMapToDataUrl(
  plan: RoutePlan,
  segmentId: string,
  geometrySegments: GeometryMap,
  options?: {
    width?: number;
    height?: number;
    /** When false, use stop/waypoint chain (e.g. pending order or stale geometry). */
    useGeometry?: boolean;
    includeDepot?: boolean;
    includeOsmBackground?: boolean;
  }
): Promise<string | null> {
  const routes = buildSegmentRoutes(plan, null, options?.useGeometry === false ? null : geometrySegments, {
    freezeRoutePaths: plan.manualTruckAssignment === true,
  });
  const route = routes.find((r) => r.segmentId === segmentId);
  const segment = plan.segments.find((s) => s.id === segmentId);
  if (!route || !segment) return null;

  return renderSegmentCanvas(
    plan,
    segment,
    route,
    geometrySegments,
    options?.useGeometry !== false,
    options?.width ?? MAP_EXPORT_WIDTH,
    options?.height ?? MAP_EXPORT_HEIGHT,
    {
      includeDepot: options?.includeDepot,
      includeOsmBackground: options?.includeOsmBackground,
    }
  );
}

/** Map image for the full plan (all segments). */
export async function renderPlanMapToDataUrl(
  plan: RoutePlan,
  geometrySegments: GeometryMap,
  options?: {
    width?: number;
    height?: number;
    useGeometry?: boolean;
    /** When false, omit Scranton depot marker, depot legs, and depot from map bounds. */
    includeDepot?: boolean;
    /** Draw OpenStreetMap tiles under routes (matches live map). */
    includeOsmBackground?: boolean;
  }
): Promise<string | null> {
  if (plan.allStops.length === 0) return null;

  const width = options?.width ?? MAP_EXPORT_WIDTH;
  const height = options?.height ?? MAP_EXPORT_HEIGHT;
  const useGeometry = options?.useGeometry !== false;
  const includeDepot = options?.includeDepot !== false;
  const includeOsmBackground = options?.includeOsmBackground !== false;
  const routes = buildSegmentRoutes(plan, null, useGeometry ? geometrySegments : null, {
    freezeRoutePaths: plan.manualTruckAssignment === true,
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, 0, width, height);

  const allBounds: LatLng[] = includeDepot ? [[plan.depot.lat, plan.depot.lng]] : [];
  for (const route of routes) {
    const segment = plan.segments.find((s) => s.id === route.segmentId);
    if (!segment) continue;
    const polyline = getSegmentPolyline(
      plan,
      route.segmentId,
      route,
      geometrySegments,
      useGeometry,
      { includeDepot }
    );
    allBounds.push(...collectBoundsPoints(plan, polyline, route, includeDepot));
  }
  if (allBounds.length === 0) {
    allBounds.push([plan.depot.lat, plan.depot.lng]);
  }

  const padding = 40;
  const mercatorView = includeOsmBackground ? pickMercatorView(allBounds, width, height, padding) : null;
  const project =
    mercatorView?.project ??
    projectPoints(allBounds, width, height, padding).project;

  if (mercatorView) {
    await paintOsmTileBackground(ctx, mercatorView);
    drawOsmAttribution(ctx, width, height);
  } else {
    const inset = 12;
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(inset, inset, width - inset * 2, height - inset * 2);
  }

  for (const route of routes) {
    const segment = plan.segments.find((s) => s.id === route.segmentId);
    if (!segment) continue;
    const drawPaths = getSegmentDrawPolylines(plan, route.segmentId, route, useGeometry, {
      includeDepot,
    });
    for (const path of drawPaths) {
      drawPolyline(ctx, path, route.color, project);
    }
    drawStartMarker(ctx, plan, segment, project, includeDepot);
    drawStops(ctx, route, project);
  }

  drawMapLabel(ctx, plan.territoryName, "#475569", width);

  return canvas.toDataURL("image/jpeg", 0.92);
}
