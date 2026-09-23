import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Session refresh middleware (per @supabase/ssr docs).
 *
 * Refreshes the Supabase auth session on every matched request and
 * forwards updated cookies to the response and downstream request.
 * Share pages stay accessible without a session, but a private/missing
 * project returns HTTP 403 before the page (including its OG tags) renders.
 */
const PROTECTED_ROUTES = [
  "/chat",
  "/settings",
  "/projects",
  "/studio",
  "/d-code",
  "/knowledge",
  "/agents",
  "/voice",
];

const SHARE_PAGE_PREFIXES = ["/d-code/share/", "/s/"];

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * Check the exact share-page path, not nested routes such as /og-image.
 * The session read permits the owner to preview a private project; the
 * service-role fallback is HARD-FILTERED to public rows, so a published link
 * still works even when the live DB is missing its anonymous SELECT policy.
 * This mirrors the recovery lane in /api/share/[key] without exposing a
 * service-role client or private data to the browser.
 */
async function canOpenShare(
  supabase: ReturnType<typeof createServerClient>,
  key: string,
  userId: string | undefined
): Promise<boolean> {
  const byId = isUuid(key);
  try {
    let query = supabase.from("dcode_projects").select("user_id, is_public");
    query = byId ? query.eq("id", key) : query.eq("share_slug", key.toLowerCase());
    const { data, error } = await query.maybeSingle();
    if (!error && data && (data.is_public || (userId && data.user_id === userId))) {
      return true;
    }
  } catch {
    // A broken session/RLS policy should not block a public link when the
    // server has a service key for the public-only recovery path below.
  }

  const service = createServiceClient();
  if (service) {
    try {
      let query = service
        .from("dcode_projects")
        .select("id")
        .eq("is_public", true);
      query = byId ? query.eq("id", key) : query.eq("share_slug", key.toLowerCase());
      const { data, error } = await query.maybeSingle();
      if (!error && data) return true;
    } catch {
      // Treat lookup errors as unavailable; never allow private rows through.
    }
  }
  return false;
}

/** A static response: never reveal whether a private project exists. */
function privateShareResponse(refreshed: NextResponse): NextResponse {
  const response = new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Shared link unavailable — DashyCore</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#f3f4f6;font:16px system-ui,sans-serif}main{max-width:28rem;margin:1.5rem;padding:2rem;border:1px solid #26354a;border-radius:1rem;background:#111a2c}h1{font-size:1.4rem}p{color:#a8b4c7;line-height:1.5}a{color:#67e8f9}</style></head><body><main><h1>This link is private or no longer exists</h1><p>If it belongs to you, sign in and open the link again. Otherwise, ask the owner to make it public.</p><a href="/login">Sign in</a></main></body></html>`,
    {
      status: 403,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    }
  );
  // Preserve auth refresh cookies even when the share access check denies a
  // request; otherwise the owner's next request could lose its session.
  refreshed.cookies.getAll().forEach(({ name, value, ...options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run code between createServerClient and getUser —
  // otherwise the session may not be refreshed in time.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const sharePrefix = SHARE_PAGE_PREFIXES.find((prefix) => pathname.startsWith(prefix));
  if (sharePrefix) {
    const key = pathname.slice(sharePrefix.length);
    // Only guard actual share pages, not /og-image or an unrelated 404.
    if (key && !key.includes("/")) {
      if (key.length <= 64 && (await canOpenShare(supabase, key, user?.id))) {
        return supabaseResponse;
      }
      return privateShareResponse(supabaseResponse);
    }
  }

  const isProtected =
    !SHARE_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
    PROTECTED_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`)
    );

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/chat";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
