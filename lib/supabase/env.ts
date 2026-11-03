/**
 * Supabase public-env resolution shared by the browser client, the server
 * client and the middleware.
 *
 * Returns null (never throws, never prints values) when the public Supabase
 * variables are absent, so callers can degrade gracefully — e.g. the
 * middleware treats a missing config as "no session" and the login page
 * shows a clear "not configured" message instead of a cryptic crash.
 */
export interface SupabasePublicEnv {
  url: string;
  anonKey: string;
}

export function getSupabaseEnv(): SupabasePublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Error message used when the public env is missing. Contains no secrets. */
export const SUPABASE_ENV_MISSING_MESSAGE =
  "Authentication is not configured on this deployment: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are missing. Set them in the Vercel project environment (Preview → staging project, Production → production project).";
