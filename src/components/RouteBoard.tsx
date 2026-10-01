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
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent, type Key } from "react";
import type { RoutePlan, Segment, SegmentValidation, Stop } from "@shared/types";
import { DRIVER_BREAK_MINUTES, NEW_DAY_SEGMENT_ID, PITTSBURGH_MAX_DAYS, SERVICE_MINUTES_PER_STOP } from "@shared/constants";
import { defaultFirstStopTimeForName } from "@shared/routeDefaults";
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
import RoutePrintModal from "./RoutePrintModal";

interface RouteBoardProps {
  plan: RoutePlan;
  pendingRouteOrder?: boolean;
  applyingRouteOrder?: boolean;
  onApplyRouteOrder?: () => void;
  onDiscardRouteOrder?: () => void;
  onUpdate: (segments: SegmentUpdate[]) => void;
  onPreviewSegments?: (segments: SegmentUpdate[] | null) => void;
  onActiveStopChange?: (stopId: string | null) => void;
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
  onFlipSegment?: (segmentId?: string) => void;
  onSwapSegments?: (segmentIdA?: string, segmentIdB?: string) => void;
  onAssignTruck?: (stopId: string, truckNumber: number) => void;
  onAssignDay?: (stopId: string, targetSegmentId: string) => void;
  onDeliveryInstructionsChange?: (stopId: string, instructions: string) => void;
  onContactChange?: (stopId: string, contactName: string, contactPhone: string) => void;
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
          {showBreakdown ? "Drive (total):" : "Drive:"}
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
        Service: {minutes} min
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
      <span className="stop-card__service-label">Service:</span>
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
      <span className="segment-column__first-stop">
        First stop: {eta ?? formatTimeOfDay(defaultTime)}
        {isManual ? " (adjusted)" : ""}
      </span>
    );
  }

  return (
    <label className={`segment-column__first-stop-edit ${isManual ? "segment-column__first-stop-edit--manual" : ""}`}>
      <span className="segment-column__first-stop-label">First stop:</span>
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

export interface DayOption {
  segmentId: string;
  name: string;
  fullName: string;
}

export function getDayShortName(label: string, index: number): string {
  const match = label.match(
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i
  );
  if (match) {
    const raw = match[1];
    return raw.slice(0, 3).charAt(0).toUpperCase() + raw.slice(1, 3).toLowerCase();
  }
  const clean = label.replace(/\s*\(.*?\)/, "").trim();
  if (clean.length > 0 && clean.length <= 5) return clean;
  return `Day ${index + 1}`;
}

function DayAssignButtons({
  availableDays,
  currentSegmentId,
  disabled,
  onAssign,
}: {
  availableDays: DayOption[];
  currentSegmentId: string;
  disabled?: boolean;
  onAssign: (targetSegmentId: string) => void;
}) {
  return (
    <div
      className="stop-card__days"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="stop-card__days-label">Day</span>
      {availableDays.map((day) => {
        const isActive = currentSegmentId === day.segmentId;
        return (
          <button
            key={day.segmentId}
            type="button"
            className={`stop-card__day-btn ${
              isActive ? "stop-card__day-btn--active" : ""
            }`}
            disabled={disabled}
            aria-pressed={isActive}
            title={
              isActive
                ? `Currently scheduled on ${day.fullName}`
                : `Switch this stop to ${day.fullName}`
            }
            onClick={(e) => {
              e.stopPropagation();
              if (!isActive) {
                onAssign(day.segmentId);
              }
            }}
          >
            {day.name}
          </button>
        );
      })}
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
  currentSegmentId,
  availableDays,
  onRemove,
  removeDisabled,
  onDriveTimeChange,
  onServiceTimeChange,
  onAssignTruck,
  onAssignDay,
  onDeliveryInstructionsChange,
  onContactChange,
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
  currentSegmentId?: string;
  availableDays?: DayOption[];
  onRemove?: () => void;
  removeDisabled?: boolean;
  onDriveTimeChange?: (minutes: number | null) => void;
  onServiceTimeChange?: (minutes: number | null) => void;
  onAssignTruck?: (truckNumber: number) => void;
  onAssignDay?: (targetSegmentId: string) => void;
  onDeliveryInstructionsChange?: (stopId: string, instructions: string) => void;
  onContactChange?: (stopId: string, contactName: string, contactPhone: string) => void;
}) {
  const [isEditingInstructions, setIsEditingInstructions] = useState(false);
  const [draftInstructions, setDraftInstructions] = useState(stop.deliveryInstructions || "");

  const [isEditingContact, setIsEditingContact] = useState(false);
  const [draftContactName, setDraftContactName] = useState(stop.contactName || "");
  const [draftContactPhone, setDraftContactPhone] = useState(stop.contactPhone || "");

  useEffect(() => {
    if (!isEditingInstructions) {
      setDraftInstructions(stop.deliveryInstructions || "");
    }
  }, [stop.deliveryInstructions, isEditingInstructions]);

  useEffect(() => {
    if (!isEditingContact) {
      setDraftContactName(stop.contactName || "");
      setDraftContactPhone(stop.contactPhone || "");
    }
  }, [stop.contactName, stop.contactPhone, isEditingContact]);

  const handleSaveContact = () => {
    if (onContactChange) {
      onContactChange(stop.id, draftContactName.trim(), draftContactPhone.trim());
    }
    setIsEditingContact(false);
  };

  const handleCancelContact = () => {
    setDraftContactName(stop.contactName || "");
    setDraftContactPhone(stop.contactPhone || "");
    setIsEditingContact(false);
  };

  const handleClearContact = () => {
    setDraftContactName("");
    setDraftContactPhone("");
    if (onContactChange) {
      onContactChange(stop.id, "", "");
    }
    setIsEditingContact(false);
  };

  const handleSaveInstructions = () => {
    if (onDeliveryInstructionsChange) {
      onDeliveryInstructionsChange(stop.id, draftInstructions.trim());
    }
    setIsEditingInstructions(false);
  };

  const handleCancelInstructions = () => {
    setDraftInstructions(stop.deliveryInstructions || "");
    setIsEditingInstructions(false);
  };

  const handleClearInstructions = () => {
    setDraftInstructions("");
    if (onDeliveryInstructionsChange) {
      onDeliveryInstructionsChange(stop.id, "");
    }
    setIsEditingInstructions(false);
  };

  const hasDetails = Boolean(
    stop.contactName ||
    stop.contactPhone ||
    stop.deliveryInstructions ||
    onDeliveryInstructionsChange ||
    onContactChange
  );
  const hasControls = Boolean(
    (onAssignDay && availableDays && availableDays.length > 1 && currentSegmentId) ||
    (onAssignTruck && currentTruck != null) ||
    driveMinutes != null ||
    onDriveTimeChange ||
    serviceMinutes != null ||
    onServiceTimeChange
  );

  return (
    <div className={`stop-card ${hasError ? "stop-card--error" : ""}`}>
      <span className="stop-card__grip" title="Drag to reorder">⋮⋮</span>
      <div className="stop-card__body">
        <div className="stop-card__row stop-card__row--main">
          <strong className="stop-card__name">{stop.customerName}</strong>
          <span className="stop-card__meta">
            {stop.address}, {stop.city}
          </span>
          {eta && <span className="stop-card__eta">ETA {eta}</span>}
        </div>

        {hasDetails && (
          <div className="stop-card__row stop-card__row--details">
            {isEditingContact ? (
              <div
                className="stop-card__contact-editor"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="stop-card__contact-editor-fields">
                  <input
                    type="text"
                    className="stop-card__contact-input"
                    value={draftContactName}
                    placeholder="Contact name (e.g. Maria Santos)"
                    autoFocus
                    onChange={(e) => setDraftContactName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSaveContact();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        handleCancelContact();
                      }
                    }}
                  />
                  <input
                    type="text"
                    className="stop-card__contact-input"
                    value={draftContactPhone}
                    placeholder="Phone number (e.g. 570-555-0199)"
                    onChange={(e) => setDraftContactPhone(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSaveContact();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        handleCancelContact();
                      }
                    }}
                  />
                </div>
                <div className="stop-card__instructions-editor-btns">
                  {(stop.contactName || stop.contactPhone) && (
                    <button
                      type="button"
                      className="stop-card__instructions-clear-btn"
                      onClick={handleClearContact}
                      title="Clear contact"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    className="stop-card__instructions-cancel-btn"
                    onClick={handleCancelContact}
                    title="Cancel editing"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="stop-card__instructions-save-btn"
                    onClick={handleSaveContact}
                    title="Save contact"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              (stop.contactName || stop.contactPhone || onContactChange) && (
                <span className="stop-card__contact">
                  <span className="stop-card__contact-text">
                    Contact: <ContactDisplay contactName={stop.contactName} contactPhone={stop.contactPhone} />
                  </span>
                  {onContactChange && (
                    <button
                      type="button"
                      className="stop-card__contact-edit-toggle"
                      title={stop.contactName || stop.contactPhone ? "Edit contact details" : "Add contact details"}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraftContactName(stop.contactName || "");
                        setDraftContactPhone(stop.contactPhone || "");
                        setIsEditingContact(true);
                      }}
                    >
                      {stop.contactName || stop.contactPhone ? "✏️ Edit contact" : "+ Add contact"}
                    </button>
                  )}
                </span>
              )
            )}
            {isEditingInstructions ? (
              <div
                className="stop-card__instructions-editor"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  className="stop-card__instructions-input"
                  value={draftInstructions}
                  placeholder="Delivery instructions (dock, gate code, call ahead)..."
                  autoFocus
                  onChange={(e) => setDraftInstructions(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveInstructions();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      handleCancelInstructions();
                    }
                  }}
                />
                <div className="stop-card__instructions-editor-btns">
                  {stop.deliveryInstructions && (
                    <button
                      type="button"
                      className="stop-card__instructions-clear-btn"
                      onClick={handleClearInstructions}
                      title="Clear instructions"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    className="stop-card__instructions-cancel-btn"
                    onClick={handleCancelInstructions}
                    title="Cancel editing"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="stop-card__instructions-save-btn"
                    onClick={handleSaveInstructions}
                    title="Save instructions"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="stop-card__instructions-display">
                {stop.deliveryInstructions ? (
                  <span className="stop-card__instructions">Note: {stop.deliveryInstructions}</span>
                ) : null}
                {onDeliveryInstructionsChange && (
                  <button
                    type="button"
                    className="stop-card__instructions-edit-toggle"
                    title={stop.deliveryInstructions ? "Edit delivery instructions" : "Add delivery instructions"}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDraftInstructions(stop.deliveryInstructions || "");
                      setIsEditingInstructions(true);
                    }}
                  >
                    {stop.deliveryInstructions ? "✏️ Edit note" : "+ Add note"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {hasControls && (
          <div className="stop-card__row stop-card__row--controls">
            {onAssignDay && availableDays && availableDays.length > 1 && currentSegmentId && (
              <DayAssignButtons
                availableDays={availableDays}
                currentSegmentId={currentSegmentId}
                disabled={removeDisabled}
                onAssign={onAssignDay}
              />
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
          </div>
        )}
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
  currentSegmentId,
  availableDays,
  disabled,
  onRemove,
  onDriveTimeChange,
  onServiceTimeChange,
  onAssignTruck,
  onAssignDay,
  onDeliveryInstructionsChange,
  onContactChange,
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
  currentSegmentId?: string;
  availableDays?: DayOption[];
  disabled?: boolean;
  onRemove?: () => void;
  onDriveTimeChange?: (minutes: number | null) => void;
  onServiceTimeChange?: (minutes: number | null) => void;
  onAssignTruck?: (truckNumber: number) => void;
  onAssignDay?: (targetSegmentId: string) => void;
  onDeliveryInstructionsChange?: (stopId: string, instructions: string) => void;
  onContactChange?: (stopId: string, contactName: string, contactPhone: string) => void;
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
        currentSegmentId={currentSegmentId}
        availableDays={availableDays}
        onRemove={onRemove}
        removeDisabled={disabled}
        onDriveTimeChange={onDriveTimeChange}
        onServiceTimeChange={onServiceTimeChange}
        onAssignTruck={onAssignTruck}
        onAssignDay={onAssignDay}
        onDeliveryInstructionsChange={onDeliveryInstructionsChange}
        onContactChange={onContactChange}
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
  onFlip,
  flipping,
  onSwapWithOther,
  swappingWithOther,
  otherDayName,
  otherDays,
  truckNumber,
  availableDays,
  onAssignTruck,
  onAssignDay,
  onPrintPdf,
  onDeliveryInstructionsChange,
  onContactChange,
}: {
  key?: Key;
  segment: Segment;
  stops: Stop[];
  truckNumber: number;
  availableDays?: DayOption[];
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
  onFlip?: () => void;
  flipping?: boolean;
  onSwapWithOther?: (targetSegmentId?: string) => void;
  swappingWithOther?: boolean;
  otherDayName?: string;
  otherDays?: { id: string; name: string }[];
  onAssignTruck?: (stopId: string, truckNumber: number) => void;
  onAssignDay?: (stopId: string, targetSegmentId: string) => void;
  onPrintPdf?: () => void;
  onDeliveryInstructionsChange?: (stopId: string, instructions: string) => void;
  onContactChange?: (stopId: string, contactName: string, contactPhone: string) => void;
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
          <div className="segment-column__title-group">
            <h3>{segment.label}</h3>
            <span className="segment-column__date">{segment.deliveryDate}</span>
            <div className="segment-column__stats">
              <span>{v.stopCount} stops</span>
              <span className="segment-column__stat-sep">·</span>
              <span>{v.totalMiles} mi</span>
            </div>
          </div>
          <div className="segment-column__actions">
            {v.stopCount > 0 && (
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                onClick={onPrintPdf ?? (() => printRoutePdf(segment.id))}
                title="Download PDF and open print preview"
              >
                Print PDF
              </button>
            )}
            {onFlip && v.stopCount >= 2 && (
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                disabled={disabled || flipping}
                onClick={onFlip}
                title={
                  segment.segmentType === "day"
                    ? "Flip the route (reverse stop order for this day)"
                    : "Flip the route (reverse stop order for this truck)"
                }
              >
                {flipping ? "Flipping…" : "⇄ Flip route"}
              </button>
            )}
            {otherDays && otherDays.length > 1 ? (
              <select
                className="btn btn--secondary btn--compact segment-column__switch-select"
                disabled={disabled || swappingWithOther}
                value=""
                onChange={(e) => {
                  if (e.target.value && onSwapWithOther) {
                    onSwapWithOther(e.target.value);
                  }
                }}
                title="Switch this day's route with another day"
              >
                <option value="" disabled>
                  {swappingWithOther ? "Switching…" : "⇄ Switch with…"}
                </option>
                {otherDays.map((d) => (
                  <option key={d.id} value={d.id}>
                    Switch with {d.name}
                  </option>
                ))}
              </select>
            ) : onSwapWithOther ? (
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                disabled={disabled || swappingWithOther}
                onClick={() => onSwapWithOther()}
                title={
                  otherDayName
                    ? `Switch all stops with ${otherDayName} (swap day schedules)`
                    : "Switch day's route"
                }
              >
                {swappingWithOther
                  ? "Switching…"
                  : otherDayName
                  ? `⇄ Switch with ${otherDayName}`
                  : "⇄ Switch days"}
              </button>
            ) : null}
            {onReoptimize && v.stopCount >= 2 && (
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                disabled={disabled || reoptimizing}
                onClick={onReoptimize}
                title="Restore algorithm-optimized stop order"
              >
                {reoptimizing ? "Optimizing…" : "Re-optimize"}
              </button>
            )}
          </div>
        </div>

        {v.stopCount > 0 && (
          <div className="segment-column__schedule-row">
            {v.departureTime && (
              <span className="segment-column__depart">Depart: {v.departureTime}</span>
            )}
            {stops[0] && (
              <FirstStopEtaControl
                eta={v.stopEtas[stops[0].id]}
                timeOverride={firstStopTimeOverride}
                defaultTime={defaultFirstStopTime ?? "10:00"}
                isManual={firstStopTimeOverride != null}
                disabled={disabled}
                onChange={onFirstStopTimeChange}
              />
            )}
            {v.completionTime && (
              <span className="segment-column__complete">Done by: {v.completionTime}</span>
            )}
            <span className="segment-column__total-time">
              Total: {formatDurationMinutes(segmentTotalMinutes(v))}
              <span className="segment-column__total-time-detail">
                {" "}
                (drive + svc{v.driverBreakMinutes ? ` + ${v.driverBreakMinutes}m break` : ""})
              </span>
            </span>
          </div>
        )}

        {v.stopCount > 0 && (
          <div className="segment-column__meta-row">
            {onDriverBreakChange ? (
              <label className="segment-column__break">
                <input
                  type="checkbox"
                  checked={driverBreakEnabled === true}
                  disabled={disabled}
                  onChange={(e) => onDriverBreakChange(e.target.checked)}
                />
                {DRIVER_BREAK_MINUTES} min break
              </label>
            ) : (
              driverBreakEnabled && (
                <span className="segment-column__break-note">
                  {DRIVER_BREAK_MINUTES} min break included
                </span>
              )
            )}
            {driverBreakEnabled && breakAfterStop && (
              <span className="segment-column__break-note">
                (after {breakAfterStop.customerName}
                {onDriverBreakMove ? " — drag marker below" : ""})
              </span>
            )}
            {segment.startLocation === "overnight" && (
              <span className="segment-column__note">Start: overnight</span>
            )}
            {segment.endLocation === "overnight" && (
              <span className="segment-column__note">End: overnight</span>
            )}
          </div>
        )}

        {v.stopCount >= 2 && (
          <div
            className={`segment-column__diff-banner ${
              v.isOptimizedOrder === false ||
              (v.timeDiffMinutes != null && v.timeDiffMinutes !== 0)
                ? "segment-column__diff-banner--manual"
                : "segment-column__diff-banner--optimal"
            }`}
          >
            <div className="segment-column__diff-content">
              <span className="segment-column__diff-icon" aria-hidden="true">
                {v.isOptimizedOrder === false ||
                (v.timeDiffMinutes != null && v.timeDiffMinutes !== 0)
                  ? "⚠️"
                  : "✓"}
              </span>
              {v.isOptimizedOrder === false ||
              (v.timeDiffMinutes != null && v.timeDiffMinutes !== 0) ? (
                <span className="segment-column__diff-text">
                  <span className="segment-column__diff-label">Manual route:</span>{" "}
                  {v.timeDiffMinutes != null && v.timeDiffMinutes > 0 ? (
                    <strong className="segment-column__diff-val segment-column__diff-val--slower">
                      +{formatDurationMinutes(v.timeDiffMinutes)} slower
                    </strong>
                  ) : v.timeDiffMinutes != null && v.timeDiffMinutes < 0 ? (
                    <strong className="segment-column__diff-val segment-column__diff-val--faster">
                      {formatDurationMinutes(Math.abs(v.timeDiffMinutes))} faster
                    </strong>
                  ) : (
                    <strong className="segment-column__diff-val segment-column__diff-val--same">
                      Same total time
                    </strong>
                  )}
                  {v.optimizedRouteMinutes != null && (
                    <span className="segment-column__diff-opt-time">
                      {" "}(optimal: {formatDurationMinutes(v.optimizedRouteMinutes)})
                    </span>
                  )}
                </span>
              ) : (
                <span className="segment-column__diff-text">
                  Optimized order ({formatDurationMinutes(v.optimizedRouteMinutes ?? v.totalRouteMinutes ?? 0)})
                </span>
              )}
            </div>
            {v.isOptimizedOrder === false && onReoptimize && !disabled && (
              <button
                type="button"
                className="segment-column__diff-revert-btn"
                onClick={onReoptimize}
                disabled={reoptimizing}
                title="Restore algorithm-optimized stop order"
              >
                Re-optimize
              </button>
            )}
          </div>
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
                currentSegmentId={segment.id}
                availableDays={availableDays}
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
                onAssignDay={
                  onAssignDay
                    ? (targetSegmentId) => onAssignDay(stop.id, targetSegmentId)
                    : undefined
                }
                onDeliveryInstructionsChange={onDeliveryInstructionsChange}
                onContactChange={onContactChange}
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
  onServiceTimeChange,
  onFirstStopTimeChange,
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
}: RouteBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [reoptimizingSegmentId, setReoptimizingSegmentId] = useState<string | null>(null);
  const [reoptimizingAll, setReoptimizingAll] = useState(false);
  const [flippingSegmentId, setFlippingSegmentId] = useState<string | null>(null);
  const [flippingAll, setFlippingAll] = useState(false);
  const [swappingSegments, setSwappingSegments] = useState(false);
  const [printSegment, setPrintSegment] = useState<{ segment: Segment; stops: Stop[] } | null>(null);
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

  const availableDays: DayOption[] = useMemo(() => {
    if (!isMultiDay || plan.segments.length <= 1) return [];
    const days = plan.segments.map((seg, idx) => ({
      segmentId: seg.id,
      name: getDayShortName(seg.label, idx),
      fullName: seg.label,
    }));
    if (plan.status !== "locked" && plan.segments.length < PITTSBURGH_MAX_DAYS) {
      days.push({
        segmentId: NEW_DAY_SEGMENT_ID,
        name: "Day 3",
        fullName: "Friday (overflow)",
      });
    }
    return days;
  }, [isMultiDay, plan.segments, plan.status]);

  const isLocked = plan.status === "locked";

  const handleAssignDay = async (stopId: string, targetSegmentId: string) => {
    if (isLocked) return;
    if (onAssignDay) {
      onAssignDay(stopId, targetSegmentId);
      return;
    }
    const fromSegment = plan.segments.find((s) => s.stops.some((st) => st.stopId === stopId));
    if (!fromSegment || fromSegment.id === targetSegmentId) return;
    const targetSegment = plan.segments.find((s) => s.id === targetSegmentId);
    if (!targetSegment) return;

    const newSegments = plan.segments.map((seg) => {
      let stops = seg.stops.filter((s) => s.stopId !== stopId);
      if (seg.id === targetSegmentId) {
        stops = [...stops, { stopId, position: stops.length }];
      }
      return {
        segmentId: seg.id,
        stops: stops.map((s, i) => ({ stopId: s.stopId, position: i })),
      };
    });
    onUpdate(newSegments);
  };

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

  const canReoptimize =
    plan.segments.some((s) => s.stops.length >= 2) &&
    !isLocked &&
    !pendingRouteOrder;

  const totalRouteMinutes =
    plan.totalRouteMinutes ??
    plan.segments.reduce((sum, s) => sum + (s.validation.totalRouteMinutes ?? 0), 0);
  const optimizedRouteMinutes =
    plan.optimizedRouteMinutes ??
    plan.segments.reduce(
      (sum, s) =>
        sum +
        (s.validation.optimizedRouteMinutes ?? s.validation.totalRouteMinutes ?? 0),
      0
    );
  const timeDiffMinutes =
    plan.timeDiffMinutes ?? (totalRouteMinutes - optimizedRouteMinutes);
  const hasManualOrder =
    plan.hasManualOrder ??
    plan.segments.some(
      (s) =>
        s.validation.isOptimizedOrder === false ||
        (s.validation.timeDiffMinutes ?? 0) !== 0
    );

  const canFlip =
    !isLocked &&
    onFlipSegment != null &&
    plan.segments.some((s) => s.stops.length >= 2);

  async function handleFlipSegment(segmentId?: string) {
    if (!onFlipSegment) return;
    if (segmentId) {
      setFlippingSegmentId(segmentId);
    } else {
      setFlippingAll(true);
    }
    try {
      await onFlipSegment(segmentId);
    } finally {
      setFlippingSegmentId(null);
      setFlippingAll(false);
    }
  }

  async function handleSwapDays(segmentIdA?: string, segmentIdB?: string) {
    if (!onSwapSegments) return;
    setSwappingSegments(true);
    try {
      await onSwapSegments(segmentIdA, segmentIdB);
    } finally {
      setSwappingSegments(false);
    }
  }

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
      {pendingRouteOrder && !isLocked && onApplyRouteOrder && (
        <div className="route-board__banner route-board__banner--pending">
          <span>
            Stop order changed locally. ETAs and drive times still reflect the last saved route until
            you update. Live traffic and the road map are unchanged until you refresh them separately.
          </span>
          <div className="route-board__pending-actions">
            <button
              type="button"
              className="btn btn--primary btn--compact"
              disabled={applyingRouteOrder}
              onClick={onApplyRouteOrder}
            >
              {applyingRouteOrder ? "Updating…" : "Update route times"}
            </button>
            {onDiscardRouteOrder && (
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                disabled={applyingRouteOrder}
                onClick={onDiscardRouteOrder}
              >
                Discard order changes
              </button>
            )}
          </div>
        </div>
      )}

      <div className="route-board__toolbar">
        {isMultiDay && onWedThresholdChange && !isLocked && (
          <label className="wed-slider">
            Wed stop threshold:{" "}
            <input
              type="range"
              min={0}
              max={plan.allStops.length}
              value={wedCount}
              disabled={pendingRouteOrder}
              onChange={(e) => onWedThresholdChange(Number(e.target.value))}
            />
            <strong>{wedCount}</strong>
            <span className="wed-slider__hint">
              (suggested: {plan.suggestedWedThreshold ?? "—"})
            </span>
          </label>
        )}
        {isMultiDay && onSwapSegments && !isLocked && plan.segments.length >= 2 && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={swappingSegments || pendingRouteOrder}
            onClick={() => void handleSwapDays()}
            title={
              plan.segments.length === 2
                ? `Switch ${plan.segments[0]?.label.split(" ")[0]} and ${plan.segments[1]?.label.split(" ")[0]} routes`
                : "Switch days' routes"
            }
          >
            {swappingSegments
              ? "Switching days…"
              : plan.segments.length === 2
              ? `⇄ Switch days (${plan.segments[0]?.label.split(" ")[0] ?? "Day 1"} ↔ ${plan.segments[1]?.label.split(" ")[0] ?? "Day 2"})`
              : "⇄ Switch days"}
          </button>
        )}
        {isMultiDay && onAddDay && !isLocked && plan.segments.length < PITTSBURGH_MAX_DAYS && (
          <button type="button" className="btn btn--secondary" onClick={onAddDay}>
            + Add Friday
          </button>
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
        {canFlip && plan.segments.length > 1 && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={isLocked || flippingAll || flippingSegmentId != null}
            onClick={() => void handleFlipSegment()}
            title={isMultiDay ? "Flip the route order on all days" : "Flip the route order on all trucks"}
          >
            {flippingAll ? "Flipping all…" : isMultiDay ? "⇄ Flip all days" : "⇄ Flip all trucks"}
          </button>
        )}
        {canFlip && plan.segments.length === 1 && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={isLocked || flippingAll || flippingSegmentId != null}
            onClick={() => void handleFlipSegment(plan.segments[0].id)}
            title="Flip the route (reverse stop order)"
          >
            {flippingSegmentId === plan.segments[0].id ? "Flipping…" : "⇄ Flip route"}
          </button>
        )}
        {canReoptimize && onReoptimizeAllSegments && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={reoptimizingAll || reoptimizingSegmentId != null}
            onClick={() => void handleReoptimizeAll()}
          >
            {reoptimizingAll ? "Re-optimizing…" : isMultiDay ? "Re-optimize all days" : "Re-optimize all trucks"}
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
            segments={plan.segments.map((segment) => ({
              id: segment.id,
              label: segment.label,
            }))}
            segmentKind={isMultiDay ? "day" : "truck"}
            disabled={isLocked}
            onAdded={onStopAdded}
          />
        )}
        {isLocked && (
          <span className="route-board__locked-badge">Route locked — unlock to edit</span>
        )}
      </div>

      {hasManualOrder && (
        <div className="route-board__comparison-banner">
          <div className="route-board__comparison-left">
            <span className="route-board__comparison-badge">Manual Route Active</span>
            <div className="route-board__comparison-details">
              <span>
                Current route: <strong>{formatDurationMinutes(totalRouteMinutes)}</strong>
              </span>
              <span className="route-board__comparison-sep">·</span>
              <span>
                Optimized route: <strong>{formatDurationMinutes(optimizedRouteMinutes)}</strong>
              </span>
              <span className="route-board__comparison-sep">·</span>
              <span
                className={`route-board__comparison-diff ${
                  timeDiffMinutes > 0
                    ? "diff-slower"
                    : timeDiffMinutes < 0
                    ? "diff-faster"
                    : "diff-same"
                }`}
              >
                {timeDiffMinutes > 0
                  ? `+${formatDurationMinutes(timeDiffMinutes)} (+${timeDiffMinutes} min slower than optimized)`
                  : timeDiffMinutes < 0
                  ? `-${formatDurationMinutes(Math.abs(timeDiffMinutes))} (${Math.abs(timeDiffMinutes)} min faster than optimized)`
                  : "Same total duration as optimized route"}
              </span>
            </div>
          </div>
          <div className="route-board__comparison-actions">
            {canReoptimize && onReoptimizeAllSegments && (
              <button
                type="button"
                className="btn btn--primary btn--compact"
                disabled={reoptimizingAll || isLocked}
                onClick={() => void handleReoptimizeAll()}
                title="Reset all stops to algorithm-optimized sequence"
              >
                {reoptimizingAll ? "Re-optimizing…" : "Re-optimize to best time"}
              </button>
            )}
          </div>
        </div>
      )}

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
          {segmentStops.map(({ segment, stops }, segmentIndex) => {
            const otherSegment =
              isMultiDay && plan.segments.length === 2
                ? plan.segments.find((s) => s.id !== segment.id)
                : undefined;
            const otherDayName = otherSegment
              ? otherSegment.label.replace(/\s*\(.*?\)/, "").trim()
              : undefined;
            const otherDays =
              isMultiDay && plan.segments.length > 2
                ? plan.segments
                    .filter((s) => s.id !== segment.id)
                    .map((s) => ({
                      id: s.id,
                      name: s.label.replace(/\s*\(.*?\)/, "").trim(),
                    }))
                : undefined;

            return (
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
                defaultFirstStopTime={defaultFirstStopTimeForName(stops[0]?.customerName)}
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
                  onReoptimizeSegment && !pendingRouteOrder
                    ? () => void handleReoptimizeSegment(segment.id)
                    : undefined
                }
                reoptimizing={
                  reoptimizingSegmentId === segment.id || reoptimizingAll
                }
                onFlip={
                  onFlipSegment && segment.stops.length >= 2
                    ? () => void handleFlipSegment(segment.id)
                    : undefined
                }
                flipping={
                  flippingSegmentId === segment.id || flippingAll
                }
                onSwapWithOther={
                  isMultiDay &&
                  onSwapSegments &&
                  !isLocked &&
                  !pendingRouteOrder &&
                  plan.segments.length >= 2
                    ? (targetId) =>
                        void handleSwapDays(segment.id, targetId ?? otherSegment?.id)
                    : undefined
                }
                swappingWithOther={swappingSegments}
                otherDayName={otherDayName}
                otherDays={otherDays}
                availableDays={availableDays}
                onAssignTruck={segment.segmentType === "day" ? undefined : onAssignTruck}
                onAssignDay={!isLocked && availableDays.length > 1 ? handleAssignDay : undefined}
                onPrintPdf={() => setPrintSegment({ segment, stops })}
                onDeliveryInstructionsChange={onDeliveryInstructionsChange}
                onContactChange={onContactChange}
              />
            );
          })}
        </div>

        <DragOverlay>
          {activeStop ? (
            <StopCard
              stop={activeStop}
              availableDays={availableDays}
              currentSegmentId={findSegmentForStop(plan, activeStop.id) ?? undefined}
            />
          ) : null}
          {activeBreakSegmentId ? (
            <div className="segment-column__break-marker segment-column__break-marker--overlay">
              <span className="segment-column__break-grip">⋮⋮</span>
              {DRIVER_BREAK_MINUTES} min driver break
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {printSegment && (
        <RoutePrintModal
          plan={plan}
          segment={printSegment.segment}
          stops={printSegment.stops}
          onClose={() => setPrintSegment(null)}
        />
      )}
    </div>
  );
}
