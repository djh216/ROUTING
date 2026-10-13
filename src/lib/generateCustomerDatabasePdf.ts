import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { CustomerListItem } from "@shared/types";
import { formatDateTime } from "@shared/timeFormat";
import {
  columnLabel,
  customerPrintCell,
  type CustomerPrintColumnId,
} from "./customerDatabasePrintColumns";

export type CustomerDatabasePdfMeta = {
  filterSummary: string;
  accountCount: number;
  totalInDatabase: number;
  routeNameById: (cycleId?: string) => string;
};

export type CustomerDatabasePdfArtifact = {
  filename: string;
  blobUrl: string;
};

export function generateCustomerDatabasePdf(
  customers: CustomerListItem[],
  columnIds: CustomerPrintColumnId[],
  meta: CustomerDatabasePdfMeta
): CustomerDatabasePdfArtifact {
  if (columnIds.length === 0) {
    throw new Error("Select at least one column to print");
  }

  const doc = new jsPDF("l", "pt", "letter");
  const margin = 36;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - margin * 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text("F Magnotta Wines — Customer Database", margin, 40);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  const line1 = `${meta.accountCount} account${meta.accountCount === 1 ? "" : "s"} printed · ${meta.filterSummary}`;
  doc.text(doc.splitTextToSize(line1, contentW), margin, 56);
  doc.text(
    `Database total: ${meta.totalInDatabase} · Printed ${formatDateTime(new Date())}`,
    margin,
    72
  );

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(margin, 82, margin + contentW, 82);

  const head = [columnIds.map((id) => columnLabel(id))];
  const body = customers.map((customer) =>
    columnIds.map((id) => customerPrintCell(customer, id, meta.routeNameById))
  );

  autoTable(doc, {
    startY: 90,
    head,
    body,
    tableWidth: contentW,
    margin: { left: margin, right: margin, bottom: 36 },
    theme: "plain",
    showHead: "everyPage",
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 8,
      lineWidth: 0.5,
      lineColor: [0, 0, 0],
      cellPadding: 4,
    },
    styles: {
      fontSize: 7.5,
      cellPadding: 3,
      overflow: "linebreak",
      textColor: [0, 0, 0],
      lineColor: [160, 160, 160],
      lineWidth: 0.25,
      valign: "top",
    },
    columnStyles: Object.fromEntries(
      columnIds.map((id, index) => [
        index,
        { fontStyle: id === "name" ? ("bold" as const) : ("normal" as const) },
      ])
    ),
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    doc.text(`Customer database · Page ${i} of ${pageCount}`, margin, pageH - 20);
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `customer_database_${dateStamp}.pdf`;
  const arrayBuffer = doc.output("arraybuffer") as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });
  const blobUrl = URL.createObjectURL(blob);

  return { filename, blobUrl };
}

export function downloadCustomerDatabasePdf(artifact: CustomerDatabasePdfArtifact): void {
  const link = document.createElement("a");
  link.href = artifact.blobUrl;
  link.download = artifact.filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
