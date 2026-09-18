import { requireWarehouse } from "@/lib/auth";
import { listProducts } from "@/lib/queries";
import StockList from "./stock-list";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const warehouse = await requireWarehouse();
  return <StockList products={await listProducts(warehouse.key)} />;
}
