import { requireWarehouse } from "@/lib/auth";
import { countMovements, listMovements } from "@/lib/queries";
import HistoryList from "./history-list";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const warehouse = await requireWarehouse();
  return (
    <div className="md:max-w-3xl">
      <h1 className="mb-4 text-[19px] font-semibold md:text-[22px]">History</h1>
      <HistoryList
        initial={listMovements(warehouse.key, { limit: 50 })}
        total={countMovements(warehouse.key)}
      />
    </div>
  );
}
