"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDamagedAction } from "@/app/actions";
import { useToast } from "@/components/toast";
import { formatDay, productLabel } from "@/lib/format";
import type { CreditLine, CreditNoteChoice } from "@/lib/queries";
import type { Invoice } from "@/lib/types";

/** Step one: choose which credit note the damaged units came back on. */
export function CreditNotePicker({ choices }: { choices: CreditNoteChoice[] }) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return choices.filter((choice) => {
      const text = `${choice.ref} ${choice.customer}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [choices, search]);

  if (choices.length === 0) {
    return (
      <div className="card px-6 py-12 text-center">
        <p className="text-[17px] font-semibold">No credit notes yet</p>
        <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-snug text-muted">
          Damaged units are listed against a credit note. Save one on the Credit tab first.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="relative">
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
          placeholder="Search credit note number or customer"
          aria-label="Search credit notes"
          className="h-14 w-full rounded-2xl border border-line bg-surface pl-12 pr-4 outline-none
                     placeholder:text-muted focus:border-brand"
        />
      </div>

      {visible.length === 0 ? (
        <p className="mt-6 text-center text-[15px] text-muted">No credit note matches.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {visible.map((choice) => (
            <li key={choice.id}>
              <Link
                href={`/damaged/new?note=${choice.id}`}
                className="tap card flex items-center gap-3 px-4 py-3 transition hover:border-brand active:bg-page"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{choice.ref}</span>
                  <span className="mt-0.5 block truncate text-[14px] text-muted">
                    {choice.customer || "No customer"} · {choice.units} units back
                  </span>
                </span>
                <span className="shrink-0 text-[13px] text-muted">{formatDay(choice.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Step two: say how many of each product on that credit note are damaged. */
export function DamagedEntry({ invoice, lines }: { invoice: Invoice; lines: CreditLine[] }) {
  const router = useRouter();
  const toast = useToast();
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const entered = lines
    .map((line) => ({ line, quantity: Number(amounts[line.product_id] || 0) }))
    .filter((entry) => entry.quantity > 0);
  const total = entered.reduce((sum, entry) => sum + entry.quantity, 0);

  function save() {
    if (entered.length === 0) {
      setError("Enter how many are damaged");
      return;
    }

    startTransition(async () => {
      const result = await addDamagedAction({
        invoiceId: invoice.id,
        lines: entered.map((entry) => ({
          productId: entry.line.product_id,
          quantity: entry.quantity,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ message: `${total} damaged kept aside · ${invoice.ref}` });
      router.push("/damaged");
      router.refresh();
    });
  }

  return (
    <>
      <p className="mb-3 px-1 text-[14px] leading-snug text-muted">
        Damaged units come out of your stock count and are kept on the Damaged list.
      </p>

      <ul className="space-y-2">
        {lines.map((line) => {
          const open = line.returned - line.damaged;
          const value = amounts[line.product_id] ?? "";
          const tooMany = Number(value || 0) > open;

          return (
            <li key={line.product_id} className="card flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                {line.product_brand && (
                  <span className="block truncate text-[12px] font-semibold uppercase tracking-wider text-muted">
                    {line.product_brand}
                  </span>
                )}
                <span className="block break-words font-medium">
                  {productLabel(line.product_name, line.product_flavor)}
                </span>
                <span className={`mt-0.5 block text-[14px] ${tooMany ? "text-danger" : "text-muted"}`}>
                  {tooMany
                    ? `Only ${open} can be damaged`
                    : line.damaged > 0
                      ? `${line.returned} came back · ${line.damaged} already damaged`
                      : `${line.returned} came back`}
                </span>
              </span>

              <input
                value={value}
                onChange={(event) => {
                  setError("");
                  setAmounts((current) => ({
                    ...current,
                    [line.product_id]: event.target.value.replace(/\D/g, "").slice(0, 6),
                  }));
                }}
                inputMode="numeric"
                placeholder="0"
                disabled={open === 0}
                aria-label={`Damaged units of ${line.product_name}`}
                className="h-12 w-20 shrink-0 rounded-xl border border-line bg-surface px-3 text-center
                           text-[19px] font-semibold tabular-nums outline-none placeholder:text-muted
                           focus:border-brand disabled:bg-page disabled:opacity-50"
              />
            </li>
          );
        })}
      </ul>

      {error && (
        <p
          role="alert"
          className="mt-4 whitespace-pre-line rounded-2xl bg-danger-soft px-4 py-3 text-[15px] text-danger"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending || entered.length === 0}
        className="tap mt-4 w-full rounded-2xl bg-brand text-[17px] font-semibold text-white
                   transition hover:opacity-90 disabled:bg-line disabled:text-muted disabled:hover:opacity-100"
      >
        {entered.length === 0 ? "Save" : `Save — ${total} damaged`}
      </button>

      <Link
        href="/damaged/new"
        className="tap mt-2 flex w-full items-center justify-center rounded-2xl text-[15px] font-medium
                   text-muted transition hover:text-ink"
      >
        Choose a different credit note
      </Link>
    </>
  );
}
