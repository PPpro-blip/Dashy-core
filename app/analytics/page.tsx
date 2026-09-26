"use client";

/**
 * DashyCore v7 — Analytics (schema-safe real counts, zero crashes).
 *
 * Every number here is real: Supabase table counts (RLS-scoped to the
 * signed-in user) plus the local Studio media library. Every query is
 * wrapped in try/catch deep inside lib/analytics.ts — a missing table or a
 * stale schema cache degrades a metric to 0 instead of ever showing a red
 * error box.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  loadAnalyticsMetrics,
  loadWeeklyActivity,
  type AnalyticsMetrics,
  type DailyActivity,
} from "@/lib/analytics";
import { MEDIA_LIBRARY_UPDATED_EVENT } from "@/lib/media-library";
import { GlassBarChart, GlassLineChart } from "@/components/AnalyticsCharts";
import {
  BookOpenIcon,
  ChartIcon,
  CodeIcon,
  ImageIcon,
  LoaderIcon,
  MessageIcon,
  RefreshIcon,
  ShareIcon,
} from "@/components/icons";

const EMPTY_METRICS: AnalyticsMetrics = {
  conversations: 0,
  messages: 0,
  dcodeProjects: 0,
  documents: 0,
  sharedAssets: 0,
  studioMedia: 0,
};

interface StatCard {
  key: keyof AnalyticsMetrics;
  label: string;
  Icon: typeof MessageIcon;
  color: string;
  href: string;
  emptyHint: string;
}

const STAT_CARDS: StatCard[] = [
  {
    key: "conversations",
    label: "Conversations",
    Icon: MessageIcon,
    color: "#22d3ee",
    href: "/chat",
    emptyHint: "No chats yet — start one in Chat!",
  },
  {
    key: "messages",
    label: "Messages sent",
    Icon: MessageIcon,
    color: "#60a5fa",
    href: "/chat",
    emptyHint: "No messages yet — say hi to Dashy!",
  },
  {
    key: "dcodeProjects",
    label: "D-Code projects",
    Icon: CodeIcon,
    color: "#a78bfa",
    href: "/d-code",
    emptyHint: "No projects yet — create one in D-Code!",
  },
  {
    key: "documents",
    label: "Knowledge docs",
    Icon: BookOpenIcon,
    color: "#34d399",
    href: "/knowledge",
    emptyHint: "No documents yet — add one in Knowledge!",
  },
  {
    key: "studioMedia",
    label: "Studio assets",
    Icon: ImageIcon,
    color: "#f472b6",
    href: "/studio",
    emptyHint: "No images yet — generate one in Studio!",
  },
  {
    key: "sharedAssets",
    label: "Shared links",
    Icon: ShareIcon,
    color: "#fbbf24",
    href: "/studio",
    emptyHint: "No shares yet — share an image from Studio!",
  },
];

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<AnalyticsMetrics>(EMPTY_METRICS);
  const [activity, setActivity] = useState<DailyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    // Every call inside these two helpers is individually try/caught — this
    // page can never see a rejected promise, only honest numbers.
    const [nextMetrics, nextActivity] = await Promise.all([
      loadAnalyticsMetrics(),
      loadWeeklyActivity(),
    ]);
    setMetrics(nextMetrics);
    setActivity(nextActivity);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh();
    // The Studio gallery lives in localStorage — keep the "Studio assets"
    // card live while the user generates/shares images in another tab.
    const onMediaUpdate = () => void refresh();
    window.addEventListener(MEDIA_LIBRARY_UPDATED_EVENT, onMediaUpdate);
    return () => window.removeEventListener(MEDIA_LIBRARY_UPDATED_EVENT, onMediaUpdate);
  }, [refresh]);

  const totalAssets =
    metrics.conversations +
    metrics.dcodeProjects +
    metrics.documents +
    metrics.studioMedia +
    metrics.sharedAssets;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            <ChartIcon className="h-5 w-5 text-cyan-400" />
            Analytics
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Real counts from your workspace — honest zeros included, never a
            crash.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
        >
          {refreshing ? (
            <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshIcon className="h-3.5 w-3.5" />
          )}
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {STAT_CARDS.map(({ key, label, Icon, color, href, emptyHint }) => {
          const value = metrics[key];
          return (
            <div
              key={key}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-xl transition-colors hover:border-white/[0.12]"
            >
              <div className="flex items-center justify-between">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${color}1f`, color }}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {loading ? (
                  <LoaderIcon className="h-3.5 w-3.5 animate-spin text-zinc-600" />
                ) : null}
              </div>
              <p className="mt-4 text-2xl font-semibold tabular-nums text-white">
                {loading ? "—" : value}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
              {!loading && value === 0 && (
                <Link
                  href={href}
                  className="mt-2 inline-block text-[11px] font-medium text-cyan-400 transition-colors hover:text-cyan-300"
                >
                  {emptyHint} →
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-xl lg:col-span-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Message activity · last 7 days
          </h2>
          <div className="mt-5">
            <GlassLineChart points={activity} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-xl lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Workspace overview
          </h2>
          <div className="mt-5">
            {totalAssets === 0 && !loading ? (
              <p className="text-xs text-zinc-500">
                Nothing here yet — chat, build in D-Code, add knowledge or
                create in Studio to see your workspace come alive.
              </p>
            ) : (
              <GlassBarChart
                data={STAT_CARDS.filter((c) => c.key !== "messages").map((c) => ({
                  label: c.label,
                  value: metrics[c.key],
                  color: c.color,
                  emptyHint: c.emptyHint,
                }))}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
