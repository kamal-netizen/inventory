import "server-only";
import { db, now } from "./db";
import type { Invoice, InvoiceLine, Movement, Product, Reason } from "./types";

/**
 * Every function here takes the warehouse key as its first argument and filters
 * on it. That is the isolation boundary: there is no query that reads across
 * warehouses, so one side can never see the other's products, stock or history.
 */

/** An error whose message is safe and useful to show the user directly. */
export class AppError extends Error {}

/* ---------------------------------- products ---------------------------------- */

export function listProducts(warehouse: string, search = ""): Product[] {
  const term = `%${search.trim().toLowerCase()}%`;
  return db()
    .prepare(
      `SELECT * FROM products
       WHERE warehouse = ? AND hidden = 0
         AND (? = '%%' OR lower(name) LIKE ? OR lower(flavor) LIKE ? OR lower(brand) LIKE ?)
       ORDER BY (low_stock_at > 0 AND quantity <= low_stock_at) DESC,
                lower(brand), lower(name), lower(flavor)`
    )
    .all(warehouse, term, term, term, term) as Product[];
}

export function getProduct(warehouse: string, id: number): Product | null {
  const row = db()
    .prepare("SELECT * FROM products WHERE warehouse = ? AND id = ?")
    .get(warehouse, id) as Product | undefined;
  return row ?? null;
}

