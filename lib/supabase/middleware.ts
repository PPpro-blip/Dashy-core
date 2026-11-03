import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { classifyPath } from "@/lib/auth/routes";
import { safeRedirectPath, DEFAULT_POST_AUTH_PATH } from "@/lib/auth/otp";

/**
 * Session refresh middleware (per @supabase/ssr docs).
 *
 * Refreshes the Supabase auth session on every matched request and forwards
 * the updated cookies to both the incoming response and the request that
 * continues downstream. Session identity is confirmed server-side with
 * `auth.getUser()` (not the weaker `getSession()`).
 *
 * Routing rules (classification lives in lib/auth/routes.ts, unit-tested):
 *  - Unauthenticated users hitting a PROTECTED route are redirected to
 *    /login with the original URL preserved in ?next= (validated on use).
 *  - Public share viewers (/d-code/share/*, /s/*, /m/*), /login, the auth
 *    callback and /api stay reachable without a session.
 *  - Authenticated users hitting /login (or /login/verify) are sent into the
 *    app (?next= if valid, otherwise /chat).
 *  - Missing Supabase env config degrades to "no session" instead of
 *    crashing; the login page then shows a clear configuration error.
 */
export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const { isProtected, isAuthPage } = classifyPath(pathname);

  const env = getSupabaseEnv();
  if (!env) {
    // No Supabase config on this deployment: never crash the middleware.
    // Protected routes still redirect to /login, where the user sees a
    // clear "not configured" message instead of a blank screen.
    if (isProtected) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.anonKey, {
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
  });

  // IMPORTANT: do not run code between createServerClient and getUser —
  // otherwise the session may not be refreshed in time.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isProtected) {
    // Redirect to /login while preserving the originally requested URL.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    const next = safeRedirectPath(
      request.nextUrl.searchParams.get("next"),
      DEFAULT_POST_AUTH_PATH
    );
    url.pathname = next;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
