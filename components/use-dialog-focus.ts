"use client";

import { useEffect, type RefObject } from "react";

/** Takes the focus into an open dialog, keeps Tab inside it, and gives it back on closing. */
export function useDialogFocus(dialog: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const box = dialog.current;
    if (!box) return;
    const opener = document.activeElement;
    box.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Tab" || !box) return;
      const stops = box.querySelectorAll<HTMLElement>("button:not(:disabled)");
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      const atEdge = event.shiftKey ? active === first || active === box : active === last;

      if (atEdge || !box.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [dialog]);
}
