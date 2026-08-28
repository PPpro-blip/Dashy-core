import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components.
 * Reads session from cookies managed by @supabase/ssr.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}