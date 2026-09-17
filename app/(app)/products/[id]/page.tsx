import { notFound } from "next/navigation";
import PageHeader from "@/components/page-header";
import ProductForm from "@/components/product-form";
import { requireWarehouse } from "@/lib/auth";
import { getProduct, listBrands } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: PageProps<"/products/[id]">) {
  const warehouse = await requireWarehouse();
  const { id } = await params;

  const product = getProduct(warehouse.key, Number(id));
  if (!product) notFound();

  return (
    <div className="md:max-w-lg">
      <PageHeader title={product.name} subtitle={product.brand || "Edit product"} />
      <ProductForm product={product} brands={listBrands(warehouse.key)} />
    </div>
  );
}
