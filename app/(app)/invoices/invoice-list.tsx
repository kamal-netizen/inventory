"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { loadInvoicesAction } from "@/app/actions";
import { dayKey, formatDay, formatTime } from "@/lib/format";
import type { AuditSummary, InvoiceSummary } from "@/lib/queries";
import { PAGE } from "@/lib/types";

/** The first and last day of the month `offset` months from now, in TIMEZONE. */
function monthRange(offset: number): { from: string; to: string } {
  const [year, month] = dayKey(new Date().toISOString()).split("-").map(Number);
  const from = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 10);
  // Day 0 of next month is the last day of this one.
  const to = new Date(Date.UTC(year, month + offset, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export default function InvoiceList({
  initial,
  hasMore: initialHasMore,
  total: initialTotal,
}: {
  initial: InvoiceSummary[];
  hasMore: boolean;
  total: number;
}) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [invoices, setInvoices] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [total, setTotal] = useState(initialTotal);
  const [audit, setAudit] = useState<AuditSummary | null>(null);
  const [pending, startTransition] = useTransition();
  const firstRender = useRef(true);

  const ranged = Boolean(from || to);

  // Searching, or narrowing to a date range, goes back to the server so it
  // covers every stored invoice, not just the page already loaded.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        // A changed term or range is a different list, so this starts from no
        // cursor and is the one call that recounts.
        const result = await loadInvoicesAction(search, null, { from, to });
        if (result.ok) {
          setInvoices(result.invoices);
          setHasMore(result.hasMore);
          if (result.total !== null) setTotal(result.total);
          setAudit(result.audit);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [search, from, to]);

  /** Asks for what follows the last note on screen — see HistoryList.loadMore. */
  function loadMore() {
    const last = invoices[invoices.length - 1];
    if (!last) return;
    startTransition(async () => {
      const result = await loadInvoicesAction(
        search,
        { created_at: last.created_at, id: last.id },
        { from, to }
      );
      if (result.ok) {
        setInvoices((current) => [...current, ...result.invoices]);
        setHasMore(result.hasMore);
      }
    });
  }

  function pickMonth(offset: number) {
    const range = monthRange(offset);
    // Picking the same preset again is a no-op, not a way to clear it.
    if (range.from === from && range.to === to) return;
    setFrom(range.from);
    setTo(range.to);
  }

  function clearRange() {
    setFrom("");
    setTo("");
  }

  const remaining = Math.max(0, total - invoices.length);
  const thisMonth = monthRange(0);
  const lastMonth = monthRange(-1);

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

      {/* Chips scroll sideways on a phone rather than wrapping the row in two. */}
      <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:overflow-visible md:px-0">
        <label className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[14px] font-medium">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="From date"
            className="bg-transparent outline-none"
          />
        </label>
        <label className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[14px] font-medium">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            aria-label="To date"
            className="bg-transparent outline-none"
          />
        </label>

        {(
          [
            ["This month", thisMonth, 0],
            ["Last month", lastMonth, -1],
          ] as const
        ).map(([label, range, offset]) => (
          <button
            key={label}
            type="button"
            onClick={() => pickMonth(offset)}
            aria-pressed={from === range.from && to === range.to}
            className={`h-10 shrink-0 rounded-xl px-3 text-[14px] font-medium transition ${
              from === range.from && to === range.to
                ? "bg-brand-soft text-brand"
                : "border border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}

        {ranged && (
          <button
            type="button"
            onClick={clearRange}
            className="flex h-10 shrink-0 items-center rounded-lg px-2 text-[13px] font-medium
                       text-muted transition hover:bg-surface hover:text-ink"
          >
            Clear dates
          </button>
        )}
      </div>

      {audit && (
        <div className="card mb-3 p-4">
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
            For this range
          </p>
          <dl className="space-y-1.5 text-[15px]">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Out on delivery notes</dt>
              <dd className="tabular-nums">{audit.out}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">In — credits &amp; receiving</dt>
              <dd className="tabular-nums">{audit.in}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Damaged</dt>
              <dd className="tabular-nums text-danger">{audit.damaged}</dd>
            </div>
            <div className="flex justify-between gap-2 border-t border-line pt-1.5">
              <dt className="font-medium">Net change</dt>
              <dd className="font-medium tabular-nums">
                {audit.net > 0 ? "+" : ""}
                {audit.net}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[13px] text-muted">
            {audit.deliveryNotes} delivery note{audit.deliveryNotes === 1 ? "" : "s"} ·{" "}
            {audit.creditNotes} credit note{audit.creditNotes === 1 ? "" : "s"} raised in range
          </p>
        </div>
      )}

      <p className="mb-2 px-1 text-[14px] text-muted">
        {total === 0
          ? ranged
            ? "No delivery notes in range"
            : "No delivery notes yet"
          : `${total} delivery note${total === 1 ? "" : "s"}${search ? " found" : ranged ? " in range" : ""}`}
      </p>

      {invoices.length === 0 ? (
        <div className="card px-6 py-12 text-center">
          <p className="text-[17px] font-semibold">
            {search ? "Nothing found" : ranged ? "Nothing in that range" : "No delivery notes yet"}
          </p>
          <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-snug text-muted">
            {search
              ? "Try part of the note number or the customer name."
              : ranged
                ? "Try a wider range of dates."
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
                      {invoice.kind === "credit" && (
                        <span className="shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 text-[12px] font-semibold text-brand">
                          Credit
                        </span>
                      )}
                      {cancelled && (
                        <span className="shrink-0 rounded-md bg-danger-soft px-1.5 py-0.5 text-[12px] font-semibold text-danger">
                          Cancelled
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[14px] text-muted">
                      {invoice.customer || "No customer"} · {invoice.lines}{" "}
                      {invoice.lines === 1 ? "item" : "items"} · {invoice.units}{" "}
                      {invoice.kind === "credit" ? "units back" : "units"}
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

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="tap mt-3 w-full rounded-2xl border border-line bg-surface font-semibold
                     transition hover:border-brand hover:text-brand disabled:opacity-60"
        >
          {pending
            ? "Loading…"
            : remaining > 0
              ? `Show ${Math.min(PAGE, remaining)} more`
              : "Show more"}
        </button>
      )}
    </>
  );
}
