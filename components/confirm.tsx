"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders into document.body rather than in place. A dialog nested inside a
 * positioned ancestor (the sticky header, for one) is trapped in that ancestor's
 * stacking context, and the bottom nav paints over its buttons.
 */
export default function Confirm({
  title,
  body,
  cancelLabel = "Cancel",
  confirmLabel,
  danger,
  pending,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  cancelLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="animate-rise card w-full max-w-sm p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1.5 text-[15px] leading-snug text-muted">{body}</p>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="tap flex-1 rounded-xl border border-line font-semibold active:bg-page"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`tap flex-1 rounded-xl font-semibold text-white active:opacity-90 disabled:opacity-60 ${
              danger ? "bg-danger" : "bg-ink"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
