"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadHistoryAction, undoMovementAction } from "@/app/actions";
import { useToast } from "@/components/toast";
import { dayKey, formatFullDate, formatTime, productLabel } from "@/lib/format";
import type { MovementRow } from "@/lib/queries";
import { PAGE } from "@/lib/types";

const REASON_LABEL: Record<string, string> = {
  new: "Added to list",
  in: "Stock in",
  out: "Stock out",
  adjust: "Adjusted",
  invoice: "Delivery note",
};

export default function HistoryList({
  initial,
  hasMore: initialHasMore,
  total,
}: {
  initial: MovementRow[];
  hasMore: boolean;
  total: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [movements, setMovements] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [pending, startTransition] = useTransition();

  /**
   * Asks for what follows the last row on screen, rather than for an offset.
   *
   * Every stock change writes a movement, including one made on another device,
   * so the list can grow at the head between render and this click. An offset
   * would then hand back a row already above it — the same id twice, and two
   * Undo buttons for one movement. A cursor cannot drift that way.
   */
  function loadMore() {
    const last = movements[movements.length - 1];
    if (!last) return;
    startTransition(async () => {
      const result = await loadHistoryAction({ created_at: last.created_at, id: last.id });
      if (result.ok) {
        setMovements((current) => [...current, ...result.movements]);
        setHasMore(result.hasMore);
      } else {
        toast({ message: result.error, tone: "error" });
      }
    });
  }

  function undo(movementId: number) {
    startTransition(async () => {
      const result = await undoMovementAction(movementId);
      toast(result.ok ? { message: "Undone" } : { message: result.error, tone: "error" });
      if (result.ok) {
        setMovements((current) =>
          current.map((row) => (row.id === movementId ? { ...row, undone: 1 } : row))
        );
      }
      router.refresh();
    });
  }

  if (movements.length === 0) {
    return (
      <div className="card mt-2 px-6 py-12 text-center">
        <p className="text-[17px] font-semibold">Nothing yet</p>
        <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-snug text-muted">
          Every stock change and delivery note line will show up here, permanently.
        </p>
      </div>
    );
  }

  // Walk the loaded rows into day sections; they already arrive newest first.
  const days: { key: string; at: string; rows: MovementRow[] }[] = [];
  for (const row of movements) {
    const key = dayKey(row.created_at);
    const last = days[days.length - 1];
    if (last?.key === key) last.rows.push(row);
    else days.push({ key, at: row.created_at, rows: [row] });
  }

  // The count came with the page and only labels the button; whether there is
  // another page is hasMore, which the server observed. If rows arrived since,
  // the label says "Show more" rather than claiming a number it cannot know.
  const remaining = Math.max(0, total - movements.length);

  return (
    <>
      <p className="mb-2 px-1 text-[14px] text-muted">
        {total} change{total === 1 ? "" : "s"} recorded
      </p>

      {days.map((day) => (
        <section key={day.key} className="mb-5">
          <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">
            {formatFullDate(day.at)}
          </h2>

          <ul className="space-y-1.5">
            {day.rows.map((row) => {
              const undone = row.undone === 1;
              const positive = row.change > 0;
              const fromInvoice = Boolean(row.invoice_id);

              return (
                <li key={row.id} className="card flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    {row.product_brand && (
                      <span className="block truncate text-[12px] font-semibold uppercase tracking-wider text-muted">
                        {row.product_brand}
                      </span>
                    )}
                    <span
                      className={`block truncate font-medium ${undone ? "text-muted line-through" : ""}`}
                    >
                      {productLabel(row.product_name, row.product_flavor)}
                    </span>
                    <span className="mt-0.5 block truncate text-[14px] text-muted">
                      {fromInvoice && row.invoice_ref ? (
                        <>
                          <Link
                            href={`/invoices/${row.invoice_id}`}
                            className="font-medium text-brand hover:underline"
                          >
                            {row.invoice_ref}
                          </Link>
                          {row.invoice_status === "cancelled" && " · cancelled"}
                        </>
                      ) : (
                        <>
                          {REASON_LABEL[row.reason] ?? "Changed"}
                          {row.ref ? ` · ${row.ref}` : ""}
                        </>
                      )}
                      {" · "}
                      {formatTime(row.created_at)}
                    </span>
                  </span>

                  <span
                    className={`shrink-0 text-[17px] font-semibold tabular-nums ${
                      undone ? "text-muted" : positive ? "text-brand" : "text-ink"
                    }`}
                  >
                    {positive ? "+" : ""}
                    {row.change}
                  </span>

                  {!undone && !fromInvoice && (
                    <button
                      type="button"
                      onClick={() => undo(row.id)}
                      disabled={pending}
                      className="shrink-0 rounded-xl px-3 py-2 text-[14px] font-semibold text-muted
                                 transition hover:bg-page hover:text-ink disabled:opacity-50"
                    >
                      Undo
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="tap mt-1 w-full rounded-2xl border border-line bg-surface font-semibold
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
