"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkInvoiceRefAction, createInvoiceAction } from "@/app/actions";
import { useToast } from "@/components/toast";
import { formatDay, productLabel } from "@/lib/format";
import type { Product } from "@/lib/types";

interface Line {
  productId: number;
  quantity: number;
}

/** Draft key is per warehouse, so one warehouse's draft can never show up in the other's form. */
export const draftKey = (warehouse: string) => `invoice-draft:${warehouse}`;

export default function InvoiceForm({
  products,
  warehouseKey,
}: {
  products: Product[];
  warehouseKey: string;
}) {
  const router = useRouter();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [reference, setReference] = useState("");
  const [customer, setCustomer] = useState("");
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [restored, setRestored] = useState(false);
  const [pending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const key = draftKey(warehouseKey);

  // Bring back an unfinished invoice — someone checking a number on the stock
  // screen and coming back should not lose what they already keyed in.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const draft = JSON.parse(saved);
        if (Array.isArray(draft.lines)) {
          // Skip anything that has since been removed from the product list.
          setLines(draft.lines.filter((line: Line) => byId.has(line.productId)));
        }
        setReference(typeof draft.reference === "string" ? draft.reference : "");
        setCustomer(typeof draft.customer === "string" ? draft.customer : "");
      }
    } catch {
      // Private mode or blocked storage — carry on with an empty form.
    }
    setRestored(true);
    // Runs once; byId is stable for the life of this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft in step. Guarded on `restored` so the empty initial state
  // cannot wipe the draft before it has been read back.
  useEffect(() => {
    if (!restored) return;
    try {
      if (lines.length === 0 && !reference.trim() && !customer.trim()) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify({ lines, reference, customer }));
      }
    } catch {
      // Nothing to do — the form still works, it just will not survive a reload.
    }
  }, [restored, lines, reference, customer, key]);

  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(term) ||
          product.flavor.toLowerCase().includes(term) ||
          product.brand.toLowerCase().includes(term)
      )
      .slice(0, 10);
  }, [products, search]);

  const totalUnits = lines.reduce((total, line) => total + line.quantity, 0);

  function setLine(productId: number, quantity: number) {
    setError("");
    setLines((current) => {
      const rest = current.filter((line) => line.productId !== productId);
      return quantity > 0 ? [...rest, { productId, quantity }] : rest;
    });
  }

  function clearDraft() {
    setLines([]);
    setReference("");
    setCustomer("");
    setDuplicate(null);
    setError("");
  }

  function save() {
    if (lines.length === 0) {
      setError("Add at least one product");
      return;
    }
    if (!reference.trim()) {
      setError("Enter the delivery note or sales order number");
      return;
    }

    startTransition(async () => {
      const result = await createInvoiceAction({ ref: reference, customer, lines });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const saved = reference.trim();
      const count = lines.length;
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
      clearDraft();

      toast({
        message: `${saved} saved · ${count} ${count === 1 ? "item" : "items"} · ${totalUnits} units out`,
      });
      // Land on the stored invoice, so it is obvious the record was kept.
      router.push(`/invoices/${result.id}`);
      router.refresh();
    });
  }

  return (
    <>
      <div className="md:grid md:grid-cols-2 md:items-start md:gap-6">
        {/* Left on desktop: find a product */}
        <div>
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
              placeholder="Search product, brand or flavour"
              aria-label="Search product to add"
              className="h-14 w-full rounded-2xl border border-line bg-surface pl-12 pr-4 outline-none
                         placeholder:text-muted focus:border-brand"
            />
          </div>

          {results.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {results.map((product) => {
                const existing = lines.find((line) => line.productId === product.id);
                const empty = product.quantity === 0;

                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      disabled={empty}
                      onClick={() => {
                        setPicking(product);
                        setSearch("");
                      }}
                      className="tap card flex w-full items-center gap-3 px-4 py-3 text-left
                                 transition hover:border-brand active:bg-page disabled:opacity-50
                                 disabled:hover:border-line"
                    >
                      <span className="min-w-0 flex-1">
                        {product.brand && (
                          <span className="block truncate text-[12px] font-semibold uppercase tracking-wider text-muted">
                            {product.brand}
                          </span>
                        )}
                        <span className="block truncate font-medium">{product.name}</span>
                        {product.flavor && (
                          <span className="mt-0.5 block truncate text-[14px] text-muted">
                            {product.flavor}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[14px] text-muted">
                        {empty ? "none left" : `${product.quantity} left`}
                      </span>
                      {existing && (
                        <span className="shrink-0 rounded-lg bg-brand-soft px-2 py-1 text-[13px] font-semibold text-brand">
                          {existing.quantity}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 hidden px-1 text-[14px] leading-snug text-muted md:block">
              Type a product name or flavour, then click a result to add it.
            </p>
          )}
        </div>

        {/* Right on desktop: the invoice itself */}
        <div className="mt-5 md:mt-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Items</h2>
            {(lines.length > 0 || reference || customer) && (
              <button
                type="button"
                onClick={clearDraft}
                className="rounded-lg px-2 py-1 text-[13px] font-medium text-muted
                           transition hover:bg-page hover:text-danger"
              >
                Clear
              </button>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="card px-4 py-8 text-center text-[15px] leading-snug text-muted">
              Search and pick a product to add it.
            </p>
          ) : (
            <ul className="space-y-2">
              {lines.map((line) => {
                const product = byId.get(line.productId);
                if (!product) return null;

                return (
                  <li key={line.productId} className="card flex items-center gap-2 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{product.name}</span>
                      {product.flavor && (
                        <span className="mt-0.5 block truncate text-[14px] text-muted">
                          {product.flavor}
                        </span>
                      )}
                    </span>

                    <button
                      type="button"
                      onClick={() => setPicking(product)}
                      aria-label={`Change quantity for ${product.name}`}
                      className="h-11 min-w-[3.25rem] rounded-xl bg-page px-3 text-[19px] font-semibold
                                 tabular-nums transition hover:bg-brand-soft hover:text-brand"
                    >
                      {line.quantity}
                    </button>

                    <button
                      type="button"
                      onClick={() => setLine(line.productId, 0)}
                      aria-label={`Remove ${product.name}`}
                      className="rounded-xl p-2.5 text-muted transition hover:bg-danger-soft hover:text-danger"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block font-medium">Delivery note / SO number</span>
              <input
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value);
                  setDuplicate(null);
                  setError("");
                }}
                onBlur={async () => {
                  const { usedOn } = await checkInvoiceRefAction(reference);
                  setDuplicate(usedOn);
                }}
                placeholder="DN-2451"
                className="h-14 w-full rounded-2xl border border-line bg-surface px-4 outline-none
                           placeholder:text-muted focus:border-brand"
              />
              {duplicate && (
                <span className="mt-1.5 block text-[14px] text-warn">
                  Already used on {formatDay(duplicate)} — saving again is allowed.
                </span>
              )}
            </label>

            <label className="block">
              <span className="mb-1.5 block font-medium">Customer</span>
              <span className="mb-1.5 -mt-1 block text-[14px] text-muted">Optional</span>
              <input
                value={customer}
                onChange={(event) => setCustomer(event.target.value)}
                placeholder="Sharma Distributors"
                className="h-14 w-full rounded-2xl border border-line bg-surface px-4 outline-none
                           placeholder:text-muted focus:border-brand"
              />
            </label>
          </div>

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
            disabled={pending || lines.length === 0}
            className="tap mt-4 w-full rounded-2xl bg-brand text-[17px] font-semibold text-white
                       transition hover:opacity-90 disabled:bg-line disabled:text-muted disabled:hover:opacity-100"
          >
            {lines.length === 0 ? "Save" : `Save — ${totalUnits} units out`}
          </button>
        </div>
      </div>

      {picking && (
        <LineSheet
          product={picking}
          current={lines.find((line) => line.productId === picking.id)?.quantity ?? 0}
          onClose={() => setPicking(null)}
          onSet={(quantity) => {
            setLine(picking.id, quantity);
            setPicking(null);
          }}
        />
      )}
    </>
  );
}

/** Quantity entry for one invoice line — capped at what is actually in stock. */
function LineSheet({
  product,
  current,
  onClose,
  onSet,
}: {
  product: Product;
  current: number;
  onClose: () => void;
  onSet: (quantity: number) => void;
}) {
  const [digits, setDigits] = useState(current ? String(current) : "");
  const amount = Number(digits || 0);
  const tooMany = amount > product.quantity;
  const ready = amount > 0 && !tooMany;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (/^[0-9]$/.test(event.key)) setDigits((d) => (d + event.key).slice(0, 6));
      else if (event.key === "Backspace") setDigits((d) => d.slice(0, -1));
      else if (event.key === "Enter" && amount > 0 && amount <= product.quantity) onSet(amount);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSet, amount, product.quantity]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 md:items-center"
      onClick={onClose}
    >
      <div
        className="animate-rise w-full max-w-md rounded-t-3xl bg-surface px-4
                   pb-[calc(16px+env(safe-area-inset-bottom))] pt-4 md:max-w-sm md:rounded-3xl md:pb-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line md:hidden" />

        <p className="text-center text-[17px] font-semibold leading-snug">
          {productLabel(product.name, product.flavor)}
        </p>
        <p className="mt-1 text-center text-[15px] text-muted">{product.quantity} in stock</p>

        <div className="py-5 text-center">
          <div className={`text-[44px] font-semibold leading-none ${digits ? "text-ink" : "text-line"}`}>
            {digits || "0"}
          </div>
          <p className={`mt-2 text-[15px] ${tooMany ? "text-danger" : "text-muted"}`}>
            {tooMany ? `Only ${product.quantity} in stock` : "How many are going out?"}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <NumberKey key={digit} onClick={() => setDigits((d) => (d + digit).slice(0, 6))}>
              {digit}
            </NumberKey>
          ))}
          <NumberKey onClick={() => setDigits("")} label="Clear">
            <span className="text-[17px] font-semibold text-muted">C</span>
          </NumberKey>
          <NumberKey onClick={() => setDigits((d) => (d + "0").slice(0, 6))}>0</NumberKey>
          <NumberKey onClick={() => setDigits((d) => d.slice(0, -1))} label="Delete">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 5h11v14H9L3 12l6-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="m12 10 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </NumberKey>
        </div>

        <div className="mt-3 flex gap-3">
          {current > 0 && (
            <button
              type="button"
              onClick={() => onSet(0)}
              className="tap flex-1 rounded-2xl border border-line font-semibold text-danger
                         transition hover:bg-danger-soft"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={() => onSet(amount)}
            disabled={!ready}
            className="tap flex-[1.6] rounded-2xl bg-brand font-semibold text-white transition
                       hover:opacity-90 disabled:bg-line disabled:text-muted disabled:hover:opacity-100"
          >
            {current > 0 ? "Update" : "Add to note"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberKey({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-14 items-center justify-center rounded-2xl bg-page text-[24px] font-medium
                 transition hover:bg-brand-soft active:scale-[0.97]"
    >
      {children}
    </button>
  );
}
