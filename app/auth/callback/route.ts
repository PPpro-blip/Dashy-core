import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";
import { safeRedirectPath, DEFAULT_POST_AUTH_PATH } from "@/lib/auth/otp";

/**
 * Supabase Auth callback.
 *
 * Handles both PKCE OAuth (`?code=...`) and email-link / OTP-hash
 * (`?token_hash=...&type=...`) arrivals: exchanges them for a session, stores
 * it in cookies via the route-handler client, then redirects to a validated
 * local `next` path (default /chat). Any failure goes back to /login.
 */

/** Email OTP/link types verifyOtp accepts for token_hash verification. */
const ALLOWED_HASH_TYPES = new Set([
  "email",
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
]);

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const hashType = searchParams.get("type");
  // Optional safety redirect target (validated below).
  const next = safeRedirectPath(
    searchParams.get("next"),
    DEFAULT_POST_AUTH_PATH
  );

  if (code) {
    const supabase = await createRouteHandlerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  if (tokenHash && hashType && ALLOWED_HASH_TYPES.has(hashType)) {
    const supabase = await createRouteHandlerClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: hashType as "email",
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth failed — send the user back to the login screen.
  return NextResponse.redirect(`${origin}/login`);
}
