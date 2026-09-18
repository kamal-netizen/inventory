"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Product } from "@/lib/types";

type Status = "all" | "in" | "low" | "out";

/** Same step as Delivery notes and History, so the button means one thing. */
const PAGE = 50;

const isLow = (p: Product) => p.low_stock_at > 0 && p.quantity <= p.low_stock_at;

export default function StockList({ products }: { products: Product[] }) {
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [shown, setShown] = useState(PAGE);

  const brands = useMemo(
    () => [...new Set(products.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [products]
  );

  // Brand narrows first, and the status counts are taken from that narrowed set
  // — a chip reading "3 low" while showing none of them is worse than no count.
  const inBrand = useMemo(
    () => (brand ? products.filter((p) => p.brand === brand) : products),
    [products, brand]
  );

  const counts = useMemo(
    () => ({
      all: inBrand.length,
      in: inBrand.filter((p) => p.quantity > 0).length,
      low: inBrand.filter(isLow).length,
      out: inBrand.filter((p) => p.quantity === 0).length,
    }),
    [inBrand]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return inBrand.filter((product) => {
      if (status === "in" && product.quantity <= 0) return false;
      if (status === "out" && product.quantity !== 0) return false;
      if (status === "low" && !isLow(product)) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        product.flavor.toLowerCase().includes(term) ||
        product.brand.toLowerCase().includes(term)
      );
    });
  }, [inBrand, search, status]);

  const filtered = Boolean(brand) || status !== "all" || Boolean(search.trim());

  // Back to the first page whenever the list underneath changes, or a search
  // that matches 3 things would still be sitting on "showing 150".
  useEffect(() => setShown(PAGE), [search, brand, status]);

  function clearFilters() {
    setBrand("");
    setStatus("all");
    setSearch("");
  }

  /**
   * Only this many rows are rendered at a time.
   *
   * Filtering stays over the whole list, not the page — it has to, or searching
   * would only find what you had already scrolled to. Everything is in memory
   * already, so this is about not putting 600 rows on screen at once, and the
   * search box remains instant.
   */
  const more = Math.max(0, visible.length - shown);

  // Products arrive ordered by brand, so grouping is just a walk down the list.
  // Slicing inside the memo, rather than passing a fresh array in, keeps the
  // dependency stable — otherwise this recomputes on every render.
  const groups = useMemo(() => {
    const out: { brand: string; items: Product[] }[] = [];
    for (const product of visible.slice(0, shown)) {
      const last = out[out.length - 1];
      if (last?.brand === product.brand) last.items.push(product);
      else out.push({ brand: product.brand, items: [product] });
    }
    return out;
  }, [visible, shown]);

  if (products.length === 0) {
    return (
      <div className="card mt-6 px-6 py-12 text-center md:py-20">
        <p className="text-[17px] font-semibold">No products yet</p>
        <p className="mx-auto mt-2 max-w-[19rem] text-[15px] leading-snug text-muted">
          Add products one at a time, or bring your whole list in from a spreadsheet.
        </p>
        <div className="mt-6 flex flex-col gap-2 md:flex-row md:justify-center">
          <Link
            href="/products/import"
            className="tap inline-flex items-center justify-center rounded-2xl bg-brand px-6
                       font-semibold text-white transition hover:opacity-90"
          >
            Import from Excel
          </Link>
          <Link
            href="/products/new"
            className="tap inline-flex items-center justify-center rounded-2xl border border-line
                       px-6 font-semibold transition hover:bg-surface"
          >
            Add one product
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sticky top-[57px] z-20 -mx-4 flex gap-2 bg-page px-4 pb-3 pt-1 md:top-0 md:-mx-8 md:gap-3 md:px-8 md:pb-4 md:pt-2">
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
            placeholder="Search product, brand or flavour"
            aria-label="Search products"
            className="h-14 w-full rounded-2xl border border-line bg-surface pl-12 pr-11 outline-none
                       placeholder:text-muted focus:border-brand"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2.5 text-muted
                         transition hover:bg-page"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        <Link
          href="/products/new"
          className="hidden shrink-0 items-center gap-2 rounded-2xl bg-brand px-5 font-semibold
                     text-white transition hover:opacity-90 md:flex"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          Add
        </Link>
        <Link
          href="/products/import"
          className="hidden shrink-0 items-center rounded-2xl border border-line bg-surface px-5
                     font-medium transition hover:border-brand hover:text-brand md:flex"
        >
          Import
        </Link>
      </div>

      {/* Chips scroll sideways on a phone rather than wrapping the row in two. */}
      <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:overflow-visible md:px-0">
        <select
          value={brand}
          onChange={(event) => setBrand(event.target.value)}
          aria-label="Filter by brand"
          className="h-10 max-w-[9.5rem] shrink-0 rounded-xl border border-line bg-surface px-3
                     text-[14px] font-medium outline-none focus:border-brand md:max-w-none"
        >
          <option value="">All brands</option>
          {brands.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        {(
          [
            ["all", "All"],
            ["in", "In stock"],
            ["low", "Low"],
            ["out", "None left"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatus(value)}
            aria-pressed={status === value}
            className={`h-10 shrink-0 rounded-xl px-3 text-[14px] font-medium transition ${
              status === value
                ? value === "low"
                  ? "bg-warn-soft text-warn"
                  : "bg-brand-soft text-brand"
                : "border border-line bg-surface text-muted hover:text-ink"
            }`}
          >
            {label}
            <span className="ml-1.5 tabular-nums opacity-60">{counts[value]}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[14px] text-muted">
          {filtered
            ? `${visible.length} of ${products.length} products`
            : `${products.length} products`}
          {more > 0 && ` · showing ${shown}`}
        </p>
        {filtered && (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-lg px-2 py-1 text-[13px] font-medium text-muted transition
                       hover:bg-surface hover:text-ink"
          >
            Clear filters
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="px-1 py-10 text-center">
          <p className="text-[15px] text-muted">
            {search ? `Nothing matches “${search}”.` : "Nothing matches these filters."}
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 rounded-xl border border-line bg-surface px-4 py-2 text-[14px] font-medium
                       transition hover:border-brand hover:text-brand"
          >
            Clear filters
          </button>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.brand || "_none"} className="mb-4">
            {group.brand && (
              <h2 className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-wider text-muted">
                {group.brand}
              </h2>
            )}

            <ul className="space-y-1.5">
              {group.items.map((product) => {
                const low = product.low_stock_at > 0 && product.quantity <= product.low_stock_at;

                return (
                  <li key={product.id}>
                    <Link
                      href={`/products/${product.id}`}
                      className="tap card flex items-center gap-3 px-4 py-3 transition
                                 hover:border-brand active:bg-page"
                    >
                      {low && (
                        <span className="-ml-1 h-9 w-1 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{product.name}</span>
                        {product.flavor && (
                          <span className="mt-0.5 block truncate text-[14px] text-muted">
                            {product.flavor}
                          </span>
                        )}
                      </span>
                      <span
                        className={`shrink-0 text-[24px] font-semibold tabular-nums ${
                          low ? "text-warn" : "text-ink"
                        }`}
                      >
                        {product.quantity}
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
          </section>
        ))
      )}

      {more > 0 && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="tap mt-1 w-full rounded-2xl border border-line bg-surface font-semibold
                     transition hover:border-brand hover:text-brand"
        >
          Show {Math.min(PAGE, more)} more
        </button>
      )}

      <div className="mt-3 flex flex-col gap-2 md:hidden">
        <Link
          href="/products/new"
          className="tap flex items-center justify-center gap-2 rounded-2xl border border-dashed
                     border-line font-semibold text-muted active:bg-surface"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          Add product
        </Link>
        <Link
          href="/products/import"
          className="tap flex items-center justify-center rounded-2xl text-[15px] font-medium text-muted
                     active:bg-surface"
        >
          Import from Excel
        </Link>
      </div>
    </>
  );
}
