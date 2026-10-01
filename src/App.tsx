import { useCallback, useEffect, useState } from "react";
import CustomerUpload from "./components/CustomerUpload";
import ManualOrderForm from "./components/ManualOrderForm";
import OrderSelector from "./components/OrderSelector";
import RoutePrintSheet from "./components/RoutePrintSheet";
import RouteTabs from "./components/RouteTabs";
import RouteView from "./components/RouteView";
import {
  addDay,
  addTruck,
  assignStopToDay,
  fetchBatches,
  fetchRoutePlan,
  clearRouteOrders,
  lockRoute,
  removeOrderForCustomer,
  resetRoute,
  unlockRoute,
  setFirstStopTime,
  setStopDriveTime,
  setDriverBreak,
  setStopServiceTime,
  setWedThreshold,
  reoptimizeSegments,
  swapSegmentRoutes,
  applyRollingTraffic,
  updateSegments,
  updateStopDeliveryInstructions,
  updateStopContact,
} from "./lib/api";
import {
  applySegmentUpdates,
  segmentUpdatesFromPlan,
  type SegmentUpdate,
} from "./lib/segmentDrag";
import { formatDateTime, formatDurationMinutes } from "@shared/timeFormat";
import { NEW_DAY_SEGMENT_ID } from "@shared/constants";
import type { BatchSummary, RoutePlan } from "@shared/types";

