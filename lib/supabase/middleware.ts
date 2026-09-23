import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh middleware (per @supabase/ssr docs).
 *
 * Refreshes the Supabase auth session on every matched request and
 * forwards the updated cookies to both the incoming response and the
 * request that continues downstream.
 *
 * Routing rules:
 *  - Unauthenticated users are redirected from protected routes to /login.
 *  - /s/<slug> and legacy /d-code/share/<slug> never redirect to login.
 *    Public rows are readable anonymously; private rows are owner-only.
 *  - Authenticated users hitting /login are sent to /chat.
 */
const PROTECTED_ROUTES = [
  "/chat",
  "/settings",
  "/projects",
  "/d-code",
  "/knowledge",
  "/agents",
  "/voice",
];

/** Prefixes served without a session (exempt from the redirect above). */
const PUBLIC_PREFIXES = ["/s/", "/d-code/share/"];

const FORBIDDEN_SHARE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Access denied · DashyCore</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#090d1a;color:#f4f4f5;font:16px system-ui,sans-serif"><main style="max-width:420px;padding:40px;text-align:center"><div style="color:#22d3ee;font-size:13px;letter-spacing:.18em;font-weight:700">DASHYCORE / 403</div><h1 style="font-size:28px;margin:20px 0 12px">This link is private</h1><p style="color:#a1a1aa;line-height:1.6">Only the owner can view this project. Ask them to turn on Public Access if you'd like to see it.</p><a href="/" style="display:inline-block;margin-top:22px;padding:12px 20px;border-radius:10px;background:#22d3ee;color:#061b24;font-size:14px;font-weight:700;text-decoration:none">Go to DashyCore</a></main></body></html>`;

function shareErrorResponse(status: 403 | 503) {
  return new NextResponse(
    status === 403 ? FORBIDDEN_SHARE_HTML : "Shared projects are temporarily unavailable.",
    {
      status,
      headers: {
        "Content-Type": status === 403 ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    }
  );
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

  // IMPORTANT: do not run code between createServerClient and getSession —
  // otherwise the session may not be refreshed in time.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicRoute = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix)
  );

  // Check share permissions before rendering any HTML/RSC/metadata. RLS
  // exposes public projects to everyone and private ones only to their owner;
  // a missing row (including an RLS-hidden private row) is a real HTTP 403,
  // not a client-side "private" message in a 200 response. Legacy links use
  // the same check before their redirect to the canonical /s/<slug> URL.
  const shareMatch = /^\/(?:s|d-code\/share)\/([a-z0-9]{12})\/?$/.exec(pathname);
  const denyShare = (status: 403 | 503) => {
    const response = shareErrorResponse(status);
    // A token refreshed by getUser should still reach the browser, even if
    // this particular link is forbidden to the account using it.
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    return response;
  };
  if (shareMatch) {
    const { data, error } = await supabase
      .from("dcode_projects")
      .select("user_id, is_public")
      .eq("share_slug", shareMatch[1])
      .maybeSingle();
    if (error) return denyShare(503);
    if (!data || (!data.is_public && data.user_id !== user?.id)) {
      return denyShare(403);
    }
    supabaseResponse.headers.set("Cache-Control", "private, no-store");
  }

  const isProtected =
    !isPublicRoute &&
    PROTECTED_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`)
    );

  if (!user && isProtected) {
    // Rewrite to /login while preserving the URL in the browser.
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