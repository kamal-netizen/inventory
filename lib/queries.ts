import "server-only";
import { cache } from "react";
import type { PoolClient } from "pg";
import { now, one, query, transaction } from "./db";
import { PAGE, type Cursor, type Invoice, type InvoiceLine, type Movement, type Page, type Product, type Reason } from "./types";

/**
 * The WHERE fragment that walks a (created_at DESC, id DESC) list.
 *
 * Postgres compares row values left to right, so this is one expression rather
 * than the created_at < x OR (created_at = x AND id < y) it replaces. When there
 * is no cursor both parameters are null, the first test is true and the whole
 * clause falls away — so the first page and every page after it run one query.
 */
const AFTER = (ts: string, id: string, col: string) =>
  `(${ts}::text IS NULL OR (${col}.created_at, ${col}.id) < (${ts}::text, ${id}::int))`;

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
  const rows = await query<Product>(
    `SELECT p.*,
            (SELECT COALESCE(sum(d.quantity), 0) FROM damaged d WHERE d.product_id = p.id) AS damaged
     FROM products p
     WHERE p.warehouse = $1 AND p.hidden = 0
       AND ($2 = '' OR lower(p.name) LIKE $3 OR lower(p.flavor) LIKE $3 OR lower(p.brand) LIKE $3)
     ORDER BY (p.low_stock_at > 0 AND p.quantity <= p.low_stock_at) DESC,
              lower(p.brand), lower(p.name), lower(p.flavor)`,
    [warehouse, term, `%${term}%`]
  );
  // sum() arrives as a string, like every aggregate here.
  return rows.map((row) => ({ ...row, damaged: int(row.damaged) }));
}

/**
 * Memoised for the length of one request.
 *
 * generateMetadata and the page it titles both need this row, and nothing else
 * in this project caches anything — without cache() the same SELECT would run
 * twice for every view of the product form.
 */
export const getProduct = cache(
  async (warehouse: string, id: number): Promise<Product | null> =>
    one<Product>("SELECT * FROM products WHERE warehouse = $1 AND id = $2", [warehouse, id])
);

/** Distinct brands already in use, for the brand picker on the product form. */
export async function listBrands(warehouse: string): Promise<string[]> {
  const rows = await query<{ brand: string }>(
    // GROUP BY rather than DISTINCT, and not a matter of taste: Postgres
    // requires every ORDER BY expression of a SELECT DISTINCT to appear in the
    // select list, so ordering by lower(brand) while selecting brand is a
    // 42P10. SQLite allowed it, which is why it survived the move and only
    // broke once a warehouse had brands to list. Grouping states the same
    // intent and lets the sort use an expression over the grouped column.
    `SELECT brand FROM products
     WHERE warehouse = $1 AND hidden = 0 AND brand <> ''
     GROUP BY brand
     ORDER BY lower(brand)`,
    [warehouse]
  );
  return rows.map((row) => row.brand);
}

/**
 * Batch number and expiry are optional: blank is stored as blank. An expiry
 * that is present must be a real calendar date, since it is compared as text.
 */
function cleanBatch(input: { batchNo?: string; expiry?: string }): { batchNo: string; expiry: string } {
  const batchNo = (input.batchNo ?? "").trim().slice(0, 80);
  const expiry = (input.expiry ?? "").trim();
  if (expiry) {
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(expiry) &&
      new Date(`${expiry}T00:00:00Z`).toISOString().startsWith(expiry);
    if (!valid) throw new AppError("Expiry date is not a valid date");
  }
  return { batchNo, expiry };
}

