/**
 * DashyCore v7 — schema-safe analytics counters.
 *
 * Every Supabase query here is individually wrapped in try/catch: a missing
 * table, a stale PostgREST schema cache, a network blip or an RLS rejection
 * all degrade to `0` instead of throwing. `/analytics` NEVER shows a red
 * crash box — worst case, a metric just reads honestly as zero.
 */

import { createClient } from "@/lib/supabase/client";
import { countMedia } from "@/lib/media-library";
import { countMySharedAssets } from "@/lib/share";

export interface AnalyticsMetrics {
  conversations: number;
  messages: number;
  dcodeProjects: number;
  documents: number;
  sharedAssets: number;
  studioMedia: number;
}

export interface DailyActivity {
  label: string;
  value: number;
}

/** Exact row count for one table — never throws, degrades to 0. */
async function safeCount(table: string): Promise<number> {
  try {
    const supabase = createClient();
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Loads every workspace metric in parallel — always resolves, never rejects. */
export async function loadAnalyticsMetrics(): Promise<AnalyticsMetrics> {
  const [conversations, messages, dcodeProjects, documents, sharedAssets] =
    await Promise.all([
      safeCount("conversations"),
      safeCount("messages"),
      safeCount("dcode_projects"),
      safeCount("documents"),
      countMySharedAssets(),
    ]);

  return {
    conversations,
    messages,
    dcodeProjects,
    documents,
    sharedAssets,
    // Real local count — Studio's gallery lives in this browser's
    // localStorage (`dashy.media.library`), not a database table.
    studioMedia: countMedia(),
  };
}

/** Messages-per-day for the last 7 days. Empty array on any failure. */
export async function loadWeeklyActivity(): Promise<DailyActivity[]> {
  const days: { key: string; label: string }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
    });
  }

  try {
    const supabase = createClient();
    const since = new Date(today);
    since.setDate(since.getDate() - 6);

    const { data, error } = await supabase
      .from("messages")
      .select("created_at")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })
      .limit(2000);
    if (error) throw error;

    const counts = new Map<string, number>(days.map((d) => [d.key, 0]));
    for (const row of (data ?? []) as { created_at: string }[]) {
      const key = row.created_at.slice(0, 10);
      if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return days.map((d) => ({ label: d.label, value: counts.get(d.key) ?? 0 }));
  } catch {
    return days.map((d) => ({ label: d.label, value: 0 }));
  }
}
