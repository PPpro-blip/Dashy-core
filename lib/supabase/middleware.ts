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
 *  - /d-code/share/<slug> stays PUBLIC (RLS allows reading is_public rows
 *    anonymously), so it is exempt from the protected-route redirect.
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
const PUBLIC_PREFIXES = ["/d-code/share/"];

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