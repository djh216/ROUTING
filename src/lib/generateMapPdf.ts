import jsPDF from "jspdf";
import type { RoutePlan } from "@shared/types";
import { formatDateTime } from "@shared/timeFormat";
import {
  MAP_EXPORT_ASPECT,
  renderPlanMapToDataUrl,
  renderSegmentMapToDataUrl,
} from "./renderRouteMapImage";
import type { RouteLegInfo } from "@shared/routeGeometry";
import type { LatLng } from "./routeMapUtils";

type GeometryMap = Map<
  string,
  { path: LatLng[]; legs?: RouteLegInfo[] }
> | null;

export type MapPdfExport = {
  segmentId: string;
  label: string;
  blobUrl: string;
  filename: string;
  mapPreviewDataUrl: string | null;
  stopCount: number;
};

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildMapPdfBlob(
  mapImage: string | null,
  subtitleLine: string
): { blob: Blob; mapPreviewDataUrl: string | null } {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "letter",
  });

  const pageW = 792;
  const margin = 36;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text("F Magnotta Wines — Route Map", margin, 40);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(subtitleLine, margin, 58);

  const imgY = 72;
  const imgW = pageW - margin * 2;
  const imgH = imgW / MAP_EXPORT_ASPECT;

  if (mapImage) {
    doc.addImage(mapImage, "JPEG", margin, imgY, imgW, imgH);
  } else {
    doc.setFontSize(11);
    doc.text("Map preview unavailable — add stops and try again.", margin, imgY + 40);
  }

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Stop numbers match the route board.", margin, imgY + imgH + 16);

  const blob = doc.output("blob");
  return { blob, mapPreviewDataUrl: mapImage };
}

/** One PDF per truck when the route uses manual multi-truck assignment. */
export async function generateMapPdfExports(
  plan: RoutePlan,
  geometrySegments: GeometryMap,
  options: {
    autoDownload?: boolean;
    useGeometry?: boolean;
  } = {}
): Promise<MapPdfExport[]> {
  const useGeometry = options.useGeometry !== false;
  const printedAt = formatDateTime(new Date());
  const safeTerritory = safeFilenamePart(plan.territoryName);

  const segmentsWithStops = plan.segments.filter((segment) => segment.stops.length > 0);
  const splitByTruck =
    plan.manualTruckAssignment === true && segmentsWithStops.length > 1;

  if (splitByTruck) {
    const exports: MapPdfExport[] = [];

    for (const segment of segmentsWithStops) {
      const mapImage = await renderSegmentMapToDataUrl(plan, segment.id, geometrySegments, {
        useGeometry,
        includeDepot: true,
        includeOsmBackground: true,
      });
      const stopCount = segment.stops.length;
      const subtitleLine = `${plan.territoryName} · ${segment.label} · Delivery ${plan.deliveryDate} · ${stopCount} stop${stopCount === 1 ? "" : "s"} · Printed ${printedAt}`;
      const { blob, mapPreviewDataUrl } = buildMapPdfBlob(mapImage, subtitleLine);
      const filename = `${safeTerritory}_${safeFilenamePart(segment.label)}_route_map_${plan.deliveryDate}.pdf`;
      const blobUrl = URL.createObjectURL(blob);

      if (options.autoDownload !== false) {
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = filename;
        link.click();
      }

      exports.push({
        segmentId: segment.id,
        label: segment.label,
        blobUrl,
        filename,
        mapPreviewDataUrl,
        stopCount,
      });
    }

    return exports;
  }

  const mapImage = await renderPlanMapToDataUrl(plan, geometrySegments, {
    useGeometry,
    includeDepot: false,
    includeOsmBackground: true,
  });
  const stopCount = plan.allStops.length;
  const subtitleLine = `${plan.territoryName} · Delivery ${plan.deliveryDate} · ${stopCount} stop${stopCount === 1 ? "" : "s"} · Printed ${printedAt}`;
  const { blob, mapPreviewDataUrl } = buildMapPdfBlob(mapImage, subtitleLine);
  const filename = `${safeTerritory}_route_map_${plan.deliveryDate}.pdf`;
  const blobUrl = URL.createObjectURL(blob);

  if (options.autoDownload !== false) {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.click();
  }

  return [
    {
      segmentId: plan.segments[0]?.id ?? "plan",
      label: plan.territoryName,
      blobUrl,
      filename,
      mapPreviewDataUrl,
      stopCount,
    },
  ];
}

/** @deprecated Use generateMapPdfExports — returns first export only. */
export async function generateMapPdf(
  plan: RoutePlan,
  geometrySegments: GeometryMap,
  options: {
    autoDownload?: boolean;
    useGeometry?: boolean;
  } = {}
): Promise<{ blobUrl: string; filename: string; mapPreviewDataUrl: string | null }> {
  const [first] = await generateMapPdfExports(plan, geometrySegments, options);
  if (!first) {
    throw new Error("No map PDF could be generated");
  }
  return first;
}
