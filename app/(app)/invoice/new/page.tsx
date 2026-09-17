import PageHeader from "@/components/page-header";
import { requireWarehouse } from "@/lib/auth";
import { listProducts, nextRef } from "@/lib/queries";
import InvoiceForm from "./invoice-form";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const warehouse = await requireWarehouse();
  return (
    <>
      <PageHeader title="New delivery note" subtitle={warehouse.name} />
      <InvoiceForm
        products={listProducts(warehouse.key)}
        warehouseKey={warehouse.key}
        suggested={nextRef(warehouse.key)}
      />
    </>
  );
}
