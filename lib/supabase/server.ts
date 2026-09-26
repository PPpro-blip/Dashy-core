import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components.
 *
 * Next.js 15: `cookies()` is asynchronous — always `await` it.
 *
 * IMPORTANT: `setAll` is intentionally a no-op. Server Components cannot
 * write cookies (Next.js throws and logs the full cookie value when they
 * try, which leaks session tokens into dev RSC payloads). Session refresh
 * is handled by `lib/supabase/middleware.ts`, and cookie writes from
 * Route Handlers use `createRouteHandlerClient` instead.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // No-op in Server Components — see note above.
        },
      },
    }
  );
}

/**
 * Supabase client for Route Handlers, where cookies ARE writable.
 * Used by the OAuth callback to persist the exchanged session.
 */
export async function createRouteHandlerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}