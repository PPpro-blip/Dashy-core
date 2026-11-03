/**
 * DashyCore — email OTP auth helpers (pure, unit-testable).
 *
 * This module contains NO Supabase imports and NO `@/` alias imports so it
 * can be loaded directly by `node --test` (see tests/auth-otp.test.mjs).
 * The Supabase-calling wrappers live in `./actions.ts`.
 *
 * Architecture (AUTH-01):
 *   Browser → Supabase Auth (signInWithOtp / verifyOtp / resend)
 *           → Resend SMTP (configured in the Supabase dashboard only)
 *           → user email OTP → verifyOtp → Supabase session in cookies
 *           → Next.js middleware/server recognize the session.
 *
 * The Resend API key NEVER appears here or in any NEXT_PUBLIC_* variable —
 * it is only used as the SMTP password inside Supabase's Auth SMTP settings.
 */

/** Auth flows supported by the login screen. */
export type AuthMode = "signin" | "signup";

/** Cooldown between OTP (re)send requests, in seconds. Matches Supabase's
 *  default "one OTP per email per 60s" server-side rate limit. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** OTP codes are numeric; Supabase defaults to 6 digits (8 allowed for
 *  projects that raise the length). */
export const OTP_MIN_LENGTH = 6;
export const OTP_MAX_LENGTH = 8;

/** Default post-authentication destination inside the app. */
export const DEFAULT_POST_AUTH_PATH = "/chat";

/** Normalize an email address consistently across signup and sign-in:
 *  trim surrounding whitespace and lowercase the whole address. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Pragmatic email validation (HTML `type="email"` is the first line of
 *  defense; this is the second, before any network call). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Normalize a typed OTP: keep digits only (users paste "123 456"). */
export function normalizeOtpToken(token: string): string {
  return token.replace(/\D/g, "");
}

/** A token is submittable when it is all digits and within the allowed length. */
export function isValidOtpToken(token: string): boolean {
  return (
    /^\d+$/.test(token) &&
    token.length >= OTP_MIN_LENGTH &&
    token.length <= OTP_MAX_LENGTH
  );
}

/**
 * Validate a post-login redirect target. Only same-origin relative paths are
 * allowed — this prevents open redirects via `?next=` / callback params.
 * Anything else falls back to `fallback`.
 */
export function safeRedirectPath(
  path: string | null | undefined,
  fallback: string = DEFAULT_POST_AUTH_PATH
): string {
  if (!path) return fallback;
  if (!path.startsWith("/")) return fallback;
  if (path.startsWith("//")) return fallback; // protocol-relative URL
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return fallback; // scheme, e.g. javascript:
  return path;
}

/** Mask an email for display: `a***@example.com`. */
export function maskEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const at = normalized.indexOf("@");
  if (at <= 0) return normalized;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const head = local.slice(0, Math.min(1, local.length));
  return `${head}***@${domain}`;
}

/** Shape of the error info we map — structurally compatible with the
 *  Supabase AuthError (`message`, `status`, `code`) without importing it. */
export interface AuthErrorLike {
  message?: string;
  status?: number;
  code?: string;
}

const GENERIC_ERROR =
  "Something went wrong while contacting the authentication service. Please try again.";
const NETWORK_ERROR =
  "Network error. Please check your connection and try again.";

/**
 * Map a Supabase Auth error to a safe, user-facing message.
 *
 * Security notes:
 *  - Never includes stack traces or raw server internals.
 *  - Does not reveal whether an account exists (unknown-account errors get a
 *    generic message that also guides the user to sign up).
 */
export function mapAuthError(error: AuthErrorLike | unknown): string {
  if (error instanceof TypeError) return NETWORK_ERROR; // fetch() network failure
  const err = (error ?? {}) as AuthErrorLike;
  const message = typeof err.message === "string" ? err.message : "";
  const lower = message.toLowerCase();
  const code = typeof err.code === "string" ? err.code : "";
  const status = typeof err.status === "number" ? err.status : undefined;

  if (status === 429 || code.includes("rate_limit")) {
    return "Too many requests. Please wait a minute before trying again.";
  }
  if (code === "otp_expired" || lower.includes("expired")) {
    return "This code has expired. Request a new one below.";
  }
  if (code === "otp_disabled") {
    return "Email codes are not enabled for this project. Please contact support.";
  }
  if (code === "user_not_found" || code === "no_authorization") {
    // Do NOT confirm whether the account exists.
    return "If an account exists for this email, a sign-in code has been sent. Otherwise, please create an account first.";
  }
  if (code === "email_exists" || code === "user_already_exists") {
    return "An account with this email already exists. Use the Sign In tab instead.";
  }
  if (code === "email_not_confirmed") {
    return "This email is not verified yet. Request a sign-in code to verify it.";
  }
  if (code === "invalid_credentials") {
    return "Incorrect email or password — or this account uses a different sign-in method. Try a sign-in code instead.";
  }
  if (code === "signup_disabled") {
    return "Sign ups are currently disabled. Please contact support.";
  }
  if (code === "email_provider_disabled") {
    return "Email authentication is not enabled for this deployment. Please contact support.";
  }
  if (code === "email_address_invalid" || code === "validation_failed") {
    return "Please enter a valid email address.";
  }
  if (lower.includes("invalid") || lower.includes("token")) {
    // Wrong OTP ("Invalid token" / "Invalid OTP") — do not echo server text.
    return "Incorrect code. Check the email we sent you and try again, or request a new code.";
  }
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return NETWORK_ERROR;
  }
  if (message && message.length <= 200) return message;
  return GENERIC_ERROR;
}
