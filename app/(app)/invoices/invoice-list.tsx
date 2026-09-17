"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { loadInvoicesAction } from "@/app/actions";
import { formatDay, formatTime } from "@/lib/format";
import type { InvoiceSummary } from "@/lib/queries";

const PAGE = 50;

export default function InvoiceList({
  initial,
  total: initialTotal,
}: {
  initial: InvoiceSummary[];
  total: number;
}) {
  const [search, setSearch] = useState("");
  const [invoices, setInvoices] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [pending, startTransition] = useTransition();
  const firstRender = useRef(true);

  // Searching goes back to the server so it covers every stored invoice,
  // not just the page already loaded.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await loadInvoicesAction(search, 0);
        if (result.ok) {
          setInvoices(result.invoices);
          setTotal(result.total);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  function loadMore() {
    startTransition(async () => {
      const result = await loadInvoicesAction(search, invoices.length);
      if (result.ok) {
        setInvoices((current) => [...current, ...result.invoices]);
        setTotal(result.total);
      }
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
            placeholder="Search note number or customer"
            aria-label="Search delivery notes"
            className="h-14 w-full rounded-2xl border border-line bg-surface pl-12 pr-4 outline-none
                       placeholder:text-muted focus:border-brand"
          />
        </div>

        <Link
          href="/invoice/new"
          className="flex shrink-0 items-center gap-2 rounded-2xl bg-brand px-5 font-semibold
                     text-white transition hover:opacity-90"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span className="hidden sm:inline">New</span>
        </Link>
      </div>

      <p className="mb-2 px-1 text-[14px] text-muted">
        {total === 0
          ? "No delivery notes yet"
          : `${total} delivery note${total === 1 ? "" : "s"}${search ? " found" : ""}`}
      </p>

      {invoices.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-[17px] font-semibold">{search ? "Nothing found" : "No delivery notes yet"}</p>
          <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-snug text-muted">
            {search
              ? "Try part of the note number or the customer name."
              : "Every delivery note you save is kept here permanently."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {invoices.map((invoice) => {
            const cancelled = invoice.status === "cancelled";

            return (
              <li key={invoice.id}>
                <Link
                  href={`/invoices/${invoice.id}`}
                  className="card flex items-center gap-3 px-4 py-3 transition hover:border-brand active:bg-page"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={`truncate font-semibold ${cancelled ? "text-muted line-through" : ""}`}
                      >
                        {invoice.ref}
                      </span>
                      {cancelled && (
                        <span className="shrink-0 rounded-md bg-danger-soft px-1.5 py-0.5 text-[12px] font-semibold text-danger">
                          Cancelled
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[14px] text-muted">
                      {invoice.customer || "No customer"} · {invoice.lines}{" "}
                      {invoice.lines === 1 ? "item" : "items"} · {invoice.units} units
                    </span>
                  </span>

                  <span className="shrink-0 text-right text-[13px] leading-tight text-muted">
                    <span className="block">{formatDay(invoice.created_at)}</span>
                    <span className="block tabular-nums">{formatTime(invoice.created_at)}</span>
                  </span>

                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-line"
                    aria-hidden="true"
                  >
                    <path d="m9 5 7 7-7 7" />
                  </svg>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {invoices.length < total && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="tap mt-3 w-full rounded-2xl border border-line bg-surface font-semibold
                     transition hover:border-brand hover:text-brand disabled:opacity-60"
        >
          {pending ? "Loading…" : `Show ${Math.min(PAGE, total - invoices.length)} more`}
        </button>
      )}
    </>
  );
}
