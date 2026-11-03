import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEmail,
  isValidEmail,
  normalizeOtpToken,
  isValidOtpToken,
  safeRedirectPath,
  maskEmail,
  mapAuthError,
  RESEND_COOLDOWN_SECONDS,
  OTP_MIN_LENGTH,
  OTP_MAX_LENGTH,
  DEFAULT_POST_AUTH_PATH,
} from "../lib/auth/otp.ts";

test("normalizeEmail trims and lowercases consistently", () => {
  assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
  assert.equal(normalizeEmail("\tA.B+c@Sub.Domain.io\n"), "a.b+c@sub.domain.io");
});

test("isValidEmail accepts normal addresses and rejects malformed ones", () => {
  assert.ok(isValidEmail("user@example.com"));
  assert.ok(isValidEmail("a.b+tag@sub.domain.co.in"));
  assert.ok(!isValidEmail(""));
  assert.ok(!isValidEmail("not-an-email"));
  assert.ok(!isValidEmail("a@b"));
  assert.ok(!isValidEmail("a b@c.com"));
  assert.ok(!isValidEmail("@example.com"));
  assert.ok(!isValidEmail("user@"));
});

test("normalizeOtpToken keeps digits only (pasted codes with spaces/dashes)", () => {
  assert.equal(normalizeOtpToken("123 456"), "123456");
  assert.equal(normalizeOtpToken("123-456"), "123456");
  assert.equal(normalizeOtpToken("  000000 "), "000000");
  assert.equal(normalizeOtpToken("12ab34"), "1234");
});

test("isValidOtpToken enforces numeric length bounds", () => {
  assert.ok(isValidOtpToken("123456"));
  assert.ok(isValidOtpToken("12345678"));
  assert.ok(!isValidOtpToken("12345"));
  assert.ok(!isValidOtpToken("123456789"));
  assert.ok(!isValidOtpToken("abcdef"));
  assert.ok(!isValidOtpToken(""));
  assert.equal(OTP_MIN_LENGTH, 6);
  assert.equal(OTP_MAX_LENGTH, 8);
});

test("safeRedirectPath allows only same-origin relative paths", () => {
  assert.equal(safeRedirectPath("/chat"), "/chat");
  assert.equal(safeRedirectPath("/d-code/abc?x=1"), "/d-code/abc?x=1");
  assert.equal(safeRedirectPath(null), DEFAULT_POST_AUTH_PATH);
  assert.equal(safeRedirectPath(""), DEFAULT_POST_AUTH_PATH);
  assert.equal(safeRedirectPath("https://evil.example.com"), DEFAULT_POST_AUTH_PATH);
  assert.equal(safeRedirectPath("//evil.example.com"), DEFAULT_POST_AUTH_PATH);
  assert.equal(safeRedirectPath("javascript:alert(1)"), DEFAULT_POST_AUTH_PATH);
  assert.equal(safeRedirectPath("chat"), DEFAULT_POST_AUTH_PATH);
  assert.equal(safeRedirectPath("/chat", "/settings"), "/chat");
  assert.equal(safeRedirectPath("http://x", "/settings"), "/settings");
});

test("maskEmail hides the local part but keeps the domain", () => {
  assert.equal(maskEmail("alice@example.com"), "a***@example.com");
  assert.equal(maskEmail("bob.smith@mail.dashycore.app"), "b***@mail.dashycore.app");
});

test("mapAuthError: expired OTP gets a resend-oriented message", () => {
  assert.match(mapAuthError({ code: "otp_expired", message: "Token has expired" }), /expired/i);
  assert.match(mapAuthError({ message: "OTP expired" }), /expired/i);
});

test("mapAuthError: wrong OTP never echoes server internals", () => {
  const msg = mapAuthError({ message: "Invalid OTP: expected abc123", status: 400 });
  assert.match(msg, /incorrect code/i);
  assert.ok(!msg.includes("abc123"));
});

test("mapAuthError: rate limiting is surfaced as a wait message", () => {
  assert.match(mapAuthError({ status: 429, message: "Too many" }), /too many requests/i);
  assert.match(mapAuthError({ code: "over_email_send_rate_limit", message: "rate limited" }), /too many requests/i);
  assert.match(mapAuthError({ code: "over_request_rate_limit", message: "x" }), /too many requests/i);
});

test("mapAuthError: unknown account does not confirm existence", () => {
  const msg = mapAuthError({ code: "user_not_found", message: "User not found", status: 404 });
  assert.match(msg, /if an account exists/i);
  assert.ok(!/not found/i.test(msg));
});

test("mapAuthError: already-registered email points to Sign In", () => {
  assert.match(mapAuthError({ code: "email_exists", message: "User already registered" }), /already exists/i);
  assert.match(mapAuthError({ code: "user_already_exists", message: "exists" }), /already exists/i);
});

test("mapAuthError: password-compat errors are friendly and non-leaking", () => {
  const msg = mapAuthError({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 });
  assert.match(msg, /incorrect email or password/i);
  assert.match(mapAuthError({ code: "email_not_confirmed", message: "Email not confirmed" }), /not verified/i);
});

test("mapAuthError: network failure maps to a connectivity message", () => {
  assert.match(mapAuthError(new TypeError("Failed to fetch")), /network error/i);
  assert.match(mapAuthError({ message: "Failed to fetch" }), /network error/i);
});

test("mapAuthError: config-level errors are explained, never raw dumps", () => {
  assert.match(mapAuthError({ code: "signup_disabled", message: "Signups disabled" }), /disabled/i);
  assert.match(mapAuthError({ code: "email_provider_disabled", message: "x" }), /not enabled/i);
  assert.match(mapAuthError({ code: "validation_failed", message: "bad email" }), /valid email/i);
  // Unknown long/stacky message falls back to a generic line, no stack leak.
  const stacky = { message: "Error: at foo (bar.js:1:1)\n".repeat(30) };
  const msg = mapAuthError(stacky);
  assert.ok(!msg.includes("bar.js"));
});

test("resend cooldown matches Supabase's default 60s OTP window", () => {
  assert.equal(RESEND_COOLDOWN_SECONDS, 60);
});
