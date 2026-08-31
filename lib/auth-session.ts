"use client";

/**
 * DashyCore v7 — shared Supabase session resolver.
 *
 * Every feature that talks to a worker needs two things from the signed-in
 * user: the Supabase **user id** (sent as `userId` so the worker can scope
 * RAG memory to the right workspace) and the **access token** (sent as
 * `Authorization: Bearer …`).
 *
 * Previously each screen re-implemented this with a bare
 * `supabase.auth.getUser()` inside a `try {} catch {}` that swallowed
 * failures. When that lookup failed (transient network error, expired
 * refresh token, cookie still warming up) the caller silently ended up with
 * `userId === null`, the FormData field was skipped entirely, and
 * dashy-digest answered `userId is required`.
 *
 * This helper is the one place that resolves both values:
 *
 *   1. `auth.getSession()` — reads the local cookie session (no network
 *      round trip, and `session.user` is already there). Preferred path.
 *   2. `auth.getUser()` — only as a fallback: it hits the auth server and
 *      can refresh an expired token, recovering cases step 1 cannot.
 *      The session is then re-read so we send the *refreshed* token.
 */

import { createClient } from "@/lib/supabase/client";

export interface DashySession {
  /** Supabase auth user id (UUID string) — the `userId` the workers expect. */
  userId: string;
  /** Supabase access token for the `Authorization: Bearer …` header. */
  accessToken: string;
  /** Signed-in email, when the session exposes it. */
  email: string | null;
}

/**
 * Resolves the current Supabase session, or `null` when nobody is signed in.
 * Never throws — auth lookup must not break an upload or a chat send.
 */
export async function getDashySession(): Promise<DashySession | null> {
  try {
    const supabase = createClient();

    // 1. Local cookie session: cheapest and already carries the user.
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.user?.id && session.access_token) {
      return {
        userId: session.user.id,
        accessToken: session.access_token,
        email: session.user.email ?? null,
      };
    }

    // 2. Fallback: validate against the auth server (also refreshes the
    //    token when it has expired), then re-read the session so we send the
    //    refreshed access token rather than a stale one.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) return null;

    const {
      data: { session: refreshed },
    } = await supabase.auth.getSession();

    const accessToken = refreshed?.access_token ?? session?.access_token ?? "";
    if (!accessToken) return null;

    return {
      userId: user.id,
      accessToken,
      email: user.email ?? null,
    };
  } catch {
    // Offline / storage-blocked / cookie unavailable → treat as signed out.
    return null;
  }
}

/** Convenience wrapper: just the Supabase user id, or `null`. */
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getDashySession();
  return session?.userId ?? null;
}