export async function createProduct(
  warehouse: string,
  input: {
    brand?: string;
    name: string;
    flavor: string;
    quantity: number;
    lowStockAt: number;
    batchNo?: string;
    expiry?: string;
  }
): Promise<number> {
  const name = input.name.trim();
  if (!name) throw new AppError("Product name is required");
  const { batchNo, expiry } = cleanBatch(input);

  return transaction(async (client) => {
    let id: number;
    try {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO products
           (warehouse, brand, name, flavor, quantity, low_stock_at, batch_no, expiry, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          warehouse,
          (input.brand ?? "").trim(),
          name,
          input.flavor.trim(),
          input.quantity,
          input.lowStockAt,
          batchNo,
          expiry,
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
  input: {
    brand?: string;
    name: string;
    flavor: string;
    lowStockAt: number;
    quantity?: number;
    /** Units received, added to whatever is on the shelf when this runs. */
    addStock?: number;
    batchNo?: string;
    expiry?: string;
  }
): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new AppError("Product name is required");
  const { batchNo, expiry } = cleanBatch(input);

  await transaction(async (client) => {
    const { rows } = await client.query<Product>(
      "SELECT * FROM products WHERE warehouse = $1 AND id = $2",
      [warehouse, id]
    );
    const product = rows[0];
    if (!product) throw new AppError("Product not found");

    try {
      await client.query(
        `UPDATE products
         SET brand = $1, name = $2, flavor = $3, low_stock_at = $4, batch_no = $5, expiry = $6
         WHERE warehouse = $7 AND id = $8`,
        [
          (input.brand ?? product.brand).trim(),
          name,
          input.flavor.trim(),
          input.lowStockAt,
          batchNo,
          expiry,
          warehouse,
          id,
        ]
      );
    } catch (err) {
      if (isDuplicate(err)) {
        throw new AppError("Another product already has that brand, name and flavour");
      }
      throw err;
    }

    // Added in SQL rather than computed from a number the form read earlier, so
    // a delivery note saved in between is not overwritten.
    if (input.addStock) {
      if (!Number.isInteger(input.addStock) || input.addStock < 0) {
        throw new AppError("Stock to add must be a whole number");
      }
      await client.query(
        "UPDATE products SET quantity = quantity + $1 WHERE warehouse = $2 AND id = $3",
        [input.addStock, warehouse, id]
      );
      await logMovement(client, warehouse, id, input.addStock, "in", "Added from product page");
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
    if (movement.reason === "damage") {
      throw new AppError("Take it off the Damaged list instead");
    }

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
export async function nextRef(
  warehouse: string,
  kind: "delivery" | "credit" = "delivery"
): Promise<{ next: string; from: string }> {
  // Each kind carries on its own run: credit note 12 follows credit note 11,
  // not whichever delivery note happened to be saved last.
  const row = await one<{ ref: string }>(
    "SELECT ref FROM invoices WHERE warehouse = $1 AND kind = $2 ORDER BY id DESC LIMIT 1",
    [warehouse, kind]
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

export async function invoiceRefUsed(
  warehouse: string,
  ref: string,
  kind: "delivery" | "credit" = "delivery"
): Promise<Invoice | null> {
  return one<Invoice>(
    `SELECT * FROM invoices WHERE warehouse = $1 AND lower(ref) = lower($2) AND kind = $3
     ORDER BY id DESC LIMIT 1`,
    [warehouse, ref.trim(), kind]
  );
}

/**
 * Memoised per request, like getProduct.
 *
 * getInvoiceWithLines calls this too, so the note's title and the note itself
 * come from one round trip even though they are fetched by different code.
 */
export const getInvoice = cache(
  async (warehouse: string, id: number): Promise<Invoice | null> =>
    one<Invoice>("SELECT * FROM invoices WHERE warehouse = $1 AND id = $2", [warehouse, id])
);

/**
 * Create a delivery note (stock out) or a credit note (returned stock back in)
 * for every line — all or nothing.
 */
export async function createInvoice(
  warehouse: string,
  input: { ref: string; customer: string; lines: InvoiceLine[]; kind?: "delivery" | "credit" }
): Promise<number> {
  const kind = input.kind === "credit" ? "credit" : "delivery";
  // +1 puts stock back, -1 takes it out.
  const direction = kind === "credit" ? 1 : -1;
  const ref = input.ref.trim();
  if (!ref) {
    throw new AppError(
      kind === "credit" ? "Credit note number is required" : "Delivery note number is required"
    );
  }
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
      // Returned stock can always be taken back; only going out can run short.
      if (kind === "delivery" && line.quantity > product.quantity) {
        const label = product.flavor ? `${product.name} · ${product.flavor}` : product.name;
        shortages.push(`${label} — only ${product.quantity} left`);
      }
    }
    if (shortages.length > 0) {
      throw new AppError(`Not enough stock:\n${shortages.join("\n")}`);
    }

    const created = await client.query<{ id: number }>(
      `INSERT INTO invoices (warehouse, ref, customer, status, kind, created_at)
       VALUES ($1, $2, $3, 'active', $4, $5) RETURNING id`,
      [warehouse, ref, input.customer.trim(), kind, now()]
    );
    const invoiceId = created.rows[0].id;

    for (const line of input.lines) {
      await client.query(
        "UPDATE products SET quantity = quantity + $1 WHERE warehouse = $2 AND id = $3",
        [direction * line.quantity, warehouse, line.productId]
      );
      await logMovement(
        client,
        warehouse,
        line.productId,
        direction * line.quantity,
        kind === "credit" ? "credit" : "invoice",
        ref,
        invoiceId
      );
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
      // Cancelling a delivery note adds stock back; cancelling a credit note
      // takes it out again, which is only possible if it is still on the shelf.
      const held = await client.query<Product>(
        "SELECT * FROM products WHERE warehouse = $1 AND id = $2 FOR UPDATE",
        [warehouse, line.product_id]
      );
      const product = held.rows[0];

      // Units already set aside as damaged left stock when they were listed, so
      // only the rest still has to come out now.
      const asideRow = await client.query<{ n: string }>(
        `SELECT COALESCE(sum(quantity), 0) AS n FROM damaged
         WHERE warehouse = $1 AND invoice_id = $2 AND product_id = $3`,
        [warehouse, invoiceId, line.product_id]
      );
      const reverse = line.change - int(asideRow.rows[0]?.n);

      if (product && product.quantity - reverse < 0) {
        const label = product.flavor ? `${product.name} · ${product.flavor}` : product.name;
        throw new AppError(
          `Cannot cancel — ${label} has only ${product.quantity} in stock, but ${reverse} of what came back on this credit note should still be there`
        );
      }

      // line.change is negative for a delivery, so subtracting it adds the stock back.
      await client.query(
        "UPDATE products SET quantity = quantity - $1 WHERE warehouse = $2 AND id = $3",
        [reverse, warehouse, line.product_id]
      );
      await client.query("UPDATE movements SET undone = 1 WHERE id = $1", [line.id]);
    }

    // The note is void, so whatever was kept aside against it goes with it.
    await client.query("DELETE FROM damaged WHERE warehouse = $1 AND invoice_id = $2", [
      warehouse,
      invoiceId,
    ]);

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
  options: { search?: string; limit?: number; after?: Cursor | null } = {}
): Promise<Page<InvoiceSummary>> {
  const search = (options.search ?? "").trim().toLowerCase();
  const limit = options.limit ?? PAGE;
  const after = options.after ?? null;

  // One row past the page, so hasMore is observed rather than counted.
  const rows = await query<InvoiceSummary>(
    `SELECT i.*,
            (SELECT count(*) FROM movements m WHERE m.invoice_id = i.id) AS lines,
            (SELECT COALESCE(sum(abs(m.change)), 0) FROM movements m WHERE m.invoice_id = i.id) AS units
     FROM invoices i
     WHERE i.warehouse = $1
       AND ($2 = '' OR lower(i.ref) LIKE $3 OR lower(i.customer) LIKE $3)
       AND ${AFTER('$4', '$5', 'i')}
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT $6`,
    [warehouse, search, `%${search}%`, after?.created_at ?? null, after?.id ?? null, limit + 1]
  );

  return {
    rows: rows
      .slice(0, limit)
      .map((row) => ({ ...row, lines: int(row.lines), units: int(row.units) })),
    hasMore: rows.length > limit,
  };
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

/* ---------------------------------- damaged ---------------------------------- */

export interface DamagedRow {
  id: number;
  quantity: number;
  created_at: string;
  product_id: number;
  product_name: string;
  product_flavor: string;
  product_brand: string;
  invoice_id: number;
  invoice_ref: string;
  invoice_customer: string;
  invoice_status: string;
}

/** Everything kept aside, newest first. Small enough to search in the browser. */
export async function listDamaged(warehouse: string): Promise<DamagedRow[]> {
  const rows = await query<DamagedRow>(
    `SELECT d.id, d.quantity, d.created_at, d.product_id,
            p.name AS product_name, p.flavor AS product_flavor, p.brand AS product_brand,
            d.invoice_id, i.ref AS invoice_ref, i.customer AS invoice_customer,
            i.status AS invoice_status
     FROM damaged d
     JOIN products p ON p.id = d.product_id
     JOIN invoices i ON i.id = d.invoice_id
     WHERE d.warehouse = $1
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT 2000`,
    [warehouse]
  );
  return rows.map((row) => ({ ...row, quantity: int(row.quantity) }));
}

export interface CreditNoteChoice {
  id: number;
  ref: string;
  customer: string;
  created_at: string;
  units: number;
}

/** Credit notes still standing, newest first, for picking the one the damage belongs to. */
export async function listCreditNoteChoices(warehouse: string): Promise<CreditNoteChoice[]> {
  const rows = await query<CreditNoteChoice>(
    `SELECT i.id, i.ref, i.customer, i.created_at,
            (SELECT COALESCE(sum(m.change), 0) FROM movements m
             WHERE m.invoice_id = i.id AND m.undone = 0) AS units
     FROM invoices i
     WHERE i.warehouse = $1 AND i.kind = 'credit' AND i.status = 'active'
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT 300`,
    [warehouse]
  );
  return rows.map((row) => ({ ...row, units: int(row.units) }));
}

export interface CreditLine {
  product_id: number;
  product_name: string;
  product_flavor: string;
  product_brand: string;
  /** Came back on the note. */
  returned: number;
  /** Already kept aside against it. */
  damaged: number;
}

/** One credit note with what came back on it and how much of that is already set aside. */
export async function getCreditNoteLines(
  warehouse: string,
  id: number
): Promise<{ invoice: Invoice; lines: CreditLine[] } | null> {
  const invoice = await getInvoice(warehouse, id);
  if (!invoice || invoice.kind !== "credit" || invoice.status !== "active") return null;

  const lines = await query<CreditLine>(
    `SELECT m.product_id, p.name AS product_name, p.flavor AS product_flavor,
            p.brand AS product_brand, sum(m.change) AS returned,
            (SELECT COALESCE(sum(d.quantity), 0) FROM damaged d
             WHERE d.invoice_id = m.invoice_id AND d.product_id = m.product_id) AS damaged
     FROM movements m JOIN products p ON p.id = m.product_id
     WHERE m.warehouse = $1 AND m.invoice_id = $2 AND m.undone = 0
     GROUP BY m.product_id, p.name, p.flavor, p.brand, m.invoice_id
     ORDER BY min(m.id)`,
    [warehouse, id]
  );

  return {
    invoice,
    lines: lines.map((line) => ({
      ...line,
      returned: int(line.returned),
      damaged: int(line.damaged),
    })),
  };
}

/**
 * Keep units aside as damaged against a credit note.
 *
 * They came back with the note, so they are already in the product's quantity;
 * this takes them out again. A line cannot set aside more than came back on the
 * note, nor more than is on the shelf now — all or nothing.
 */
export async function createDamaged(
  warehouse: string,
  invoiceId: number,
  lines: InvoiceLine[]
): Promise<void> {
  const wanted = lines.filter((line) => line.quantity > 0);
  if (wanted.length === 0) throw new AppError("Enter how many are damaged");

  await transaction(async (client) => {
    const found = await client.query<Invoice>(
      "SELECT * FROM invoices WHERE warehouse = $1 AND id = $2 FOR UPDATE",
      [warehouse, invoiceId]
    );
    const invoice = found.rows[0];
    if (!invoice || invoice.kind !== "credit") throw new AppError("Credit note not found");
    if (invoice.status === "cancelled") throw new AppError("That credit note is cancelled");

    const problems: string[] = [];

    for (const line of wanted) {
      if (!Number.isInteger(line.quantity)) throw new AppError("Damaged units must be a whole number");

      const held = await client.query<Product>(
        "SELECT * FROM products WHERE warehouse = $1 AND id = $2 FOR UPDATE",
        [warehouse, line.productId]
      );
      const product = held.rows[0];
      if (!product) throw new AppError("A product on this credit note no longer exists");
      const label = product.flavor ? `${product.name} · ${product.flavor}` : product.name;

      const sums = await client.query<{ returned: string; damaged: string }>(
        `SELECT
           (SELECT COALESCE(sum(change), 0) FROM movements
            WHERE warehouse = $1 AND invoice_id = $2 AND product_id = $3 AND undone = 0) AS returned,
           (SELECT COALESCE(sum(quantity), 0) FROM damaged
            WHERE warehouse = $1 AND invoice_id = $2 AND product_id = $3) AS damaged`,
        [warehouse, invoiceId, line.productId]
      );
      const returned = int(sums.rows[0].returned);
      const open = returned - int(sums.rows[0].damaged);

      if (returned === 0) {
        problems.push(`${label} is not on this credit note`);
      } else if (line.quantity > open) {
        problems.push(`${label} — only ${open} of ${returned} left to mark as damaged`);
      } else if (line.quantity > product.quantity) {
        problems.push(`${label} — only ${product.quantity} in stock now`);
      }
    }
    if (problems.length > 0) throw new AppError(problems.join("\n"));

    for (const line of wanted) {
      await client.query(
        `INSERT INTO damaged (warehouse, product_id, invoice_id, quantity, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [warehouse, line.productId, invoiceId, line.quantity, now()]
      );
      await client.query(
        "UPDATE products SET quantity = quantity - $1 WHERE warehouse = $2 AND id = $3",
        [line.quantity, warehouse, line.productId]
      );
      await logMovement(client, warehouse, line.productId, -line.quantity, "damage", invoice.ref);
    }
  });
}

/** A damaged entry made by mistake: the units go back into stock. */
export async function removeDamaged(warehouse: string, id: number): Promise<void> {
  await transaction(async (client) => {
    const found = await client.query<{
      product_id: number;
      quantity: number;
      ref: string;
    }>(
      `SELECT d.product_id, d.quantity, i.ref
       FROM damaged d JOIN invoices i ON i.id = d.invoice_id
       WHERE d.warehouse = $1 AND d.id = $2 FOR UPDATE OF d`,
      [warehouse, id]
    );
    const entry = found.rows[0];
    if (!entry) throw new AppError("That damaged entry was already removed");

    await client.query("DELETE FROM damaged WHERE id = $1", [id]);
    await client.query(
      "UPDATE products SET quantity = quantity + $1 WHERE warehouse = $2 AND id = $3",
      [entry.quantity, warehouse, entry.product_id]
    );
    await logMovement(
      client,
      warehouse,
      entry.product_id,
      entry.quantity,
      "damage",
      `${entry.ref} · taken off damaged`
    );
  });
}

/* ---------------------------------- history ---------------------------------- */

/**
 * The full movement log, newest first, one row per change. Note lines carry
 * their note number so History can link across to the stored document.
 */
export async function listMovements(
  warehouse: string,
  options: { limit?: number; after?: Cursor | null } = {}
): Promise<Page<MovementRow>> {
  const limit = options.limit ?? PAGE;
  const after = options.after ?? null;

  // One row past the page, so hasMore is observed rather than counted.
  const rows = await query<MovementRow>(
    `SELECT m.*, p.name AS product_name, p.flavor AS product_flavor, p.brand AS product_brand,
            i.ref AS invoice_ref, i.status AS invoice_status
     FROM movements m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN invoices i ON i.id = m.invoice_id
     WHERE m.warehouse = $1
       AND ${AFTER('$2', '$3', 'm')}
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $4`,
    [warehouse, after?.created_at ?? null, after?.id ?? null, limit + 1]
  );

  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
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
