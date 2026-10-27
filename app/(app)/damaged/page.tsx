import type { Metadata } from "next";
import { requireWarehouse } from "@/lib/auth";
import { listDamaged } from "@/lib/queries";
import DamagedList from "./damaged-list";

export const metadata: Metadata = { title: "Damaged" };

export const dynamic = "force-dynamic";

export default async function DamagedPage() {
  const warehouse = await requireWarehouse();
  return (
    <div className="md:max-w-3xl">
      <h1 className="mb-4 text-[19px] font-semibold md:text-[22px]">Damaged</h1>
      <DamagedList rows={await listDamaged(warehouse.key)} />
    </div>
  );
}
