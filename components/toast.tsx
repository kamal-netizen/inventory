"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

interface Toast {
  id: number;
  message: string;
  tone: "ok" | "error";
  undo?: () => Promise<unknown>;
}

interface ShowToast {
  message: string;
  tone?: "ok" | "error";
  /** When given, the toast shows an Undo button and stays up longer. */
  undo?: () => Promise<unknown>;
}

const ToastContext = createContext<(toast: ShowToast) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    ({ message, tone = "ok", undo }: ShowToast) => {
      const id = nextId.current++;
      // Only ever one toast on screen — stacking them is noise in a warehouse.
      setToasts([{ id, message, tone, undo }]);
      setTimeout(() => dismiss(id), undo ? 10000 : 4500);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`animate-rise pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3
                        text-[15px] leading-snug shadow-[0_8px_24px_rgba(18,24,32,0.18)] ${
                          toast.tone === "error" ? "bg-danger text-white" : "bg-ink text-white"
                        }`}
          >
            <span className="min-w-0 flex-1 whitespace-pre-line">{toast.message}</span>

            {toast.undo && (
              <button
                type="button"
                onClick={async () => {
                  dismiss(toast.id);
                  await toast.undo?.();
                }}
                className="shrink-0 rounded-lg bg-white/15 px-3 py-2 font-semibold active:bg-white/25"
              >
                Undo
              </button>
            )}

            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded-lg p-2 text-white/70 active:bg-white/15"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
