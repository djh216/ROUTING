import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import type { RoutePlan, Segment, SegmentValidation, Stop } from "@shared/types";
import { DRIVER_BREAK_MINUTES, SERVICE_MINUTES_PER_STOP } from "@shared/constants";
import {
  formatDurationMinutes,
  formatTimeOfDay,
  minutesToTimeInputValue,
  parseDeliveryTime,
  parseFormattedTimeToMinutes,
} from "@shared/timeFormat";
import { computeSegmentUpdate, type SegmentUpdate } from "../lib/segmentDrag";
import { printRoutePdf } from "../lib/printRoute";
import ContactDisplay from "./ContactDisplay";
import AddStopPanel from "./AddStopPanel";

interface RouteBoardProps {
  plan: RoutePlan;
  onUpdate: (segments: SegmentUpdate[]) => void;
  onPreviewSegments?: (segments: SegmentUpdate[] | null) => void;
  onActiveStopChange?: (stopId: string | null) => void;
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
  onServiceTimeChange?: (
    segmentId: string,
    stopId: string,
    minutes: number | null
  ) => void;
  onFirstStopTimeChange?: (segmentId: string, time: string | null) => void;
  onDriverBreakChange?: (segmentId: string, enabled: boolean) => void;
  onDriverBreakMove?: (segmentId: string, afterStopId: string) => void;
  onReoptimizeSegment?: (segmentId: string) => void;
  onReoptimizeAllSegments?: () => void;
  onAssignTruck?: (stopId: string, truckNumber: number) => void;
}

function driverBreakDragId(segmentId: string): string {
  return `driver-break-${segmentId}`;
}

function isDriverBreakDragId(id: string): boolean {
  return id.startsWith("driver-break-");
}

function findSegmentForStop(plan: RoutePlan, stopId: string): string | null {
  for (const seg of plan.segments) {
    if (seg.stops.some((s) => s.stopId === stopId)) return seg.id;
  }
  return null;
}

function DraggableDriverBreak({
  segmentId,
  disabled,
}: {
  segmentId: string;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: driverBreakDragId(segmentId),
    disabled,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="segment-column__break-marker"
      {...attributes}
      {...listeners}
    >
      <span className="segment-column__break-grip">⋮⋮</span>
      {DRIVER_BREAK_MINUTES} min driver break
      {!disabled && <span className="segment-column__break-hint">drag to reposition</span>}
    </div>
  );
}

function formatTrafficLabel(trafficMinutes: number): string {
  if (trafficMinutes <= 0) return "No extra traffic";
  return `+${trafficMinutes} min traffic`;
}

function DriveTimeBreakdown({
  baseMinutes,
  trafficMinutes,
}: {
  baseMinutes: number;
  trafficMinutes: number;
}) {
  return (
    <div className="stop-card__drive-breakdown">
      <span className="stop-card__drive-base">{baseMinutes} min base</span>
      <span className="stop-card__drive-breakdown-sep">·</span>
      <span className="stop-card__traffic">{formatTrafficLabel(trafficMinutes)}</span>
    </div>
  );
}

