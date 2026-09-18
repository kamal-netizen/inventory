import "server-only";
import type { PoolClient } from "pg";
import { now, one, query, transaction } from "./db";
import type { Invoice, InvoiceLine, Movement, Product, Reason } from "./types";

/**
 * Every function here takes the warehouse key as its first argument and filters
 * on it. That is the isolation boundary: there is no query that reads across
 * warehouses, so one side can never see the other's products, stock or history.
 */

/** An error whose message is safe and useful to show the user directly. */
export class AppError extends Error {}

/** Postgres unique_violation. */
function isDuplicate(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** count() and sum() come back as strings — they are bigint on the wire. */
const int = (value: unknown): number => Number(value ?? 0);

/* ---------------------------------- products ---------------------------------- */

export async function listProducts(warehouse: string, search = ""): Promise<Product[]> {
  const term = search.trim().toLowerCase();
  return query<Product>(
    `SELECT * FROM products
     WHERE warehouse = $1 AND hidden = 0
       AND ($2 = '' OR lower(name) LIKE $3 OR lower(flavor) LIKE $3 OR lower(brand) LIKE $3)
     ORDER BY (low_stock_at > 0 AND quantity <= low_stock_at) DESC,
              lower(brand), lower(name), lower(flavor)`,
    [warehouse, term, `%${term}%`]
  );
}

export async function getProduct(warehouse: string, id: number): Promise<Product | null> {
  return one<Product>("SELECT * FROM products WHERE warehouse = $1 AND id = $2", [warehouse, id]);
}

/** Distinct brands already in use, for the brand picker on the product form. */
export async function listBrands(warehouse: string): Promise<string[]> {
  const rows = await query<{ brand: string }>(
    `SELECT DISTINCT brand FROM products
     WHERE warehouse = $1 AND hidden = 0 AND brand <> ''
     ORDER BY lower(brand)`,
    [warehouse]
  );
  return rows.map((row) => row.brand);
}

export async function createProduct(
  warehouse: string,
  input: { brand?: string; name: string; flavor: string; quantity: number; lowStockAt: number }
): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new AppError("Product name is required");

  return transaction(async (client) => {
    let id: number;
    try {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO products (warehouse, brand, name, flavor, quantity, low_stock_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          warehouse,
          (input.brand ?? "").trim(),
          name,
          input.flavor.trim(),
          input.quantity,
          input.lowStockAt,
          now(),
        ]
      );
      id = rows[0].id;
    } catch (err) {
      if (isDuplicate(err)) {
        const label = input.flavor.trim() ? `${name} · ${input.flavor.trim()}` : name;
        throw new AppError(`"${label}" is already in your list`);
      }
      throw err;
    }

    if (input.quantity !== 0) {
      await logMovement(client, warehouse, id, input.quantity, "new", "");
    }
    return id;
  });
}

export async function updateProduct(
  warehouse: string,
  id: number,
  input: { brand?: string; name: string; flavor: string; lowStockAt: number; quantity?: number }
): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new AppError("Product name is required");

  await transaction(async (client) => {
    const { rows } = await client.query<Product>(
      "SELECT * FROM products WHERE warehouse = $1 AND id = $2",
      [warehouse, id]
    );
    const product = rows[0];
    if (!product) throw new AppError("Product not found");

    try {
      await client.query(
        `UPDATE products SET brand = $1, name = $2, flavor = $3, low_stock_at = $4
         WHERE warehouse = $5 AND id = $6`,
        [(input.brand ?? product.brand).trim(), name, input.flavor.trim(), input.lowStockAt, warehouse, id]
      );
    } catch (err) {
      if (isDuplicate(err)) {
        throw new AppError("Another product already has that brand, name and flavour");
      }
      throw err;
    }

    // Typing a quantity here is a stock correction, so it goes in the log like
    // any other change rather than silently rewriting the number.
    if (input.quantity !== undefined && input.quantity !== product.quantity) {
      if (input.quantity < 0) throw new AppError("Quantity cannot be negative");
      await client.query("UPDATE products SET quantity = $1 WHERE warehouse = $2 AND id = $3", [
        input.quantity,
        warehouse,
        id,
      ]);
      await logMovement(
        client,
        warehouse,
        id,
        input.quantity - product.quantity,
        "adjust",
        "Set by hand"
      );
    }
  });
}

