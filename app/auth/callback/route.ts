import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { supabaseSessionTokens } from "@/lib/supabase/oauth-session";

/**
 * Supabase OAuth PKCE callback.
 * Exchanges the `code` for a session, then redirects to /chat.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Optional safety redirect target (validated below).
  const next = searchParams.get("next") ?? "/chat";

  if (code) {
    const supabase = await createRouteHandlerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session) {
      // Supabase OAuth responses can contain provider_token. Re-save only the
      // Supabase access/refresh tokens before the response reaches the browser;
      // setSession reconstructs a minimal session and replaces the cookie.
      let sanitized = false;
      try {
        const { data: safeSession, error: sanitizeError } = await supabase.auth.setSession(
          supabaseSessionTokens(data.session)
        );
        sanitized = !sanitizeError && !!safeSession.session &&
          !safeSession.session.provider_token && !safeSession.session.provider_refresh_token;
      } catch {
        // Treat any failure to rewrite the cookie as a failed login.
      }
      if (sanitized) {
        // Only allow a same-origin relative path (avoid // and backslash variants).
        const target = next.startsWith("/") ? new URL(next, origin) : new URL("/chat", origin);
        const safeNext = target.origin === origin
          ? `${target.pathname}${target.search}${target.hash}`
          : "/chat";
        return NextResponse.redirect(`${origin}${safeNext}`);
      }
      // Fail closed: never return a response carrying a provider token.
      await supabase.auth.signOut({ scope: "local" });
    }
  }

  // Auth failed — send the user back to the login screen.
  return NextResponse.redirect(`${origin}/login`);
}