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
  onUpdate: (segments: SegmentUpdate[]) => void;
  onPreviewSegments: (segments: SegmentUpdate[] | null) => void;
  onActiveStopChange: (stopId: string | null) => void;
  onRemoveStop?: (customerId: string) => void;
  onClearRoute?: () => void;
  onStopAdded?: (plan: RoutePlan) => void;
  onWedThresholdChange?: (n: number) => void;
  onAddTruck?: () => void;
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
  onAssignTruck?: (stopId: string, truckNumber: number) => void;
  onDeliveryInstructionsChange?: (stopId: string, instructions: string) => void;
  onContactChange?: (stopId: string, contactName: string, contactPhone: string) => void;
  mapGeometryRefreshKey: number;
}

export default function RouteView({
  cycleId,
  plan,
  previewSegments,
  activeStopId,
  onUpdate,
  onPreviewSegments,
  onActiveStopChange,
  onRemoveStop,
  onClearRoute,
  onStopAdded,
  onWedThresholdChange,
  onAddTruck,
  onDriveTimeChange,
  onFirstStopTimeChange,
  onServiceTimeChange,
  onDriverBreakChange,
  onDriverBreakMove,
  onReoptimizeSegment,
  onReoptimizeAllSegments,
  onAssignTruck,
  onDeliveryInstructionsChange,
  onContactChange,
  mapGeometryRefreshKey,
}: RouteViewProps) {
  const mapPreviewSegments = plan.manualTruckAssignment ? null : previewSegments;
  const { geometrySegments, geometryPaths, trafficSummary, geometrySource, loading: geometryLoading } = useRouteGeometry(
    cycleId,
    plan,
    mapPreviewSegments,
    mapGeometryRefreshKey
  );

  return (
    <div className="main__route-view">
      <RouteMap
        plan={plan}
        previewSegments={mapPreviewSegments}
        activeStopId={activeStopId}
        geometrySegments={geometrySegments}
        geometryPaths={geometryPaths}
        trafficSummary={trafficSummary}
        geometrySource={geometrySource}
        geometryLoading={geometryLoading}
      />
      <RouteBoard
        plan={plan}
        onUpdate={onUpdate}
        onPreviewSegments={onPreviewSegments}
        onActiveStopChange={onActiveStopChange}
        onRemoveStop={onRemoveStop}
        onClearRoute={onClearRoute}
        onStopAdded={onStopAdded}
        onWedThresholdChange={onWedThresholdChange}
        onAddTruck={onAddTruck}
        onDriveTimeChange={onDriveTimeChange}
        onFirstStopTimeChange={onFirstStopTimeChange}
        onServiceTimeChange={onServiceTimeChange}
        onDriverBreakChange={onDriverBreakChange}
        onDriverBreakMove={onDriverBreakMove}
        onReoptimizeSegment={onReoptimizeSegment}
        onReoptimizeAllSegments={onReoptimizeAllSegments}
        onAssignTruck={onAssignTruck}
        onDeliveryInstructionsChange={onDeliveryInstructionsChange}
        onContactChange={onContactChange}
      />
    </div>
  );
}