export function createProduct(
  warehouse: string,
  input: { brand?: string; name: string; flavor: string; quantity: number; lowStockAt: number }
): number {
  const name = input.name.trim();
  if (!name) throw new AppError("Product name is required");

  const create = db().transaction(() => {
    let id: number;
    try {
      const result = db()
        .prepare(
          `INSERT INTO products (warehouse, brand, name, flavor, quantity, low_stock_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          warehouse,
          (input.brand ?? "").trim(),
          name,
          input.flavor.trim(),
          input.quantity,
          input.lowStockAt,
          now()
        );
      id = Number(result.lastInsertRowid);
    } catch (err) {
      if (String(err).includes("UNIQUE")) {
        const label = input.flavor.trim() ? `${name} · ${input.flavor.trim()}` : name;
        throw new AppError(`"${label}" is already in your list`);
      }
      throw err;
    }

    if (input.quantity !== 0) {
      logMovement(warehouse, id, input.quantity, "new", "");
    }
    return id;
  });

  return create();
}

export function updateProduct(
  warehouse: string,
  id: number,
  input: { brand?: string; name: string; flavor: string; lowStockAt: number; quantity?: number }
): void {
  const name = input.name.trim();
  if (!name) throw new AppError("Product name is required");

  const update = db().transaction(() => {
    const product = getProduct(warehouse, id);
    if (!product) throw new AppError("Product not found");

    try {
      db().prepare(
        "UPDATE products SET brand = ?, name = ?, flavor = ?, low_stock_at = ? WHERE warehouse = ? AND id = ?"
      ).run((input.brand ?? product.brand).trim(), name, input.flavor.trim(), input.lowStockAt, warehouse, id);
    } catch (err) {
      if (String(err).includes("UNIQUE")) {
        throw new AppError("Another product already has that brand, name and flavour");
      }
      throw err;
    }

    // Typing a quantity here is a stock correction, so it goes in the log like
    // any other change rather than silently rewriting the number.
    if (input.quantity !== undefined && input.quantity !== product.quantity) {
      if (input.quantity < 0) throw new AppError("Quantity cannot be negative");
      db().prepare("UPDATE products SET quantity = ? WHERE warehouse = ? AND id = ?").run(
        input.quantity,
        warehouse,
        id
      );
      logMovement(warehouse, id, input.quantity - product.quantity, "adjust", "Set by hand");
    }
  });

  update();
}

/** Distinct brands already in use, for the brand suggestions on the product form. */
export function listBrands(warehouse: string): string[] {
  const rows = db()
    .prepare(
      `SELECT DISTINCT brand FROM products
       WHERE warehouse = ? AND hidden = 0 AND brand <> ''
       ORDER BY lower(brand)`
    )
    .all(warehouse) as { brand: string }[];
  return rows.map((row) => row.brand);
}

/** Products are hidden, never deleted, so past invoices keep making sense. */
export function hideProduct(warehouse: string, id: number): void {
  db().prepare("UPDATE products SET hidden = 1 WHERE warehouse = ? AND id = ?").run(warehouse, id);
}

/* ---------------------------------- stock ---------------------------------- */

function logMovement(
  warehouse: string,
  productId: number,
  change: number,
  reason: Reason,
  ref: string,
  invoiceId: number | null = null
): number {
  const result = db()
    .prepare(
      `INSERT INTO movements (warehouse, product_id, change, reason, ref, invoice_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(warehouse, productId, change, reason, ref, invoiceId, now());
  return Number(result.lastInsertRowid);
}

/** Apply a stock change, refusing to go below zero. Returns the new quantity. */
export function adjustStock(
  warehouse: string,
  productId: number,
  change: number,
  reason?: Reason,
  ref = ""
): { quantity: number; movementId: number } {
  const why: Reason = reason ?? (change >= 0 ? "in" : "out");

  const apply = db().transaction(() => {
    const product = getProduct(warehouse, productId);
    if (!product) throw new AppError("Product not found");

    const quantity = product.quantity + change;
    if (quantity < 0) {
      throw new AppError(`Only ${product.quantity} in stock — cannot remove ${Math.abs(change)}`);
    }

    db().prepare("UPDATE products SET quantity = ? WHERE warehouse = ? AND id = ?").run(
      quantity,
      warehouse,
      productId
    );
    return { quantity, movementId: logMovement(warehouse, productId, change, why, ref) };
  });

  return apply();
}

/** Reverse a single stock change and mark it undone. */
export function undoMovement(warehouse: string, movementId: number): void {
  const undo = db().transaction(() => {
    const movement = db()
      .prepare("SELECT * FROM movements WHERE warehouse = ? AND id = ? AND undone = 0")
      .get(warehouse, movementId) as Movement | undefined;

    if (!movement) throw new AppError("That change was already undone");
    if (movement.invoice_id) throw new AppError("Cancel the delivery note instead");

    const product = getProduct(warehouse, movement.product_id);
    if (!product) throw new AppError("Product not found");

    const quantity = product.quantity - movement.change;
    if (quantity < 0) throw new AppError(`Cannot undo — only ${product.quantity} in stock now`);

    db().prepare("UPDATE products SET quantity = ? WHERE warehouse = ? AND id = ?").run(
      quantity,
      warehouse,
      movement.product_id
    );
    db().prepare("UPDATE movements SET undone = 1 WHERE id = ?").run(movementId);
  });

  undo();
}

/* ---------------------------------- invoices ---------------------------------- */

export function invoiceRefUsed(warehouse: string, ref: string): Invoice | null {
  const row = db()
    .prepare(
      "SELECT * FROM invoices WHERE warehouse = ? AND lower(ref) = lower(?) ORDER BY id DESC LIMIT 1"
    )
    .get(warehouse, ref.trim()) as Invoice | undefined;
  return row ?? null;
}

export function getInvoice(warehouse: string, id: number): Invoice | null {
  const row = db()
    .prepare("SELECT * FROM invoices WHERE warehouse = ? AND id = ?")
    .get(warehouse, id) as Invoice | undefined;
  return row ?? null;
}

/** Create an invoice and reduce stock for every line — all or nothing. */
export function createInvoice(
  warehouse: string,
  input: { ref: string; customer: string; lines: InvoiceLine[] }
): number {
  const ref = input.ref.trim();
  if (!ref) throw new AppError("Delivery note number is required");
  if (input.lines.length === 0) throw new AppError("Add at least one product");

  const create = db().transaction(() => {
    // Check every line before touching anything, so one error names all the problems.
    const shortages: string[] = [];
    for (const line of input.lines) {
      const product = getProduct(warehouse, line.productId);
      if (!product) throw new AppError("A product on this delivery note no longer exists");
      if (line.quantity <= 0) throw new AppError("Quantity must be at least 1");
      if (line.quantity > product.quantity) {
        const label = product.flavor ? `${product.name} · ${product.flavor}` : product.name;
        shortages.push(`${label} — only ${product.quantity} left`);
      }
    }
    if (shortages.length > 0) {
      throw new AppError(`Not enough stock:\n${shortages.join("\n")}`);
    }

    const invoiceId = Number(
      db()
        .prepare(
          `INSERT INTO invoices (warehouse, ref, customer, status, created_at)
           VALUES (?, ?, ?, 'active', ?)`
        )
        .run(warehouse, ref, input.customer.trim(), now()).lastInsertRowid
    );

    for (const line of input.lines) {
      db().prepare("UPDATE products SET quantity = quantity - ? WHERE warehouse = ? AND id = ?").run(
        line.quantity,
        warehouse,
        line.productId
      );
      logMovement(warehouse, line.productId, -line.quantity, "invoice", ref, invoiceId);
    }

    return invoiceId;
  });

  return create();
}

/** Put every line's stock back. The invoice stays in history, marked cancelled. */
export function cancelInvoice(warehouse: string, invoiceId: number): void {
  const cancel = db().transaction(() => {
    const invoice = getInvoice(warehouse, invoiceId);
    if (!invoice) throw new AppError("Delivery note not found");
    if (invoice.status === "cancelled") throw new AppError("This delivery note is already cancelled");

    const lines = db()
      .prepare("SELECT * FROM movements WHERE warehouse = ? AND invoice_id = ? AND undone = 0")
      .all(warehouse, invoiceId) as Movement[];

    for (const line of lines) {
      // line.change is negative, so subtracting it adds the stock back.
      db().prepare("UPDATE products SET quantity = quantity - ? WHERE warehouse = ? AND id = ?").run(
        line.change,
        warehouse,
        line.product_id
      );
      db().prepare("UPDATE movements SET undone = 1 WHERE id = ?").run(line.id);
    }

    db().prepare("UPDATE invoices SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(
      now(),
      invoiceId
    );
  });

  cancel();
}

/* ------------------------------ invoices: stored ------------------------------ */

export interface MovementRow extends Movement {
  product_name: string;
  product_flavor: string;
  product_brand: string;
  invoice_ref: string | null;
  invoice_status: string | null;
}

export interface InvoiceSummary extends Invoice {
  lines: number;
  units: number;
}

/** Every invoice ever raised, newest first. Searchable by number or customer. */
export function listInvoices(
  warehouse: string,
  options: { search?: string; limit?: number; offset?: number } = {}
): InvoiceSummary[] {
  const search = (options.search ?? "").trim().toLowerCase();
  const term = `%${search}%`;

  return db()
    .prepare(
      `SELECT i.*,
              (SELECT count(*) FROM movements m WHERE m.invoice_id = i.id) AS lines,
              (SELECT COALESCE(sum(abs(m.change)), 0) FROM movements m WHERE m.invoice_id = i.id) AS units
       FROM invoices i
       WHERE i.warehouse = ?
         AND (? = '' OR lower(i.ref) LIKE ? OR lower(i.customer) LIKE ?)
       ORDER BY i.created_at DESC, i.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(warehouse, search, term, term, options.limit ?? 50, options.offset ?? 0) as InvoiceSummary[];
}

export function countInvoices(warehouse: string, search = ""): number {
  const trimmed = search.trim().toLowerCase();
  const term = `%${trimmed}%`;
  const row = db()
    .prepare(
      `SELECT count(*) AS n FROM invoices
       WHERE warehouse = ? AND (? = '' OR lower(ref) LIKE ? OR lower(customer) LIKE ?)`
    )
    .get(warehouse, trimmed, term, term) as { n: number };
  return row.n;
}

/** One invoice with every line on it, including lines whose product was later hidden. */
export function getInvoiceWithLines(
  warehouse: string,
  id: number
): { invoice: Invoice; lines: MovementRow[]; units: number } | null {
  const invoice = getInvoice(warehouse, id);
  if (!invoice) return null;

  const lines = db()
    .prepare(
      `SELECT m.*, p.name AS product_name, p.flavor AS product_flavor, p.brand AS product_brand,
              NULL AS invoice_ref, NULL AS invoice_status
       FROM movements m JOIN products p ON p.id = m.product_id
       WHERE m.warehouse = ? AND m.invoice_id = ?
       ORDER BY m.id`
    )
    .all(warehouse, id) as MovementRow[];

  return {
    invoice,
    lines,
    units: lines.reduce((total, line) => total + Math.abs(line.change), 0),
  };
}

/* ---------------------------------- history ---------------------------------- */

/**
 * The full movement log, newest first, one row per change. Invoice lines carry
 * their invoice number so History can link across to the stored invoice.
 */
export function listMovements(
  warehouse: string,
  options: { limit?: number; offset?: number } = {}
): MovementRow[] {
  return db()
    .prepare(
      `SELECT m.*, p.name AS product_name, p.flavor AS product_flavor, p.brand AS product_brand,
              i.ref AS invoice_ref, i.status AS invoice_status
       FROM movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN invoices i ON i.id = m.invoice_id
       WHERE m.warehouse = ?
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(warehouse, options.limit ?? 100, options.offset ?? 0) as MovementRow[];
}

export function countMovements(warehouse: string): number {
  const row = db()
    .prepare("SELECT count(*) AS n FROM movements WHERE warehouse = ?")
    .get(warehouse) as { n: number };
  return row.n;
}

/* ---------------------------------- import ---------------------------------- */

export interface ImportCandidate {
  row: number;
  brand: string;
  name: string;
  flavor: string;
  quantity: number;
  lowStockAt: number;
}

export interface PlannedRow extends ImportCandidate {
  action: "add" | "update" | "same";
  existingId: number | null;
  currentQuantity: number | null;
}

/**
 * Works out what an import would do without touching anything, so the preview
 * shows the real outcome before a single row is written.
 */
export function planImport(
  warehouse: string,
  rows: ImportCandidate[],
  options: { hasQuantity: boolean; hasLowStock: boolean }
): PlannedRow[] {
  const find = db().prepare(
    `SELECT id, quantity, low_stock_at FROM products
     WHERE warehouse = ? AND lower(brand) = lower(?) AND lower(name) = lower(?) AND lower(flavor) = lower(?)`
  );

  return rows.map((row) => {
    const existing = find.get(warehouse, row.brand, row.name, row.flavor) as
      | { id: number; quantity: number; low_stock_at: number }
      | undefined;

    if (!existing) {
      return { ...row, action: "add", existingId: null, currentQuantity: null };
    }

    const quantityChanges = options.hasQuantity && row.quantity !== existing.quantity;
    const lowChanges = options.hasLowStock && row.lowStockAt !== existing.low_stock_at;

    return {
      ...row,
      action: quantityChanges || lowChanges ? "update" : "same",
      existingId: existing.id,
      currentQuantity: existing.quantity,
    };
  });
}

/**
 * Applies a planned import in one transaction. Columns missing from the file are
 * left alone on products that already exist — re-importing a catalogue with no
 * quantity column must never wipe the stock figures.
 */
export function applyImport(
  warehouse: string,
  rows: PlannedRow[],
  options: { hasQuantity: boolean; hasLowStock: boolean }
): { added: number; updated: number } {
  let added = 0;
  let updated = 0;

  const run = db().transaction(() => {
    for (const row of rows) {
      if (row.action === "same") continue;

      if (row.action === "add") {
        const id = Number(
          db()
            .prepare(
              `INSERT INTO products (warehouse, brand, name, flavor, quantity, low_stock_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(warehouse, row.brand, row.name, row.flavor, row.quantity, row.lowStockAt, now())
            .lastInsertRowid
        );
        if (row.quantity !== 0) logMovement(warehouse, id, row.quantity, "new", "Excel import");
        added++;
        continue;
      }

      if (!row.existingId) continue;

      if (options.hasLowStock) {
        db().prepare("UPDATE products SET low_stock_at = ? WHERE warehouse = ? AND id = ?").run(
          row.lowStockAt,
          warehouse,
          row.existingId
        );
      }

      if (options.hasQuantity && row.currentQuantity !== null && row.quantity !== row.currentQuantity) {
        db().prepare("UPDATE products SET quantity = ? WHERE warehouse = ? AND id = ?").run(
          row.quantity,
          warehouse,
          row.existingId
        );
        logMovement(
          warehouse,
          row.existingId,
          row.quantity - row.currentQuantity,
          "adjust",
          "Excel import"
        );
      }

      updated++;
    }
  });

  run();
  return { added, updated };
}
