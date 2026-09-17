"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loginAction } from "@/app/actions";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function Keypad({ pinLength, lockedMinutes }: { pinLength: number; lockedMinutes: number }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(lockedMinutes > 0 ? `Locked. Try again in ${lockedMinutes} minutes.` : "");
  const [shake, setShake] = useState(0);
  const [pending, startTransition] = useTransition();

  // Remembers which PIN has already been sent, so a re-render can never turn
  // one completed PIN into two login attempts (which would burn the lockout).
  const submitted = useRef("");

  useEffect(() => {
    if (pin.length !== pinLength || submitted.current === pin) return;
    submitted.current = pin;

    startTransition(async () => {
      const result = await loginAction(pin);
      if (result.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setError(result.error);
      setPin("");
      submitted.current = "";
      setShake((n) => n + 1);
    });
  }, [pin, pinLength, router]);

  const press = useCallback(
    (digit: string) => {
      if (pending) return;
      setError("");
      setPin((current) => (current.length >= pinLength ? current : current + digit));
    },
    [pending, pinLength]
  );

  const back = useCallback(() => {
    setError("");
    setPin((current) => current.slice(0, -1));
  }, []);

  // Physical keyboard, for whoever uses this on a laptop.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (/^[0-9]$/.test(event.key)) press(event.key);
      else if (event.key === "Backspace") back();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, back]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <div className="mb-10 flex flex-col items-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M7 10V7a5 5 0 0 1 10 0v3"
              stroke="var(--color-brand)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <rect x="4" y="10" width="16" height="10" rx="2.5" fill="var(--color-brand)" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold">Enter PIN</h1>

        <div
          key={shake}
          className={`mt-7 flex gap-4 ${error && !pending ? "animate-shake" : ""}`}
          aria-label={`${pin.length} of ${pinLength} digits entered`}
        >
          {Array.from({ length: pinLength }).map((_, index) => (
            <span
              key={index}
              className={`h-4 w-4 rounded-full transition-colors ${
                index < pin.length ? "bg-brand" : "bg-line"
              }`}
            />
          ))}
        </div>

        <p
          className={`mt-5 max-w-[17rem] text-center text-[15px] leading-snug ${
            error ? "text-danger" : "text-transparent"
          }`}
          role={error ? "alert" : undefined}
        >
          {error || "placeholder"}
        </p>
      </div>

      <div className="grid w-full max-w-[19rem] grid-cols-3 gap-3">
        {KEYS.map((digit) => (
          <Key key={digit} onClick={() => press(digit)} disabled={pending}>
            {digit}
          </Key>
        ))}
        <div />
        <Key onClick={() => press("0")} disabled={pending}>
          0
        </Key>
        <Key onClick={back} disabled={pending || pin.length === 0} label="Delete">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M9 5h11v14H9L3 12l6-7Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="m12 10 4 4m0-4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </Key>
      </div>
    </div>
  );
}

function Key({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-[72px] items-center justify-center rounded-2xl bg-surface text-[28px] font-medium
                 text-ink shadow-[0_1px_2px_rgba(18,24,32,0.08)] transition
                 active:scale-[0.97] active:bg-brand-soft disabled:opacity-40 disabled:active:scale-100"
    >
      {children}
    </button>
  );
}