function DriveTimeControl({
  minutes,
  baseMinutes,
  trafficMinutes,
  isManual,
  disabled,
  onChange,
}: {
  minutes?: number;
  baseMinutes?: number;
  trafficMinutes?: number;
  isManual?: boolean;
  disabled?: boolean;
  onChange?: (minutes: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (typeof minutes === "number" ? String(minutes) : "");

  function commit() {
    if (!onChange) return;
    const trimmed = (draft ?? display).trim();
    if (trimmed === "") {
      onChange(null);
      setDraft(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || parsed < 0) {
      setDraft(null);
      return;
    }
    onChange(Math.round(parsed));
    setDraft(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      setDraft(null);
      e.currentTarget.blur();
    }
  }

  const showBreakdown =
    !isManual &&
    typeof baseMinutes === "number" &&
    typeof trafficMinutes === "number";

  if (!onChange) {
    if (typeof minutes !== "number") return null;
    if (showBreakdown) {
      return (
        <div className="stop-card__drive-row">
          <DriveTimeBreakdown baseMinutes={baseMinutes} trafficMinutes={trafficMinutes} />
          <span className="stop-card__drive-total">{minutes} min total drive from previous</span>
        </div>
      );
    }
    return <span className="stop-card__drive">{minutes} min drive from previous</span>;
  }

  return (
    <div className="stop-card__drive-row">
      {showBreakdown && (
        <DriveTimeBreakdown baseMinutes={baseMinutes} trafficMinutes={trafficMinutes} />
      )}
      <label
        className={`stop-card__drive-edit ${isManual ? "stop-card__drive-edit--manual" : ""}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="stop-card__drive-label">
          {showBreakdown ? "Total drive from previous" : "Drive from previous"}
        </span>
        <input
          type="number"
          min={0}
          max={600}
          step={1}
          className="stop-card__drive-input"
          value={display}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
        <span className="stop-card__drive-unit">min</span>
        {isManual && (
          <button
            type="button"
            className="stop-card__drive-reset"
            disabled={disabled}
            title="Reset to calculated drive time"
            onClick={() => onChange(null)}
          >
            Reset
          </button>
        )}
      </label>
    </div>
  );
}

function ServiceTimeControl({
  minutes = SERVICE_MINUTES_PER_STOP,
  isManual,
  disabled,
  onChange,
}: {
  minutes?: number;
  isManual?: boolean;
  disabled?: boolean;
  onChange?: (minutes: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? String(minutes);

  function commit() {
    if (!onChange) return;
    const trimmed = (draft ?? display).trim();
    if (trimmed === "") {
      onChange(null);
      setDraft(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || parsed < SERVICE_MINUTES_PER_STOP) {
      setDraft(null);
      return;
    }
    if (parsed <= SERVICE_MINUTES_PER_STOP) {
      onChange(null);
    } else {
      onChange(Math.round(parsed));
    }
    setDraft(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      setDraft(null);
      e.currentTarget.blur();
    }
  }

  if (!onChange) {
    return (
      <span className="stop-card__service">
        {minutes} min service
        {isManual && minutes > SERVICE_MINUTES_PER_STOP ? " (extended)" : ""}
      </span>
    );
  }

  return (
    <label
      className={`stop-card__service-edit ${isManual ? "stop-card__service-edit--manual" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="stop-card__service-label">Service time</span>
      <input
        type="number"
        min={SERVICE_MINUTES_PER_STOP}
        max={120}
        step={1}
        className="stop-card__service-input"
        value={display}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
      <span className="stop-card__drive-unit">min</span>
      {isManual && (
        <button
          type="button"
          className="stop-card__drive-reset"
          disabled={disabled}
          title={`Reset to default ${SERVICE_MINUTES_PER_STOP} min`}
          onClick={() => onChange(null)}
        >
          Reset
        </button>
      )}
    </label>
  );
}

function FirstStopEtaControl({
  eta,
  timeOverride,
  defaultTime,
  isManual,
  disabled,
  onChange,
}: {
  eta?: string;
  timeOverride?: string;
  defaultTime: string;
  isManual?: boolean;
  disabled?: boolean;
  onChange?: (time: string | null) => void;
}) {
  const resolvedMinutes =
    (timeOverride ? parseDeliveryTime(timeOverride) : null) ??
    (eta ? parseFormattedTimeToMinutes(eta) : null) ??
    parseDeliveryTime(defaultTime) ??
    10 * 60;
  const inputValue = minutesToTimeInputValue(resolvedMinutes);

  if (!onChange) {
    if (!eta && !timeOverride) return null;
    return (
      <p className="segment-column__first-stop">
        First stop arrive: {eta ?? formatTimeOfDay(defaultTime)}
        {isManual ? " (adjusted)" : ""}
      </p>
    );
  }

  return (
    <label className={`segment-column__first-stop-edit ${isManual ? "segment-column__first-stop-edit--manual" : ""}`}>
      <span className="segment-column__first-stop-label">First stop arrive at</span>
      <input
        type="time"
        className="segment-column__first-stop-input"
        value={inputValue}
        disabled={disabled}
        onChange={(e) => {
          const value = e.target.value;
          if (!value) return;
          onChange(value);
        }}
      />
      {isManual && (
        <button
          type="button"
          className="segment-column__first-stop-reset"
          disabled={disabled}
          title={`Reset to default ${formatTimeOfDay(defaultTime)}`}
          onClick={() => onChange(null)}
        >
          Reset
        </button>
      )}
    </label>
  );
}

function TruckAssignButtons({
  currentTruck,
  disabled,
  onAssign,
}: {
  currentTruck: number;
  disabled?: boolean;
  onAssign: (truckNumber: number) => void;
}) {
  return (
    <div
      className="stop-card__trucks"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="stop-card__trucks-label">Truck</span>
      {[1, 2, 3].map((truckNumber) => (
        <button
          key={truckNumber}
          type="button"
          className={`stop-card__truck-btn ${
            currentTruck === truckNumber ? "stop-card__truck-btn--active" : ""
          }`}
          disabled={disabled}
          aria-pressed={currentTruck === truckNumber}
          onClick={(e) => {
            e.stopPropagation();
            onAssign(truckNumber);
          }}
        >
          {truckNumber}
        </button>
      ))}
    </div>
  );
}

function StopCard({
  stop,
  eta,
  driveMinutes,
  baseDriveMinutes,
  trafficMinutes,
  driveIsManual,
  serviceMinutes,
  serviceIsManual,
  hasError,
  currentTruck,
  onRemove,
  removeDisabled,
  onDriveTimeChange,
  onServiceTimeChange,
  onAssignTruck,
}: {
  stop: Stop;
  eta?: string;
  driveMinutes?: number;
  baseDriveMinutes?: number;
  trafficMinutes?: number;
  driveIsManual?: boolean;
  serviceMinutes?: number;
  serviceIsManual?: boolean;
  hasError?: boolean;
  currentTruck?: number;
  onRemove?: () => void;
  removeDisabled?: boolean;
  onDriveTimeChange?: (minutes: number | null) => void;
  onServiceTimeChange?: (minutes: number | null) => void;
  onAssignTruck?: (truckNumber: number) => void;
}) {
  return (
    <div className={`stop-card ${hasError ? "stop-card--error" : ""}`}>
      <span className="stop-card__grip">⋮⋮</span>
      <div className="stop-card__body">
        <strong>{stop.customerName}</strong>
        <span className="stop-card__meta">
          {stop.address}, {stop.city}
        </span>
        {(stop.contactName || stop.contactPhone) && (
          <span className="stop-card__contact">
            Contact: <ContactDisplay contactName={stop.contactName} contactPhone={stop.contactPhone} />
          </span>
        )}
        {stop.deliveryInstructions && (
          <span className="stop-card__instructions">{stop.deliveryInstructions}</span>
        )}
        {onAssignTruck && currentTruck != null && (
          <TruckAssignButtons
            currentTruck={currentTruck}
            disabled={removeDisabled}
            onAssign={onAssignTruck}
          />
        )}
        <DriveTimeControl
          minutes={driveMinutes}
          baseMinutes={baseDriveMinutes}
          trafficMinutes={trafficMinutes}
          isManual={driveIsManual}
          disabled={removeDisabled}
          onChange={onDriveTimeChange}
        />
        <ServiceTimeControl
          minutes={serviceMinutes}
          isManual={serviceIsManual}
          disabled={removeDisabled}
          onChange={onServiceTimeChange}
        />
        {eta && <span className="stop-card__eta">ETA {eta}</span>}
      </div>
      {onRemove && (
        <button
          type="button"
          className="stop-card__remove"
          disabled={removeDisabled}
          title="Remove from route"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function SortableStop({
  stop,
  eta,
  driveMinutes,
  baseDriveMinutes,
  trafficMinutes,
  driveIsManual,
  serviceMinutes,
  serviceIsManual,
  hasError,
  currentTruck,
  disabled,
  onRemove,
  onDriveTimeChange,
  onServiceTimeChange,
  onAssignTruck,
}: {
  stop: Stop;
  eta?: string;
  driveMinutes?: number;
  baseDriveMinutes?: number;
  trafficMinutes?: number;
  driveIsManual?: boolean;
  serviceMinutes?: number;
  serviceIsManual?: boolean;
  hasError?: boolean;
  currentTruck?: number;
  disabled?: boolean;
  onRemove?: () => void;
  onDriveTimeChange?: (minutes: number | null) => void;
  onServiceTimeChange?: (minutes: number | null) => void;
  onAssignTruck?: (truckNumber: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <StopCard
        stop={stop}
        eta={eta}
        driveMinutes={driveMinutes}
        baseDriveMinutes={baseDriveMinutes}
        trafficMinutes={trafficMinutes}
        driveIsManual={driveIsManual}
        serviceMinutes={serviceMinutes}
        serviceIsManual={serviceIsManual}
        hasError={hasError}
        currentTruck={currentTruck}
        onRemove={onRemove}
        removeDisabled={disabled}
        onDriveTimeChange={onDriveTimeChange}
        onServiceTimeChange={onServiceTimeChange}
        onAssignTruck={onAssignTruck}
      />
    </div>
  );
}

function segmentTotalMinutes(v: SegmentValidation): number {
  if (v.totalRouteMinutes != null && v.totalRouteMinutes > 0) {
    return v.totalRouteMinutes;
  }
  const drive =
    v.totalDriveMinutes ??
    Object.values(v.stopDriveMinutes ?? {}).reduce((sum, n) => sum + n, 0);
  return drive + v.stopCount * SERVICE_MINUTES_PER_STOP;
}

function SegmentColumn({
  segment,
  stops,
  disabled,
  driveOverrides,
  serviceOverrides,
  firstStopTimeOverride,
  defaultFirstStopTime,
  onRemoveStop,
  onDriveTimeChange,
  onServiceTimeChange,
  onFirstStopTimeChange,
  driverBreakEnabled,
  onDriverBreakChange,
  onDriverBreakMove,
  onReoptimize,
  reoptimizing,
  truckNumber,
  onAssignTruck,
}: {
  segment: Segment;
  stops: Stop[];
  truckNumber: number;
  disabled?: boolean;
  driveOverrides?: Record<string, number>;
  serviceOverrides?: Record<string, number>;
  firstStopTimeOverride?: string;
  defaultFirstStopTime?: string;
  driverBreakEnabled?: boolean;
  onRemoveStop?: (customerId: string) => void;
  onDriveTimeChange?: (stopId: string, minutes: number | null) => void;
  onServiceTimeChange?: (stopId: string, minutes: number | null) => void;
  onFirstStopTimeChange?: (time: string | null) => void;
  onDriverBreakChange?: (enabled: boolean) => void;
  onDriverBreakMove?: (afterStopId: string) => void;
  onReoptimize?: () => void;
  reoptimizing?: boolean;
  onAssignTruck?: (stopId: string, truckNumber: number) => void;
}) {
  const stopIds = stops.map((s) => s.id);
  const v = segment.validation;
  const breakAfterStop = v.driverBreakAfterStopId
    ? stops.find((s) => s.id === v.driverBreakAfterStopId)
    : undefined;
  const { setNodeRef, isOver } = useDroppable({ id: `segment-${segment.id}` });

  return (
    <div className="segment-column" ref={setNodeRef} data-over={isOver}>
      <div className="segment-column__header">
        <div className="segment-column__title-row">
          <h3>{segment.label}</h3>
          <div className="segment-column__actions">
            {v.stopCount > 0 && (
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                onClick={() => printRoutePdf(segment.id)}
              >
                Print PDF
              </button>
            )}
            {onReoptimize && v.stopCount >= 2 && (
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                disabled={disabled || reoptimizing}
                onClick={onReoptimize}
              >
                {reoptimizing ? "Optimizing…" : "Re-optimize"}
              </button>
            )}
          </div>
        </div>
        <p className="segment-column__date">{segment.deliveryDate}</p>
        <div className="segment-column__stats">
          <span>{v.stopCount} stops</span>
          <span>{v.totalCases} cases</span>
          <span>{v.totalMiles} mi</span>
        </div>
        {v.stopCount > 0 && (
          <p className="segment-column__total-time">
            Total time: {formatDurationMinutes(segmentTotalMinutes(v))}
            <span className="segment-column__total-time-detail">
              {" "}
              (drive + service{v.driverBreakMinutes ? ` + ${v.driverBreakMinutes} min break` : ""})
            </span>
          </p>
        )}
        {v.stopCount > 0 &&
          (onDriverBreakChange ? (
            <label className="segment-column__break">
              <input
                type="checkbox"
                checked={driverBreakEnabled === true}
                disabled={disabled}
                onChange={(e) => onDriverBreakChange(e.target.checked)}
              />
              {DRIVER_BREAK_MINUTES} min driver break
            </label>
          ) : (
            driverBreakEnabled && (
              <p className="segment-column__break-note">
                {DRIVER_BREAK_MINUTES} min driver break included
              </p>
            )
          ))}
        {driverBreakEnabled && breakAfterStop && (
          <p className="segment-column__break-note">
            After {breakAfterStop.customerName}
            {onDriverBreakMove ? " — drag break below to move" : ""}
          </p>
        )}
        {v.stopCount > 0 && stops[0] && (
          <FirstStopEtaControl
            eta={v.stopEtas[stops[0].id]}
            timeOverride={firstStopTimeOverride}
            defaultTime={defaultFirstStopTime ?? "10:00"}
            isManual={firstStopTimeOverride != null}
            disabled={disabled}
            onChange={onFirstStopTimeChange}
          />
        )}
        {v.departureTime && (
          <p className="segment-column__depart">Depart: {v.departureTime}</p>
        )}
        {v.completionTime && v.stopCount > 0 && (
          <p className="segment-column__complete">Done by: {v.completionTime}</p>
        )}
        {segment.startLocation === "overnight" && (
          <p className="segment-column__note">Start: overnight (no warehouse return)</p>
        )}
        {segment.endLocation === "overnight" && (
          <p className="segment-column__note">End: overnight near territory</p>
        )}
      </div>

      <SortableContext items={stopIds} strategy={verticalListSortingStrategy}>
        <div className="segment-column__stops">
          {stops.length === 0 && <p className="segment-column__empty">Drop stops here</p>}
          {stops.map((stop, index) => {
            const eta = v.stopEtas[stop.id];
            const driveMinutes = v.stopDriveMinutes?.[stop.id];
            const baseDriveMinutes = v.stopBaseDriveMinutes?.[stop.id];
            const trafficMinutes = v.stopTrafficMinutes?.[stop.id];
            const driveIsManual = driveOverrides?.[stop.id] != null;
            const serviceMinutes =
              serviceOverrides?.[stop.id] ?? SERVICE_MINUTES_PER_STOP;
            const serviceIsManual = serviceOverrides?.[stop.id] != null;
            const hasError = v.errors.some((e) => e.includes(stop.customerName));
            return (
              <Fragment key={stop.id}>
              <SortableStop
                stop={stop}
                eta={eta}
                driveMinutes={driveMinutes}
                baseDriveMinutes={baseDriveMinutes}
                trafficMinutes={trafficMinutes}
                driveIsManual={driveIsManual}
                serviceMinutes={serviceMinutes}
                serviceIsManual={serviceIsManual}
                hasError={hasError}
                currentTruck={truckNumber}
                disabled={disabled}
                onRemove={onRemoveStop ? () => onRemoveStop(stop.customerId) : undefined}
                onDriveTimeChange={
                  onDriveTimeChange
                    ? (minutes) => onDriveTimeChange(stop.id, minutes)
                    : undefined
                }
                onServiceTimeChange={
                  onServiceTimeChange
                    ? (minutes) => onServiceTimeChange(stop.id, minutes)
                    : undefined
                }
                onAssignTruck={
                  onAssignTruck
                    ? (targetTruck) => onAssignTruck(stop.id, targetTruck)
                    : undefined
                }
              />
              {driverBreakEnabled && v.driverBreakAfterStopId === stop.id && (
                <DraggableDriverBreak segmentId={segment.id} disabled={disabled} />
              )}
              </Fragment>
            );
          })}
        </div>
      </SortableContext>

      {(v.warnings.length > 0 || v.errors.length > 0) && (
        <div className="segment-column__alerts">
          {v.errors.map((e) => (
            <p key={e} className="alert alert--error">
              {e}
            </p>
          ))}
          {v.warnings.map((w) => (
            <p key={w} className="alert alert--warn">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RouteBoard({
  plan,
  onUpdate,
  onPreviewSegments,
  onActiveStopChange,
  onRemoveStop,
  onClearRoute,
  onStopAdded,
  onWedThresholdChange,
  onAddTruck,
  onDriveTimeChange,
  onServiceTimeChange,
  onFirstStopTimeChange,
  onDriverBreakChange,
  onDriverBreakMove,
  onReoptimizeSegment,
  onReoptimizeAllSegments,
  onAssignTruck,
}: RouteBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reoptimizingSegmentId, setReoptimizingSegmentId] = useState<string | null>(null);
  const [reoptimizingAll, setReoptimizingAll] = useState(false);
  const stopMap = useMemo(() => new Map(plan.allStops.map((s) => [s.id, s])), [plan.allStops]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const segmentStops = useMemo(
    () =>
      plan.segments.map((seg) => ({
        segment: seg,
        stops: seg.stops
          .map((a) => stopMap.get(a.stopId))
          .filter((s): s is Stop => !!s),
      })),
    [plan.segments, stopMap]
  );

  const wedCount = plan.segments[0]?.stops.length ?? 0;
  const isMultiDay = plan.segments.some((s) => s.segmentType === "day");

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveId(id);
    if (!isDriverBreakDragId(id)) {
      onActiveStopChange?.(id);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    if (plan.status === "locked" || !onPreviewSegments) return;
    if (isDriverBreakDragId(String(event.active.id))) return;
    const { active, over } = event;
    if (!over) {
      onPreviewSegments(null);
      return;
    }
    const preview = computeSegmentUpdate(plan, String(active.id), String(over.id));
    onPreviewSegments(preview);
  }

  function handleDragEnd(event: DragEndEvent) {
    onPreviewSegments?.(null);
    onActiveStopChange?.(null);
    setActiveId(null);
    const { active, over } = event;
    if (!over || plan.status === "locked") return;

    const activeDragId = String(active.id);
    const overId = String(over.id);

    if (isDriverBreakDragId(activeDragId)) {
      const segmentId = activeDragId.replace("driver-break-", "");
      if (onDriverBreakMove && !overId.startsWith("segment-")) {
        const targetSegment = findSegmentForStop(plan, overId);
        if (targetSegment === segmentId) {
          onDriverBreakMove(segmentId, overId);
        }
      }
      return;
    }

    const newSegments = computeSegmentUpdate(plan, activeDragId, overId);
    if (newSegments) onUpdate(newSegments);
  }

  function handleDragCancel() {
    onPreviewSegments?.(null);
    onActiveStopChange?.(null);
    setActiveId(null);
  }

  const activeStop =
    activeId && !isDriverBreakDragId(activeId) ? stopMap.get(activeId) : null;
  const activeBreakSegmentId =
    activeId && isDriverBreakDragId(activeId)
      ? activeId.replace("driver-break-", "")
      : null;
  const isManualTrucks = plan.manualTruckAssignment === true;
  const columnCount = plan.segments.length;

  const allErrors = plan.segments.flatMap((s) => s.validation.errors);

  const isLocked = plan.status === "locked";
  const canReoptimize =
    isManualTrucks &&
    plan.segments.some((s) => s.stops.length >= 2) &&
    !isLocked;

  async function handleReoptimizeSegment(segmentId: string) {
    if (!onReoptimizeSegment) return;
    setReoptimizingSegmentId(segmentId);
    try {
      await onReoptimizeSegment(segmentId);
    } finally {
      setReoptimizingSegmentId(null);
    }
  }

  async function handleReoptimizeAll() {
    if (!onReoptimizeAllSegments) return;
    setReoptimizingAll(true);
    try {
      await onReoptimizeAllSegments();
    } finally {
      setReoptimizingAll(false);
    }
  }

  return (
    <div className="route-board">
      <div className="route-board__toolbar">
        {isMultiDay && onWedThresholdChange && !isLocked && (
          <label className="wed-slider">
            Wed stop threshold:{" "}
            <input
              type="range"
              min={0}
              max={plan.allStops.length}
              value={wedCount}
              onChange={(e) => onWedThresholdChange(Number(e.target.value))}
            />
            <strong>{wedCount}</strong>
            <span className="wed-slider__hint">
              (suggested: {plan.suggestedWedThreshold ?? "—"})
            </span>
          </label>
        )}
        {!isMultiDay && onAddTruck && !isLocked && (
          <button type="button" className="btn btn--secondary" onClick={onAddTruck}>
            + Add truck
          </button>
        )}
        {isManualTrucks && !isLocked && (
          <span className="route-board__assign-hint">
            Drag stops between trucks to split the route
          </span>
        )}
        {canReoptimize && onReoptimizeAllSegments && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={reoptimizingAll || reoptimizingSegmentId != null}
            onClick={() => void handleReoptimizeAll()}
          >
            {reoptimizingAll ? "Re-optimizing…" : "Re-optimize all trucks"}
          </button>
        )}
        {onClearRoute && !isLocked && plan.allStops.length > 0 && (
          <button type="button" className="btn btn--secondary" onClick={onClearRoute}>
            Clear route
          </button>
        )}
        {onStopAdded && (
          <AddStopPanel
            cycleId={plan.cycleId}
            territoryId={plan.territoryId}
            territoryName={plan.territoryName}
            disabled={isLocked}
            onAdded={onStopAdded}
          />
        )}
        {isLocked && (
          <span className="route-board__locked-badge">Route locked — unlock to edit</span>
        )}
      </div>

      {allErrors.length > 0 && (
        <div className="route-board__banner route-board__banner--error">
          {allErrors.length} validation issue(s) — adjust stop order or split across segments
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          className="route-board__columns"
          style={{ gridTemplateColumns: `repeat(${columnCount}, 1fr)` }}
        >
          {segmentStops.map(({ segment, stops }, segmentIndex) => (
            <SegmentColumn
              key={segment.id}
              segment={segment}
              stops={stops}
              truckNumber={segmentIndex + 1}
              disabled={plan.status === "locked"}
              driveOverrides={plan.driveMinuteOverrides?.[segment.id]}
              serviceOverrides={plan.serviceMinuteOverrides?.[segment.id]}
              driverBreakEnabled={plan.driverBreakAfterStop?.[segment.id] != null}
              firstStopTimeOverride={plan.firstStopTimeOverrides?.[segment.id]}
              defaultFirstStopTime="10:00"
              onRemoveStop={!isLocked ? onRemoveStop : undefined}
              onDriveTimeChange={
                !isLocked && onDriveTimeChange
                  ? (stopId, minutes) => onDriveTimeChange(segment.id, stopId, minutes)
                  : undefined
              }
              onServiceTimeChange={
                !isLocked && onServiceTimeChange
                  ? (stopId, minutes) => onServiceTimeChange(segment.id, stopId, minutes)
                  : undefined
              }
              onFirstStopTimeChange={
                !isLocked && onFirstStopTimeChange
                  ? (time) => onFirstStopTimeChange(segment.id, time)
                  : undefined
              }
              onDriverBreakChange={
                !isLocked && onDriverBreakChange
                  ? (enabled) => onDriverBreakChange(segment.id, enabled)
                  : undefined
              }
              onDriverBreakMove={
                !isLocked && onDriverBreakMove
                  ? (afterStopId) => onDriverBreakMove(segment.id, afterStopId)
                  : undefined
              }
              onReoptimize={
                isManualTrucks && onReoptimizeSegment
                  ? () => void handleReoptimizeSegment(segment.id)
                  : undefined
              }
              reoptimizing={
                reoptimizingSegmentId === segment.id || reoptimizingAll
              }
              onAssignTruck={isManualTrucks ? onAssignTruck : undefined}
            />
          ))}
        </div>

        <DragOverlay>
          {activeStop ? <StopCard stop={activeStop} /> : null}
          {activeBreakSegmentId ? (
            <div className="segment-column__break-marker segment-column__break-marker--overlay">
              <span className="segment-column__break-grip">⋮⋮</span>
              {DRIVER_BREAK_MINUTES} min driver break
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
