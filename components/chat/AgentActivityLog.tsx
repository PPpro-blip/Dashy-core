"use client";

/**
 * DashyCore v7 — shared Agent Mode activity accordion.
 *
 * Renders the worker's `activity: [{ type, message, tool, status }]` timeline
 * above an assistant reply. Used by both the chat workspace and the Agents
 * page so the two surfaces show agent reasoning identically.
 *
 * It never invents steps: when the payload has no activity the component
 * renders nothing at all.
 */

import { useState } from "react";
import {
  normalizeActivityStatus,
  type AgentActivity,
  type AgentActivityStatus,
} from "@/lib/chat-client";
import { ChevronDownIcon } from "@/components/icons";

const STATUS_STYLES: Record<AgentActivityStatus, string> = {
  running: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  done: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  error: "border-red-400/30 bg-red-400/10 text-red-300",
  skipped: "border-white/[0.08] bg-white/[0.03] text-zinc-500",
};

const STATUS_DOT: Record<AgentActivityStatus, string> = {
  running: "bg-cyan-400 animate-pulse",
  done: "bg-emerald-400",
  error: "bg-red-400",
  skipped: "bg-zinc-600",
};

export interface AgentActivityLogProps {
  activity: AgentActivity[] | undefined;
  /** Start expanded (default true — the reasoning is the point of the mode). */
  defaultOpen?: boolean;
  /** True while the reply is still arriving: shows a live indicator. */
  live?: boolean;
  title?: string;
  className?: string;
}

export function AgentActivityLog({
  activity,
  defaultOpen = true,
  live = false,
  title = "Agent Thinking / Activity",
  className,
}: AgentActivityLogProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!activity || activity.length === 0) return null;

  const failed = activity.some(
    (step) => normalizeActivityStatus(step.status) === "error"
  );

  return (
    <div
      className={`overflow-hidden rounded-xl border ${
        failed ? "border-red-400/20 bg-red-500/[0.04]" : "border-cyan-400/20 bg-cyan-500/[0.04]"
      } ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
          failed ? "hover:bg-red-500/[0.06]" : "hover:bg-cyan-500/[0.06]"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
            live ? "bg-cyan-400 animate-pulse" : failed ? "bg-red-400" : "bg-cyan-400"
          }`}
        />
        <span
          className={`text-xs font-semibold ${failed ? "text-red-300" : "text-cyan-300"}`}
        >
          {title}
        </span>
        <span className="rounded-full border border-white/[0.08] bg-black/25 px-1.5 py-px text-[10px] text-zinc-400">
          {activity.length} step{activity.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500">
          {open ? "Hide" : "Show"}
          <ChevronDownIcon
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open ? (
        <ol className="border-t border-cyan-400/10 px-3 py-2">
          {activity.map((step, index) => (
            <ActivityStep key={`${step.type}-${index}`} step={step} last={index === activity.length - 1} />
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ActivityStep({ step, last }: { step: AgentActivity; last: boolean }) {
  const status = normalizeActivityStatus(step.status);
  return (
    <li className="flex gap-2">
      {/* Timeline rail */}
      <span className="flex flex-col items-center pt-1.5">
        <span
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
            status ? STATUS_DOT[status] : "bg-zinc-600"
          }`}
        />
        {!last ? <span className="w-px flex-1 bg-white/[0.08]" /> : null}
      </span>

      <span className={`min-w-0 flex-1 ${last ? "pb-0.5" : "pb-2"}`}>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md border border-cyan-400/25 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
            {step.type}
          </span>
          {step.tool ? (
            <span className="rounded-md border border-white/[0.08] bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              {step.tool}
            </span>
          ) : null}
          {step.status ? (
            <span
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                status
                  ? STATUS_STYLES[status]
                  : "border-white/[0.08] bg-white/[0.03] text-zinc-400"
              }`}
            >
              {step.status}
            </span>
          ) : null}
        </span>
        {step.message ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-zinc-400">
            {step.message}
          </span>
        ) : null}
      </span>
    </li>
  );
}
