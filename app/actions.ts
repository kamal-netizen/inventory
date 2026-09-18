"use server";

import { revalidatePath } from "next/cache";
import { attemptLogin, endSession, requireWarehouse } from "@/lib/auth";
import * as q from "@/lib/queries";
import type { InvoiceLine } from "@/lib/types";

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** Turns any thrown error into something safe to put on screen. */
function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof q.AppError) return { ok: false, error: err.message };
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

function refreshAll() {
  revalidatePath("/", "layout");
}

/* ---------------------------------- session ---------------------------------- */

export async function loginAction(pin: string): Promise<Result> {
  const result = await attemptLogin(pin);
  if (result.ok) return { ok: true };

  if (result.reason === "locked") {
    return { ok: false, error: `Too many wrong tries. Try again in ${result.minutes} minutes.` };
  }
  if (result.triesLeft === 0) {
    const minutes = "minutes" in result ? result.minutes : 15;
    return { ok: false, error: `Too many wrong tries. Locked for ${minutes} minutes.` };
  }
  const tries = result.triesLeft;
  return { ok: false, error: `Wrong PIN. ${tries} ${tries === 1 ? "try" : "tries"} left.` };
}

export async function logoutAction(): Promise<void> {
  await endSession();
  refreshAll();
}

/* ---------------------------------- stock ---------------------------------- */

export async function undoMovementAction(movementId: number): Promise<Result> {
  try {
    const warehouse = await requireWarehouse();
    await q.undoMovement(warehouse.key, movementId);
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ---------------------------------- products ---------------------------------- */

export async function createProductAction(input: {
  brand: string;
  name: string;
  flavor: string;
  quantity: number;
  lowStockAt: number;
}): Promise<Result<{ id: number }>> {
  try {
    const warehouse = await requireWarehouse();
    const id = await q.createProduct(warehouse.key, input);
    refreshAll();
    return { ok: true, id };
  } catch (err) {
    return fail(err);
  }
}

export async function updateProductAction(
  id: number,
  input: { brand: string; name: string; flavor: string; lowStockAt: number; quantity: number }
): Promise<Result> {
  try {
    const warehouse = await requireWarehouse();
    await q.updateProduct(warehouse.key, id, input);
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function hideProductAction(id: number): Promise<Result> {
  try {
    const warehouse = await requireWarehouse();
    await q.hideProduct(warehouse.key, id);
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ---------------------------------- invoices ---------------------------------- */

/** Used by the invoice screen to warn (not block) on a reused number. */
export async function checkInvoiceRefAction(ref: string): Promise<{ usedOn: string | null }> {
  try {
    const warehouse = await requireWarehouse();
    if (!ref.trim()) return { usedOn: null };
    const existing = await q.invoiceRefUsed(warehouse.key, ref);
    return { usedOn: existing ? existing.created_at : null };
  } catch {
    return { usedOn: null };
  }
}

export async function createInvoiceAction(input: {
  ref: string;
  customer: string;
  lines: InvoiceLine[];
}): Promise<Result<{ id: number }>> {
  try {
    const warehouse = await requireWarehouse();
    const id = await q.createInvoice(warehouse.key, input);
    refreshAll();
    return { ok: true, id };
  } catch (err) {
    return fail(err);
  }
}

const PAGE = 50;

/** Paging for the stored-invoice list. */
export async function loadInvoicesAction(
  search: string,
  offset: number
): Promise<Result<{ invoices: q.InvoiceSummary[]; total: number }>> {
  try {
    const warehouse = await requireWarehouse();
    return {
      ok: true,
      invoices: await q.listInvoices(warehouse.key, { search, limit: PAGE, offset: Math.max(0, offset) }),
      total: await q.countInvoices(warehouse.key, search),
    };
  } catch (err) {
    return fail(err);
  }
}

/** Paging for the movement log. */
export async function loadHistoryAction(
  offset: number
): Promise<Result<{ movements: q.MovementRow[]; total: number }>> {
  try {
    const warehouse = await requireWarehouse();
    return {
      ok: true,
      movements: await q.listMovements(warehouse.key, { limit: PAGE, offset: Math.max(0, offset) }),
      total: await q.countMovements(warehouse.key),
    };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelInvoiceAction(id: number): Promise<Result> {
  try {
    const warehouse = await requireWarehouse();
    await q.cancelInvoice(warehouse.key, id);
    refreshAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ---------------------------------- import ---------------------------------- */

const MAX_IMPORT_ROWS = 20000;

/** Clamp anything coming back from the browser before it reaches the database. */
function cleanRows(rows: q.PlannedRow[]): q.PlannedRow[] {
  return rows.slice(0, MAX_IMPORT_ROWS).map((row) => ({
    row: Number(row.row) || 0,
    brand: String(row.brand ?? "").trim().slice(0, 120),
    name: String(row.name ?? "").trim().slice(0, 200),
    flavor: String(row.flavor ?? "").trim().slice(0, 120),
    quantity: Math.max(0, Math.round(Number(row.quantity) || 0)),
    lowStockAt: Math.max(0, Math.round(Number(row.lowStockAt) || 0)),
    action: row.action === "add" || row.action === "update" ? row.action : "same",
    existingId: row.existingId === null ? null : Number(row.existingId) || null,
    currentQuantity: row.currentQuantity === null ? null : Number(row.currentQuantity),
  }));
}

export async function previewImportAction(formData: FormData): Promise<
  Result<{
    rows: q.PlannedRow[];
    problems: { row: number; message: string }[];
    headers: string[];
    hasQuantity: boolean;
    hasLowStock: boolean;
    brandSource: "column" | "headings" | "none";
    detectedBrands: string[];
  }>
> {
  try {
    const warehouse = await requireWarehouse();

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose a file first." };
    }
    if (file.size > 10 * 1024 * 1024) {
      return { ok: false, error: "That file is over 10 MB. Split it and import in parts." };
    }

    const useHeadingsAsBrands = formData.get("useHeadingsAsBrands") !== "false";
    const { parseSheet } = await import("@/lib/import");
    const sheet = await parseSheet(
      Buffer.from(await file.arrayBuffer()),
      file.name,
      { useHeadingsAsBrands }
    );

    return {
      ok: true,
      rows: await q.planImport(warehouse.key, sheet.rows, {
        hasQuantity: sheet.hasQuantity,
        hasLowStock: sheet.hasLowStock,
      }),
      problems: sheet.problems,
      headers: sheet.headers,
      hasQuantity: sheet.hasQuantity,
      hasLowStock: sheet.hasLowStock,
      brandSource: sheet.brandSource,
      detectedBrands: sheet.detectedBrands,
    };
  } catch (err) {
    const { ImportError } = await import("@/lib/import");
    if (err instanceof ImportError) return { ok: false, error: err.message };
    return fail(err);
  }
}

export async function applyImportAction(
  rows: q.PlannedRow[],
  options: { hasQuantity: boolean; hasLowStock: boolean }
): Promise<Result<{ added: number; updated: number }>> {
  try {
    const warehouse = await requireWarehouse();
    const { added, updated } = await q.applyImport(warehouse.key, cleanRows(rows), {
      hasQuantity: Boolean(options.hasQuantity),
      hasLowStock: Boolean(options.hasLowStock),
    });
    refreshAll();
    return { ok: true, added, updated };
  } catch (err) {
    return fail(err);
  }
}
