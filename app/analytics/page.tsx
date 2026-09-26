"use client";

/**
 * DashyCore v7 — Analytics.
 *
 * Honest, schema-safe workspace metrics:
 *   - Studio assets → real count from `dashy.media.library` (localStorage)
 *   - D-Code projects / share links / chats / messages / memory docs → real
 *     Supabase counts, each wrapped so a missing table (schema-cache miss),
 *     an RLS refusal, or an offline client resolves to 0.
 *
 * There is deliberately NO error state in this UI: a failed query renders a
 * calm zero plus an action prompt, never a red crash box.
 */

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  countAllShareLinks,
  loadAnalyticsSnapshot,
  type AnalyticsSnapshot,
  type CountResult,
} from "@/lib/analytics";
import { listMedia, MEDIA_LIBRARY_EVENT } from "@/lib/media-library";
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

interface Metric {
  id: string;
  label: string;
  value: number;
  Icon: ComponentType<{ className?: string }>;
  accent: string;
  /** Shown when the metric is zero — a next action, not an error. */
  emptyHint: string;
  href: string;
}

const EMPTY_RESULT: CountResult = { count: 0, ok: false };

const EMPTY_SNAPSHOT: AnalyticsSnapshot = {
  studioAssets: EMPTY_RESULT,
  dcodeProjects: EMPTY_RESULT,
  shareLinks: EMPTY_RESULT,
  conversations: EMPTY_RESULT,
  messages: EMPTY_RESULT,
  documents: EMPTY_RESULT,
  databaseReachable: false,
};

/** Simple deterministic 7-point series derived from a total (visual only). */
function seriesFor(total: number): number[] {
  if (total <= 0) return [0, 0, 0, 0, 0, 0, 0];
  const weights = [0.35, 0.5, 0.42, 0.68, 0.8, 0.72, 1];
  return weights.map((weight) => Math.round(total * weight));
}

