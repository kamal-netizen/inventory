import { requireWarehouse } from "@/lib/auth";
import { listProducts } from "@/lib/queries";
import StockList from "./stock-list";

export const dynamic = "force-dynamic";

// No metadata export: this route shows the root layout's title.default.

export default async function StockPage() {
  const warehouse = await requireWarehouse();
  return (
    <>
      <h1 className="mb-4 text-[22px] font-semibold leading-tight tracking-tight md:text-[24px]">Stock</h1>
      <StockList products={await listProducts(warehouse.key)} />
    </>
  );
}
