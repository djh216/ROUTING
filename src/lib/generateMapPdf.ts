import jsPDF from "jspdf";
import type { RoutePlan } from "@shared/types";
import { formatDateTime } from "@shared/timeFormat";
import { MAP_EXPORT_ASPECT, renderPlanMapToDataUrl } from "./renderRouteMapImage";
import type { RouteLegInfo } from "@shared/routeGeometry";
import type { LatLng } from "./routeMapUtils";
type GeometryMap = Map<
  string,
  { path: LatLng[]; legs?: RouteLegInfo[] }
> | null;

export async function generateMapPdf(
  plan: RoutePlan,
  geometrySegments: GeometryMap,
  options: {
    autoDownload?: boolean;
    useGeometry?: boolean;
  } = {}
): Promise<{ blobUrl: string; filename: string }> {
  const useGeometry = options.useGeometry !== false;
  const mapImage = renderPlanMapToDataUrl(plan, geometrySegments, {
    useGeometry,
    includeDepot: false,
  });

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
  doc.text(
    `${plan.territoryName} · Delivery ${plan.deliveryDate} · ${plan.allStops.length} stops · Printed ${formatDateTime(new Date())}`,
    margin,
    58
  );

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
  doc.text(
    "Stop numbers match the route board.",
    margin,
    imgY + imgH + 16
  );

  const safeName = plan.territoryName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeName}_route_map_${plan.deliveryDate}.pdf`;

  const blob = doc.output("blob");
  const blobUrl = URL.createObjectURL(blob);

  if (options.autoDownload !== false) {
    doc.save(filename);
  }

  return { blobUrl, filename };
}
