import { requireWarehouse } from "@/lib/auth";
import { countInvoices, listInvoices } from "@/lib/queries";
import InvoiceList from "./invoice-list";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const warehouse = await requireWarehouse();
  return (
    <div className="md:max-w-3xl">
      <h1 className="mb-4 text-[19px] font-semibold md:text-[22px]">Invoices</h1>
      <InvoiceList
        initial={listInvoices(warehouse.key, { limit: 50 })}
        total={countInvoices(warehouse.key)}
      />
    </div>
  );
}
