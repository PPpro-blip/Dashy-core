/**
 * DashyCore — route classification for the auth middleware (pure, unit-testable).
 *
 * No imports so `node --test` can load this directly
 * (see tests/auth-routes.test.mjs). `lib/supabase/middleware.ts` consumes it.
 *
 * Kinds:
 *  - "protected" — requires an authenticated session; unauthenticated users
 *    are redirected to /login (with ?next= preserved).
 *  - "auth"      — the login/verify screens; authenticated users are bounced
 *    into the app.
 *  - "public"    — everything else (share links, auth callback, API routes,
 *    the landing redirect).
 */

/** Route prefixes that require a session. Public share viewers are NOT here. */
export const PROTECTED_PREFIXES = [
  "/chat",
  "/settings",
  "/projects",
  "/knowledge",
  "/agents",
  "/voice",
  "/studio",
  "/share",
  "/d-code",
];

/** Prefixes that stay reachable without a session, even though a protected
 *  prefix could otherwise match (order matters: public wins). */
export const PUBLIC_PREFIXES = [
  "/d-code/share", // public project share viewer (RLS: is_public rows)
  "/s", // public short share links
  "/m", // public meta share links
  "/login",
  "/auth/callback",
  "/api",
];

export type RouteKind = "protected" | "auth" | "public";

export interface RouteClassification {
  kind: RouteKind;
  isProtected: boolean;
  isAuthPage: boolean;
}

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Classify a request path. Public prefixes are checked FIRST so that e.g.
 * /d-code/share/abc is public even though /d-code is protected.
 * /login and /login/verify are the auth pages.
 */
export function classifyPath(pathname: string): RouteClassification {
  const path = pathname || "/";

  if (path === "/login" || path.startsWith("/login/")) {
    return { kind: "auth", isProtected: false, isAuthPage: true };
  }
  if (matchesPrefix(path, PUBLIC_PREFIXES)) {
    return { kind: "public", isProtected: false, isAuthPage: false };
  }
  if (matchesPrefix(path, PROTECTED_PREFIXES)) {
    return { kind: "protected", isProtected: true, isAuthPage: false };
  }
  return { kind: "public", isProtected: false, isAuthPage: false };
}
