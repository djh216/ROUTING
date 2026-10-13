import type { CustomerListItem } from "@shared/types";
import { formatDateTime } from "@shared/timeFormat";
import {
  columnLabel,
  customerPrintCell,
  type CustomerPrintColumnId,
} from "./customerDatabasePrintColumns";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateCustomerDatabasePrintHtml(
  customers: CustomerListItem[],
  columnIds: CustomerPrintColumnId[],
  meta: {
    filterSummary: string;
    accountCount: number;
    totalInDatabase: number;
    routeNameById: (cycleId?: string) => string;
  }
): string {
  const headers = columnIds.map((id) => `<th>${escapeHtml(columnLabel(id))}</th>`).join("");
  const rows = customers
    .map((customer) => {
      const cells = columnIds
        .map((id) => {
          const raw = customerPrintCell(customer, id, meta.routeNameById);
          return `<td>${escapeHtml(raw).replace(/\n/g, "<br>")}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  const printedAt = formatDateTime(new Date());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Customer Database</title>
  <style>
    @page { size: landscape; margin: 0.45in; }
    * { box-sizing: border-box; }
    body {
      font-family: Helvetica, Arial, sans-serif;
      font-size: 9pt;
      line-height: 1.35;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 0.25in 0.35in;
    }
    h1 { font-size: 14pt; margin: 0 0 0.15in; }
    .meta { font-size: 9pt; color: #333; margin: 0 0 0.2in; }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid #666;
      padding: 4px 5px;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    th {
      background: #fff;
      font-weight: 700;
      text-align: left;
    }
    tbody tr:nth-child(even) { background: #f5f5f5; }
    td:first-child { font-weight: 600; }
    .foot { margin-top: 0.15in; font-size: 8pt; color: #555; }
  </style>
</head>
<body>
  <h1>F Magnotta Wines — Customer Database</h1>
  <p class="meta">
    ${escapeHtml(String(meta.accountCount))} account${meta.accountCount === 1 ? "" : "s"} ·
    ${escapeHtml(meta.filterSummary)} · Database total: ${meta.totalInDatabase} · Printed ${escapeHtml(printedAt)}
  </p>
  <table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="foot">Customer data as of print time.</p>
</body>
</html>`;
}
