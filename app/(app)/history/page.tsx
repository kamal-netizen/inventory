import { requireWarehouse } from "@/lib/auth";
import { countMovements, listMovements } from "@/lib/queries";
import HistoryList from "./history-list";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const warehouse = await requireWarehouse();
  const first = await listMovements(warehouse.key);
  return (
    <div className="md:max-w-3xl">
      <h1 className="mb-4 text-[19px] font-semibold md:text-[22px]">History</h1>
      <HistoryList
        initial={first.rows}
        hasMore={first.hasMore}
        total={await countMovements(warehouse.key)}
      />
    </div>
  );
}
