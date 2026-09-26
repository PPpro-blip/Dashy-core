"use client";

/**
 * DashyCore v7 — lightweight toast notification system.
 *
 * - Success (emerald), error (red), info (indigo)
 * - Auto-dismisses after 4 seconds (configurable; 0 = persistent)
 * - Slide-in-from-bottom animation (see .toast-enter in globals.css)
 * - `update(id, …)` lets callers transition a toast through states
 *   (e.g. upload: info loading → success).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertIcon, CheckIcon, InfoIcon, XIcon } from "@/components/icons";

export type ToastType = "success" | "error" | "info";

export interface ToastOptions {
  type?: ToastType;
  title: string;
  message?: string;
  /** Milliseconds before auto-dismiss. 0 = sticky. Default: 4000. */
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, "message">> {
  id: string;
  message?: string;
  createdAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

interface ToastApi {
  show: (options: ToastOptions) => string;
  update: (id: string, options: ToastOptions) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 4000;
const MAX_TOASTS = 3;

const TOAST_STYLES: Record<
  ToastType,
  { border: string; iconBg: string; icon: (cls: string) => React.ReactNode }
> = {
  success: {
    border: "border-emerald-500/30",
    iconBg: "bg-emerald-500/15 text-emerald-400",
    icon: (cls) => <CheckIcon className={cls} />,
  },
  error: {
    border: "border-red-500/40",
    iconBg: "bg-red-500/15 text-red-400",
    icon: (cls) => <AlertIcon className={cls} />,
  },
  info: {
    border: "border-indigo-500/30",
    iconBg: "bg-indigo-500/15 text-indigo-400",
    icon: (cls) => <InfoIcon className={cls} />,
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer]
  );

  const scheduleDismiss = useCallback(
    (id: string, duration: number) => {
      clearTimer(id);
      if (duration <= 0) return;
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    },
    [clearTimer, dismiss]
  );

  const show = useCallback(
    (options: ToastOptions): string => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const record: ToastRecord = {
        id,
        type: options.type ?? "info",
        title: options.title,
        message: options.message,
        duration: options.duration ?? DEFAULT_DURATION,
        createdAt: Date.now(),
      };
      setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), record]);
      scheduleDismiss(id, record.duration);
      return id;
    },
    [scheduleDismiss]
  );

  const update = useCallback(
    (id: string, options: ToastOptions) => {
      setToasts((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                type: options.type ?? t.type,
                title: options.title,
                message: options.message,
                duration: options.duration ?? t.duration,
                createdAt: Date.now(),
              }
            : t
        )
      );
      // Reset the auto-dismiss clock (sticky if the caller asks for 0).
      const duration = options.duration ?? DEFAULT_DURATION;
      scheduleDismiss(id, duration);
    },
    [scheduleDismiss]
  );

  const api = useMemo<ToastApi>(() => ({ show, update, dismiss }), [show, update, dismiss]);

  // Clean up pending timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toast viewport */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2.5 px-4"
      >
        {toasts.map((toast) => {
          const style = TOAST_STYLES[toast.type];
          return (
            <div
              key={toast.id}
              role="status"
              className={`toast-enter pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border ${style.border} bg-zinc-900/95 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur-md`}
            >
              <span
                className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${style.iconBg}`}
              >
                {style.icon("h-3.5 w-3.5")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug text-zinc-100">
                  {toast.title}
                </p>
                {toast.message && (
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-zinc-400">
                    {toast.message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="flex-shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): {
  success: (title: string, message?: string, duration?: number) => string;
  error: (title: string, message?: string, duration?: number) => string;
  info: (title: string, message?: string, duration?: number) => string;
  show: ToastApi["show"];
  update: ToastApi["update"];
  dismiss: ToastApi["dismiss"];
} {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error("useToast must be used inside <ToastProvider>.");
  }
  return {
    show: api.show,
    update: api.update,
    dismiss: api.dismiss,
    success: (title, message, duration) =>
      api.show({ type: "success", title, message, duration }),
    error: (title, message, duration) =>
      api.show({ type: "error", title, message, duration }),
    info: (title, message, duration) =>
      api.show({ type: "info", title, message, duration }),
  };
}
