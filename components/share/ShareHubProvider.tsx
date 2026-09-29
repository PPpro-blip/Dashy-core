"use client";

/**
 * DashyCore v7 — Share Hub access point.
 *
 * Mounted once by the workspace shell. Any feature can call
 * `useShareHub().open(source)` and gets THE Share Hub (components/share/
 * ShareHub) in a focused drawer — no second implementation, no duplicated
 * routing, and the source it was launched with is already selected.
 *
 * The drawer is a real dialog: focus is trapped-ish (initial focus moves
 * inside), Escape closes it, the backdrop closes it, and the page behind
 * stops scrolling.
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
import { ShareHub } from "@/components/share/ShareHub";
import { sourceKey, type ShareSource } from "@/lib/share/types";

interface ShareHubApi {
  /** Opens the hub. Pass a source to pre-select it (project-scoped share). */
  open: (source?: ShareSource | null) => void;
  close: () => void;
  isOpen: boolean;
}

const ShareHubContext = createContext<ShareHubApi | null>(null);

export function useShareHub(): ShareHubApi {
  const api = useContext(ShareHubContext);
  if (!api) {
    throw new Error("useShareHub must be used inside <ShareHubProvider>.");
  }
  return api;
}

export function ShareHubProvider({ children }: { children: React.ReactNode }) {
  const [openState, setOpenState] = useState<{
    open: boolean;
    source: ShareSource | null;
  }>({ open: false, source: null });

  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const open = useCallback((source: ShareSource | null = null) => {
    if (typeof document !== "undefined") {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
    }
    setOpenState({ open: true, source });
  }, []);

  const close = useCallback(() => {
    setOpenState((prev) => ({ ...prev, open: false }));
    restoreFocusRef.current?.focus?.();
  }, []);

  /* Escape to close + scroll lock while open. */
  useEffect(() => {
    if (!openState.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    // Move focus into the panel for keyboard + screen-reader users.
    const timer = window.setTimeout(() => panelRef.current?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [openState.open, close]);

  const api = useMemo<ShareHubApi>(
    () => ({ open, close, isOpen: openState.open }),
    [open, close, openState.open]
  );

  return (
    <ShareHubContext.Provider value={api}>
      {children}

      {openState.open && (
        <div className="fixed inset-0 z-[70] flex justify-end">
          <button
            type="button"
            aria-label="Close Share Hub"
            tabIndex={-1}
            onClick={close}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm motion-safe:animate-[fade-in_160ms_ease-out]"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-hub-dialog-title"
            tabIndex={-1}
            className="relative flex h-full w-full max-w-full flex-col border-l border-white/[0.08] bg-[#0b0e1c] shadow-2xl shadow-black/60 outline-none motion-safe:animate-[slide-in-right_220ms_cubic-bezier(0.22,1,0.36,1)] sm:max-w-xl lg:max-w-4xl"
          >
            <ShareHub
              key={openState.source ? sourceKey(openState.source) : "no-source"}
              initialSource={openState.source}
              variant="dialog"
              onClose={close}
              titleId="share-hub-dialog-title"
            />
          </div>
        </div>
      )}
    </ShareHubContext.Provider>
  );
}

/**
 * Same hub, but tolerant of being rendered outside the workspace shell
 * (e.g. the public /d-code/share/<slug> viewer, which has no chrome).
 */
export function useOptionalShareHub(): ShareHubApi | null {
  return useContext(ShareHubContext);
}
