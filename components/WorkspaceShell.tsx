"use client";

/**
 * DashyCore v7 — workspace chrome (client half of the app shell).
 *
 * Owns the three responsive navigation states and nothing else:
 *
 *   ≥1024px  docked sidebar, expanded or collapsed (remembered preference)
 *   768–1023 docked sidebar, collapsed by default (tablet gets a real layout,
 *            not a squeezed desktop) — still expandable
 *   <768px   no docked sidebar; a hamburger opens a slide-over drawer with a
 *            backdrop, Escape-to-close, focus trapping and close-on-navigate
 *
 * The sidebar is a flex sibling of the main column, so collapsing it hands
 * the reclaimed width straight to the workspace — no gap, no overlap, no
 * horizontal scrollbar.
 *
 * The Share Hub is mounted here exactly once so every feature can open THE
 * same hub without a second implementation.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { ShareHubProvider } from "@/components/share/ShareHubProvider";
import {
  getStoredSidebarCollapsed,
  hasStoredSidebarPreference,
  setStoredSidebarCollapsed,
  SIDEBAR_CHANGED_EVENT,
} from "@/lib/preferences";

/** Read the stored preference before paint on the client, after it on SSR. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function WorkspaceShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  /* Restore the stored preference; tablets start collapsed by default. */
  useIsomorphicLayoutEffect(() => {
    if (hasStoredSidebarPreference()) {
      setCollapsed(getStoredSidebarCollapsed());
      return;
    }
    const tablet = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    setCollapsed(tablet.matches);
  }, []);

  /* Keep every mounted shell in sync (the preference is workspace-wide). */
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ collapsed?: boolean }>).detail;
      if (typeof detail?.collapsed === "boolean") setCollapsed(detail.collapsed);
    };
    window.addEventListener(SIDEBAR_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(SIDEBAR_CHANGED_EVENT, onChange);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      setStoredSidebarCollapsed(!prev);
      return !prev;
    });
  }, []);

  const openDrawer = useCallback(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    triggerRef.current?.focus?.();
  }, []);

  /* Route change closes the drawer (belt and braces with onNavigate). */
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  /* Growing past the mobile breakpoint hands over to the docked sidebar. */
  useEffect(() => {
    if (!drawerOpen) return;
    const desktop = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (desktop.matches) setDrawerOpen(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, [drawerOpen]);

  /* Escape closes, body scroll locks, focus moves into and stays in the drawer. */
  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = drawerRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => drawerRef.current?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [drawerOpen, closeDrawer]);

  return (
    <ShareHubProvider>
      <div className="flex min-h-screen w-full overflow-x-hidden bg-navy">
        {/* Docked sidebar — tablet and up. */}
        <div className="hidden md:flex">
          <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        </div>

        {/* Mobile slide-over drawer. */}
        {drawerOpen && (
          <div className="fixed inset-0 z-[60] md:hidden">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close navigation"
              onClick={closeDrawer}
              className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm motion-safe:animate-[fade-in_160ms_ease-out]"
            />
            <div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Workspace navigation"
              tabIndex={-1}
              className="relative flex h-full w-[86%] max-w-[20rem] flex-col border-r border-white/[0.08] shadow-2xl shadow-black/60 outline-none motion-safe:animate-[slide-in-left_200ms_cubic-bezier(0.22,1,0.36,1)]"
            >
              <Sidebar variant="drawer" onNavigate={closeDrawer} />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <Header sessionTitle={title} onOpenNav={openDrawer} />
          <main id="main" className="min-w-0 flex-1 overflow-x-hidden">
            {children}
          </main>
        </div>
      </div>
    </ShareHubProvider>
  );
}
