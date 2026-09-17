"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logoutAction } from "@/app/actions";
import Confirm from "./confirm";

export default function LogoutButton() {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      // Drop any unfinished invoice so it cannot reappear for whoever signs in next.
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("invoice-draft:")) localStorage.removeItem(key);
        }
      } catch {
        // Storage blocked — nothing was saved to clear.
      }

      await logoutAction();
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-label="Log out"
        className="-mr-2 rounded-xl p-2.5 text-muted active:bg-page"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2" />
          <path d="M19 12H9m10 0-3-3m3 3-3 3" />
        </svg>
      </button>

      {asking && (
        <Confirm
          title="Log out?"
          body="You will need the PIN again to get back in."
          cancelLabel="Stay"
          confirmLabel="Log out"
          pending={pending}
          onCancel={() => setAsking(false)}
          onConfirm={signOut}
        />
      )}
    </>
  );
}
