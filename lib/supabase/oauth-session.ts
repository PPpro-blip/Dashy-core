import type { Session } from "@supabase/supabase-js";

/** Keep only Supabase credentials when persisting an OAuth callback session. */
export function supabaseSessionTokens(session: Session): Pick<Session, "access_token" | "refresh_token"> {
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}
