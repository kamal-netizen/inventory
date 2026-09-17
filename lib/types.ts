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