export default function App() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderListKey, setOrderListKey] = useState(0);
  const [previewSegments, setPreviewSegments] = useState<SegmentUpdate[] | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [mapGeometryRefreshKey, setMapGeometryRefreshKey] = useState(0);
  const [pendingRouteOrder, setPendingRouteOrder] = useState(false);
  const [applyingRouteOrder, setApplyingRouteOrder] = useState(false);
  const [refreshingTraffic, setRefreshingTraffic] = useState(false);
  const [trafficRefreshError, setTrafficRefreshError] = useState<string | null>(null);

  const refreshMapGeometry = useCallback(() => {
    setMapGeometryRefreshKey((k) => k + 1);
  }, []);

  const handleRefreshTraffic = useCallback(async () => {
    if (!selectedCycleId || !plan) return;
    setRefreshingTraffic(true);
    setTrafficRefreshError(null);
    try {
      const updated = await applyRollingTraffic(
        selectedCycleId,
        segmentUpdatesFromPlan(plan)
      );
      setPlan(updated);
      setPendingRouteOrder(false);
      refreshMapGeometry();
    } catch (e) {
      setTrafficRefreshError(
        e instanceof Error ? e.message : "Failed to refresh traffic"
      );
    } finally {
      setRefreshingTraffic(false);
    }
  }, [selectedCycleId, plan, refreshMapGeometry]);

  const loadBatches = useCallback(() => {
    return fetchBatches().then((b) => {
      setBatches(b);
      setSelectedCycleId((prev) =>
        prev && b.some((x) => x.cycleId === prev) ? prev : (b[0]?.cycleId ?? null)
      );
    });
  }, []);

  useEffect(() => {
    loadBatches()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [loadBatches]);

  useEffect(() => {
    setPreviewSegments(null);
    setActiveStopId(null);
    setPendingRouteOrder(false);
    setMapGeometryRefreshKey(0);
    if (!selectedCycleId) {
      setPlan(null);
      return;
    }
    setLoading(true);
    fetchRoutePlan(selectedCycleId)
      .then((p) => {
        setPlan(p);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedCycleId]);

  const handleUpdate = useCallback((segments: SegmentUpdate[]) => {
    setPreviewSegments(null);
    setPlan((current) => {
      if (!current) return current;
      return {
        ...applySegmentUpdates(current, segments),
        rollingTrafficApplied: false,
      };
    });
    setPendingRouteOrder(true);
    setMapGeometryRefreshKey(0);
  }, []);

  const handleApplyRouteOrder = useCallback(async () => {
    if (!selectedCycleId || !plan) return;
    setApplyingRouteOrder(true);
    setError(null);
    try {
      const updated = await updateSegments(selectedCycleId, segmentUpdatesFromPlan(plan));
      setPlan(updated);
      setPendingRouteOrder(false);
      setPreviewSegments(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update route times");
    } finally {
      setApplyingRouteOrder(false);
    }
  }, [selectedCycleId, plan]);

  const handleDiscardRouteOrder = useCallback(async () => {
    if (!selectedCycleId) return;
    setApplyingRouteOrder(true);
    try {
      const restored = await fetchRoutePlan(selectedCycleId);
      setPlan(restored);
      setPendingRouteOrder(false);
      setPreviewSegments(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reload route");
    } finally {
      setApplyingRouteOrder(false);
    }
  }, [selectedCycleId]);

  const handleWedThreshold = useCallback(
    async (n: number) => {
      if (!selectedCycleId) return;
      const updated = await setWedThreshold(selectedCycleId, n);
      setPlan(updated);
      setPendingRouteOrder(false);
    },
    [selectedCycleId]
  );

  const handleAddTruck = useCallback(async () => {
    if (!selectedCycleId) return;
    const updated = await addTruck(selectedCycleId);
    setPlan(updated);
    setPendingRouteOrder(false);
  }, [selectedCycleId]);

  const handleAddDay = useCallback(async () => {
    if (!selectedCycleId) return;
    try {
      const updated = await addDay(selectedCycleId);
      setPlan(updated);
      setPendingRouteOrder(false);
      setPreviewSegments(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add Friday");
    }
  }, [selectedCycleId]);

  const handleReoptimizeSegment = useCallback(
    async (segmentId: string) => {
      if (!selectedCycleId) return;
      try {
        const updated = await reoptimizeSegments(selectedCycleId, segmentId);
        setPlan(updated);
        setPendingRouteOrder(false);
        setPreviewSegments(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to re-optimize truck");
      }
    },
    [selectedCycleId]
  );

  const handleReoptimizeAllSegments = useCallback(async () => {
    if (!selectedCycleId) return;
    try {
      const updated = await reoptimizeSegments(selectedCycleId);
      setPlan(updated);
      setPendingRouteOrder(false);
      setPreviewSegments(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to re-optimize trucks");
    }
  }, [selectedCycleId]);

  const handleFlipSegment = useCallback(
    (segmentId?: string) => {
      if (!plan) return;
      const flipThese = new Set(
        segmentId ? [segmentId] : plan.segments.map((segment) => segment.id)
      );
      handleUpdate(
        plan.segments.map((seg) => {
          const stops = flipThese.has(seg.id) ? [...seg.stops].reverse() : seg.stops;
          return {
            segmentId: seg.id,
            stops: stops.map((s, position) => ({ stopId: s.stopId, position })),
          };
        })
      );
    },
    [plan, handleUpdate]
  );

  const handleSwapSegments = useCallback(
    async (segmentIdA?: string, segmentIdB?: string) => {
      if (!selectedCycleId) return;
      try {
        const updated = await swapSegmentRoutes(selectedCycleId, segmentIdA, segmentIdB);
        setPlan(updated);
        setPendingRouteOrder(false);
        setPreviewSegments(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to switch days' routes");
      }
    },
    [selectedCycleId]
  );

  const handleAssignTruck = useCallback(
    (stopId: string, truckNumber: number) => {
      if (!plan) return;
      const targetSegment = plan.segments[truckNumber - 1];
      if (!targetSegment) return;
      const fromSegment = plan.segments.find((s) => s.stops.some((st) => st.stopId === stopId));
      if (!fromSegment || fromSegment.id === targetSegment.id) return;

      handleUpdate(
        plan.segments.map((seg) => {
          let stops = seg.stops.filter((s) => s.stopId !== stopId);
          if (seg.id === targetSegment.id) {
            stops = [...stops, { stopId, position: stops.length }];
          }
          return {
            segmentId: seg.id,
            stops: stops.map((s, position) => ({ stopId: s.stopId, position })),
          };
        })
      );
    },
    [plan, handleUpdate]
  );

  const handleAssignDay = useCallback(
    async (stopId: string, targetSegmentId: string) => {
      if (!selectedCycleId) return;
      if (targetSegmentId !== NEW_DAY_SEGMENT_ID) {
        if (!plan) return;
        const fromSegment = plan.segments.find((s) => s.stops.some((st) => st.stopId === stopId));
        if (!fromSegment || fromSegment.id === targetSegmentId) return;
        const targetSegment = plan.segments.find((s) => s.id === targetSegmentId);
        if (!targetSegment) return;

        handleUpdate(
          plan.segments.map((seg) => {
            let stops = seg.stops.filter((s) => s.stopId !== stopId);
            if (seg.id === targetSegmentId) {
              stops = [...stops, { stopId, position: stops.length }];
            }
            return {
              segmentId: seg.id,
              stops: stops.map((s, position) => ({ stopId: s.stopId, position })),
            };
          })
        );
        return;
      }

      try {
        const updated = await assignStopToDay(selectedCycleId, stopId, targetSegmentId);
        setPlan(updated);
        setPendingRouteOrder(false);
        setPreviewSegments(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to switch day for stop");
      }
    },
    [selectedCycleId, plan, handleUpdate]
  );

  const handleDriveTimeChange = useCallback(
    async (segmentId: string, stopId: string, minutes: number | null) => {
      if (!selectedCycleId) return;
      try {
        const updated = await setStopDriveTime(selectedCycleId, segmentId, stopId, minutes);
        setPlan(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update drive time");
      }
    },
    [selectedCycleId]
  );

  const handleFirstStopTimeChange = useCallback(
    async (segmentId: string, time: string | null) => {
      if (!selectedCycleId) return;
      try {
        const updated = await setFirstStopTime(selectedCycleId, segmentId, time);
        setPlan(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update first stop time");
      }
    },
    [selectedCycleId]
  );

  const handleDriverBreakChange = useCallback(
    async (segmentId: string, enabled: boolean) => {
      if (!selectedCycleId) return;
      try {
        const updated = await setDriverBreak(selectedCycleId, segmentId, enabled);
        setPlan(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update driver break");
      }
    },
    [selectedCycleId]
  );

  const handleDriverBreakMove = useCallback(
    async (segmentId: string, afterStopId: string) => {
      if (!selectedCycleId) return;
      try {
        const updated = await setDriverBreak(
          selectedCycleId,
          segmentId,
          true,
          afterStopId
        );
        setPlan(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to move driver break");
      }
    },
    [selectedCycleId]
  );

  const handleServiceTimeChange = useCallback(
    async (segmentId: string, stopId: string, minutes: number | null) => {
      if (!selectedCycleId) return;
      try {
        const updated = await setStopServiceTime(selectedCycleId, segmentId, stopId, minutes);
        setPlan(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update service time");
      }
    },
    [selectedCycleId]
  );

  const handleDeliveryInstructionsChange = useCallback(
    async (stopId: string, instructions: string) => {
      if (!selectedCycleId) return;
      try {
        const updated = await updateStopDeliveryInstructions(selectedCycleId, stopId, instructions);
        setPlan(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update delivery instructions");
      }
    },
    [selectedCycleId]
  );

  const handleContactChange = useCallback(
    async (stopId: string, contactName: string, contactPhone: string) => {
      if (!selectedCycleId) return;
      try {
        const updated = await updateStopContact(selectedCycleId, stopId, contactName, contactPhone);
        setPlan(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update contact");
      }
    },
    [selectedCycleId]
  );

  const handleCustomersLoaded = useCallback(() => {
    setOrderListKey((k) => k + 1);
  }, []);

  const refreshAfterOrderChange = useCallback(async (cycleId: string | null) => {
    const b = await fetchBatches();
    setBatches(b);
    const nextId =
      cycleId && b.some((x) => x.cycleId === cycleId) ? cycleId : (b[0]?.cycleId ?? null);
    setSelectedCycleId(nextId);
    if (!nextId) {
      setPlan(null);
      setPreviewSegments(null);
      setActiveStopId(null);
      return;
    }
    const updated = await fetchRoutePlan(nextId);
    setPlan(updated);
    setMapGeometryRefreshKey(0);
  }, []);

  const handleOrdersApplied = useCallback(async () => {
    await refreshAfterOrderChange(selectedCycleId);
    setOrderListKey((k) => k + 1);
    handleCustomersLoaded();
  }, [refreshAfterOrderChange, selectedCycleId, handleCustomersLoaded]);

  const handleRemoveStop = useCallback(
    async (customerId: string) => {
      const summary = await removeOrderForCustomer(customerId);
      if (summary.errors.length > 0) {
        setError(summary.errors.join(" · "));
        return;
      }
      await refreshAfterOrderChange(selectedCycleId);
      setOrderListKey((k) => k + 1);
    },
    [refreshAfterOrderChange, selectedCycleId]
  );

  const handleStopAdded = useCallback(async (updatedPlan: RoutePlan) => {
    setPlan(updatedPlan);
    setPendingRouteOrder(false);
    setPreviewSegments(null);
    setActiveStopId(null);
    const b = await fetchBatches();
    setBatches(b);
    setOrderListKey((k) => k + 1);
  }, []);

  const handleClearRoute = useCallback(async () => {
    if (!selectedCycleId) return;
    const summary = await clearRouteOrders(selectedCycleId);
    if (summary.errors.length > 0) {
      setError(summary.errors.join(" · "));
      return;
    }
    await refreshAfterOrderChange(selectedCycleId);
    setOrderListKey((k) => k + 1);
  }, [refreshAfterOrderChange, selectedCycleId]);

  const handleReset = async () => {
    if (!selectedCycleId) return;
    const updated = await resetRoute(selectedCycleId);
    setPlan(updated);
    setPendingRouteOrder(false);
    setMapGeometryRefreshKey(0);
  };

  const handleLock = async () => {
    if (!selectedCycleId) return;
    const updated = await lockRoute(selectedCycleId);
    setPlan(updated);
  };

  const handleUnlock = async () => {
    if (!selectedCycleId) return;
    const updated = await unlockRoute(selectedCycleId);
    setPlan(updated);
  };

  const selectedBatch = batches.find((b) => b.cycleId === selectedCycleId);

  if (loading && !plan && batches.length === 0) {
    return <div className="app app--loading">Loading…</div>;
  }

  if (error) {
    return <div className="app app--error">{error}</div>;
  }

  return (
    <>
    <div className="app">
      <header className="header">
        <div>
          <h1>F Magnotta Wines - Routing</h1>
        </div>
        <div className="header__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleReset}
            disabled={!plan || plan.status === "locked" || pendingRouteOrder}
          >
            Reset to suggested
          </button>
          {plan?.status === "locked" ? (
            <button type="button" className="btn btn--primary" onClick={() => void handleUnlock()}>
              Unlock route
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleLock()}
              disabled={!plan || pendingRouteOrder}
            >
              Lock route
            </button>
          )}
        </div>
      </header>

      <RouteTabs
        batches={batches}
        selectedCycleId={selectedCycleId}
        onSelect={setSelectedCycleId}
      />

      <aside className="sidebar">
        <CustomerUpload
          onUploaded={() => void handleOrdersApplied()}
          onCustomersLoaded={handleCustomersLoaded}
          refreshKey={orderListKey}
        />
        <OrderSelector
          refreshKey={orderListKey}
          onApplied={() => void handleOrdersApplied()}
        />
        <ManualOrderForm
          activePlan={plan}
          onAdded={(updatedPlan) => {
            if (updatedPlan && updatedPlan.cycleId === selectedCycleId) {
              setPlan(updatedPlan);
              setPendingRouteOrder(false);
              setPreviewSegments(null);
              setActiveStopId(null);
              setMapGeometryRefreshKey(0);
              setOrderListKey((k) => k + 1);
              void fetchBatches().then(setBatches);
              return;
            }
            void handleOrdersApplied();
          }}
        />
      </aside>

      <main className="main">
        {plan && selectedBatch ? (
          <>
            <div className="main__header">
              <h2>{plan.territoryName}</h2>
              <p>
                Delivery {plan.deliveryDate} · Batch {plan.batchId} ·{" "}
                {plan.allStops.length} stops · Depot:{" "}
                {plan.depot.address}, {plan.depot.city}
              </p>
              <p className="main__cutoff">
                Cutoff {formatDateTime(selectedBatch.cutoffAt)} ·
                {selectedBatch.multiDay
                  ? " Multi-day route — Wednesday, Thursday, and optional Friday; truck stays out overnight"
                  : plan.manualTruckAssignment
                    ? " Manual truck assignment — all stops start on Truck 1; drag to split"
                    : " Same-day return to Scranton"}
                {plan.travelTimeSource && (
                  <>
                    {" "}
                    · Drive times:{" "}
                    {plan.travelTimeSource === "google"
                      ? plan.rollingTrafficApplied
                        ? "Google Maps (live traffic applied)"
                        : "Google Maps (refresh traffic for live delays)"
                      : plan.travelTimeSource === "osrm"
                        ? "road estimate"
                        : "straight-line estimate"}
                  </>
                )}
                {plan.hasManualOrder && (
                  <span className="main__manual-badge">
                    {" "}
                    · Manual route order (
                    {(plan.timeDiffMinutes ?? 0) > 0
                      ? `+${formatDurationMinutes(plan.timeDiffMinutes!)} slower than optimal`
                      : (plan.timeDiffMinutes ?? 0) < 0
                      ? `${formatDurationMinutes(Math.abs(plan.timeDiffMinutes!))} faster than optimal`
                      : "same time as optimal"}
                    )
                  </span>
                )}
              </p>
            </div>
            <RouteView
              cycleId={selectedCycleId!}
              plan={plan}
              mapGeometryRefreshKey={mapGeometryRefreshKey}
              trafficRefreshPending={
                plan.travelTimeSource === "google" && !plan.rollingTrafficApplied
              }
              refreshingTraffic={refreshingTraffic}
              trafficRefreshError={trafficRefreshError}
              onRefreshTraffic={() => void handleRefreshTraffic()}
              previewSegments={previewSegments}
              activeStopId={activeStopId}
              pendingRouteOrder={pendingRouteOrder}
              applyingRouteOrder={applyingRouteOrder}
              onApplyRouteOrder={() => void handleApplyRouteOrder()}
              onDiscardRouteOrder={() => void handleDiscardRouteOrder()}
              onUpdate={handleUpdate}
              onPreviewSegments={setPreviewSegments}
              onActiveStopChange={setActiveStopId}
              onRemoveStop={(customerId) => void handleRemoveStop(customerId)}
              onClearRoute={() => void handleClearRoute()}
              onStopAdded={handleStopAdded}
              onWedThresholdChange={
                plan.segments.some((s) => s.segmentType === "day")
                  ? handleWedThreshold
                  : undefined
              }
              onAddTruck={
                !plan.segments.some((s) => s.segmentType === "day") ? handleAddTruck : undefined
              }
              onAddDay={
                plan.segments.some((s) => s.segmentType === "day") && plan.status !== "locked"
                  ? handleAddDay
                  : undefined
              }
              onDriveTimeChange={
                plan.status !== "locked"
                  ? (segmentId, stopId, minutes) =>
                      void handleDriveTimeChange(segmentId, stopId, minutes)
                  : undefined
              }
              onFirstStopTimeChange={
                plan.status !== "locked"
                  ? (segmentId, time) => void handleFirstStopTimeChange(segmentId, time)
                  : undefined
              }
              onServiceTimeChange={
                plan.status !== "locked"
                  ? (segmentId, stopId, minutes) =>
                      void handleServiceTimeChange(segmentId, stopId, minutes)
                  : undefined
              }
              onDriverBreakChange={
                plan.status !== "locked"
                  ? (segmentId, enabled) => void handleDriverBreakChange(segmentId, enabled)
                  : undefined
              }
              onDriverBreakMove={
                plan.status !== "locked"
                  ? (segmentId, afterStopId) =>
                      void handleDriverBreakMove(segmentId, afterStopId)
                  : undefined
              }
              onReoptimizeSegment={
                plan.status !== "locked" ? handleReoptimizeSegment : undefined
              }
              onReoptimizeAllSegments={
                plan.status !== "locked" ? handleReoptimizeAllSegments : undefined
              }
              onFlipSegment={
                plan.status !== "locked" ? handleFlipSegment : undefined
              }
              onSwapSegments={
                plan.status !== "locked" ? handleSwapSegments : undefined
              }
              onAssignTruck={
                plan.status !== "locked" ? handleAssignTruck : undefined
              }
              onAssignDay={
                plan.status !== "locked" ? handleAssignDay : undefined
              }
              onDeliveryInstructionsChange={(stopId, instructions) =>
                void handleDeliveryInstructionsChange(stopId, instructions)
              }
              onContactChange={(stopId, name, phone) =>
                void handleContactChange(stopId, name, phone)
              }
            />
          </>
        ) : (
          <div className="main__empty">
            <h2>Route board</h2>
            <p>Upload your weekly customer CSV, select accounts with orders, then apply to build routes.</p>
          </div>
        )}
      </main>
    </div>
    {plan && (
      <RoutePrintSheet plan={plan} batch={selectedBatch} />
    )}
    </>
  );
}
