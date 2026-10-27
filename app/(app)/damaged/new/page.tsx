import type { Metadata } from "next";
import PageHeader from "@/components/page-header";
import { requireWarehouse } from "@/lib/auth";
import { getCreditNoteLines, listCreditNoteChoices } from "@/lib/queries";
import { CreditNotePicker, DamagedEntry } from "./damaged-form";

export const metadata: Metadata = { title: "Add damaged" };

export const dynamic = "force-dynamic";

export default async function NewDamagedPage({ searchParams }: PageProps<"/damaged/new">) {
  const warehouse = await requireWarehouse();
  const { note } = await searchParams;
  const id = Number(Array.isArray(note) ? note[0] : note);

  // A note in the address means it was already chosen — from here or from the
  // credit note's own page. One that is gone, cancelled or not a credit note
  // falls back to the picker rather than to an error.
  const chosen = Number.isInteger(id) && id > 0 ? await getCreditNoteLines(warehouse.key, id) : null;

  if (chosen) {
    return (
      <div className="md:max-w-lg">
        <PageHeader title="Add damaged" back="/damaged" subtitle={chosen.invoice.ref} />
        <DamagedEntry invoice={chosen.invoice} lines={chosen.lines} />
      </div>
    );
  }

  return (
    <div className="md:max-w-lg">
      <PageHeader title="Add damaged" back="/damaged" subtitle="Pick the credit note" />
      <CreditNotePicker choices={await listCreditNoteChoices(warehouse.key)} />
    </div>
  );
}
