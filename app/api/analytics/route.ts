import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import type { AnalyticsPayload, SeriesSource } from "@/lib/analytics";

/**
 * DashyCore — /api/analytics — raw activity feed for the /analytics dashboard.
 *
 * Reads through the cookie-bound Supabase client, so Row Level Security
 * scopes every query to the signed-in user (plus explicit user_id filters
 * as belt-and-braces). Returns RAW timestamps for the window instead of
 * server-side day buckets: the browser buckets them in the user's local
 * timezone, so "today" is the viewer's today.
 *
 *   GET /api/analytics?days=14
 *
 * Sources (each degrades independently — one missing table never blanks
 * the whole dashboard):
 *   - projects       `dcode_projects` (the live table), falling back to a
 *                    legacy `projects` table — created_at per row
 *   - shares         public projects by updated_at (publish/re-publish)
 *   - conversations  `conversations.created_at`
 *   - views          `share_views(viewed_at)` when that table exists —
 *                    otherwise `views.source = "mock"` and the client renders
 *                    clearly-labelled sample data. Wire it with e.g.
 *                      create table share_views (
 *                        id bigserial primary key,
 *                        project_id uuid references dcode_projects(id) on delete cascade,
 *                        user_id uuid not null,     -- project owner (for RLS)
 *                        viewed_at timestamptz not null default now()
 *                      );
 *   - memory         head counts of `documents` + `document_chunks`
 */

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;
const DEFAULT_DAYS = 14;

type Client = SupabaseClient;

async function timestamps(
  supabase: Client,
  table: string,
  column: string,
  sinceIso: string,
  filters: Record<string, string | boolean>
): Promise<{ ok: true; values: string[] } | { ok: false; error: string }> {
  try {
    let query = supabase.from(table).select(column).gte(column, sinceIso);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const { data, error } = await query.order(column, { ascending: true }).limit(MAX_ROWS);
    if (error) return { ok: false, error: `${table}: ${error.message}` };
    const values = ((data ?? []) as unknown as Array<Record<string, unknown>>)
      .map((row) => row[column])
      .filter((v): v is string => typeof v === "string");
    return { ok: true, values };
  } catch (error) {
    return { ok: false, error: `${table}: ${error instanceof Error ? error.message : "query failed"}` };
  }
}

async function headCount(
  supabase: Client,
  table: string,
  filters: Record<string, string | boolean> = {}
): Promise<number | null> {
  try {
    let query = supabase.from(table).select("*", { count: "exact", head: true });
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { count, error } = await query;
    return error ? null : count ?? 0;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const supabase = (await createRouteHandlerClient()) as unknown as Client;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const rawDays = Number.parseInt(request.nextUrl.searchParams.get("days") ?? "", 10);
  const days = Number.isFinite(rawDays) ? Math.min(60, Math.max(1, rawDays)) : DEFAULT_DAYS;
  // +1 day of slack so the browser can bucket in any timezone.
  const since = new Date(Date.now() - (days + 1) * 24 * 60 * 60 * 1000).toISOString();
  const errors: string[] = [];

  // Projects: live table first, legacy `projects` second.
  let projectsTable: string | null = null;
  let projectCreated: string[] = [];
  for (const table of ["dcode_projects", "projects"]) {
    const result = await timestamps(supabase, table, "created_at", since, { user_id: user.id });
    if (result.ok) {
      projectsTable = table;
      projectCreated = result.values;
      break;
    }
    errors.push(result.error);
  }

  const [shares, conversations, views, projectsTotal, publicTotal, conversationsTotal, documents, chunks] =
    await Promise.all([
      projectsTable
        ? timestamps(supabase, projectsTable, "updated_at", since, { user_id: user.id, is_public: true })
        : Promise.resolve({ ok: false as const, error: "shares: no projects table" }),
      timestamps(supabase, "conversations", "created_at", since, { user_id: user.id }),
      timestamps(supabase, "share_views", "viewed_at", since, { user_id: user.id }),
      projectsTable ? headCount(supabase, projectsTable, { user_id: user.id }) : Promise.resolve(null),
      // user_id pinned: the public-share RLS policy exposes EVERYONE's public rows.
      projectsTable
        ? headCount(supabase, projectsTable, { user_id: user.id, is_public: true })
        : Promise.resolve(null),
      headCount(supabase, "conversations", { user_id: user.id }),
      headCount(supabase, "documents", { user_id: user.id }),
      // Chunks are owner-scoped by RLS; pin user_id when the column exists.
      headCount(supabase, "document_chunks", { user_id: user.id }).then(
        (count) => count ?? headCount(supabase, "document_chunks")
      ),
    ]);

  if (!shares.ok) errors.push(shares.error);
  if (!conversations.ok) errors.push(conversations.error);
  // A missing share_views table is the expected state — not an error.

  const quotaEnv = Number.parseInt(process.env.NEXT_PUBLIC_DIGEST_QUOTA_DOCS ?? "", 10);
  const quota = Number.isFinite(quotaEnv) && quotaEnv > 0 ? quotaEnv : 100;

  const liveOrNull = (ok: boolean): SeriesSource => (ok ? "live" : "unavailable");

  const payload: AnalyticsPayload = {
    generatedAt: new Date().toISOString(),
    days,
    projects: {
      source: liveOrNull(projectsTable !== null),
      table: projectsTable,
      createdAt: projectCreated,
      total: projectsTotal,
    },
    shares: {
      source: liveOrNull(shares.ok),
      at: shares.ok ? shares.values : [],
      publicTotal,
    },
    conversations: {
      source: liveOrNull(conversations.ok),
      createdAt: conversations.ok ? conversations.values : [],
      total: conversationsTotal,
    },
    views: {
      source: views.ok ? "live" : "mock",
      at: views.ok ? views.values : [],
    },
    memory: {
      source: documents === null ? "unavailable" : "live",
      documents: documents ?? 0,
      chunks,
      quota,
    },
    errors,
  };

  return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
}
