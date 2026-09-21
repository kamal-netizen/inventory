import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/page-header";
import { getWarehouse, requireWarehouse } from "@/lib/auth";
import { getInvoice, getInvoiceWithLines } from "@/lib/queries";
import InvoiceDetail from "./invoice-detail";

export const dynamic = "force-dynamic";

/**
 * The note number, which is what someone scanning their tabs is looking for.
 * Not the customer — that is a third party's name, and a title lands in browser
 * history. getInvoice is the cheap half of getInvoiceWithLines and memoised, so
 * this adds no query.
 */
export async function generateMetadata({
  params,
}: PageProps<"/invoices/[id]">): Promise<Metadata> {
  const warehouse = await getWarehouse();
  if (!warehouse) return { title: "Delivery note" };

  const { id } = await params;
  const invoice = await getInvoice(warehouse.key, Number(id));
  return { title: invoice ? `Delivery note ${invoice.ref}` : "Delivery note" };
}

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const warehouse = await requireWarehouse();
  const { id } = await params;

  const found = await getInvoiceWithLines(warehouse.key, Number(id));
  if (!found) notFound();

  return (
    <div className="md:max-w-2xl">
      <PageHeader title="Delivery note" back="/invoices" />
      <InvoiceDetail invoice={found.invoice} lines={found.lines} units={found.units} />
    </div>
  );
}
