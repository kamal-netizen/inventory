"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyImportAction, previewImportAction } from "@/app/actions";
import { useToast } from "@/components/toast";
import type { PlannedRow } from "@/lib/queries";

interface Preview {
  rows: PlannedRow[];
  problems: { row: number; message: string }[];
  headers: string[];
  hasQuantity: boolean;
  hasLowStock: boolean;
  brandSource: "column" | "headings" | "none";
  detectedBrands: string[];
}

const SHOWN = 60;

export default function ImportForm() {
  const router = useRouter();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [useHeadings, setUseHeadings] = useState(true);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function read(chosen: File, headings: boolean) {
    setError("");
    startTransition(async () => {
      const data = new FormData();
      data.append("file", chosen);
      data.append("useHeadingsAsBrands", String(headings));

      const result = await previewImportAction(data);
      if (!result.ok) {
        setPreview(null);
        setError(result.error);
        return;
      }
      const { ok, ...rest } = result;
      void ok;
      setPreview(rest);
    });
  }

  function choose(chosen: File | null) {
    setFile(chosen);
    setPreview(null);
    setError("");
    if (chosen) read(chosen, useHeadings);
  }

  function toggleHeadings(next: boolean) {
    setUseHeadings(next);
    if (file) read(file, next);
  }

  function apply() {
    if (!preview) return;
    startTransition(async () => {
      const result = await applyImportAction(preview.rows, {
        hasQuantity: preview.hasQuantity,
        hasLowStock: preview.hasLowStock,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        message: `Imported · ${result.added} added${result.updated ? `, ${result.updated} updated` : ""}`,
      });
      router.push("/");
      router.refresh();
    });
  }

  const counts = preview
    ? {
        add: preview.rows.filter((row) => row.action === "add").length,
        update: preview.rows.filter((row) => row.action === "update").length,
        same: preview.rows.filter((row) => row.action === "same").length,
      }
    : null;

  return (
    <div className="space-y-5">
      {/* Step 1 — the file */}
      <div className="card p-5">
        <h2 className="font-semibold">1. Choose your file</h2>
        <p className="mt-1 text-[15px] leading-snug text-muted">
          Excel (.xlsx) or .csv. The first row should name the columns — a product name column is
          the only one required.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xlsm,.csv"
          className="hidden"
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={pending}
            className="tap flex-1 rounded-2xl bg-brand px-5 font-semibold text-white
                       transition hover:opacity-90 disabled:opacity-60"
          >
            {file ? "Choose a different file" : "Choose file"}
          </button>
          <a
            href="/api/import-template"
            className="tap flex items-center justify-center rounded-2xl border border-line px-5
                       font-medium transition hover:border-brand hover:text-brand"
          >
            Download template
          </a>
        </div>

        {file && (
          <p className="mt-3 truncate text-[14px] text-muted">
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </p>
        )}
      </div>

      {pending && !preview && (
        <p className="px-1 text-[15px] text-muted">Reading the file…</p>
      )}

      {error && (
        <p role="alert" className="whitespace-pre-line rounded-2xl bg-danger-soft px-4 py-3 text-[15px] text-danger">
          {error}
        </p>
      )}

      {/* Step 2 — what will happen */}
      {preview && counts && (
        <>
          <div className="card p-5">
            <h2 className="font-semibold">2. Check what will happen</h2>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="New products" value={counts.add} tone="brand" />
              <Stat label="Updated" value={counts.update} />
              <Stat label="Unchanged" value={counts.same} />
            </div>

            <dl className="mt-4 space-y-2 text-[15px]">
              <Row term="Columns found" detail={preview.headers.join(", ") || "—"} />
              {!preview.hasQuantity && (
                <Note>
                  No quantity column, so new products come in with <strong>0 in stock</strong> and
                  existing stock figures are left untouched. You can type quantities in afterwards.
                </Note>
              )}
              {!preview.hasLowStock && (
                <Note>No low-stock column, so no alerts are set. You can add those per product later.</Note>
              )}
            </dl>

            {preview.brandSource === "headings" && (
              <div className="mt-4 rounded-2xl bg-page p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={useHeadings}
                    onChange={(event) => toggleHeadings(event.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
                  />
                  <span className="text-[15px] leading-snug">
                    <strong className="font-semibold">
                      Treat {preview.detectedBrands.length} heading rows as brands
                    </strong>
                    <span className="mt-1 block text-muted">
                      Rows sitting on their own above a group of products. Untick to import them as
                      products instead.
                    </span>
                    <span className="mt-2 block text-[13px] leading-relaxed text-muted">
                      {preview.detectedBrands.join(" · ")}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {preview.problems.length > 0 && (
              <div className="mt-4 rounded-2xl bg-warn-soft p-4">
                <p className="text-[15px] font-semibold text-warn">
                  {preview.problems.length} {preview.problems.length === 1 ? "row was" : "rows were"} skipped
                </p>
                <ul className="mt-2 space-y-1 text-[14px] text-warn">
                  {preview.problems.slice(0, 10).map((problem) => (
                    <li key={problem.row}>
                      Row {problem.row}: {problem.message}
                    </li>
                  ))}
                  {preview.problems.length > 10 && <li>…and {preview.problems.length - 10} more</li>}
                </ul>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                Preview · first {Math.min(SHOWN, preview.rows.length)} of {preview.rows.length}
              </h3>
            </div>

            <ul className="divide-y divide-line">
              {preview.rows.slice(0, SHOWN).map((row) => (
                <li key={`${row.row}`} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    {row.brand && (
                      <span className="block truncate text-[12px] font-semibold uppercase tracking-wider text-muted">
                        {row.brand}
                      </span>
                    )}
                    <span className="block truncate text-[15px]">{row.name}</span>
                    {row.flavor && (
                      <span className="block truncate text-[13px] text-muted">{row.flavor}</span>
                    )}
                  </span>

                  <span className="shrink-0 text-[15px] font-semibold tabular-nums">
                    {row.action === "update" && row.currentQuantity !== null
                      ? `${row.currentQuantity} → ${row.quantity}`
                      : row.quantity}
                  </span>

                  <span
                    className={`w-20 shrink-0 text-right text-[12px] font-semibold uppercase tracking-wide ${
                      row.action === "add"
                        ? "text-brand"
                        : row.action === "update"
                          ? "text-warn"
                          : "text-muted"
                    }`}
                  >
                    {row.action === "same" ? "no change" : row.action}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Step 3 — commit */}
          <button
            type="button"
            onClick={apply}
            disabled={pending || counts.add + counts.update === 0}
            className="tap w-full rounded-2xl bg-brand text-[17px] font-semibold text-white
                       transition hover:opacity-90 disabled:bg-line disabled:text-muted"
          >
            {counts.add + counts.update === 0
              ? "Nothing to import"
              : `Import ${counts.add + counts.update} products`}
          </button>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "brand" }) {
  return (
    <div className="rounded-2xl bg-page px-3 py-3 text-center">
      <p className={`text-[24px] font-semibold tabular-nums ${tone === "brand" ? "text-brand" : ""}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[13px] leading-tight text-muted">{label}</p>
    </div>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted">{term}:</dt>
      <dd className="min-w-0 break-words">{detail}</dd>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-page px-3 py-2 text-[14px] leading-snug text-muted">{children}</p>;
}
