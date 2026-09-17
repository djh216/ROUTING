import type { RoutePlan, Segment, Stop } from "@shared/types";
import { DRIVER_BREAK_MINUTES } from "@shared/constants";
import { formatDateTime, formatDurationMinutes } from "@shared/timeFormat";

function escapeHtml(str: string | undefined | null): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function generatePrintableHtml(
  plan: RoutePlan,
  segment: Segment,
  stops: Stop[]
): string {
  const v = segment.validation;
  const breakAfterStopId =
    v.driverBreakAfterStopId ?? plan.driverBreakAfterStop?.[segment.id];
  const breakAfterStop = breakAfterStopId
    ? stops.find((s) => s.id === breakAfterStopId)
    : undefined;

  const rowsHtml = stops
    .map((stop, idx) => {
      const contactInfo = [stop.contactName, stop.contactPhone]
        .filter(Boolean)
        .map((t) => escapeHtml(t))
        .join("<br>");

      const stopRow = `
        <tr class="stop-row">
          <td class="col-num">${idx + 1}</td>
          <td class="col-name"><strong>${escapeHtml(stop.customerName)}</strong></td>
          <td class="col-addr">${escapeHtml(stop.address)}, ${escapeHtml(stop.city)}</td>
          <td class="col-contact">${contactInfo || "—"}</td>
          <td class="col-eta"><strong>${escapeHtml(v.stopEtas[stop.id] ?? "—")}</strong></td>
          <td class="col-cases">${stop.cases ?? "—"}</td>
          <td class="col-instructions">${escapeHtml(stop.deliveryInstructions) || "—"}</td>
        </tr>`;

      const breakRow =
        breakAfterStopId === stop.id
          ? `
        <tr class="break-row">
          <td class="col-num">—</td>
          <td colspan="6">
            *** ${DRIVER_BREAK_MINUTES} MIN DRIVER BREAK ***
          </td>
        </tr>`
          : "";

      return stopRow + breakRow;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Delivery Manifest - ${escapeHtml(plan.territoryName)} - ${escapeHtml(segment.label)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @page {
      size: letter portrait;
      margin: 0.4in;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 1.5rem;
      font-size: 12px;
      line-height: 1.4;
    }
    .no-print-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      justify-content: space-between;
      background: #f8fafc;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      margin-bottom: 1.5rem;
      border: 1px solid #cbd5e1;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .no-print-bar h3 {
      margin: 0;
      font-size: 14px;
      color: #1e293b;
    }
    .no-print-bar p {
      margin: 2px 0 0;
      font-size: 12px;
      color: #64748b;
    }
    .btn-group {
      display: flex;
      gap: 8px;
    }
    .btn {
      background: #0f172a;
      color: #ffffff;
      padding: 7px 14px;
      border-radius: 6px;
      border: none;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s;
    }
    .btn:hover {
      background: #334155;
    }
    .btn-secondary {
      background: #e2e8f0;
      color: #1e293b;
    }
    .btn-secondary:hover {
      background: #cbd5e1;
    }
    @media print {
      .no-print-bar {
        display: none !important;
      }
      body {
        padding: 0 !important;
      }
    }
    header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 18px;
      font-weight: 800;
      margin: 0 0 2px;
      color: #0f172a;
    }
    h2 {
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 6px;
      color: #334155;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 11px;
      color: #475569;
      margin: 2px 0;
    }
    .summary-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 12px;
      margin: 10px 0 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 11px;
    }
    .summary-item {
      color: #475569;
    }
    .summary-item strong {
      color: #0f172a;
    }
    .break-note {
      color: #b45309;
      font-style: italic;
      font-size: 11px;
      margin: 4px 0 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 11px;
      margin-top: 6px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 5px 6px;
      text-align: left;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    th {
      background: #0f172a;
      color: #ffffff;
      font-weight: 700;
      font-size: 10.5px;
    }
    .col-num { width: 26px; text-align: center; }
    .col-name { width: 22%; }
    .col-addr { width: 24%; }
    .col-contact { width: 17%; }
    .col-eta { width: 50px; text-align: center; }
    .col-cases { width: 42px; text-align: center; }
    .col-instructions { width: auto; }
    tr:nth-child(even) td {
      background: #f8fafc;
    }
    tr.break-row td {
      background: #fef3c7 !important;
      color: #92400e !important;
      font-weight: bold;
      text-align: center;
      padding: 6px;
    }
    footer {
      margin-top: 14px;
      font-size: 10px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <div>
      <h3>Print Delivery Manifest — ${escapeHtml(segment.label)}</h3>
      <p>${escapeHtml(plan.territoryName)} · ${escapeHtml(segment.deliveryDate)} · ${v.stopCount} stops · ${v.totalCases} cases</p>
    </div>
    <div class="btn-group">
      <button class="btn" onclick="window.print()">🖨️ Print Manifest</button>
      <button class="btn btn-secondary" onclick="window.close()">✕ Close</button>
    </div>
  </div>

  <header>
    <h1>F Magnotta Wines — Delivery Manifest</h1>
    <h2>${escapeHtml(plan.territoryName)} — ${escapeHtml(segment.label)}</h2>
    <div class="meta-row">
      <span>Delivery Date: <strong>${escapeHtml(segment.deliveryDate)}</strong></span>
      <span>Batch ID: <strong>${escapeHtml(plan.batchId)}</strong></span>
      <span>Status: <strong>${escapeHtml(plan.status.toUpperCase())}</strong></span>
      <span>Printed: <strong>${escapeHtml(formatDateTime(new Date()))}</strong></span>
    </div>
    <div class="meta-row">
      <span>Depot: ${escapeHtml(plan.depot.address)}, ${escapeHtml(plan.depot.city)}</span>
      ${segment.endLocation === "overnight" ? "<span>Overnight Route</span>" : ""}
      ${segment.startLocation === "overnight" ? "<span>Continues from Overnight</span>" : ""}
    </div>
  </header>

  <div class="summary-box">
    <div class="summary-item">Stops: <strong>${v.stopCount}</strong></div>
    <div class="summary-item">Total Cases: <strong>${v.totalCases}</strong></div>
    <div class="summary-item">Total Miles: <strong>${v.totalMiles} mi</strong></div>
    ${v.departureTime ? `<div class="summary-item">Depart: <strong>${escapeHtml(v.departureTime)}</strong></div>` : ""}
    ${v.completionTime ? `<div class="summary-item">Done by: <strong>${escapeHtml(v.completionTime)}</strong></div>` : ""}
    ${v.totalRouteMinutes ? `<div class="summary-item">Total Route Time: <strong>${escapeHtml(formatDurationMinutes(v.totalRouteMinutes))}</strong></div>` : ""}
  </div>

  ${breakAfterStop ? `<div class="break-note">* Scheduled ${DRIVER_BREAK_MINUTES}-min driver break after stop: ${escapeHtml(breakAfterStop.customerName)}</div>` : ""}

  ${
    stops.length === 0
      ? "<p>No stops assigned to this route segment.</p>"
      : `
    <table>
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th class="col-name">Customer / Restaurant</th>
          <th class="col-addr">Address</th>
          <th class="col-contact">Contact</th>
          <th class="col-eta">ETA</th>
          <th class="col-cases">Cases</th>
          <th class="col-instructions">Delivery Instructions</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `
  }

  <footer>
    <span>F Magnotta Wines Routing System</span>
    <span>Manifest for ${escapeHtml(segment.label)}</span>
  </footer>

  <script>
    window.addEventListener('load', function() {
      // Auto-trigger print after render
      setTimeout(function() {
        window.focus();
        window.print();
      }, 350);
    });
  <\/script>
</body>
</html>`;
}
