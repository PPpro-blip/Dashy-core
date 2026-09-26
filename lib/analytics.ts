/**
 * Live analytics helpers shared by the route and dashboard.
 *
 * Every series is timestamp-based real activity. Empty histories remain
 * empty rather than being filled with fabricated activity.
 */

export type SeriesSource = "live" | "unavailable";

export interface AnalyticsPayload {
  generatedAt: string;
  days: number;
  projects: { source: SeriesSource; createdAt: string[]; total: number };
  shares: { source: SeriesSource; at: string[]; publicTotal: number };
  conversations: { source: SeriesSource; createdAt: string[]; total: number };
  messages: { source: SeriesSource; createdAt: string[]; total: number };
  studio: { source: "local"; createdAt: string[]; total: number };
  errors: string[];
}

export interface DayBucket {
  start: number;
  label: string;
  longLabel: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function lastDays(count: number, now: Date = new Date()): DayBucket[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: count }, (_, index) => {
    const daysAgo = count - index - 1;
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo);
    return {
      start: day.getTime(),
      label: daysAgo === 0 ? "Today" : day.toLocaleDateString(undefined, { weekday: "short" }),
      longLabel: day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
    };
  });
}

/** Buckets real timestamps in the viewer's local timezone (DST-safe). */
export function bucketCounts(values: Array<string | number>, buckets: DayBucket[]): number[] {
  const counts = new Array<number>(buckets.length).fill(0);
  if (buckets.length === 0) return counts;
  const first = buckets[0].start;
  const end = buckets[buckets.length - 1].start + DAY_MS;
  values.forEach((value) => {
    const timestamp = typeof value === "number" ? value : Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp < first || timestamp >= end) return;
    for (let index = buckets.length - 1; index >= 0; index -= 1) {
      if (timestamp >= buckets[index].start) {
        counts[index] += 1;
        return;
      }
    }
  });
  return counts;
}

export const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/**
 * Reads actual ready Studio media from the browser library. Supports the
 * established `Tile` schema (`url`, numeric createdAt, status=ready) and the
 * lightweight Studio share schema (`imageUrl`, ISO createdAt).
 */
export const STUDIO_LIBRARY_KEY = "dashy.media.library";
export function readStudioGenerations(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STUDIO_LIBRARY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as { status?: unknown; url?: unknown; imageUrl?: unknown; createdAt?: unknown; type?: unknown };
      if (item.type === "video" || item.status === "generating" || item.status === "loading") return [];
      if (typeof item.url !== "string" && typeof item.imageUrl !== "string") return [];
      const date = typeof item.createdAt === "number" ? item.createdAt : typeof item.createdAt === "string" ? Date.parse(item.createdAt) : NaN;
      return Number.isFinite(date) ? [date] : [];
    });
  } catch {
    return [];
  }
}
