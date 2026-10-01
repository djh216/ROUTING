import RouteBoard from "./RouteBoard";
import RouteMap from "./RouteMap";
import { useRouteGeometry } from "../lib/useRouteGeometry";
import type { SegmentUpdate } from "../lib/segmentDrag";
import type { RoutePlan } from "@shared/types";

interface RouteViewProps {
  cycleId: string;
  plan: RoutePlan;
  previewSegments: SegmentUpdate[] | null;
  activeStopId: string | null;
  pendingRouteOrder?: boolean;
  applyingRouteOrder?: boolean;
  onApplyRouteOrder?: () => void;
  onDiscardRouteOrder?: () => void;
  onUpdate: (segments: SegmentUpdate[]) => void;
  onPreviewSegments: (segments: SegmentUpdate[] | null) => void;
  onActiveStopChange: (stopId: string | null) => void;
  onRemoveStop?: (customerId: string) => void;
  onClearRoute?: () => void;
  onStopAdded?: (plan: RoutePlan) => void;
  onWedThresholdChange?: (n: number) => void;
  onAddTruck?: () => void;
  onAddDay?: () => void;
  onDriveTimeChange?: (
    segmentId: string,
    stopId: string,
    minutes: number | null
  ) => void;
  onFirstStopTimeChange?: (segmentId: string, time: string | null) => void;
  onServiceTimeChange?: (
    segmentId: string,
    stopId: string,
    minutes: number | null
  ) => void;
  onDriverBreakChange?: (segmentId: string, enabled: boolean) => void;
  onDriverBreakMove?: (segmentId: string, afterStopId: string) => void;
  onReoptimizeSegment?: (segmentId: string) => void;
  onReoptimizeAllSegments?: () => void;
  onFlipSegment?: (segmentId?: string) => void;
  onSwapSegments?: (segmentIdA?: string, segmentIdB?: string) => void;
  onAssignTruck?: (stopId: string, truckNumber: number) => void;
  onAssignDay?: (stopId: string, targetSegmentId: string) => void;
  onDeliveryInstructionsChange?: (stopId: string, instructions: string) => void;
  onContactChange?: (stopId: string, contactName: string, contactPhone: string) => void;
  mapGeometryRefreshKey: number;
  trafficRefreshPending?: boolean;
  refreshingTraffic?: boolean;
  trafficRefreshError?: string | null;
  onRefreshTraffic?: () => void;
}

export default function RouteView({
  cycleId,
  plan,
  previewSegments,
  activeStopId,
  pendingRouteOrder,
  applyingRouteOrder,
  onApplyRouteOrder,
  onDiscardRouteOrder,
  onUpdate,
  onPreviewSegments,
  onActiveStopChange,
  onRemoveStop,
  onClearRoute,
  onStopAdded,
  onWedThresholdChange,
  onAddTruck,
  onAddDay,
  onDriveTimeChange,
  onFirstStopTimeChange,
  onServiceTimeChange,
  onDriverBreakChange,
  onDriverBreakMove,
  onReoptimizeSegment,
  onReoptimizeAllSegments,
  onFlipSegment,
  onSwapSegments,
  onAssignTruck,
  onAssignDay,
  onDeliveryInstructionsChange,
  onContactChange,
  mapGeometryRefreshKey,
  trafficRefreshPending,
  refreshingTraffic,
  trafficRefreshError,
  onRefreshTraffic,
}: RouteViewProps) {
  const { geometrySegments, geometryPaths, trafficSummary, geometrySource, loading: geometryLoading } = useRouteGeometry(
    cycleId,
    plan,
    null,
    mapGeometryRefreshKey
  );

  return (
    <div className="main__route-view">
      <RouteMap
        plan={plan}
        previewSegments={previewSegments}
        activeStopId={activeStopId}
        geometrySegments={geometrySegments}
        geometryPaths={geometryPaths}
        trafficSummary={trafficSummary}
        geometrySource={geometrySource}
        geometryLoading={geometryLoading}
        trafficRefreshPending={trafficRefreshPending}
        refreshingTraffic={refreshingTraffic}
        trafficRefreshError={trafficRefreshError}
        onRefreshTraffic={onRefreshTraffic}
        pendingRouteOrder={pendingRouteOrder}
        routeLocked={plan.status === "locked"}
      />
      <RouteBoard
        plan={plan}
        pendingRouteOrder={pendingRouteOrder}
        applyingRouteOrder={applyingRouteOrder}
        onApplyRouteOrder={onApplyRouteOrder}
        onDiscardRouteOrder={onDiscardRouteOrder}
        onUpdate={onUpdate}
        onPreviewSegments={onPreviewSegments}
        onActiveStopChange={onActiveStopChange}
        onRemoveStop={onRemoveStop}
        onClearRoute={onClearRoute}
        onStopAdded={onStopAdded}
        onWedThresholdChange={onWedThresholdChange}
        onAddTruck={onAddTruck}
        onAddDay={onAddDay}
        onDriveTimeChange={onDriveTimeChange}
        onFirstStopTimeChange={onFirstStopTimeChange}
        onServiceTimeChange={onServiceTimeChange}
        onDriverBreakChange={onDriverBreakChange}
        onDriverBreakMove={onDriverBreakMove}
        onReoptimizeSegment={onReoptimizeSegment}
        onReoptimizeAllSegments={onReoptimizeAllSegments}
        onFlipSegment={onFlipSegment}
        onSwapSegments={onSwapSegments}
        onAssignTruck={onAssignTruck}
        onAssignDay={onAssignDay}
        onDeliveryInstructionsChange={onDeliveryInstructionsChange}
        onContactChange={onContactChange}
      />
    </div>
  );
}
