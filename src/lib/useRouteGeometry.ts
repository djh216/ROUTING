import { useEffect, useMemo, useRef, useState } from "react";
import type { RoutePlan } from "@shared/types";
import { fetchRouteGeometry, type RouteGeometryResponse, type RouteLegInfo, type SegmentTrafficAlert } from "./api";
import type { SegmentUpdate } from "./segmentDrag";
import { segmentRoutesCacheKey, type LatLng } from "./routeMapUtils";

export interface GeometrySegmentData {
  path: LatLng[];
  legs?: RouteLegInfo[];
  trafficAlert?: SegmentTrafficAlert;
}

function toGeometryMap(data: RouteGeometryResponse): Map<string, GeometrySegmentData> {
  return new Map(
    data.segments.map((seg) => [
      seg.segmentId,
      {
        path: seg.path.map((p) => [p.lat, p.lng] as LatLng),
        legs: seg.legs,
        trafficAlert: seg.trafficAlert,
      },
    ])
  );
}

export function useRouteGeometry(
  cycleId: string | null,
  plan: RoutePlan,
  previewSegments: SegmentUpdate[] | null,
  geometryRefreshKey: number
) {
  const freezeGeometry = plan.manualTruckAssignment === true;
  const [geometry, setGeometry] = useState<{
    routeKey: string;
    segments: Map<string, GeometrySegmentData>;
    paths: Map<string, LatLng[]>;
    trafficSummary?: RouteGeometryResponse["trafficSummary"];
    source: RouteGeometryResponse["source"];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const lastFetchedRefreshKey = useRef(0);
  const routeKeyRef = useRef("");
  const routeKey = useMemo(
    () => segmentRoutesCacheKey(plan, previewSegments),
    [plan, previewSegments]
  );
  routeKeyRef.current = routeKey;

  useEffect(() => {
    if (!cycleId) {
      setGeometry(null);
      lastFetchedRefreshKey.current = 0;
      return;
    }

    if (geometryRefreshKey <= 0) {
      setGeometry(null);
      lastFetchedRefreshKey.current = 0;
      return;
    }

    if (geometryRefreshKey === lastFetchedRefreshKey.current) {
      return;
    }

    if (freezeGeometry && previewSegments) {
      return;
    }

    lastFetchedRefreshKey.current = geometryRefreshKey;
    const controller = new AbortController();
    const keyAtFetch = routeKeyRef.current;
    const id = ++requestId.current;
    setLoading(true);

    void fetchRouteGeometry(
      cycleId,
      !freezeGeometry && previewSegments ? { segments: previewSegments } : undefined,
      controller.signal
    )
      .then((result) => {
        if (id !== requestId.current) return;
        const segMap = toGeometryMap(result);
        const pathMap = new Map(
          Array.from(segMap.entries()).map(([k, v]) => [k, v.path])
        );
        setGeometry({
          routeKey: keyAtFetch,
          segments: segMap,
          paths: pathMap,
          trafficSummary: result.trafficSummary,
          source: result.source,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (id !== requestId.current) return;
        console.warn("Route geometry fetch failed:", err);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [cycleId, geometryRefreshKey, freezeGeometry, previewSegments]);

  const geometrySegments = useMemo(() => {
    if (!geometry) return null;
    if (!freezeGeometry && geometry.routeKey !== routeKey) return null;
    return geometry.segments;
  }, [geometry, routeKey, freezeGeometry]);

  const geometryPaths = useMemo(() => {
    if (!geometry) return null;
    if (!freezeGeometry && geometry.routeKey !== routeKey) return null;
    return geometry.paths;
  }, [geometry, routeKey, freezeGeometry]);

  return {
    geometrySegments,
    geometryPaths,
    trafficSummary: geometry?.trafficSummary,
    geometrySource: geometryPaths ? geometry?.source ?? null : null,
    loading,
  };
}
