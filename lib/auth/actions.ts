/**
 * DashyCore — browser-side Supabase Auth actions for email OTP (AUTH-01).
 *
 * Supabase Auth owns identity + OTP verification; Resend is only the SMTP
 * delivery provider configured inside Supabase (never called from here).
 * No Resend API key, no service-role key, and no OTP value is ever stored
 * or logged by this module.
 *
 * SDK contract verified against the installed @supabase/auth-js 2.112.2:
 *  - signInWithOtp({ email, options }) sends the OTP email. `shouldCreateUser:
 *    false` (sign-in mode) prevents accidental account creation;
 *    default `true` (sign-up mode) creates the account.
 *  - verifyOtp({ email, token, type: 'email' }) verifies an email OTP for
 *    BOTH sign-up and sign-in (`signup`/`magiclink` types are deprecated in
 *    this SDK version in favor of 'email').
 *  - resend({ type: 'signup' | 'email_change', email }) only supports
 *    signup/email-change resends — for existing-user sign-in OTPs the
 *    documented approach is to call signInWithOtp() again.
 */

import { createClient } from "@/lib/supabase/client";
import {
  mapAuthError,
  safeRedirectPath,
  DEFAULT_POST_AUTH_PATH,
  type AuthMode,
} from "./otp";

export interface AuthActionResult {
  /** User-facing, safe error message; null on success. */
  error: string | null;
}

/** Absolute emailRedirectTo sent with OTP requests: our own callback route,
 *  with a validated relative `next` attached. */
function emailRedirectTo(next?: string | null): string {
  const origin = window.location.origin;
  const safe = safeRedirectPath(next, DEFAULT_POST_AUTH_PATH);
  return `${origin}/auth/callback?next=${encodeURIComponent(safe)}`;
}

/**
 * Step 1 of both flows — ask Supabase Auth to email an OTP.
 *  - mode "signup": creates the account if it does not exist yet
 *    (shouldCreateUser defaults to true) and sends the verification OTP.
 *  - mode "signin": shouldCreateUser: false — an unknown email NEVER becomes
 *    a new account from the Sign In tab.
 */
export async function requestOtp(
  email: string,
  mode: AuthMode,
  next?: string | null
): Promise<AuthActionResult> {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: emailRedirectTo(next),
        ...(mode === "signin" ? { shouldCreateUser: false } : {}),
      },
    });
    return { error: error ? mapAuthError(error) : null };
  } catch (err) {
    return { error: mapAuthError(err) };
  }
}

/**
 * Step 2 — verify the OTP typed by the user. Per the installed SDK contract,
 * email OTPs for both sign-up and sign-in are verified with type 'email'.
 * On success the @supabase/ssr browser client persists the session in
 * cookies, which the middleware/server then recognize.
 */
export async function verifyOtpCode(
  email: string,
  token: string,
  _mode: AuthMode
): Promise<AuthActionResult> {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    return { error: error ? mapAuthError(error) : null };
  } catch (err) {
    return { error: mapAuthError(err) };
  }
}

/**
 * Resend the OTP with the correct supported API per mode:
 *  - signup: supabase.auth.resend({ type: 'signup', ... })
 *  - signin: signInWithOtp() again with shouldCreateUser: false
 *    (resend() does not support existing-user sign-in OTPs).
 */
export async function resendOtp(
  email: string,
  mode: AuthMode,
  next?: string | null
): Promise<AuthActionResult> {
  try {
    const supabase = createClient();
    const redirect = emailRedirectTo(next);
    const { error } =
      mode === "signup"
        ? await supabase.auth.resend({
            type: "signup",
            email,
            options: { emailRedirectTo: redirect },
          })
        : await supabase.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: false, emailRedirectTo: redirect },
          });
    return { error: error ? mapAuthError(error) : null };
  } catch (err) {
    return { error: mapAuthError(err) };
  }
}

/**
 * Password sign-in kept ONLY as a compatibility path for pre-existing
 * password accounts (clearly separated in the UI). It genuinely calls
 * Supabase and never fakes success.
 */
export async function signInWithPasswordCompat(
  email: string,
  password: string
): Promise<AuthActionResult> {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? mapAuthError(error) : null };
  } catch (err) {
    return { error: mapAuthError(err) };
  }
}

/** OAuth providers kept for existing account compatibility (PKCE flow via
 *  /auth/callback). */
export async function startOAuth(
  provider: "google" | "github",
  next?: string | null
): Promise<AuthActionResult> {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: emailRedirectTo(next) },
    });
    return { error: error ? mapAuthError(error) : null };
  } catch (err) {
    return { error: mapAuthError(err) };
  }
}
