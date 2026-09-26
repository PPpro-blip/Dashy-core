import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";

/**
 * Raw, user-scoped analytics timestamps. The browser turns these into local
 * day buckets; this route never manufactures sample series or view counts.
 */
export const dynamic = "force-dynamic";

const MAX_DAYS = 60;
const DEFAULT_DAYS = 30;

type TimestampRow = { created_at?: string | null; updated_at?: string | null };

function validDates(rows: TimestampRow[] | null, field: "created_at" | "updated_at"): string[] {
  return (rows ?? [])
    .map((row) => row[field])
    .filter((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

export async function GET(request: NextRequest) {
  const supabase = await createRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const requestedDays = Number.parseInt(request.nextUrl.searchParams.get("days") ?? "", 10);
  const days = Number.isFinite(requestedDays)
    ? Math.max(1, Math.min(MAX_DAYS, requestedDays))
    : DEFAULT_DAYS;
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString();

  const [
    projectsCount,
    projectsTimeline,
    conversationCount,
    conversationsTimeline,
    publicProjectCount,
    publicProjectTimeline,
    publicAssetCount,
    publicAssetTimeline,
  ] = await Promise.all([
    supabase.from("dcode_projects").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("dcode_projects").select("created_at").eq("user_id", user.id).gte("created_at", since),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("conversations").select("created_at").eq("user_id", user.id).gte("created_at", since),
    supabase.from("dcode_projects").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_public", true),
    supabase.from("dcode_projects").select("updated_at").eq("user_id", user.id).eq("is_public", true).gte("updated_at", since),
    supabase.from("shared_assets").select("id", { count: "exact", head: true }).eq("owner_id", user.id).eq("is_public", true),
    supabase.from("shared_assets").select("created_at").eq("owner_id", user.id).eq("is_public", true).gte("created_at", since),
  ]);

  const errors = [
    projectsCount.error,
    projectsTimeline.error,
    conversationCount.error,
    conversationsTimeline.error,
    publicProjectCount.error,
    publicProjectTimeline.error,
    publicAssetCount.error,
    publicAssetTimeline.error,
  ].filter((error) => error !== null).map((error) => error.message);

  const [messageCount, messageTimeline] = await Promise.all([
    supabase
      .from("messages")
      .select("id, conversations!inner(user_id)", { count: "exact", head: true })
      .eq("conversations.user_id", user.id),
    supabase
      .from("messages")
      .select("created_at, conversations!inner(user_id)")
      .eq("conversations.user_id", user.id)
      .gte("created_at", since),
  ]);
  if (messageCount.error) errors.push(messageCount.error.message);
  if (messageTimeline.error) errors.push(messageTimeline.error.message);

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      days,
      projects: { total: projectsCount.count ?? 0, createdAt: validDates(projectsTimeline.data as TimestampRow[] | null, "created_at") },
      conversations: { total: conversationCount.count ?? 0, createdAt: validDates(conversationsTimeline.data as TimestampRow[] | null, "created_at") },
      messages: { total: messageCount.count ?? 0, createdAt: validDates(messageTimeline.data as TimestampRow[] | null, "created_at") },
      shares: {
        total: (publicProjectCount.count ?? 0) + (publicAssetCount.count ?? 0),
        createdAt: [
          ...validDates(publicProjectTimeline.data as TimestampRow[] | null, "updated_at"),
          ...validDates(publicAssetTimeline.data as TimestampRow[] | null, "created_at"),
        ],
      },
      errors,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
