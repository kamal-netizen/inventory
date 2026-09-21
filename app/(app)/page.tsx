import { requireWarehouse } from "@/lib/auth";
import { listProducts } from "@/lib/queries";
import StockList from "./stock-list";

export const dynamic = "force-dynamic";

// No metadata export: this route shows the root layout's title.default, "Stock".
// A `title` here would be decorated by the template into "Stock · Stock".

export default async function StockPage() {
  const warehouse = await requireWarehouse();
  return <StockList products={await listProducts(warehouse.key)} />;
}
