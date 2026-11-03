# DashyCore — Auth setup runbook (AUTH-01)

Email OTP authentication: **Supabase Auth owns identity and OTP verification;
Resend is only the SMTP delivery provider configured inside Supabase.** The
browser never calls Resend, never sees a Resend API key, and never stores an
OTP anywhere — Supabase generates, stores, rate-limits and verifies the codes.

Code flow (all in this repo):

```
app/login/page.tsx        email + mode (signin|signup)
  → lib/auth/actions.ts   requestOtp()  = supabase.auth.signInWithOtp()
                          (signin: shouldCreateUser:false — never creates an
                           account from the Sign In tab; signup: default true)
app/login/verify/page.tsx OTP entry
  → lib/auth/actions.ts   verifyOtpCode() = supabase.auth.verifyOtp({ type: 'email' })
                          resendOtp()     = auth.resend({type:'signup'}) for signup,
                                            signInWithOtp() again for signin
app/auth/callback/route.ts  PKCE `code` exchange AND email `token_hash` links
lib/supabase/middleware.ts  session refresh + route guards (getUser)
lib/auth/routes.ts          protected/public/auth route classification (unit-tested)
lib/auth/otp.ts             pure helpers: email/OTP validation, error mapping,
                            safe redirect validation (unit-tested)
```

SDK contract (verified against installed `@supabase/auth-js@2.112.2`):
`signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser } })`;
`verifyOtp({ email, token, type: 'email' })` — `type: 'email'` covers both
sign-up and sign-in OTPs in this SDK version (`signup`/`magiclink` are
deprecated); `resend({ type: 'signup' | 'email_change', email })` does NOT
support existing-user sign-in OTPs — those are resent via `signInWithOtp()`.

## Manual configuration required OUTSIDE this repository

These live in the Supabase/Resend/Vercel dashboards. **This task does not
modify Production anything.** Apply to BOTH projects independently:

### 1. Resend (once)

- Verify the sending domain (e.g. `mail.dashycore.app`) in Resend →
  Domains, and complete DKIM/SPF DNS records.
- Create an API key (`re_...`). Use it ONLY as the SMTP password below.
  Never put it in Vercel env, never in `NEXT_PUBLIC_*`, never in this repo.

### 2. Supabase project: `dashycore-v7-staging` (ref `gscvojambzzrgozpnhjf`) — for Preview

### 3. Supabase project: `dashycore-v7` (ref `wtuyczwtuzwyhsckzhjd`) — for Production

For each project, in the dashboard:

1. **Authentication → Settings → SMTP**: enable *Custom SMTP*:
   - Host `smtp.resend.com`, Port `465` (SSL) or `587` (TLS)
   - Username `resend`, Password = the Resend API key
   - Sender email on the verified domain, e.g. `DashyCore <login@mail.dashycore.app>`
2. **Authentication → Templates → "Magic Link"** (used by `signInWithOtp`):
   the template MUST include `{{ .Token }}` (the 6-digit OTP). If only
   `{{ .ConfirmationURL }}` is present, users get a link instead of a code.
   The same template serves signup verification and passwordless sign-in.
3. **Authentication → Settings**: *Confirm email* = ON (do not disable it to
   work around delivery). Set **OTP expiry** (default 3600 s; 600–3600
   recommended). Leave the email rate limits ON (default: one OTP per email
   per 60 s — the UI cooldown matches this).
4. **Authentication → URL Configuration**:
   - Site URL = the deployment's origin
   - Redirect URLs allowlist must include, per environment:
     - `https://dashy-core.vercel.app/auth/callback` (production)
     - `https://*-pppro-blip.vercel.app/auth/callback` or explicit preview
       deployment URLs (preview) — wildcard `https://*.vercel.app/auth/callback`
       if the project uses Vercel preview wildcards
     - `http://localhost:3000/auth/callback` (local dev)
5. **CAPTCHA** (Auth → Settings → Bot protection): leave at the project
   default; the UI passes through `captchaToken` only if configured.

### 4. Vercel project `dashy-core` — environment variable scopes

Verify (do not change values here) that the six Supabase variables are
scoped correctly:

| Variable | Production scope | Preview scope |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://wtuyczwtuzwyhsckzhjd.supabase.co` | `https://gscvojambzzrgozpnhjf.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key of `dashycore-v7` | anon key of `dashycore-v7-staging` |
| `SUPABASE_SERVICE_ROLE_KEY` | service key of `dashycore-v7` | service key of `dashycore-v7-staging` |

No Resend variable belongs in Vercel for auth email delivery (SMTP is
configured inside Supabase). `SUPABASE_SERVICE_ROLE_KEY` must remain
server-only (never `NEXT_PUBLIC_`).

## Verification checklist (staging first, never Production)

1. Preview deployment (staging project): Sign Up with a disposable address →
   real OTP email arrives via Resend (check Resend → Emails for the delivery
   event) → enter code → lands in `/chat`.
2. Sign In with the same address (shouldCreateUser:false path) → OTP → session.
3. Wrong code → clear error; expired code → "request a new one"; Resend →
   60 s cooldown enforced client-side + server-side rate limit.
4. Unknown email on Sign In → no account created, generic message.
5. Refresh on `/chat`, navigate between sections, sign out → `/login`.
6. Only after staging passes: merge to `main` for Production. Do not test
   account creation against the Production database.
