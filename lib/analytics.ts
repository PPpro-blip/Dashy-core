/**
 * DashyCore — analytics helpers (pure, isomorphic).
 *
 * Shared contract between /api/analytics (raw timestamps) and the
 * /analytics dashboard (local-timezone day buckets, sample-data fallback).
 */

export type SeriesSource = "live" | "mock" | "unavailable";

export interface AnalyticsPayload {
  generatedAt: string;
  days: number;
  projects: { source: SeriesSource; table: string | null; createdAt: string[]; total: number | null };
  shares: { source: SeriesSource; at: string[]; publicTotal: number | null };
  conversations: { source: SeriesSource; createdAt: string[]; total: number | null };
  views: { source: SeriesSource; at: string[] };
  memory: { source: SeriesSource; documents: number; chunks: number | null; quota: number };
  errors: string[];
}

export interface DayBucket {
  /** Local-midnight timestamp of the day. */
  start: number;
  /** Short axis label, e.g. "Mon". */
  label: string;
  /** Long label for tooltips, e.g. "Mon, Sep 22". */
  longLabel: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The last `count` local calendar days, oldest first (today last). */
export function lastDays(count: number, now: Date = new Date()): DayBucket[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: DayBucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push({
      start: day.getTime(),
      label: i === 0 ? "Today" : day.toLocaleDateString(undefined, { weekday: "short" }),
      longLabel: day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    });
  }
  return out;
}

/** Counts timestamps (ISO strings or epoch ms) into the given day buckets. */
export function bucketCounts(values: Array<string | number>, buckets: DayBucket[]): number[] {
  const counts = new Array<number>(buckets.length).fill(0);
  if (buckets.length === 0) return counts;
  const first = buckets[0].start;
  const end = buckets[buckets.length - 1].start + DAY_MS;
  for (const value of values) {
    const t = typeof value === "number" ? value : Date.parse(value);
    if (!Number.isFinite(t) || t < first || t >= end) continue;
    // Walk back from the end — DST-safe (buckets are real local midnights).
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t >= buckets[i].start) {
        counts[i] += 1;
        break;
      }
    }
  }
  return counts;
}

export const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

/** Week-over-week change in percent (null when there is no baseline). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/* ------------------------------------------------------------------------ */
/* Sample data (clearly labelled in the UI)                                   */
/* ------------------------------------------------------------------------ */

/** Tiny deterministic PRNG (mulberry32) so sample data is stable per user/day. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Plausible upward-trending sample series: base × growth curve × weekday
 * rhythm × jitter. Deterministic for (key, bucket dates).
 */
export function sampleSeries(key: string, buckets: DayBucket[], base: number, growth = 0.08): number[] {
  return buckets.map((bucket, i) => {
    const rand = prng(hashString(`${key}:${bucket.start}`));
    const weekday = new Date(bucket.start).getDay();
    const rhythm = weekday === 0 || weekday === 6 ? 0.78 : 1 + 0.06 * Math.sin(weekday);
    const trend = Math.pow(1 + growth, i);
    const jitter = 0.82 + rand() * 0.36;
    return Math.max(0, Math.round(base * trend * rhythm * jitter));
  });
}

/* ------------------------------------------------------------------------ */
/* Studio Media Library (browser)                                             */
/* ------------------------------------------------------------------------ */

/** Mirrors LIBRARY_KEY in app/studio/page.tsx. */
export const STUDIO_LIBRARY_KEY = "dashy.media.library";

/** createdAt of every finished (ready) Studio image in this browser. */
export function readStudioGenerations(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STUDIO_LIBRARY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: number[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as { status?: unknown; createdAt?: unknown; type?: unknown };
      if (item.type === "video") continue;
      if (item.status !== "ready") continue;
      if (typeof item.createdAt === "number") out.push(item.createdAt);
    }
    return out;
  } catch {
    return [];
  }
}
