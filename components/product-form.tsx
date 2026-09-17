"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProductAction, hideProductAction, updateProductAction } from "@/app/actions";
import Confirm from "./confirm";
import { useToast } from "./toast";
import type { Product } from "@/lib/types";

/**
 * Sentinel for the "add a new one" option. Not a value any brand could hold:
 * brands are trimmed on save, and nothing in the catalogue looks like this.
 */
const NEW_BRAND = "__new_brand__";

export default function ProductForm({
  product,
  brands = [],
}: {
  product?: Product;
  brands?: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(product);

  const [brand, setBrand] = useState(product?.brand ?? "");
  const [typingBrand, setTypingBrand] = useState(false);

  const [name, setName] = useState(product?.name ?? "");
  const [flavor, setFlavor] = useState(product?.flavor ?? "");
  const [quantity, setQuantity] = useState(product ? String(product.quantity) : "");
  const [lowStockAt, setLowStockAt] = useState(
    product?.low_stock_at ? String(product.low_stock_at) : ""
  );
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * The brands on offer, plus this product's own.
   *
   * `brands` comes from visible products only, so a product whose brand is
   * otherwise used only by hidden ones would have its brand silently dropped by
   * a select that had no option for it.
   */
  const brandOptions = useMemo(() => {
    const all = new Set(brands);
    if (product?.brand) all.add(product.brand);
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [brands, product?.brand]);

  const newQuantity = Number(quantity || 0);
  const quantityChanged = editing && newQuantity !== product!.quantity;

  function save() {
    if (!name.trim()) {
      setError("Product name is required");
      return;
    }

    startTransition(async () => {
      const result = editing
        ? await updateProductAction(product!.id, {
            brand,
            name,
            flavor,
            quantity: newQuantity,
            lowStockAt: Number(lowStockAt || 0),
          })
        : await createProductAction({
            brand,
            name,
            flavor,
            quantity: newQuantity,
            lowStockAt: Number(lowStockAt || 0),
          });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast({
        message: editing
          ? quantityChanged
            ? `${name.trim()} · stock set to ${newQuantity}`
            : "Product updated"
          : `${name.trim()} added`,
      });
      router.push("/");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await hideProductAction(product!.id);
      if (!result.ok) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      toast({ message: `${product!.name} removed from the list` });
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/*
        A list you pick from, not a text box wearing a dropdown arrow.
        It was a <datalist>, which put an arrow beside a grey placeholder —
        reading as "already set to Optimum Nutrition" when the field was in fact
        empty. It also gave no sign the list existed until you found the arrow,
        and Firefox on Android ignores datalist entirely.

        A native select shows "No brand" as a real value, opens the OS picker on
        a phone, and makes adding a brand a deliberate choice rather than a
        typo away.
      */}
      <label className="block">
        <span className="mb-1.5 block font-medium">Brand</span>
        <span className="mb-1.5 -mt-1 block text-[14px] text-muted">Optional</span>

        {typingBrand ? (
          <div className="flex gap-2">
            <input
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              placeholder="New brand name"
              autoFocus
              className="h-14 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 outline-none
                         placeholder:text-muted focus:border-brand"
            />
            <button
              type="button"
              onClick={() => {
                setTypingBrand(false);
                setBrand("");
              }}
              className="h-14 shrink-0 rounded-2xl border border-line px-4 font-medium text-muted
                         transition hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <select
            value={brand}
            onChange={(event) => {
              if (event.target.value === NEW_BRAND) {
                setTypingBrand(true);
                setBrand("");
              } else {
                setBrand(event.target.value);
              }
            }}
            className="h-14 w-full rounded-2xl border border-line bg-surface px-4 outline-none
                       focus:border-brand"
          >
            <option value="">No brand</option>
            {brandOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            <option value={NEW_BRAND}>+ Add a new brand…</option>
          </select>
        )}
      </label>

      <Field
        label="Product name"
        value={name}
        onChange={setName}
        placeholder="Gold Standard Whey 2 LB"
        autoFocus={!editing}
      />

      <Field
        label="Flavour or variant"
        hint="Leave blank if it has none"
        value={flavor}
        onChange={setFlavor}
        placeholder="Chocolate"
      />

      <Field
        label="Quantity in stock"
        hint={
          quantityChanged
            ? `Will change from ${product!.quantity} to ${newQuantity} and be recorded in History`
            : undefined
        }
        value={quantity}
        onChange={(value) => setQuantity(value.replace(/\D/g, ""))}
        placeholder="0"
        numeric
        autoFocus={editing}
      />

      <Field
        label="Warn me when stock falls to"
        hint="Leave blank for no warning"
        value={lowStockAt}
        onChange={(value) => setLowStockAt(value.replace(/\D/g, ""))}
        placeholder="10"
        numeric
      />

      {error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="tap w-full rounded-2xl bg-brand text-[17px] font-semibold text-white
                   transition hover:opacity-90 disabled:opacity-60"
      >
        {editing ? "Save changes" : "Add product"}
      </button>

      {editing && (
        <>
          <button
            type="button"
            onClick={() => setRemoving(true)}
            className="tap w-full rounded-2xl text-[15px] font-medium text-danger transition hover:bg-danger-soft"
          >
            Remove from list
          </button>

          {removing && (
            <Confirm
              title={`Remove ${product!.name}?`}
              body="It disappears from your stock list. Past delivery notes that used it stay intact."
              cancelLabel="Keep"
              confirmLabel="Remove"
              danger
              pending={pending}
              onCancel={() => setRemoving(false)}
              onConfirm={remove}
            />
          )}
        </>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  numeric,
  autoFocus,
  list,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  autoFocus?: boolean;
  list?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-medium">{label}</span>
      {hint && <span className="mb-1.5 -mt-1 block text-[14px] text-muted">{hint}</span>}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        list={list}
        inputMode={numeric ? "numeric" : undefined}
        className="h-14 w-full rounded-2xl border border-line bg-surface px-4 outline-none
                   placeholder:text-muted focus:border-brand"
      />
    </label>
  );
}
