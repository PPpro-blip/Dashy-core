"use client";

/**
 * DashyCore — /analytics — live analytics command center.
 *
 *   📈 Project Velocity   views / shares / new projects, last 7 days
 *   🖼️ Studio Activity    images generated per day (Media Library)
 *   🧠 Memory Usage       Knowledge Digest documents vs quota
 *
 * Data: /api/analytics (Supabase, RLS-scoped raw timestamps, bucketed here
 * in the viewer's timezone) + this browser's Studio Media Library. Every
 * panel carries a source badge — "Live", or "Sample" when the backing data
 * does not exist yet (e.g. no `share_views` table → sample views). With no
 * real activity at all the dashboard opens in Demo mode so the trends are
 * visible; the Live/Demo switch is always one click away.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  bucketCounts,
  lastDays,
  percentChange,
  readStudioGenerations,
  sampleSeries,
  sum,
  type AnalyticsPayload,
  type SeriesSource,
} from "@/lib/analytics";
import {
  DASHY_CYAN,
  ELECTRIC_PURPLE,
  GlowBarChart,
  GlowLineChart,
  RadialGauge,
  SOFT_PINK,
  Sparkline,
} from "@/components/analytics/Charts";
import {
  ActivityIcon,
  BrainIcon,
  DatabaseIcon,
  EyeIcon,
  FolderIcon,
  ImageIcon,
  MessageIcon,
  RefreshIcon,
  ShareIcon,
} from "@/components/icons";

type Mode = "live" | "demo";
const REFRESH_MS = 60_000;

function SourceBadge({ source }: { source: SeriesSource | "demo" }) {
  const styles: Record<string, string> = {
    live: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    mock: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    demo: "border-violet-400/30 bg-violet-400/10 text-violet-200",
    unavailable: "border-zinc-600/40 bg-zinc-700/20 text-zinc-400",
  };
  const label = { live: "Live", mock: "Sample", demo: "Demo", unavailable: "Unavailable" }[source];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[source]}`}>
      {source === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />}
      {label}
    </span>
  );
}

function Panel({
  title,
  icon,
  badge,
  subtitle,
  children,
  className = "",
  glow = "cyan",
}: {
  title: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  glow?: "cyan" | "purple";
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.035] p-5 shadow-2xl shadow-black/40 backdrop-blur-xl ${className}`}
    >
      <div
        className={`pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full blur-3xl ${
          glow === "cyan" ? "bg-cyan-500/10" : "bg-violet-600/15"
        }`}
      />
      <header className="relative mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-cyan-300">
            {icon}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            {subtitle && <p className="text-[11px] text-zinc-500">{subtitle}</p>}
          </div>
        </div>
        {badge}
      </header>
      <div className="relative">{children}</div>
    </section>
  );
}

function StatCard({
  label,
  value,
  delta,
  spark,
  color,
  icon,
  hint,
}: {
  label: string;
  value: number | null;
  delta: number | null;
  spark: number[];
  color: string;
  icon: React.ReactNode;
  hint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-xl transition-colors hover:border-cyan-400/25">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <span style={{ color }}>{icon}</span>
          {label}
        </span>
        {delta !== null && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
              delta >= 0 ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300"
            }`}
          >
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="text-2xl font-bold tabular-nums text-white">{value === null ? "—" : value.toLocaleString()}</p>
          <p className="text-[11px] text-zinc-500">{hint}</p>
        </div>
        <Sparkline values={spark} color={color} />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [studio, setStudio] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/analytics?days=14", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }
      setData((await response.json()) as AnalyticsPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load analytics");
    } finally {
      setStudio(readStudioGenerations());
      setNow(new Date());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  /* ------------------------------ derived series ---------------------------- */

  const view = useMemo(() => {
    const buckets14 = lastDays(14, now);
    const week = buckets14.slice(7);
    const prev = buckets14.slice(0, 7);
    const split = (values: number[]) => ({ cur: values.slice(7), prev: values.slice(0, 7) });

    const real = {
      projects: split(bucketCounts(data?.projects.createdAt ?? [], buckets14)),
      shares: split(bucketCounts(data?.shares.at ?? [], buckets14)),
      conversations: split(bucketCounts(data?.conversations.createdAt ?? [], buckets14)),
      views: split(bucketCounts(data?.views.at ?? [], buckets14)),
      studio: split(bucketCounts(studio, buckets14)),
    };
    const hasRealActivity =
      sum(real.projects.cur) + sum(real.projects.prev) + sum(real.shares.cur) + sum(real.shares.prev) +
        sum(real.conversations.cur) + sum(real.conversations.prev) + sum(real.studio.cur) + sum(real.studio.prev) >
      0;

    const sample = (key: string, base: number, growth?: number) => split(sampleSeries(key, buckets14, base, growth));
    const demo = {
      projects: sample("projects", 2, 0.06),
      shares: sample("shares", 5, 0.1),
      conversations: sample("conversations", 6, 0.07),
      views: sample("views", 38, 0.11),
      studio: sample("studio", 7, 0.09),
    };
    // Views have no real table until `share_views` exists → sample even in Live.
    const viewsAreSample = data?.views.source !== "live";
    const liveViews = viewsAreSample
      ? sample("views-live", Math.max(4, ((data?.shares.publicTotal ?? 0) + 1) * 6), 0.1)
      : real.views;

    return { week, prev, real, demo, liveViews, viewsAreSample, hasRealActivity };
  }, [data, studio, now]);

  // First load decides the default: Demo only when there is nothing real yet.
  useEffect(() => {
    if (mode === null && !loading && (data || error)) setMode(view.hasRealActivity ? "live" : "demo");
  }, [mode, loading, data, error, view.hasRealActivity]);

  const activeMode: Mode = mode ?? "live";
  const s = activeMode === "demo" ? view.demo : { ...view.real, views: view.liveViews };
  const badgeFor = (source: SeriesSource | undefined): SeriesSource | "demo" =>
    activeMode === "demo" ? "demo" : source ?? "unavailable";

  const labels = view.week.map((b) => b.label);
  const longLabels = view.week.map((b) => b.longLabel);

  const memory = data?.memory;
  const memDocs = activeMode === "demo" ? 64 : memory?.documents ?? 0;
  const memQuota = memory?.quota ?? 100;
  const memChunks = activeMode === "demo" ? 1480 : memory?.chunks ?? null;

  const lastUpdated = data ? new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="relative min-h-full overflow-hidden bg-[#070a13] px-4 py-8 text-white sm:px-6 md:px-10">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-cyan-500/10 blur-[110px]" />
      <div className="pointer-events-none absolute -right-40 top-40 h-[30rem] w-[30rem] rounded-full bg-violet-600/15 blur-[120px]" />

      <div className="relative mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-6">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/20 text-cyan-300">
                <ActivityIcon className="h-3.5 w-3.5" />
              </span>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Command Center</p>
            </div>
            <h1 className="bg-gradient-to-r from-white via-cyan-100 to-violet-200 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
              Analytics
            </h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-400">
              Velocity, Studio output and memory — the last 7 days, in your timezone.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-2 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
              </span>
              <span className="text-[11px] font-medium text-cyan-100">
                {loading && !data ? "Connecting…" : lastUpdated ? `Updated ${lastUpdated}` : "Offline"}
              </span>
            </div>
            <div role="tablist" aria-label="Data mode" className="flex rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1">
              {(["live", "demo"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={activeMode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-all ${
                    activeMode === m
                      ? m === "live"
                        ? "bg-cyan-400/15 text-cyan-200 shadow-lg shadow-cyan-950/40"
                        : "bg-violet-500/20 text-violet-100 shadow-lg shadow-violet-950/40"
                      : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              title="Refresh now"
              aria-label="Refresh analytics"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-zinc-400 transition hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
            >
              <RefreshIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {error && (
          <p role="alert" className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-xs text-amber-200">
            Live data unavailable: {error}. Studio activity (from this browser) and Demo mode still work.
          </p>
        )}
        {activeMode === "demo" && (
          <p className="rounded-2xl border border-violet-400/25 bg-violet-500/[0.08] px-4 py-3 text-xs text-violet-100">
            Demo mode — sample trends so you can see the dashboard in action.
            {view.hasRealActivity ? " Switch to Live for your real numbers." : " Create projects, chats or Studio images and Live mode fills in automatically."}
          </p>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Projects"
            icon={<FolderIcon className="h-3.5 w-3.5" />}
            value={activeMode === "demo" ? 24 : data?.projects.total ?? null}
            delta={percentChange(sum(s.projects.cur), sum(s.projects.prev))}
            spark={s.projects.cur}
            color={SOFT_PINK}
            hint={`+${sum(s.projects.cur)} this week`}
          />
          <StatCard
            label="Conversations"
            icon={<MessageIcon className="h-3.5 w-3.5" />}
            value={sum(s.conversations.cur)}
            delta={percentChange(sum(s.conversations.cur), sum(s.conversations.prev))}
            spark={s.conversations.cur}
            color={DASHY_CYAN}
            hint="new this week"
          />
          <StatCard
            label="Images"
            icon={<ImageIcon className="h-3.5 w-3.5" />}
            value={sum(s.studio.cur)}
            delta={percentChange(sum(s.studio.cur), sum(s.studio.prev))}
            spark={s.studio.cur}
            color={ELECTRIC_PURPLE}
            hint="generated this week"
          />
          <StatCard
            label="Views"
            icon={<EyeIcon className="h-3.5 w-3.5" />}
            value={sum(s.views.cur)}
            delta={percentChange(sum(s.views.cur), sum(s.views.prev))}
            spark={s.views.cur}
            color="#818cf8"
            hint={activeMode === "live" && view.viewsAreSample ? "sample · wire share_views" : "share views this week"}
          />
        </div>

        {/* Velocity + Memory */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Project Velocity"
            subtitle="Views, shares and new projects per day"
            icon={<ActivityIcon className="h-4 w-4" />}
            badge={
              <div className="flex items-center gap-1.5">
                {activeMode === "live" && view.viewsAreSample && (
                  <span title="No share_views table yet — views are sample data" className="text-[10px] text-amber-300/80">
                    views: sample
                  </span>
                )}
                <SourceBadge source={badgeFor(data?.projects.source)} />
              </div>
            }
          >
            <GlowLineChart
              labels={labels}
              longLabels={longLabels}
              series={[
                { name: "Views", color: ELECTRIC_PURPLE, values: s.views.cur, area: true, dashed: activeMode === "live" && view.viewsAreSample },
                { name: "Shares", color: DASHY_CYAN, values: s.shares.cur, area: true },
                { name: "New projects", color: SOFT_PINK, values: s.projects.cur },
              ]}
            />
            <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-zinc-400">
              {[
                { name: "Views", color: ELECTRIC_PURPLE, total: sum(s.views.cur) },
                { name: "Shares", color: DASHY_CYAN, total: sum(s.shares.cur) },
                { name: "New projects", color: SOFT_PINK, total: sum(s.projects.cur) },
              ].map((item) => (
                <span key={item.name} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }} />
                  {item.name}
                  <span className="font-semibold tabular-nums text-zinc-200">{item.total}</span>
                </span>
              ))}
            </div>
          </Panel>

          <Panel
            title="Memory Usage"
            subtitle="Knowledge Digest"
            glow="purple"
            icon={<BrainIcon className="h-4 w-4" />}
            badge={<SourceBadge source={badgeFor(memory?.source)} />}
          >
            <div className="flex flex-col items-center">
              <RadialGauge
                value={memDocs}
                max={memQuota}
                label="of quota"
                sublabel={`${memDocs.toLocaleString()} / ${memQuota.toLocaleString()} docs`}
              />
              <div className="mt-2 grid w-full grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border border-white/[0.06] bg-black/20 px-2 py-2">
                  <p className="text-lg font-bold tabular-nums text-cyan-200">{memDocs.toLocaleString()}</p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Documents</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-black/20 px-2 py-2">
                  <p className="text-lg font-bold tabular-nums text-violet-200">{memChunks === null ? "—" : memChunks.toLocaleString()}</p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Chunks</p>
                </div>
              </div>
              <Link href="/knowledge" className="mt-3 text-[11px] font-medium text-cyan-300/80 transition hover:text-cyan-200">
                Manage knowledge →
              </Link>
            </div>
          </Panel>
        </div>

        {/* Studio + Sources */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Studio Activity"
            subtitle="Images generated per day"
            glow="purple"
            icon={<ImageIcon className="h-4 w-4" />}
            badge={<SourceBadge source={activeMode === "demo" ? "demo" : "live"} />}
          >
            <GlowBarChart labels={labels} longLabels={longLabels} values={s.studio.cur} name="Images" />
            {activeMode === "live" && sum(s.studio.cur) === 0 && (
              <p className="mt-2 text-center text-[11px] text-zinc-500">
                No images this week —{" "}
                <Link href="/studio" className="text-cyan-300 hover:text-cyan-200">
                  open Studio
                </Link>{" "}
                to generate some.
              </p>
            )}
          </Panel>

          <Panel title="Data Sources" subtitle="Where each metric comes from" icon={<DatabaseIcon className="h-4 w-4" />}>
            <ul className="space-y-2.5 text-xs">
              {[
                { label: "Projects", detail: data?.projects.table ?? "dcode_projects", source: data?.projects.source, icon: <FolderIcon className="h-3.5 w-3.5" /> },
                { label: "Shares", detail: "public projects · updated_at", source: data?.shares.source, icon: <ShareIcon className="h-3.5 w-3.5" /> },
                { label: "Conversations", detail: "conversations · created_at", source: data?.conversations.source, icon: <MessageIcon className="h-3.5 w-3.5" /> },
                { label: "Views", detail: data?.views.source === "live" ? "share_views · viewed_at" : "add a share_views table", source: data?.views.source, icon: <EyeIcon className="h-3.5 w-3.5" /> },
                { label: "Studio", detail: "this browser's Media Library", source: "live" as SeriesSource, icon: <ImageIcon className="h-3.5 w-3.5" /> },
                { label: "Memory", detail: "documents + document_chunks", source: data?.memory.source, icon: <BrainIcon className="h-3.5 w-3.5" /> },
              ].map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.05] bg-black/20 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-zinc-500">{row.icon}</span>
                    <span className="min-w-0">
                      <span className="block font-medium text-zinc-200">{row.label}</span>
                      <span className="block truncate font-mono text-[10px] text-zinc-500">{row.detail}</span>
                    </span>
                  </span>
                  <SourceBadge source={row.source ?? (loading ? "live" : "unavailable")} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
