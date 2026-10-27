import type { Metadata } from "next";
import PageHeader from "@/components/page-header";
import { requireWarehouse } from "@/lib/auth";
import { listProducts, nextRef } from "@/lib/queries";
import InvoiceForm from "../../invoice/new/invoice-form";

export const metadata: Metadata = { title: "New credit note" };

export const dynamic = "force-dynamic";

/** Stock coming back from a customer: the same form as a delivery note, the other way round. */
export default async function NewCreditNotePage() {
  const warehouse = await requireWarehouse();
  return (
    <>
      <PageHeader title="New credit note" subtitle={warehouse.name} />
      <InvoiceForm
        kind="credit"
        products={await listProducts(warehouse.key)}
        warehouseKey={warehouse.key}
        suggested={await nextRef(warehouse.key, "credit")}
      />
    </>
  );
}
