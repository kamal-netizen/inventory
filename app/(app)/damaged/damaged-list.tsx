"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { removeDamagedAction } from "@/app/actions";
import Confirm from "@/components/confirm";
import { useToast } from "@/components/toast";
import { formatDay, productLabel } from "@/lib/format";
import type { DamagedRow } from "@/lib/queries";

/** Every typed word has to turn up in the product, credit note number or customer. */
function matches(row: DamagedRow, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [
    row.product_brand,
    row.product_name,
    row.product_flavor,
    row.invoice_ref,
    row.invoice_customer,
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

export default function DamagedList({ rows }: { rows: DamagedRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<DamagedRow | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => rows.filter((row) => matches(row, search)), [rows, search]);
  const totalUnits = rows.reduce((sum, row) => sum + row.quantity, 0);
  const visibleUnits = visible.reduce((sum, row) => sum + row.quantity, 0);

  function remove(row: DamagedRow) {
    startTransition(async () => {
      const result = await removeDamagedAction(row.id);
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      setRemoving(null);
      toast({ message: `${row.quantity} taken off damaged · back in stock` });
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-3 flex gap-2 md:gap-3">
        <div className="relative flex-1">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product, credit note or customer"
            aria-label="Search damaged products"
            className="h-14 w-full rounded-2xl border border-line bg-surface pl-12 pr-4 outline-none
                       placeholder:text-muted focus:border-brand"
          />
        </div>

        <Link
          href="/damaged/new"
          className="flex shrink-0 items-center gap-2 rounded-2xl bg-brand px-5 font-semibold
                     text-white transition hover:opacity-90"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className="hidden sm:inline">Add</span>
        </Link>
      </div>

      <p className="mb-2 px-1 text-[14px] text-muted">
        {rows.length === 0
          ? "Nothing kept aside"
          : search
            ? `${visibleUnits} damaged units in ${visible.length} of ${rows.length} entries`
            : `${totalUnits} damaged units in ${rows.length} ${rows.length === 1 ? "entry" : "entries"}`}
      </p>

      {visible.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-[17px] font-semibold">{search ? "Nothing found" : "No damaged products"}</p>
          <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-snug text-muted">
            {search
              ? "Try part of the product name, the credit note number or the customer."
              : "Damaged units from a credit note are kept here, out of your stock count."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => (
            <li key={row.id} className="card flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                {row.product_brand && (
                  <span className="block truncate text-[12px] font-semibold uppercase tracking-wider text-muted">
                    {row.product_brand}
                  </span>
                )}
                <span className="block break-words font-medium">
                  {productLabel(row.product_name, row.product_flavor)}
                </span>
                <span className="mt-0.5 block truncate text-[14px] text-muted">
                  <Link
                    href={`/invoices/${row.invoice_id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {row.invoice_ref}
                  </Link>
                  {row.invoice_customer && ` · ${row.invoice_customer}`}
                  {" · "}
                  {formatDay(row.created_at)}
                </span>
              </span>

              <span className="shrink-0 text-[24px] font-semibold tabular-nums">{row.quantity}</span>

              <button
                type="button"
                onClick={() => setRemoving(row)}
                className="shrink-0 rounded-xl px-3 py-2 text-[14px] font-semibold text-muted
                           transition hover:bg-page hover:text-ink"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {removing && (
        <Confirm
          title="Take off the damaged list?"
          body={`${removing.quantity} × ${productLabel(
            removing.product_name,
            removing.product_flavor
          )} go back into stock. Use this only if it was entered by mistake.`}
          cancelLabel="Keep it"
          confirmLabel="Put back in stock"
          pending={pending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
        />
      )}
    </>
  );
}
