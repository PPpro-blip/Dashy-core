import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";

/**
 * Supabase OAuth / email-link PKCE callback.
 * Exchanges the `code` for a session, then redirects to /chat.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Optional safety redirect target (validated below).
  const next = searchParams.get("next") ?? "/chat";

  if (code) {
    const supabase = await createRouteHandlerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Only allow local paths ("//host" is a protocol-relative redirect).
      const safeNext =
        next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
          ? next
          : "/chat";
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  // Auth failed — send the user back to the login screen.
  return NextResponse.redirect(`${origin}/login`);
}
