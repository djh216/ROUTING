import { useEffect, useMemo, useRef, useState } from "react";
import type { RoutePlan } from "@shared/types";
import { fetchRouteGeometry, type RouteGeometryResponse } from "./api";
import type { SegmentUpdate } from "./segmentDrag";
import { segmentRoutesCacheKey, type LatLng } from "./routeMapUtils";

function toGeometryPaths(data: RouteGeometryResponse): Map<string, LatLng[]> {
  return new Map(
    data.segments.map((seg) => [
      seg.segmentId,
      seg.path.map((p) => [p.lat, p.lng] as LatLng),
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
    paths: Map<string, LatLng[]>;
    source: RouteGeometryResponse["source"];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const routeKey = useMemo(
    () => segmentRoutesCacheKey(plan, previewSegments),
    [plan, previewSegments]
  );

  useEffect(() => {
    if (!cycleId) {
      setGeometry(null);
      return;
    }

    if (freezeGeometry && previewSegments) {
      return;
    }

    const debounceMs = !freezeGeometry && previewSegments ? 250 : 0;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      const id = ++requestId.current;
      setLoading(true);
      void fetchRouteGeometry(
        cycleId,
        !freezeGeometry && previewSegments ? { segments: previewSegments } : undefined,
        controller.signal
      )
        .then((result) => {
          if (id !== requestId.current) return;
          setGeometry({
            routeKey,
            paths: toGeometryPaths(result),
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
    };

    if (debounceMs > 0) {
      timer = setTimeout(run, debounceMs);
    } else {
      run();
    }

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, freezeGeometry
    ? [cycleId, geometryRefreshKey, freezeGeometry]
    : [cycleId, previewSegments, routeKey, freezeGeometry]);

  const geometryPaths = useMemo(() => {
    if (!geometry) return null;
    if (!freezeGeometry && geometry.routeKey !== routeKey) return null;
    return geometry.paths;
  }, [geometry, routeKey, freezeGeometry]);

  return {
    geometryPaths,
    geometrySource: geometryPaths ? geometry?.source ?? null : null,
    loading,
  };
}