/** Products are hidden, never deleted, so past delivery notes keep making sense. */
export async function hideProduct(warehouse: string, id: number): Promise<void> {
  await query("UPDATE products SET hidden = 1 WHERE warehouse = $1 AND id = $2", [warehouse, id]);
}

/* ---------------------------------- stock ---------------------------------- */

/**
 * Always takes the transaction's own client. Reaching for the pool here would
 * log the movement outside the transaction that changed the stock, so a
 * rollback would leave the log claiming something that never happened.
 */
async function logMovement(
  client: PoolClient,
  warehouse: string,
  productId: number,
  change: number,
  reason: Reason,
  ref: string,
  invoiceId: number | null = null
): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO movements (warehouse, product_id, change, reason, ref, invoice_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [warehouse, productId, change, reason, ref, invoiceId, now()]
  );
  return rows[0].id;
}

/** Reverse a single stock change and mark it undone. */
export async function undoMovement(warehouse: string, movementId: number): Promise<void> {
  await transaction(async (client) => {
    const { rows } = await client.query<Movement>(
      "SELECT * FROM movements WHERE warehouse = $1 AND id = $2 AND undone = 0",
      [warehouse, movementId]
    );
    const movement = rows[0];

    if (!movement) throw new AppError("That change was already undone");
    if (movement.invoice_id) throw new AppError("Cancel the delivery note instead");

    const found = await client.query<Product>(
      "SELECT * FROM products WHERE warehouse = $1 AND id = $2",
      [warehouse, movement.product_id]
    );
    const product = found.rows[0];
    if (!product) throw new AppError("Product not found");

    const quantity = product.quantity - movement.change;
    if (quantity < 0) throw new AppError(`Cannot undo — only ${product.quantity} in stock now`);

    await client.query("UPDATE products SET quantity = $1 WHERE warehouse = $2 AND id = $3", [
      quantity,
      warehouse,
      movement.product_id,
    ]);
    await client.query("UPDATE movements SET undone = 1 WHERE id = $1", [movementId]);
  });
}

/* ------------------------------ delivery notes ------------------------------ */

/**
 * The number to offer for the next delivery note: the last one for this
 * warehouse with its trailing digits bumped by one.
 *
 * Reading the last note rather than inventing a format is what lets the app
 * carry on the numbering already in use — 46984 becomes 46985 — instead of
 * starting a second, competing run alongside it.
 *
 * Per warehouse, like everything else here. A shared counter would leak how
 * busy the other side is through the gaps in your own numbers.
 */
export async function nextRef(warehouse: string): Promise<{ next: string; from: string }> {
  const row = await one<{ ref: string }>(
    "SELECT ref FROM invoices WHERE warehouse = $1 ORDER BY id DESC LIMIT 1",
    [warehouse]
  );

  const from = row?.ref.trim() ?? "";
  const match = /^(.*?)(\d+)$/.exec(from);
  // Beyond 15 digits Number() starts rounding, and a wrong number is worse
  // than none.
  if (!match || match[2].length > 15) return { next: "", from: "" };

  const [, prefix, digits] = match;
  const bumped = String(Number(digits) + 1);
  // Keep zero padding that was there: 0007 → 0008, but 46984 → 46985.
  const next =
    digits.startsWith("0") && bumped.length < digits.length
      ? bumped.padStart(digits.length, "0")
      : bumped;

  return { next: prefix + next, from };
}

export async function invoiceRefUsed(warehouse: string, ref: string): Promise<Invoice | null> {
  return one<Invoice>(
    "SELECT * FROM invoices WHERE warehouse = $1 AND lower(ref) = lower($2) ORDER BY id DESC LIMIT 1",
    [warehouse, ref.trim()]
  );
}

export async function getInvoice(warehouse: string, id: number): Promise<Invoice | null> {
  return one<Invoice>("SELECT * FROM invoices WHERE warehouse = $1 AND id = $2", [warehouse, id]);
}

