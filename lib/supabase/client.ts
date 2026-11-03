import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv, SUPABASE_ENV_MISSING_MESSAGE } from "./env";

/**
 * Supabase client for Client Components.
 *
 * Session storage is COOKIES via @supabase/ssr (not localStorage), so the
 * Next.js middleware and server components can read/refresh the same session.
 *
 * Throws a clear, secret-free error when the public env is missing — callers
 * on the auth screens catch this and show it to the user.
 */
export function createClient() {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(SUPABASE_ENV_MISSING_MESSAGE);
  }
  return createBrowserClient(env.url, env.anonKey);
}
