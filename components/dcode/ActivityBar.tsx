"use client";

/**
 * DashyCore v7 — D-Code activity bar (left, VS Code style).
 *
 * Switches the side panel between Explorer / Source Control / Extensions.
 * The Explorer is the existing file tree — the activity bar only swaps
 * which panel is mounted, it never replaces the tree.
 */

import {
  FilesIcon,
  GitBranchIcon,
  PuzzleIcon,
} from "@/components/icons";

export type SideView = "explorer" | "scm" | "extensions";

interface ActivityBarProps {
  view: SideView;
  onSelect: (view: SideView) => void;
  /** Uncommitted change count badge for Source Control. */
  scmChangeCount?: number;
  /** Enabled extension count badge for Extensions. */
  enabledExtensionCount?: number;
}

interface BarButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}

function BarButton({ label, active, onClick, badge, children }: BarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`group relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
        active ? "text-cyan-300" : "text-zinc-500 hover:text-zinc-200"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-cyan-400" />
      )}
      <span
        className={`rounded-md p-1.5 transition-colors ${
          active ? "bg-cyan-400/10" : "group-hover:bg-white/[0.04]"
        }`}
      >
        {children}
      </span>
      {typeof badge === "number" && badge > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[9px] font-bold text-[#06202a]">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

export function ActivityBar({
  view,
  onSelect,
  scmChangeCount = 0,
  enabledExtensionCount = 0,
}: ActivityBarProps) {
  return (
    <nav
      aria-label="Activity bar"
      className="flex w-11 flex-shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-navy/60 py-2"
    >
      <BarButton
        label="Explorer (Ctrl+Shift+E)"
        active={view === "explorer"}
        onClick={() => onSelect("explorer")}
      >
        <FilesIcon className="h-5 w-5" />
      </BarButton>
      <BarButton
        label="Source Control — GitHub"
        active={view === "scm"}
        onClick={() => onSelect("scm")}
        badge={view === "scm" ? 0 : scmChangeCount}
      >
        <GitBranchIcon className="h-5 w-5" />
      </BarButton>
      <BarButton
        label="Extensions"
        active={view === "extensions"}
        onClick={() => onSelect("extensions")}
        badge={view === "extensions" ? 0 : enabledExtensionCount}
      >
        <PuzzleIcon className="h-5 w-5" />
      </BarButton>
      <div className="flex-1" />
    </nav>
  );
}
