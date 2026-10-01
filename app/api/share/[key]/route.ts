import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient, createServiceClient } from "@/lib/supabase/server";

/**
 * DashyCore v7 — /api/share/[key] — public share resolver (server-side).
 *
 * The Share viewer resolves links through the browser client, which depends
 * on the `dcode_projects_select_public` RLS policy existing in the LIVE
 * database. When that migration has not been applied, every anonymous read
 * returns zero rows and visitors see "This link is private or no longer
 * exists" even for published projects. This route is the server-side
 * recovery lane:
 *
 *   1. FIRST read through the cookie-bound (anon/auth) client — RLS fully
 *      applies, so the OWNER of a private project still resolves their own
 *      row and nothing private can ever be served to a visitor.
 *   2. If that yields nothing AND a service role key is configured, retry
 *      with the service client HARD-FILTERED to is_public = true. Published
 *      links therefore keep working even on a database where the public
 *      SELECT policy is missing; private rows can never leak (the filter is
 *      in the query itself, not in discretionary policy logic).
 *
 * Response: the raw project row JSON (same shape lib/dcode expects) or 404.
 * `key` is either the project uuid or its 12-char share slug.
 */

interface RouteContext {
  params: Promise<{ key: string }>;
}

/** True for canonical uuid text (8-4-4-4-12 hex). */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

const SELECT_COLUMNS = "*";

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { key: rawKey } = await context.params;
  const key = (rawKey ?? "").trim();
  if (!key || key.length > 64) {
    return NextResponse.json({ error: "Invalid share key" }, { status: 400 });
  }

  // Lane 1 — session/RLS-respecting read (owner sees own private rows).
  try {
    const supabase = await createRouteHandlerClient();
    let query = supabase.from("dcode_projects").select(SELECT_COLUMNS);
    query = isUuid(key)
      ? query.eq("id", key)
      : query.eq("share_slug", key.toLowerCase());
    const { data, error } = await query.maybeSingle();
    if (!error && data) {
      return NextResponse.json(data, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    }
  } catch {
    // Fall through to lane 2 — a dead/invalid session must not break a
    // public link.
  }

  // Lane 2 — service-role recovery, public rows ONLY.
  const service = createServiceClient();
  if (service) {
    try {
      let query = service
        .from("dcode_projects")
        .select(SELECT_COLUMNS)
        // Hard privacy gate: only rows the owner explicitly published.
        .eq("is_public", true);
      query = isUuid(key)
        ? query.eq("id", key)
        : query.eq("share_slug", key.toLowerCase());
      const { data, error } = await query.maybeSingle();
      if (!error && data) {
        return NextResponse.json(data, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      }
    } catch {
      // Treated as not-found below.
    }
  }

  return NextResponse.json(
    { error: "Not found or private" },
    { status: 404, headers: { "Cache-Control": "no-store" } }
  );
}
