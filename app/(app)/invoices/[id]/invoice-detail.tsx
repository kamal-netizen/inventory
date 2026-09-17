"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelInvoiceAction } from "@/app/actions";
import Confirm from "@/components/confirm";
import { useToast } from "@/components/toast";
import { formatFullDate, formatTime, productLabel } from "@/lib/format";
import type { MovementRow } from "@/lib/queries";
import type { Invoice } from "@/lib/types";

export default function InvoiceDetail({
  invoice,
  lines,
  units,
}: {
  invoice: Invoice;
  lines: MovementRow[];
  units: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  const cancelled = invoice.status === "cancelled";

  function cancel() {
    startTransition(async () => {
      const result = await cancelInvoiceAction(invoice.id);
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      setAsking(false);
      toast({ message: `${invoice.ref} cancelled · stock put back` });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className={`text-[22px] font-semibold ${cancelled ? "text-muted line-through" : ""}`}>
              {invoice.ref}
            </h2>
            <p className="mt-1 text-[15px] text-muted">
              {formatFullDate(invoice.created_at)} · {formatTime(invoice.created_at)}
            </p>
          </div>
          {cancelled && (
            <span className="shrink-0 rounded-lg bg-danger-soft px-2.5 py-1 text-[13px] font-semibold text-danger">
              Cancelled
            </span>
          )}
        </div>

        <dl className="mt-4 space-y-2 border-t border-line pt-4 text-[15px]">
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted">Customer</dt>
            <dd className="min-w-0 break-words">{invoice.customer || "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-muted">Items</dt>
            <dd>
              {lines.length} {lines.length === 1 ? "product" : "products"} · {units} units
            </dd>
          </div>
          {cancelled && invoice.cancelled_at && (
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted">Cancelled</dt>
              <dd>
                {formatFullDate(invoice.cancelled_at)} · {formatTime(invoice.cancelled_at)}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            What went out
          </h3>
        </div>

        <ul className="divide-y divide-line">
          {lines.map((line) => (
            <li key={line.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                {line.product_brand && (
                  <span className="block truncate text-[12px] font-semibold uppercase tracking-wider text-muted">
                    {line.product_brand}
                  </span>
                )}
                <span className="block truncate">
                  {productLabel(line.product_name, line.product_flavor)}
                </span>
              </span>
              <span className="shrink-0 text-[19px] font-semibold tabular-nums">
                {Math.abs(line.change)}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-line bg-page px-4 py-3">
          <span className="font-semibold">Total</span>
          <span className="text-[19px] font-semibold tabular-nums">{units}</span>
        </div>
      </div>

      <a
        href={`/api/invoices/${invoice.id}/pdf`}
        className="tap flex w-full items-center justify-center gap-2 rounded-2xl bg-brand
                   text-[16px] font-semibold text-white transition hover:opacity-90"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 4v11m0 0-4-4m4 4 4-4" />
          <path d="M5 19h14" />
        </svg>
        Download PDF
      </a>

      {cancelled ? (
        <p className="rounded-2xl bg-page px-4 py-3 text-[15px] leading-snug text-muted">
          This invoice was cancelled and all {units} units went back into stock. It is kept here so
          the record stays complete.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="tap w-full rounded-2xl border border-line text-[15px] font-semibold text-danger
                     transition hover:bg-danger-soft"
        >
          Cancel invoice
        </button>
      )}

      {asking && (
        <Confirm
          title={`Cancel ${invoice.ref}?`}
          body={`All ${units} units go back into stock. The invoice stays here, marked cancelled.`}
          cancelLabel="Keep it"
          confirmLabel="Cancel it"
          danger
          pending={pending}
          onCancel={() => setAsking(false)}
          onConfirm={cancel}
        />
      )}
    </div>
  );
}
