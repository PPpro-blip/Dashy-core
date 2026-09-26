"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { listStudioMedia, STUDIO_MEDIA_UPDATED_EVENT } from "@/lib/studio";
import {
  ChartIcon,
  CodeIcon,
  ImageIcon,
  LoaderIcon,
  MessageIcon,
  RefreshIcon,
  ShareIcon,
} from "@/components/icons";

type Range = 7 | 30;

type TimestampRow = { created_at: string | null };
type ProjectRow = TimestampRow;
type ConversationRow = TimestampRow & { id: string };
type MessageRow = TimestampRow;

/** Every metric degrades to 0 when its table is missing or unreadable. */
interface LiveAnalytics {
  projectTotal: number;
  conversationTotal: number;
  messageTotal: number;
  studioTotal: number;
  shareTotal: number;
  projectDates: string[];
  conversationDates: string[];
  messageDates: string[];
  studioDates: string[];
  shareDates: string[];
  /** Tables whose queries failed — surfaced as a muted hint, never a crash. */
  degraded: string[];
  signedIn: boolean;
}

const EMPTY_ANALYTICS: LiveAnalytics = {
  projectTotal: 0,
  conversationTotal: 0,
  messageTotal: 0,
  studioTotal: 0,
  shareTotal: 0,
  projectDates: [],
  conversationDates: [],
  messageDates: [],
  studioDates: [],
  shareDates: [],
  degraded: [],
  signedIn: false,
};

