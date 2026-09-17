import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { RoutePlan, Segment, Stop } from "@shared/types";
import { DRIVER_BREAK_MINUTES } from "@shared/constants";
import { formatDateTime, formatDurationMinutes } from "@shared/timeFormat";

export function generateRoutePdf(
  plan: RoutePlan,
  segment: Segment,
  stops: Stop[],
  options: { autoDownload?: boolean } = { autoDownload: true }
): { blobUrl: string; filename: string } {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  const v = segment.validation;
  const deliveryDate = segment.deliveryDate || "Scheduled";
  const breakAfterStopId =
    v.driverBreakAfterStopId ?? plan.driverBreakAfterStop?.[segment.id];
  const breakAfterStop = breakAfterStopId
    ? stops.find((s) => s.id === breakAfterStopId)
    : undefined;

  // Header Banner
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text("F Magnotta Wines — Delivery Manifest", 40, 45);

  doc.setFontSize(13);
  doc.setTextColor(71, 85, 105);
  doc.text(`${plan.territoryName} — ${segment.label}`, 40, 65);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const metaLine1 = `Delivery Date: ${deliveryDate}  |  Batch: ${plan.batchId}  |  Status: ${plan.status.toUpperCase()}`;
  const metaLine2 = `Depot: ${plan.depot.address}, ${plan.depot.city}  |  Printed: ${formatDateTime(new Date())}`;
  doc.text(metaLine1, 40, 82);
  doc.text(metaLine2, 40, 95);

  // Divider line
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(1);
  doc.line(40, 103, 572, 103);

  // Summary Metrics Box
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(40, 110, 532, 42, 4, 4, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(`Stops: ${v.stopCount}    Total Cases: ${v.totalCases}    Total Miles: ${v.totalMiles} mi`, 50, 126);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const timeInfo = [
    v.departureTime ? `Depart: ${v.departureTime}` : null,
    v.stopEtas && stops[0] ? `First Stop ETA: ${v.stopEtas[stops[0].id] ?? "—"}` : null,
    v.completionTime ? `Done by: ${v.completionTime}` : null,
    v.totalRouteMinutes ? `Total Route: ${formatDurationMinutes(v.totalRouteMinutes)}` : null,
  ].filter(Boolean).join("    |    ");
  doc.text(timeInfo || "Standard schedule", 50, 142);

  let startY = 162;

  if (breakAfterStop) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(180, 83, 9);
    doc.text(`* Scheduled ${DRIVER_BREAK_MINUTES}-min driver break after stop: ${breakAfterStop.customerName}`, 40, startY);
    startY += 14;
  }

  // Table Data
  const tableRows: Array<Array<string | number>> = [];

  stops.forEach((stop, idx) => {
    tableRows.push([
      idx + 1,
      stop.customerName,
      `${stop.address}, ${stop.city}`,
      stop.contactName || stop.contactPhone
        ? `${stop.contactName ?? ""}\n${stop.contactPhone ?? ""}`.trim()
        : "—",
      v.stopEtas[stop.id] ?? "—",
      stop.cases ?? "—",
      stop.deliveryInstructions || "—",
    ]);

    if (breakAfterStopId === stop.id) {
      tableRows.push([
        "—",
        `*** ${DRIVER_BREAK_MINUTES} MIN DRIVER BREAK ***`,
        "",
        "",
        "",
        "",
        "Mandatory Rest",
      ]);
    }
  });

  autoTable(doc, {
    startY,
    head: [["#", "Customer / Restaurant", "Address", "Contact", "ETA", "Cases", "Instructions"]],
    body: tableRows,
    margin: { left: 40, right: 40 },
    theme: "striped",
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontSize: 8.5,
      fontStyle: "bold",
    },
    styles: {
      fontSize: 8,
      cellPadding: 4,
      overflow: "linebreak",
      textColor: [30, 41, 59],
    },
    columnStyles: {
      0: { cellWidth: 22, halign: "center" },
      1: { cellWidth: 105, fontStyle: "bold" },
      2: { cellWidth: 110 },
      3: { cellWidth: 80 },
      4: { cellWidth: 45, halign: "center", fontStyle: "bold" },
      5: { cellWidth: 35, halign: "center" },
      6: { cellWidth: "auto" },
    },
    didParseCell: (data) => {
      // Highlight driver break row
      if (data.row.raw && Array.isArray(data.row.raw) && data.row.raw[0] === "—") {
        data.cell.styles.fillColor = [254, 243, 199];
        data.cell.styles.textColor = [146, 64, 14];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // Footer on each page
  const pageCount = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `F Magnotta Wines — ${plan.territoryName} (${segment.label}) — Page ${i} of ${pageCount}`,
      40,
      765
    );
  }

  // Clean filename
  const safeTerritory = plan.territoryName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeLabel = segment.label.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${safeTerritory}_${safeLabel}_${deliveryDate}.pdf`;

  // Embed auto-print directive so PDF viewers prompt to print upon opening
  try {
    doc.autoPrint();
  } catch (e) {
    console.debug("autoPrint unsupported:", e);
  }

  const blob = doc.output("blob");
  const blobUrl = URL.createObjectURL(blob);

  if (options.autoDownload !== false) {
    doc.save(filename);
  }

  return { blobUrl, filename };
}
