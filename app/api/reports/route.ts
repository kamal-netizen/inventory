import type { NextRequest } from "next/server";
import { requireWarehouse } from "@/lib/auth";
import { isReportPeriod, reportRange, safeFilename } from "@/lib/format";
import { getAuditSummary, listInvoices, listMovements, listProductAudit } from "@/lib/queries";
import { buildReport } from "@/lib/report";

/** A report is the whole period, not a page of it. */
const EVERYTHING = 1_000_000;

const TITLE = { daily: "Daily report", weekly: "Weekly report", monthly: "Monthly report" };

const dayFirst = (dateStr: string) => dateStr.split("-").reverse().join("-");

export async function GET(request: NextRequest) {
  const warehouse = await requireWarehouse();

  const period = request.nextUrl.searchParams.get("period");
  const date = request.nextUrl.searchParams.get("date") ?? "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  // Comparing back catches dates that roll over, like 31 February.
  const realDate =
    parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
  if (!isReportPeriod(period) || !realDate) return new Response("Bad request", { status: 400 });

  const range = reportRange(period, date);
  const [audit, products, notes, movements] = await Promise.all([
    getAuditSummary(warehouse.key, range),
    listProductAudit(warehouse.key, range),
    listInvoices(warehouse.key, { ...range, limit: EVERYTHING }),
    listMovements(warehouse.key, { ...range, limit: EVERYTHING }),
  ]);

  const file = await buildReport({
    title: TITLE[period],
    warehouseName: warehouse.name,
    ...range,
    audit,
    products,
    notes: notes.rows,
    movements: movements.rows,
  });

  // e.g. "Muscle Fusion Weekly report 14-09-2026 to 20-09-2026.xlsx"
  const covers =
    range.from === range.to ? dayFirst(range.from) : `${dayFirst(range.from)} to ${dayFirst(range.to)}`;
  const filename = `${safeFilename([warehouse.name, TITLE[period], covers].join(" "))}.xlsx`;

  // ASCII fallback first, then the exact UTF-8 name for browsers that read it.
  const ascii = filename.replace(/[^\x20-\x7e]+/g, "_").replace(/"/g, "");

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
