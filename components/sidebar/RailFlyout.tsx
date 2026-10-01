"use client";

/**
 * DashyCore v7 — collapsed-rail overlays.
 *
 * Two primitives used only by the icon rail:
 *
 *   <RailTip>    tooltip for an icon-only control — appears on hover AND on
 *                keyboard focus, so the rail is never "recognise the icon or
 *                get lost".
 *   <RailGroup>  a group (D-Code, Studio) as an icon that opens a small menu
 *                with its real children, instead of flattening every child
 *                into a wall of icons.
 *
 * Both render through a portal with fixed positioning: the rail scrolls and
 * is `backdrop-blur`ed, and either of those would clip an absolutely
 * positioned overlay.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

export interface RailChild {
  id: string;
  label: string;
  href: string;
  Icon: ComponentType<{ className?: string }>;
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Positioning                                                                 */
/* -------------------------------------------------------------------------- */

/** Live bounding box of the anchor while the overlay is open. */
function useAnchorRect(open: boolean, ref: RefObject<HTMLElement | null>) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    const measure = () => {
      const node = ref.current;
      if (node) setRect(node.getBoundingClientRect());
    };
    measure();
    window.addEventListener("resize", measure);
    // `true` → also follow scrolling of the rail itself.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, ref]);

  return rect;
}

function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Wraps an icon-only control and labels it on hover/focus.
 *
 * The bubble itself is `aria-hidden`: the control inside already carries a
 * real accessible name, so assistive tech announces it once, not twice.
 */
export function RailTip({
  label,
  disabled = false,
  children,
}: {
  label: string;
  /** Suppress the tooltip (e.g. while this item's menu is open). */
  disabled?: boolean;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const visible = open && !disabled;
  const rect = useAnchorRect(visible, anchorRef);

  return (
    <div
      ref={anchorRef}
      className="relative flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {visible && rect && (
        <Portal>
          <span
            aria-hidden="true"
            style={{ top: rect.top + rect.height / 2, left: rect.right + 10 }}
            className="pointer-events-none fixed z-[90] -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/[0.08] bg-[#151a33] px-2.5 py-1.5 text-xs font-medium text-zinc-100 shadow-xl shadow-black/50 motion-safe:animate-[fade-in_120ms_ease-out]"
          >
            {label}
          </span>
        </Portal>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Group flyout                                                                */
/* -------------------------------------------------------------------------- */

const MENU_ITEM_HEIGHT = 36;

/**
 * Collapsed-rail group: one icon, one menu, every child still reachable.
 *
 * Opens on click/Enter/Space/ArrowRight (so it works with touch and keyboard,
 * not just a mouse), moves focus into the menu, closes on Escape, outside
 * click, or focus leaving — and returns focus to the trigger.
 */
export function RailGroup({
  label,
  Icon,
  active,
  items,
  onNavigate,
}: {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  active: boolean;
  items: RailChild[];
  onNavigate?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rect = useAnchorRect(open, triggerRef);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  /* Outside pointer / focus / Escape all dismiss the menu. */
  useEffect(() => {
    if (!open) return;

    const isInside = (target: EventTarget | null) =>
      target instanceof Node &&
      (menuRef.current?.contains(target) || triggerRef.current?.contains(target));

    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) close();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!isInside(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  /* Keyboard users land on the first destination straight away. */
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      menuRef.current?.querySelector<HTMLElement>("[data-menu-item]")?.focus();
    }, 10);
    return () => window.clearTimeout(timer);
  }, [open]);

  const moveFocus = (direction: 1 | -1) => {
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? []
    );
    if (nodes.length === 0) return;
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    const next = (index + direction + nodes.length) % nodes.length;
    nodes[next]?.focus();
  };

  /* Keep the menu on screen without hiding items below the fold. */
  const estimatedHeight = items.length * MENU_ITEM_HEIGHT + 44;
  const top = rect
    ? Math.max(
        8,
        Math.min(rect.top - 6, (typeof window === "undefined" ? 0 : window.innerHeight) - estimatedHeight - 8)
      )
    : 0;

  return (
    <RailTip label={label} disabled={open}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
          active || open
            ? "bg-cyan-500/12 text-cyan-300"
            : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" />
      </button>

      {open && rect && (
        <Portal>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            style={{ top, left: rect.right + 10 }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(-1);
              }
            }}
            className="fixed z-[90] w-52 rounded-xl border border-white/[0.08] bg-[#151a33] p-1.5 shadow-2xl shadow-black/60 motion-safe:animate-[fade-in_120ms_ease-out]"
          >
            <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              {label}
            </p>
            {items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                role="menuitem"
                data-menu-item
                aria-current={item.active ? "page" : undefined}
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className={`flex min-h-[36px] w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:bg-white/[0.06] ${
                  item.active
                    ? "bg-cyan-500/10 text-cyan-300"
                    : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <item.Icon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            ))}
          </div>
        </Portal>
      )}
    </RailTip>
  );
}
