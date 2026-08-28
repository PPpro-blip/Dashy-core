/**
 * Server-side Supabase client for Cloudflare Workers.
 *
 * Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from Worker environment.
 * NEVER expose this client to browser/client code.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

let cachedClient: SupabaseClient | null = null;

export function createSupabaseClient(config: SupabaseConfig): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}

export function getSupabaseClientFromEnv(env: {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}): SupabaseClient {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Worker environment"
    );
  }

  return createSupabaseClient({ url, serviceRoleKey });
}
