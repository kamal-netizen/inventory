import { notFound } from "next/navigation";
import PageHeader from "@/components/page-header";
import { requireWarehouse } from "@/lib/auth";
import { getInvoiceWithLines } from "@/lib/queries";
import InvoiceDetail from "./invoice-detail";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const warehouse = await requireWarehouse();
  const { id } = await params;

  const found = getInvoiceWithLines(warehouse.key, Number(id));
  if (!found) notFound();

  return (
    <div className="md:max-w-2xl">
      <PageHeader title="Delivery note" back="/invoices" />
      <InvoiceDetail invoice={found.invoice} lines={found.lines} units={found.units} />
    </div>
  );
}
