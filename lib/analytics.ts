/**
 * DashyCore v7 — schema-safe analytics counters.
 *
 * The dashboard must NEVER surface a red error box. Supabase projects in the
 * wild are missing tables, have RLS locked down, or hit a stale schema cache
 * ("Could not find the table 'public.x' in the schema cache"). Every counter
 * here therefore resolves to a plain number: real count on success, `0` on
 * any failure, with the reason kept for an optional muted hint.
 */

import { createClient } from "@/lib/supabase/client";
import { countMedia } from "@/lib/media-library";

export interface CountResult {
  /** Real row count, or 0 when the query could not run. */
  count: number;
  /** True when the number came back from the database. */
  ok: boolean;
  /** Present only when `ok` is false — never rendered as an error box. */
  reason?: string;
}

const ZERO: CountResult = { count: 0, ok: false, reason: "unavailable" };

/**
 * Counts rows of a table without ever throwing.
 * `filters` is applied as a series of equality filters.
 */
export async function safeCount(
  table: string,
  filters: Record<string, string | number | boolean> = {}
): Promise<CountResult> {
  try {
    const supabase = createClient();
    let query = supabase.from(table).select("*", { count: "exact", head: true });
    for (const [column, value] of Object.entries(filters)) {
      query = query.eq(column, value);
    }
    const { count, error } = await query;
    if (error) return { count: 0, ok: false, reason: error.message };
    return { count: count ?? 0, ok: true };
  } catch (error) {
    return {
      count: 0,
      ok: false,
      reason: error instanceof Error ? error.message : "unavailable",
    };
  }
}

export interface AnalyticsSnapshot {
  studioAssets: CountResult;
  dcodeProjects: CountResult;
  shareLinks: CountResult;
  conversations: CountResult;
  messages: CountResult;
  documents: CountResult;
  /** True when at least one DB counter answered successfully. */
  databaseReachable: boolean;
}

/** Local Studio assets are read from localStorage — always succeeds. */
function studioAssetsCount(): CountResult {
  try {
    return { count: countMedia(), ok: true };
  } catch {
    return ZERO;
  }
}

/**
 * Loads every dashboard counter in parallel. Resolves with honest numbers
 * (zeros where a table is missing) and never rejects.
 */
export async function loadAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
  const [dcodeProjects, shareLinks, conversations, messages, documents] =
    await Promise.all([
      safeCount("dcode_projects"),
      safeCount("shared_assets"),
      safeCount("conversations"),
      safeCount("messages"),
      safeCount("documents"),
    ]);

  return {
    studioAssets: studioAssetsCount(),
    dcodeProjects,
    shareLinks,
    conversations,
    messages,
    documents,
    databaseReachable: [
      dcodeProjects,
      shareLinks,
      conversations,
      messages,
      documents,
    ].some((result) => result.ok),
  };
}

/**
 * Counts public D-Code share links too, so "share links" reflects both the
 * Studio Share Hub and shared D-Code projects. Never throws.
 */
export async function countAllShareLinks(): Promise<CountResult> {
  const [studio, dcode] = await Promise.all([
    safeCount("shared_assets", { is_public: true }),
    safeCount("dcode_projects", { is_public: true }),
  ]);
  return {
    count: studio.count + dcode.count,
    ok: studio.ok || dcode.ok,
    reason: studio.ok || dcode.ok ? undefined : studio.reason ?? dcode.reason,
  };
}
