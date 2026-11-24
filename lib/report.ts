import "server-only";
import ExcelJS from "exceljs";
import { dayKey, formatTime, productLabel, reasonLabel } from "./format";
import type { AuditSummary, InvoiceSummary, MovementRow, ProductAudit } from "./queries";

/** A calendar date as Excel stores one, so the column sorts and filters as dates. */
function excelDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

const DATE_FORMAT = "dd-mm-yyyy";

export async function buildReport(report: {
  title: string;
  warehouseName: string;
  from: string;
  to: string;
  audit: AuditSummary;
  products: ProductAudit[];
  notes: InvoiceSummary[];
  movements: MovementRow[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  function addTable(name: string, columns: Partial<ExcelJS.Column>[]) {
    const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = columns;
    const head = sheet.getRow(1);
    head.font = { bold: true };
    head.height = 22;
    head.alignment = { vertical: "middle" };
    return sheet;
  }

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 28 }, { width: 24, style: { alignment: { horizontal: "left" } } }];
  summary.addRow([report.title]).font = { bold: true, size: 14 };
  summary.addRow(["Warehouse", report.warehouseName]);
  summary.addRow(["From", excelDate(report.from)]).getCell(2).numFmt = DATE_FORMAT;
  summary.addRow(["To", excelDate(report.to)]).getCell(2).numFmt = DATE_FORMAT;
  summary.addRow([]);
  summary.addRow(["Out on delivery notes", report.audit.out]);
  summary.addRow(["In — credits & receiving", report.audit.in]);
  summary.addRow(["Damaged", report.audit.damaged]);
  summary.addRow(["Net change", report.audit.net]).font = { bold: true };
  summary.addRow([]);
  summary.addRow(["Delivery notes raised", report.audit.deliveryNotes]);
  summary.addRow(["Credit notes raised", report.audit.creditNotes]);

  const products = addTable("Products", [
    { header: "Brand", key: "brand", width: 24 },
    { header: "Product", key: "product", width: 48 },
    { header: "Out", key: "out", width: 10 },
    { header: "In", key: "in", width: 10 },
    { header: "Damaged", key: "damaged", width: 12 },
    { header: "Net change", key: "net", width: 12 },
  ]);
  for (const row of report.products) {
    products.addRow({ ...row, product: productLabel(row.name, row.flavor) });
  }

  const notes = addTable("Notes", [
    { header: "Date", key: "date", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: "Time", key: "time", width: 12 },
    { header: "Number", key: "ref", width: 16 },
    { header: "Type", key: "type", width: 16 },
    { header: "Customer", key: "customer", width: 32 },
    { header: "Items", key: "lines", width: 10 },
    { header: "Units", key: "units", width: 10 },
    { header: "Status", key: "status", width: 12 },
  ]);
  for (const note of report.notes) {
    notes.addRow({
      date: excelDate(dayKey(note.created_at)),
      time: formatTime(note.created_at),
      ref: note.ref,
      type: note.kind === "credit" ? "Credit note" : "Delivery note",
      customer: note.customer,
      lines: note.lines,
      units: note.units,
      status: note.status === "cancelled" ? "Cancelled" : "Active",
    });
  }

  const movements = addTable("Stock changes", [
    { header: "Date", key: "date", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: "Time", key: "time", width: 12 },
    { header: "Brand", key: "brand", width: 24 },
    { header: "Product", key: "product", width: 48 },
    { header: "Reason", key: "reason", width: 16 },
    { header: "Reference", key: "ref", width: 24 },
    { header: "Change", key: "change", width: 10 },
    { header: "Undone", key: "undone", width: 10 },
  ]);
  for (const row of report.movements) {
    movements.addRow({
      date: excelDate(dayKey(row.created_at)),
      time: formatTime(row.created_at),
      brand: row.product_brand,
      product: productLabel(row.product_name, row.product_flavor),
      reason: reasonLabel(row.reason),
      ref: row.invoice_ref ?? row.ref,
      change: row.change,
      undone: row.undone === 1 ? "Yes" : "",
    });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
