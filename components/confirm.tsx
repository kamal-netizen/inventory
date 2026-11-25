"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "./use-dialog-focus";

/**
 * Renders into document.body rather than in place. A dialog nested inside a
 * positioned ancestor (the sticky header, for one) is trapped in that ancestor's
 * stacking context, and the bottom nav paints over its buttons. Only ever shown
 * after a tap, so there is always a document to render into.
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
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={onCancel}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-rise card w-full max-w-sm p-5 outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-[19px] font-semibold leading-tight">
          {title}
        </h2>
        <p className="mt-1.5 text-[15px] leading-snug text-muted">{body}</p>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="tap flex-1 rounded-2xl border border-line bg-surface font-semibold transition
                       hover:border-brand hover:text-brand"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`tap flex-1 rounded-2xl font-semibold text-white transition hover:opacity-90 disabled:opacity-60 ${
              danger ? "bg-danger" : "bg-ink"
            }`}
          >
            {pending ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
