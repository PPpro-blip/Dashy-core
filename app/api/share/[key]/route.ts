import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient, createServiceClient } from "@/lib/supabase/server";
import { publicSharePayload } from "@/lib/dcode/share-response";

interface RouteContext {
  params: Promise<{ key: string }>;
}

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const PUBLIC_FIELDS = "title, description, language, files, is_public, share_slug";

function unavailable() {
  return NextResponse.json({ error: "Not found or private" }, { status: 404, headers: NO_STORE });
}

/** Resolves only a valid public share slug and emits a strict render-only DTO. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { key } = await context.params;
  if (!/^[a-z0-9]{12}$/i.test(key ?? "")) return unavailable();

  // RLS-bound path still requires is_public, so an owner's private link does
  // not become visible through this public endpoint.
  try {
    const supabase = await createRouteHandlerClient();
    const { data } = await supabase
      .from("dcode_projects")
      .select(PUBLIC_FIELDS)
      .eq("share_slug", key.toLowerCase())
      .eq("is_public", true)
      .maybeSingle();
    if (data) return NextResponse.json(publicSharePayload(data), { headers: NO_STORE });
  } catch {
    // Continue with service role, always hard-filtered to public rows.
  }

  const service = createServiceClient();
  if (service) {
    try {
      const { data } = await service
        .from("dcode_projects")
        .select(PUBLIC_FIELDS)
        .eq("share_slug", key.toLowerCase())
        .eq("is_public", true)
        .maybeSingle();
      if (data) return NextResponse.json(publicSharePayload(data), { headers: NO_STORE });
    } catch {
      // Return a uniform not-found response.
    }
  }
  return unavailable();
}
