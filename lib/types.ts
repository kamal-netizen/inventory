export interface Product {
  id: number;
  warehouse: string;
  brand: string;
  name: string;
  flavor: string;
  quantity: number;
  low_stock_at: number;
  hidden: number;
  created_at: string;
}

export interface Invoice {
  id: number;
  warehouse: string;
  ref: string;
  customer: string;
  status: "active" | "cancelled";
  created_at: string;
  cancelled_at: string | null;
}

/** Why the stock changed. Drives the wording and icon shown in History. */
export type Reason = "new" | "in" | "out" | "invoice" | "adjust" | "cancel" | "undo";

export interface Movement {
  id: number;
  warehouse: string;
  product_id: number;
  change: number;
  reason: Reason;
  ref: string;
  invoice_id: number | null;
  undone: number;
  created_at: string;
}

export interface InvoiceLine {
  productId: number;
  quantity: number;
}

/* --------------------------------- paging --------------------------------- */

/** Rows per page. Shared so "Show more" means the same thing on every list. */
export const PAGE = 50;

/**
 * Where a page stopped, for keyset paging.
 *
 * Both paged lists are ordered (created_at DESC, id DESC) and grow at the head,
 * so OFFSET shifts underneath the reader: record one movement while History is
 * open, press Show more, and the next page repeats a row already on screen —
 * with a duplicate React key and two Undo buttons for one movement. A cursor
 * names the last row seen instead, and stays right however much arrives above.
 *
 * `created_at` is TEXT holding an ISO 8601 stamp from now(). That sorts
 * lexicographically in the same order it sorts chronologically, so comparing it
 * as text is not a shortcut — it is the comparison ORDER BY is already making.
 */
export interface Cursor {
  created_at: string;
  id: number;
}

/**
 * A page of rows and whether another exists.
 *
 * `hasMore` comes from reading one row past the page rather than from a second
 * COUNT, so the button can never disagree with what a click would deliver.
 */
export interface Page<T> {
  rows: T[];
  hasMore: boolean;
}