interface DayBucket {
  key: string;
  label: string;
  projects: number;
  conversations: number;
  messages: number;
  studio: number;
  shares: number;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRangeStart(days: number): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

function dates(rows: TimestampRow[] | null): string[] {
  return (rows ?? [])
    .map((row) => row.created_at)
    .filter((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

async function loadLiveAnalytics(): Promise<LiveAnalytics> {
  // Studio media is local-only, so it is always available even offline.
  const studioItems = listStudioMedia();
  const studioDates = studioItems
    .map((item) => item.createdAt)
    .filter((value) => !Number.isNaN(Date.parse(value)));
  const localOnly = (signedIn: boolean, degraded: string[]): LiveAnalytics => ({
    ...EMPTY_ANALYTICS,
    signedIn,
    degraded,
    studioTotal: studioItems.length,
    studioDates,
  });

  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = createClient();
  } catch {
    return localOnly(false, ["supabase"]);
  }

  let user: { id: string } | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user ?? null;
  } catch {
    user = null;
  }
  if (!user) return localOnly(false, []);

  const windowStart = dateRangeStart(30).toISOString();
  const degraded: string[] = [];

  const [
    projectCountResult,
    projectTimelineResult,
    conversationCountResult,
    conversationTimelineResult,
    publicProjectCountResult,
    publicProjectsResult,
    publicAssetCountResult,
    publicAssetsResult,
  ] = await Promise.all([
    supabase.from("dcode_projects").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("dcode_projects")
      .select("created_at, is_public")
      .eq("user_id", user.id)
      .gte("created_at", windowStart),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("conversations")
      .select("id, created_at")
      .eq("user_id", user.id)
      .gte("created_at", windowStart),
    supabase
      .from("dcode_projects")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_public", true),
    supabase
      .from("dcode_projects")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("is_public", true)
      .gte("created_at", windowStart),
    supabase
      .from("shared_assets")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("is_public", true),
    supabase
      .from("shared_assets")
      .select("created_at")
      .eq("owner_id", user.id)
      .eq("is_public", true)
      .gte("created_at", windowStart),
  ]);

  // Schema safety: a missing table (schema-cache miss), an RLS refusal or a
  // renamed column must never crash the dashboard — the metric reads 0.
  const noteIfFailed = (table: string, error: { message: string } | null) => {
    if (error && !degraded.includes(table)) degraded.push(table);
  };
  noteIfFailed("dcode_projects", projectCountResult.error);
  noteIfFailed("dcode_projects", projectTimelineResult.error);
  noteIfFailed("conversations", conversationCountResult.error);
  noteIfFailed("conversations", conversationTimelineResult.error);
  noteIfFailed("dcode_projects", publicProjectCountResult.error);
  noteIfFailed("dcode_projects", publicProjectsResult.error);
  noteIfFailed("shared_assets", publicAssetCountResult.error);
  noteIfFailed("shared_assets", publicAssetsResult.error);

  const conversations = (conversationTimelineResult.data ?? []) as ConversationRow[];

  // The inner relation keeps the count scoped to the current owner even for
  // accounts with more than one page of conversations. It avoids turning a
  // partial client-side ID list into a misleading total.
  const [messageCountResult, messageTimelineResult] = await Promise.all([
    supabase
      .from("messages")
      .select("id, conversations!inner(user_id)", { count: "exact", head: true })
      .eq("conversations.user_id", user.id),
    supabase
      .from("messages")
      .select("created_at, conversations!inner(user_id)")
      .eq("conversations.user_id", user.id)
      .gte("created_at", windowStart),
  ]);
  noteIfFailed("messages", messageCountResult.error);
  noteIfFailed("messages", messageTimelineResult.error);
  const messageCount = messageCountResult.count ?? 0;
  const messageRows = (messageTimelineResult.data ?? []) as MessageRow[];

  const projectRows = (projectTimelineResult.data ?? []) as ProjectRow[];
  const publicProjectRows = (publicProjectsResult.data ?? []) as TimestampRow[];
  const publicAssetRows = (publicAssetsResult.data ?? []) as TimestampRow[];

  return {
    projectTotal: projectCountResult.count ?? 0,
    conversationTotal: conversationCountResult.count ?? 0,
    messageTotal: messageCount,
    studioTotal: studioItems.length,
    // These are only real public database rows—D-Code project shares plus
    // Studio shared_assets. No client-side or dummy share count is mixed in.
    shareTotal: (publicProjectCountResult.count ?? 0) + (publicAssetCountResult.count ?? 0),
    projectDates: dates(projectRows),
    conversationDates: dates(conversations),
    messageDates: dates(messageRows),
    studioDates,
    shareDates: [...dates(publicProjectRows), ...dates(publicAssetRows)],
    degraded,
    signedIn: true,
  };
}

function buildBuckets(analytics: LiveAnalytics, range: Range): DayBucket[] {
  const buckets: DayBucket[] = [];
  const byDate = new Map<string, DayBucket>();
  const start = dateRangeStart(range);

  for (let offset = 0; offset < range; offset += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    const bucket: DayBucket = {
      key: localDateKey(date),
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      projects: 0,
      conversations: 0,
      messages: 0,
      studio: 0,
      shares: 0,
    };
    buckets.push(bucket);
    byDate.set(bucket.key, bucket);
  }

  const add = (values: string[], field: keyof Omit<DayBucket, "key" | "label">) => {
    values.forEach((value) => {
      const bucket = byDate.get(localDateKey(new Date(value)));
      if (bucket) bucket[field] += 1;
    });
  };
  add(analytics.projectDates, "projects");
  add(analytics.conversationDates, "conversations");
  add(analytics.messageDates, "messages");
  add(analytics.studioDates, "studio");
  add(analytics.shareDates, "shares");
  return buckets;
}

function LineChart({ buckets }: { buckets: DayBucket[] }) {
  const values = buckets.map((bucket) => bucket.projects + bucket.conversations + bucket.messages + bucket.studio + bucket.shares);
  const max = Math.max(...values, 1);
  const width = 640;
  const height = 180;
  const padding = 16;
  const step = buckets.length > 1 ? (width - padding * 2) / (buckets.length - 1) : 0;
  const points = values
    .map((value, index) => {
      const x = padding + index * step;
      const y = height - padding - (value / max) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="mt-5 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 min-w-[520px] w-full" role="img" aria-label="Combined daily live activity">
        {[0.25, 0.5, 0.75].map((position) => (
          <line key={position} x1={padding} x2={width - padding} y1={height * position} y2={height * position} stroke="rgba(255,255,255,0.07)" strokeDasharray="4 4" />
        ))}
        <polyline points={points} fill="none" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {buckets.map((bucket, index) => {
          const value = values[index];
          const x = padding + index * step;
          const y = height - padding - (value / max) * (height - padding * 2);
          return (
            <g key={bucket.key}>
              <title>{`${bucket.label}: ${value} recorded activity item${value === 1 ? "" : "s"}`}</title>
              <circle cx={x} cy={y} r="4" fill="#0d1020" stroke="#67e8f9" strokeWidth="2" />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 grid min-w-[520px]" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
        {buckets.map((bucket) => <span key={bucket.key} className="text-center text-[10px] text-zinc-600">{bucket.label}</span>)}
      </div>
    </div>
  );
}

function ActivityBars({ buckets }: { buckets: DayBucket[] }) {
  const fields: Array<{ field: keyof Omit<DayBucket, "key" | "label">; label: string; className: string }> = [
    { field: "projects", label: "Projects", className: "bg-violet-400" },
    { field: "conversations", label: "Chats", className: "bg-sky-400" },
    { field: "messages", label: "Messages", className: "bg-cyan-300" },
    { field: "studio", label: "Studio", className: "bg-fuchsia-400" },
    { field: "shares", label: "Shares", className: "bg-emerald-400" },
  ];
  const max = Math.max(1, ...buckets.flatMap((bucket) => fields.map(({ field }) => bucket[field])));

  return (
    <div className="mt-5 overflow-x-auto">
      <div className="flex min-w-[600px] items-end gap-2" style={{ height: "176px" }}>
        {buckets.map((bucket) => (
          <div key={bucket.key} className="flex h-full min-w-0 flex-1 items-end justify-center gap-px" title={`${bucket.label}: ${fields.map(({ field, label }) => `${label} ${bucket[field]}`).join(", ")}`}>
            {fields.map(({ field, className }) => (
              <span key={field} className={`min-w-[3px] flex-1 rounded-t-sm ${className}`} style={{ height: `${(bucket[field] / max) * 100}%`, minHeight: bucket[field] > 0 ? "3px" : "0" }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 grid min-w-[600px]" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
        {buckets.map((bucket) => <span key={bucket.key} className="text-center text-[10px] text-zinc-600">{bucket.label}</span>)}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {fields.map(({ field, label, className }) => <span key={field} className="flex items-center gap-1.5 text-[11px] text-zinc-500"><i className={`h-2 w-2 rounded-full ${className}`} />{label}</span>)}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<LiveAnalytics | null>(null);
  const [range, setRange] = useState<Range>(7);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAnalytics(await loadLiveAnalytics());
    } catch {
      // Last-resort guard: the dashboard shows honest zeros, never a crash.
      setAnalytics(EMPTY_ANALYTICS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onStudioChange = () => void refresh();
    window.addEventListener(STUDIO_MEDIA_UPDATED_EVENT, onStudioChange);
    window.addEventListener("storage", onStudioChange);
    return () => {
      window.removeEventListener(STUDIO_MEDIA_UPDATED_EVENT, onStudioChange);
      window.removeEventListener("storage", onStudioChange);
    };
  }, [refresh]);

  const buckets = useMemo(() => (analytics ? buildBuckets(analytics, range) : []), [analytics, range]);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-cyan-300"><ChartIcon className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-[0.16em]">Live workspace data</span></div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">Projects, conversations, Studio media and shares from your real activity.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.025] p-1">
            {([7, 30] as const).map((value) => <button key={value} type="button" onClick={() => setRange(value)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${range === value ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500 hover:text-zinc-200"}`}>{value} days</button>)}
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-2 text-zinc-400 hover:border-cyan-400/30 hover:text-cyan-200 disabled:opacity-50" aria-label="Refresh analytics" title="Refresh analytics"><RefreshIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </div>

      {loading && !analytics ? (
        <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-zinc-500"><LoaderIcon className="h-4 w-4 animate-spin text-cyan-400" />Loading live analytics…</div>
      ) : analytics ? (
        <>
          <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard icon={<CodeIcon className="h-4 w-4" />} label="D-Code projects" value={analytics.projectTotal} />
            <MetricCard icon={<MessageIcon className="h-4 w-4" />} label="Conversations" value={analytics.conversationTotal} />
            <MetricCard icon={<MessageIcon className="h-4 w-4" />} label="Chat turns" value={analytics.messageTotal} />
            <MetricCard icon={<ImageIcon className="h-4 w-4" />} label="Studio media" value={analytics.studioTotal} />
            <MetricCard icon={<ShareIcon className="h-4 w-4" />} label="Public shares" value={analytics.shareTotal} />
          </section>

          <section className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 xl:col-span-3">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-zinc-100">Daily activity</h2><p className="mt-1 text-xs text-zinc-500">All recorded items across the selected period.</p></div><span className="text-[11px] uppercase tracking-wider text-zinc-600">Last {range} days</span></div>
              <LineChart buckets={buckets} />
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 xl:col-span-2">
              <h2 className="text-sm font-semibold text-zinc-100">Activity by source</h2>
              <p className="mt-1 text-xs text-zinc-500">Daily timestamps grouped from live records.</p>
              <ActivityBars buckets={buckets} />
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
            {analytics.shareTotal === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div><h2 className="text-sm font-semibold text-zinc-100">0 public shares</h2><p className="mt-1 text-sm text-zinc-500">No shares yet — Share your first project!</p></div>
                <Link href="/studio" className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-[#06202a] hover:bg-cyan-400"><ShareIcon className="h-4 w-4" />Open Studio</Link>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4"><div><h2 className="text-sm font-semibold text-zinc-100">Public sharing is active</h2><p className="mt-1 text-sm text-zinc-500">{analytics.shareTotal} real public {analytics.shareTotal === 1 ? "record" : "records"} found in your workspace.</p></div><Link href="/studio" className="text-sm font-medium text-cyan-300 hover:text-cyan-200">Manage Studio shares →</Link></div>
            )}
          </section>

          {analytics.projectTotal === 0 &&
          analytics.conversationTotal === 0 &&
          analytics.messageTotal === 0 &&
          analytics.studioTotal === 0 ? (
            <section className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 text-center">
              <p className="text-sm text-zinc-300">Your workspace is brand new.</p>
              <p className="mt-1 text-xs text-zinc-500">No projects yet — create one in D-Code, or generate your first image in Dashy Studio.</p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Link href="/d-code" className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-[#06202a] hover:bg-cyan-400">Open D-Code</Link>
                <Link href="/studio" className="rounded-xl border border-white/[0.08] px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-white/[0.06]">Open Studio</Link>
              </div>
            </section>
          ) : null}

          {!analytics.signedIn ? (
            <p className="mt-4 text-center text-xs text-zinc-600">Showing local Studio activity only — sign in to include your cloud workspace records.</p>
          ) : analytics.degraded.length > 0 ? (
            <p className="mt-4 text-center text-xs text-zinc-600">
              Some cloud metrics read zero because {analytics.degraded.join(", ")}{" "}
              {analytics.degraded.length === 1 ? "is" : "are"} not reachable in this Supabase project yet. Everything else is live.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <article className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4"><div className="flex items-center gap-2 text-zinc-500">{icon}<span className="text-[11px] font-semibold uppercase tracking-[0.1em]">{label}</span></div><p className="mt-3 text-3xl font-semibold tracking-tight text-zinc-100">{value.toLocaleString()}</p></article>;
}