/** Create a delivery note and reduce stock for every line — all or nothing. */
export async function createInvoice(
  warehouse: string,
  input: { ref: string; customer: string; lines: InvoiceLine[] }
): Promise<number> {
  const ref = input.ref.trim();
  if (!ref) throw new AppError("Delivery note number is required");
  if (input.lines.length === 0) throw new AppError("Add at least one product");

  return transaction(async (client) => {
    // Check every line before touching anything, so one error names all the
    // problems. FOR UPDATE holds the rows until commit, so two notes going out
    // at once cannot both pass a check on the same last few units.
    const shortages: string[] = [];
    for (const line of input.lines) {
      const { rows } = await client.query<Product>(
        "SELECT * FROM products WHERE warehouse = $1 AND id = $2 FOR UPDATE",
        [warehouse, line.productId]
      );
      const product = rows[0];
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

    const created = await client.query<{ id: number }>(
      `INSERT INTO invoices (warehouse, ref, customer, status, created_at)
       VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
      [warehouse, ref, input.customer.trim(), now()]
    );
    const invoiceId = created.rows[0].id;

    for (const line of input.lines) {
      await client.query(
        "UPDATE products SET quantity = quantity - $1 WHERE warehouse = $2 AND id = $3",
        [line.quantity, warehouse, line.productId]
      );
      await logMovement(client, warehouse, line.productId, -line.quantity, "invoice", ref, invoiceId);
    }

    return invoiceId;
  });
}

/** Put every line's stock back. The note stays in history, marked cancelled. */
export async function cancelInvoice(warehouse: string, invoiceId: number): Promise<void> {
  await transaction(async (client) => {
    const found = await client.query<Invoice>(
      "SELECT * FROM invoices WHERE warehouse = $1 AND id = $2 FOR UPDATE",
      [warehouse, invoiceId]
    );
    const invoice = found.rows[0];

    if (!invoice) throw new AppError("Delivery note not found");
    if (invoice.status === "cancelled") throw new AppError("This delivery note is already cancelled");

    const { rows: lines } = await client.query<Movement>(
      "SELECT * FROM movements WHERE warehouse = $1 AND invoice_id = $2 AND undone = 0",
      [warehouse, invoiceId]
    );

    for (const line of lines) {
      // line.change is negative, so subtracting it adds the stock back.
      await client.query(
        "UPDATE products SET quantity = quantity - $1 WHERE warehouse = $2 AND id = $3",
        [line.change, warehouse, line.product_id]
      );
      await client.query("UPDATE movements SET undone = 1 WHERE id = $1", [line.id]);
    }

    await client.query(
      "UPDATE invoices SET status = 'cancelled', cancelled_at = $1 WHERE id = $2",
      [now(), invoiceId]
    );
  });
}

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

/** Every delivery note ever raised, newest first. Searchable by number or customer. */
export async function listInvoices(
  warehouse: string,
  options: { search?: string; limit?: number; offset?: number } = {}
): Promise<InvoiceSummary[]> {
  const search = (options.search ?? "").trim().toLowerCase();

  const rows = await query<InvoiceSummary>(
    `SELECT i.*,
            (SELECT count(*) FROM movements m WHERE m.invoice_id = i.id) AS lines,
            (SELECT COALESCE(sum(abs(m.change)), 0) FROM movements m WHERE m.invoice_id = i.id) AS units
     FROM invoices i
     WHERE i.warehouse = $1
       AND ($2 = '' OR lower(i.ref) LIKE $3 OR lower(i.customer) LIKE $3)
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT $4 OFFSET $5`,
    [warehouse, search, `%${search}%`, options.limit ?? 50, options.offset ?? 0]
  );

  return rows.map((row) => ({ ...row, lines: int(row.lines), units: int(row.units) }));
}

export async function countInvoices(warehouse: string, search = ""): Promise<number> {
  const trimmed = search.trim().toLowerCase();
  const row = await one<{ n: string }>(
    `SELECT count(*) AS n FROM invoices
     WHERE warehouse = $1 AND ($2 = '' OR lower(ref) LIKE $3 OR lower(customer) LIKE $3)`,
    [warehouse, trimmed, `%${trimmed}%`]
  );
  return int(row?.n);
}

/** One note with every line on it, including lines whose product was later hidden. */
export async function getInvoiceWithLines(
  warehouse: string,
  id: number
): Promise<{ invoice: Invoice; lines: MovementRow[]; units: number } | null> {
  const invoice = await getInvoice(warehouse, id);
  if (!invoice) return null;

  const lines = await query<MovementRow>(
    `SELECT m.*, p.name AS product_name, p.flavor AS product_flavor, p.brand AS product_brand,
            NULL AS invoice_ref, NULL AS invoice_status
     FROM movements m JOIN products p ON p.id = m.product_id
     WHERE m.warehouse = $1 AND m.invoice_id = $2
     ORDER BY m.id`,
    [warehouse, id]
  );

  return {
    invoice,
    lines,
    units: lines.reduce((total, line) => total + Math.abs(line.change), 0),
  };
}

/* ---------------------------------- history ---------------------------------- */

/**
 * The full movement log, newest first, one row per change. Note lines carry
 * their note number so History can link across to the stored document.
 */
export async function listMovements(
  warehouse: string,
  options: { limit?: number; offset?: number } = {}
): Promise<MovementRow[]> {
  return query<MovementRow>(
    `SELECT m.*, p.name AS product_name, p.flavor AS product_flavor, p.brand AS product_brand,
            i.ref AS invoice_ref, i.status AS invoice_status
     FROM movements m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN invoices i ON i.id = m.invoice_id
     WHERE m.warehouse = $1
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $2 OFFSET $3`,
    [warehouse, options.limit ?? 100, options.offset ?? 0]
  );
}

export async function countMovements(warehouse: string): Promise<number> {
  const row = await one<{ n: string }>("SELECT count(*) AS n FROM movements WHERE warehouse = $1", [
    warehouse,
  ]);
  return int(row?.n);
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
export async function planImport(
  warehouse: string,
  rows: ImportCandidate[],
  options: { hasQuantity: boolean; hasLowStock: boolean }
): Promise<PlannedRow[]> {
  // One query for the lot: 600 round trips to plan a 600-row import would make
  // the preview feel broken.
  const existing = await query<{
    id: number;
    brand: string;
    name: string;
    flavor: string;
    quantity: number;
    low_stock_at: number;
  }>(
    "SELECT id, brand, name, flavor, quantity, low_stock_at FROM products WHERE warehouse = $1",
    [warehouse]
  );

  const key = (brand: string, name: string, flavor: string) =>
    `${brand.toLowerCase()}|${name.toLowerCase()}|${flavor.toLowerCase()}`;

  const byKey = new Map(existing.map((p) => [key(p.brand, p.name, p.flavor), p]));

  return rows.map((row): PlannedRow => {
    const match = byKey.get(key(row.brand, row.name, row.flavor));
    if (!match) return { ...row, action: "add", existingId: null, currentQuantity: null };

    const quantityChanges = options.hasQuantity && row.quantity !== match.quantity;
    const lowChanges = options.hasLowStock && row.lowStockAt !== match.low_stock_at;

    return {
      ...row,
      action: quantityChanges || lowChanges ? "update" : "same",
      existingId: match.id,
      currentQuantity: match.quantity,
    };
  });
}

/**
 * Applies a planned import in one transaction. Columns missing from the file are
 * left alone on products that already exist — re-importing a catalogue with no
 * quantity column must never wipe the stock figures.
 */
export async function applyImport(
  warehouse: string,
  rows: PlannedRow[],
  options: { hasQuantity: boolean; hasLowStock: boolean }
): Promise<{ added: number; updated: number }> {
  return transaction(async (client) => {
    let added = 0;
    let updated = 0;

    for (const row of rows) {
      if (row.action === "same") continue;

      if (row.action === "add") {
        const { rows: created } = await client.query<{ id: number }>(
          `INSERT INTO products (warehouse, brand, name, flavor, quantity, low_stock_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [warehouse, row.brand, row.name, row.flavor, row.quantity, row.lowStockAt, now()]
        );
        const id = created[0].id;
        if (row.quantity !== 0) {
          await logMovement(client, warehouse, id, row.quantity, "new", "Excel import");
        }
        added++;
        continue;
      }

      if (!row.existingId) continue;

      if (options.hasLowStock) {
        await client.query("UPDATE products SET low_stock_at = $1 WHERE warehouse = $2 AND id = $3", [
          row.lowStockAt,
          warehouse,
          row.existingId,
        ]);
      }

      if (options.hasQuantity && row.currentQuantity !== null && row.quantity !== row.currentQuantity) {
        await client.query("UPDATE products SET quantity = $1 WHERE warehouse = $2 AND id = $3", [
          row.quantity,
          warehouse,
          row.existingId,
        ]);
        await logMovement(
          client,
          warehouse,
          row.existingId,
          row.quantity - row.currentQuantity,
          "adjust",
          "Excel import"
        );
      }

      updated++;
    }

    return { added, updated };
  });
}
