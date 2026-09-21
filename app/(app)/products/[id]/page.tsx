import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/page-header";
import ProductForm from "@/components/product-form";
import { getWarehouse, requireWarehouse } from "@/lib/auth";
import { getProduct, listBrands } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * getWarehouse rather than requireWarehouse: this runs before the layout has
 * redirected a signed-out visitor, and a title is not worth throwing over.
 * getProduct is memoised per request, so this shares the page's query.
 */
export async function generateMetadata({
  params,
}: PageProps<"/products/[id]">): Promise<Metadata> {
  const warehouse = await getWarehouse();
  if (!warehouse) return { title: "Product" };

  const { id } = await params;
  const product = await getProduct(warehouse.key, Number(id));
  return { title: product?.name ?? "Product" };
}

export default async function EditProductPage({ params }: PageProps<"/products/[id]">) {
  const warehouse = await requireWarehouse();
  const { id } = await params;

  const product = await getProduct(warehouse.key, Number(id));
  if (!product) notFound();

  return (
    <div className="md:max-w-lg">
      <PageHeader title={product.name} subtitle={product.brand || "Edit product"} />
      <ProductForm product={product} brands={await listBrands(warehouse.key)} />
    </div>
  );
}
