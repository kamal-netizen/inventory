import PageHeader from "@/components/page-header";
import ProductForm from "@/components/product-form";
import { requireWarehouse } from "@/lib/auth";
import { listBrands } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const warehouse = await requireWarehouse();
  return (
    <div className="md:max-w-lg">
      <PageHeader title="Add product" />
      <ProductForm brands={await listBrands(warehouse.key)} />
    </div>
  );
}
