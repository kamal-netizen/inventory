import type { Metadata } from "next";
import { requireWarehouse } from "@/lib/auth";
import { countInvoices, listInvoices } from "@/lib/queries";
import InvoiceList from "./invoice-list";

export const metadata: Metadata = { title: "Delivery notes" };

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const warehouse = await requireWarehouse();
  const first = await listInvoices(warehouse.key);
  return (
    <div className="md:max-w-3xl">
      <h1 className="mb-4 text-[19px] font-semibold md:text-[22px]">Delivery notes</h1>
      <InvoiceList
        initial={first.rows}
        hasMore={first.hasMore}
        total={await countInvoices(warehouse.key)}
      />
    </div>
  );
}