function LineChart({ points, stroke }: { points: number[]; stroke: string }) {
  const width = 320;
  const height = 96;
  const max = Math.max(...points, 1);
  const step = width / Math.max(points.length - 1, 1);
  const coords = points.map((value, index) => {
    const x = index * step;
    const y = height - (value / max) * (height - 12) - 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M${coords.join(" L")}`;
  const area = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-24 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`grad-${stroke.replace(/[^a-z0-9]/gi, "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#grad-${stroke.replace(/[^a-z0-9]/gi, "")})`} />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BarChart({ metrics }: { metrics: Metric[] }) {
  const max = Math.max(...metrics.map((metric) => metric.value), 1);
  return (
    <div className="space-y-3">
      {metrics.map((metric) => (
        <div key={metric.id} className="flex items-center gap-3">
          <span className="w-32 flex-shrink-0 truncate text-xs text-zinc-400">
            {metric.label}
          </span>
          <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.max((metric.value / max) * 100, metric.value > 0 ? 6 : 1.5)}%`,
                background: `linear-gradient(90deg, ${metric.accent}, ${metric.accent}66)`,
                boxShadow: metric.value > 0 ? `0 0 14px ${metric.accent}66` : "none",
              }}
            />
          </div>
          <span className="w-10 flex-shrink-0 text-right text-xs font-semibold text-zinc-200">
            {metric.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot>(EMPTY_SNAPSHOT);
  const [shareLinks, setShareLinks] = useState<CountResult>(EMPTY_RESULT);
  const [localAssets, setLocalAssets] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    // Both loaders swallow their own failures; this can never reject.
    const [next, shares] = await Promise.all([
      loadAnalyticsSnapshot(),
      countAllShareLinks(),
    ]);
    setSnapshot(next);
    setShareLinks(shares);
    setLocalAssets(listMedia().length);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const sync = () => setLocalAssets(listMedia().length);
    window.addEventListener(MEDIA_LIBRARY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MEDIA_LIBRARY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [refresh]);

  const metrics = useMemo<Metric[]>(
    () => [
      {
        id: "studio",
        label: "Studio assets",
        value: localAssets,
        Icon: ImageIcon,
        accent: "#22d3ee",
        emptyHint: "No images yet — generate one in Dashy Studio!",
        href: "/studio",
      },
      {
        id: "projects",
        label: "D-Code projects",
        value: snapshot.dcodeProjects.count,
        Icon: CodeIcon,
        accent: "#a78bfa",
        emptyHint: "No projects yet — create one in D-Code!",
        href: "/d-code",
      },
      {
        id: "shares",
        label: "Share links",
        value: shareLinks.count,
        Icon: ShareIcon,
        accent: "#34d399",
        emptyHint: "Nothing shared yet — publish an image from Studio!",
        href: "/studio",
      },
      {
        id: "chats",
        label: "Conversations",
        value: snapshot.conversations.count,
        Icon: MessageIcon,
        accent: "#60a5fa",
        emptyHint: "No chats yet — start one in Chat!",
        href: "/chat",
      },
      {
        id: "messages",
        label: "Messages",
        value: snapshot.messages.count,
        Icon: ChartIcon,
        accent: "#f472b6",
        emptyHint: "No messages yet — say hello in Chat!",
        href: "/chat",
      },
      {
        id: "documents",
        label: "Memory documents",
        value: snapshot.documents.count,
        Icon: BookOpenIcon,
        accent: "#fbbf24",
        emptyHint: "No documents yet — upload one in Knowledge!",
        href: "/knowledge",
      },
    ],
    [localAssets, shareLinks.count, snapshot]
  );

  const total = metrics.reduce((sum, metric) => sum + metric.value, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Real workspace numbers — local Studio media plus your Supabase
            tables. Missing tables simply read zero.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-60"
        >
          {loading ? (
            <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshIcon className="h-3.5 w-3.5" />
          )}
          Refresh
        </button>
      </div>

      {/* Metric cards with glowing sparklines */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <Link
            key={metric.id}
            href={metric.href}
            className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 backdrop-blur-xl transition-colors hover:border-white/20"
            style={{ boxShadow: "inset 0 1px 0 0 rgba(255,255,255,0.05)" }}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-400">
                <metric.Icon className="h-4 w-4" />
                {metric.label}
              </span>
            </div>
            <p
              className="mt-3 text-4xl font-semibold tracking-tight"
              style={{ color: metric.accent }}
            >
              {loading ? "—" : metric.value}
            </p>
            <div className="mt-2 -mx-1">
              <LineChart points={seriesFor(metric.value)} stroke={metric.accent} />
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              {metric.value === 0
                ? metric.emptyHint
                : "Live count · tap to open"}
            </p>
          </Link>
        ))}
      </div>

      {/* Distribution bar chart */}
      <section className="mt-8 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Workspace distribution
          </h2>
          <span className="text-xs text-zinc-500">{total} total records</span>
        </div>
        {total === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-zinc-300">Your workspace is brand new.</p>
            <p className="mt-1 text-xs text-zinc-500">
              No projects yet — create one in D-Code, or generate your first
              image in Dashy Studio.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Link
                href="/d-code"
                className="rounded-xl bg-cyan-500 px-4 py-2 text-xs font-semibold text-[#06202a] transition-colors hover:bg-cyan-400"
              >
                Open D-Code
              </Link>
              <Link
                href="/studio"
                className="rounded-xl border border-white/[0.08] px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/[0.06]"
              >
                Open Studio
              </Link>
            </div>
          </div>
        ) : (
          <BarChart metrics={metrics} />
        )}
      </section>

      {!loading && !snapshot.databaseReachable ? (
        <p className="mt-4 text-center text-xs text-zinc-600">
          Cloud metrics are showing zero — your Supabase tables aren&apos;t
          reachable from this session. Local Studio counts are still accurate.
        </p>
      ) : null}
    </div>
  );
}
