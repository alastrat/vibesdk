# Account Basics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email sending, password reset, email confirmation (which also closes the account pre-hijacking gap), an honest delete-account dialog and a corrected debug-panel address, so strangers can use Estori safely.

**Architecture:**
- A small email module picks a sender:
  - the Cloudflare Email Service binding `EMAIL` when present;
  - the dev log when the environment is dev;
  - otherwise nothing, and email is reported off.
- Token helpers store only SHA-256 hashes, in the existing `password_reset_tokens` and `email_verification_tokens` tables.
- `AuthService` gains the reset and confirmation flows. The controllers and routes follow the existing auth patterns.
- The frontend adds a forgot-password view in the auth window, `/reset-password` and `/verify-email` public pages, and the confirmation status and resend in Settings.

**Tech Stack:** Cloudflare Workers with Hono, Drizzle on D1, the Durable Object rate limiter, React 19, React Router 7, TanStack Query, Kumo UI, and Vitest in the Workers pool.

**Spec:** `docs/superpowers/specs/2026-10-14-account-basics-design.md`

## Global Constraints

**Email**
- Sender: `no-reply@estori.app` with the display name `Estori`, passed to the Email Service as `{ email, name }`.
- Reset links: `/reset-password?token=…`, valid 30 minutes.
- Confirmation links: `/verify-email?token=…`, valid 24 hours.
- Link domain:
  - production: `https://{env.CUSTOM_DOMAIN}`, never the request's Host header;
  - when `CUSTOM_DOMAIN` is empty or the request host is a loopback: the request origin.
- Tokens: 32 random bytes as base64url. Only the SHA-256 hex hash is stored. Single use. A new token marks the user's earlier unused tokens of the same kind as used.

**Exact copy**
- Forgot-password answer: `If an account exists for that email, we've sent a link to reset your password. It expires in 30 minutes.`
- Bad reset link: `This reset link is invalid or has expired.`
- Bad confirmation link: `This confirmation link is invalid or has expired.`
- Delete dialog: `To delete your account and all your data, email privacy@estori.app from {email}. We complete erasure within 45 days.`, with the mailto subject `Delete my Estori account`.

**Behavior**
- An email failure never fails sign-up or the forgot-password answer; it's logged.
- `forgot-password` answers the same for unknown, provider-only and password accounts.
- Nothing is gated on email confirmation, except the provider auto-link rule:
  - when an account's email is unconfirmed, attaching a provider removes the password, marks the email confirmed and revokes the account's other sessions;
  - when it's confirmed, attaching works as today.

**Configuration:** don't add a `send_email` binding to `wrangler.estori.jsonc`. Don't change `wrangler.jsonc`, `.dev.vars` or `bun.lockb`, and never stage them.

**Code rules:** no `any`; frontend types and constants through `@/api-types`; comments explain purpose only; no emojis.

**Tests:** run from the repo root with `npx vitest run <paths>` (the Workers pool, no jsdom). Frontend tests are pure-function or raw-source guard tests. `worker/api/routes/**` is excluded from Vitest, so route wiring tests sit next to their controller. If a run fails with `EADDRNOTAVAIL`, `ERR_RUNTIME_FAILURE` or "Fallback service failed", rerun it after about 60 seconds.

**Commits:** stage explicit paths only. End each message with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A reset link used twice, or after a newer one is requested,** must fail with the invalid-link message. Task 2 tests both cases.
2. **Someone who requests a reset for an email with no account** must get the same 200 answer, with no email sent and no timing-visible database write. Task 2 tests it.
3. **A Host header set to another domain in production** must not change the link domain. Task 1 tests `appBaseUrl`.
4. **A confirmation link sent to an old address after an email change** must not confirm the new address. Task 3 tests the email match.
5. **The real owner signing in with Google to an account an attacker created with their address** ends with the attacker's password removed and the attacker's sessions revoked. Task 3 tests it.

---

### Task 1: Email foundation (tokens, sender, links, templates, rate limit)

**Files:**
- Create: `worker/services/email/types.ts`
- Create: `worker/services/email/sender.ts`
- Create: `worker/services/email/templates.ts`
- Create: `worker/services/email/links.ts`
- Create: `worker/services/auth/one-time-token.ts`
- Create: `worker/types/email-binding.d.ts`
- Tests: `worker/services/email/sender.test.ts`, `worker/services/email/templates.test.ts`, `worker/services/email/links.test.ts`, `worker/services/auth/one-time-token.test.ts`
- Modify:
  - `worker/services/rate-limit/config.ts`: add `RateLimitType.AUTH_EMAIL = 'authEmail'`, its `RateLimitSettings` entry, and a default `authEmail: { enabled: true, store: RateLimitStore.DURABLE_OBJECT, limit: 5, period: 60 * 60 }`.
  - `worker/services/rate-limit/rateLimits.ts`: add `enforceAuthEmailRateLimit`.
  - Test: `worker/services/rate-limit/auth-email-rate-limit.test.ts`.

**Interfaces (produces):**
```ts
// worker/services/email/types.ts
export interface OutgoingEmail { to: string; subject: string; html: string; text: string }
export interface EmailSender { send(email: OutgoingEmail): Promise<void> }
export interface EmailAddress { email: string; name: string }
/** The Cloudflare Email Service binding (send_email with remote: true). */
export interface TransactionalEmailBinding {
	send(message: { to: string; from: string | EmailAddress; subject: string; html: string; text: string }): Promise<{ messageId: string }>;
}
export const EMAIL_FROM: EmailAddress = { email: 'no-reply@estori.app', name: 'Estori' };

// worker/services/email/sender.ts
export function createEmailSender(env: Env): EmailSender | null;   // binding → Cloudflare; isDev(env) → dev log; else null
export function isEmailSendingEnabled(env: Env): boolean;          // createEmailSender(env) !== null

// worker/services/email/links.ts
export function appBaseUrl(env: Env, request: Request): string;     // no trailing slash
export function resetPasswordLink(base: string, token: string): string;   // `${base}/reset-password?token=${encodeURIComponent(token)}`
export function verifyEmailLink(base: string, token: string): string;     // `${base}/verify-email?token=…`

// worker/services/email/templates.ts
export function passwordResetEmail(to: string, link: string): OutgoingEmail;  // subject "Reset your Estori password"
export function verifyEmailEmail(to: string, link: string): OutgoingEmail;    // subject "Confirm your email for Estori"

// worker/services/auth/one-time-token.ts
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export function createOneTimeToken(): string;                       // 32 random bytes, base64url, no padding
export async function hashOneTimeToken(token: string): Promise<string>; // SHA-256 hex
export function isTokenUsable(row: { used: boolean | null; expiresAt: Date }, now: Date): boolean;

// RateLimitService
static async enforceAuthEmailRateLimit(env: Env, config: RateLimitSettings, request: Request, user: AuthUser | null): Promise<void>; // keyed by universal identifier (user or client IP), throws RateLimitExceededError
```

`worker/types/email-binding.d.ts` augments the global `Env` with `EMAIL?: TransactionalEmailBinding`. First check how other optional bindings are typed: `worker-configuration.d.ts` is generated by `wrangler types`, so augment with `interface Env { EMAIL?: … }` in a `.d.ts` included by the worker tsconfig. Make sure `tsc` picks it up.

**Behavior:**
- **The Cloudflare sender** calls `env.EMAIL.send({ to, from: EMAIL_FROM, subject, html, text })`.
- **The dev sender** logs, through the project logger (`createLogger('Email')`) at info level, a single structured entry with `to`, `subject` and `text`, so the link can be read in the dev server log. It's never used in production. With no binding and a non-dev environment, `createEmailSender` returns `null`.
- **`appBaseUrl`:**
  - If `env.CUSTOM_DOMAIN` is non-empty and the request host is not a loopback, return `https://${env.CUSTOM_DOMAIN}`.
  - Otherwise return `new URL(request.url).origin`.
  - Use `isLocalHost` from `worker/utils/urls.ts`.
- **Templates:**
  - Plain HTML: a heading, one paragraph, one button-styled `<a>` with an inline style, and the raw link repeated as text, with no images. The text version carries the same words and link.
  - The reset email says `This link expires in 30 minutes. If you didn't ask to reset your password, ignore this email.`
  - The confirmation email says `This link expires in 24 hours.`
  - HTML-escape the link and the address in the HTML part.

- [ ] **Step 1: Write the failing tests**

`one-time-token.test.ts`:
- the token is 43 base64url characters, matching `/^[A-Za-z0-9_-]{43}$/`, and two tokens differ;
- the hash is 64 hex characters, deterministic, and differs from the token;
- `isTokenUsable` is false when used, false when `expiresAt <= now`, and true otherwise.

`links.test.ts`:
- production (`CUSTOM_DOMAIN` `estori.app`, request `https://evil.example/x` with any Host) gives `https://estori.app`;
- `CUSTOM_DOMAIN` empty with request `http://localhost:8100/api/x` gives `http://localhost:8100`;
- a loopback request with `CUSTOM_DOMAIN` set gives the request origin;
- the link builders encode the token.

`templates.test.ts`:
- each template's `to`, subject, both bodies containing the link, the expiry sentence, no `<img`;
- an HTML-escaped link when it contains `&`.

`sender.test.ts`:
- with a fake binding, `send` passes `from: EMAIL_FROM` and the fields;
- with no binding and `ENVIRONMENT: 'dev'`, it returns a sender that doesn't throw;
- with no binding and `ENVIRONMENT: 'prod'`, it returns `null`, and `isEmailSendingEnabled` is false.

`auth-email-rate-limit.test.ts`: the default config has `authEmail` enabled with limit 5 per 3600 seconds. Add a source wiring check that `enforceAuthEmailRateLimit` builds its key with `RateLimitType.AUTH_EMAIL`.

- [ ] **Step 2: Run them and watch them fail.** Run `npx vitest run worker/services/email worker/services/auth/one-time-token.test.ts worker/services/rate-limit/auth-email-rate-limit.test.ts`. Expect FAIL, because the modules are missing.

- [ ] **Step 3: Implement the modules above.** Use `crypto.getRandomValues` and `crypto.subtle.digest('SHA-256', …)` (both exist in Workers), and base64url without padding. Copy the rate-limit method's shape from `enforcePublicAppsRateLimit`, using `getUniversalIdentifier(user, request)`, its message, and `['Please try again in an hour.']`.

- [ ] **Step 4: Run the tests and watch them pass.** Run the same command. Expect PASS. Then run the typecheck: `npx tsc -b --incremental --noEmit 2>&1 | grep "error TS" | grep -v artifacts-viewer`, which should print nothing.

- [ ] **Step 5: Commit.** Commit the files above with the message `feat(email): send account emails through Cloudflare Email Service, or the dev log locally`.

---

### Task 2: Password reset on the server

**Files:**
- Modify:
  - `worker/database/services/AuthService.ts`: add `requestPasswordReset` and `resetPassword`, each with a JSDoc comment. Keep the `\n    /**` method boundaries that the wiring tests use.
  - `worker/api/controllers/auth/controller.ts`: add `forgotPassword` and `resetPassword`.
  - `worker/api/routes/authRoutes.ts`: add both routes as public, beside `/register`.
- Create: `worker/database/services/password-reset.test.ts` and `worker/api/controllers/auth/password-reset.test.ts`.
- Consumes from Task 1: `createEmailSender`, `appBaseUrl`, `resetPasswordLink`, `passwordResetEmail`, the token helpers, `RESET_TOKEN_TTL_MS` and `enforceAuthEmailRateLimit`. Also the existing `forgotPasswordSchema` and `resetPasswordSchema` (`authSchemas.ts:60-83`), `SessionService.revokeAllUserSessions`, `validatePassword` and `PasswordService.hash`.

**Interfaces (produces):**
```ts
// AuthService
async requestPasswordReset(email: string, sender: EmailSender | null, baseUrl: string): Promise<void>; // never throws for unknown email
async resetPassword(token: string, newPassword: string): Promise<void>; // throws SecurityError 400 RESET_LINK_INVALID_MESSAGE or password rule messages
// worker/services/auth/one-time-token.ts (add)
export const RESET_LINK_INVALID_MESSAGE = 'This reset link is invalid or has expired.';
export const FORGOT_PASSWORD_MESSAGE = "If an account exists for that email, we've sent a link to reset your password. It expires in 30 minutes.";
// Routes
POST /api/auth/forgot-password  { email }                                   → 200 { message: FORGOT_PASSWORD_MESSAGE }
POST /api/auth/reset-password   { token, newPassword, confirmPassword }     → 200 { message: 'Your password is updated.' } | 400
```

**Behavior:**
- **`requestPasswordReset`:**
  1. Look up the user by lowercased email.
  2. If there's no user, no `passwordHash` (a provider-only account), or no sender, return.
  3. Otherwise mark the user's unused reset tokens as used, insert a new row (id, userId, `tokenHash`, `expiresAt` = now + TTL), and send `passwordResetEmail` with the link.
  4. Catch email errors and log them without throwing.
- **`resetPassword`:**
  1. Hash the token and find the row.
  2. If there's no row or it isn't usable, throw 400 with the invalid-link message.
  3. Validate the password with `validatePassword(newPassword, undefined, { email: user.email })`. On failure, throw 400 with the joined errors.
  4. Hash the password and update the user: `passwordHash`, `passwordChangedAt` = now, `failedLoginAttempts` 0, `lockedUntil` null, `updatedAt`.
  5. Mark the token used, and call `revokeAllUserSessions(userId)`.
  6. Log the auth attempt with type `'password_reset'`, following the `logAuthAttempt` signature.
- **Controllers:**
  - Parse JSON, then `safeParse` the schema (400 with the first issue message).
  - Call `enforceAuthEmailRateLimit` on both endpoints (429 on `RateLimitExceededError`).
  - `forgotPassword` calls the service with `createEmailSender(env)` and `appBaseUrl(env, request)` and always returns `FORGOT_PASSWORD_MESSAGE`.
  - `resetPassword` maps `SecurityError` to its status and message.
  - When `isEmailAuthEnabled(env)` is false, both answer 403 like `register` does.

- [ ] **Step 1: Write the failing tests**

`password-reset.test.ts` (the service) uses `recordingD1` with rows supplied per statement where needed, or `vi.mock` of the database calls if `recordingD1` can't express multi-step flows. Choose the lighter option and keep the assertions behavioral:
- an unknown email sends nothing and inserts nothing;
- a provider-only account sends nothing;
- a password account marks old tokens used, inserts a row whose `token_hash` is 64 hex characters (never the raw token), and sends one email whose link contains the raw token;
- `resetPassword` with an unknown, used or expired token throws the invalid message;
- a valid token with a weak password throws the rule message and doesn't update;
- a valid token with a strong password updates the hash, marks the token used and revokes sessions.

`worker/api/controllers/auth/password-reset.test.ts` (controller and wiring, with `vi.mock` of `AuthService` as in `accept-terms.test.ts`):
- forgot-password answers 200 with the same message whether the service resolves or throws;
- reset-password answers 400 with the service's message;
- mismatched passwords answer 400 "Passwords don't match";
- a source check that both routes are registered with `AuthConfig.public` and that both handlers call `enforceAuthEmailRateLimit`.

- [ ] **Step 2: Run them and watch them fail.** Run `npx vitest run worker/database/services/password-reset.test.ts worker/api/controllers/auth/password-reset.test.ts`. Expect FAIL.

- [ ] **Step 3: Implement as described.**

- [ ] **Step 4: Run them and watch them pass.** Run the same tests plus `npx vitest run worker/database/services worker/api/controllers/auth`, then the typecheck.

- [ ] **Step 5: Commit.** Use the message `feat(auth): reset a forgotten password by email`.

---

### Task 3: Email confirmation, resend, the providers flag, and the provider auto-link rule

**Files:**
- Modify:
  - `worker/database/services/AuthService.ts`:
    - `register`: store `emailVerified: false`, then send the confirmation after the insert, best effort;
    - add `sendEmailConfirmation`, `verifyEmail` and `resendEmailConfirmation`;
    - change the auto-link branch of `findOrCreateOAuthUser` (around lines 714-728).
  - `worker/api/controllers/auth/controller.ts`:
    - add `verifyEmail` and `resendVerification`;
    - `getAuthProviders` adds `emailSending: isEmailSendingEnabled(env)` to `providers`;
    - `register` passes the sender and base URL to the service.
  - `worker/api/routes/authRoutes.ts`: add `POST /verify-email` (public) and `POST /resend-verification` (authenticated).
  - `worker/api/controllers/auth/authSchemas.ts`: add `verifyEmailSchema = z.object({ token: z.string().min(1).max(200) })`.
- Create: `worker/database/services/email-confirmation.test.ts`, `worker/database/services/oauth-autolink.test.ts` and `worker/api/controllers/auth/email-confirmation.test.ts`.

**Interfaces (produces):**
```ts
// one-time-token.ts (add)
export const CONFIRM_LINK_INVALID_MESSAGE = 'This confirmation link is invalid or has expired.';
// AuthService
async sendEmailConfirmation(user: { id: string; email: string }, sender: EmailSender | null, baseUrl: string): Promise<void>; // best effort
async verifyEmail(token: string): Promise<void>;           // 400 CONFIRM_LINK_INVALID_MESSAGE unless row usable AND row.email === user's current email
async resendEmailConfirmation(userId: string, sender: EmailSender | null, baseUrl: string): Promise<void>; // no-op if confirmed or no passwordHash
// register signature gains (sender, baseUrl) after request — keep existing callers compiling
// Providers payload: providers.emailSending: boolean
// Routes
POST /api/auth/verify-email           { token } → 200 { message: 'Your email is confirmed.' } | 400
POST /api/auth/resend-verification    (auth)    → 200 { message: 'If your email is not confirmed yet, we sent a new link.' }, rate limited by enforceAuthEmailRateLimit with the user
```

**The auto-link rule.** Replace the `emailRow` branch with:
- if `emailRow.emailVerified === true`, link as today;
- otherwise, link the identity, then update the user with `emailVerified: true`, `passwordHash: null` and `updatedAt`, call `revokeAllUserSessions(emailRow.id)` before the new session is created, and log `Claimed unconfirmed account through a verified provider` with the userId and provider. Return the updated row.

Check the order: the new session for this sign-in must be created after the revoke. Read the caller `handleOAuthCallback` to confirm where the session is created, and keep it after.

- [ ] **Step 1: Write the failing tests**

`email-confirmation.test.ts` (the service):
- `register` inserts `email_verified` false and sends one confirmation email when a sender is given;
- `register` still succeeds when the sender throws;
- `verifyEmail` rejects unknown, used and expired tokens and a row whose email differs from the user's current email, and marks the user verified and the token used for a valid token;
- `resendEmailConfirmation` sends nothing for a confirmed user or a provider-only user, and marks old tokens used before inserting a new one.

`oauth-autolink.test.ts`:
- a confirmed existing account gets the identity linked, with the password untouched and no revoke;
- an unconfirmed existing account gets the identity linked, `password_hash` set to null, `email_verified` true, and `revokeAllUserSessions` called once.

Use `vi.spyOn` on `SessionService.prototype.revokeAllUserSessions`, or a recording database.

`email-confirmation.test.ts` (the controller):
- verify-email answers 200 or 400;
- resend-verification is authenticated, rate limited, and answers 200;
- `getAuthProviders` includes `emailSending`, false with no binding in prod and true with a fake binding;
- a source check of the route auth levels.

- [ ] **Step 2: Run them and watch them fail.** Run `npx vitest run worker/database/services/email-confirmation.test.ts worker/database/services/oauth-autolink.test.ts worker/api/controllers/auth/email-confirmation.test.ts`. Expect FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and watch them pass,** plus `npx vitest run worker/database worker/api/controllers/auth` and the typecheck. The existing `terms-wiring.test.ts` and `auth-admin-email-wiring.test.ts` must still pass.

- [ ] **Step 5: Commit.** Use the message `feat(auth): confirm email addresses and protect accounts from pre-hijacking through provider sign-in`.

---

### Task 4: Frontend for forgot password, the reset and confirm pages, and confirmation status in Settings

**Files:**
- Modify:
  - `src/lib/api-client.ts`: add `forgotPassword(email)`, `resetPassword(token, newPassword, confirmPassword)`, `verifyEmail(token)` and `resendVerification()`, each returning `ApiResponse<{ message: string }>`.
  - `src/contexts/auth-context.tsx`: `authProviders` gains `emailSending: boolean`. Check how the providers response is typed and stored, and widen it there.
  - `src/components/auth/login-modal.tsx`: add a `'forgot'` mode.
  - `src/routes.tsx`: add `reset-password` and `verify-email` under `PublicShell`.
  - `src/components/auth/TermsGate.tsx`: skip the window on `/reset-password` and `/verify-email` too, extending the path check without duplicating the list.
  - `src/routes/settings/index.tsx`: show the email confirmation status and a resend button.
- Create: `src/routes/auth/ResetPasswordPage.tsx`, `src/routes/auth/VerifyEmailPage.tsx` and `src/routes/auth-pages-guard.test.ts`.

**Behavior:**
- **The login modal's sign-in mode** shows a `Forgot password?` text button under the password field, only when `authProviders?.emailSending`.
- **`'forgot'` mode:**
  - title "Reset your password", one email field and `Send reset link`;
  - on success it shows the server's message, `FORGOT_PASSWORD_MESSAGE`, in place of the form, with `Back to sign in`;
  - errors (429, network) show in the existing error banner.
- **`ResetPasswordPage`:**
  - It reads `token` from the query. With no token, it shows the invalid-link state.
  - It has New password and Confirm password fields. Client checks match the sign-up rules (reuse the same validation helper the modal uses; extract one if the modal's rules are inline). Don't copy the logic.
  - It submits through `apiClient.resetPassword`.
  - **Success:** `Your password is updated. Sign in with your new password.` with a `Sign in` button calling `showAuthModal()`.
  - **Invalid-link error:** `This reset link is invalid or has expired.` with a `Request a new link` button that opens the auth window in forgot mode. Add a way to open the modal directly in forgot mode, for example an optional `initialMode` passed through `showAuthModal`'s options. Keep the existing call signature working.
- **`VerifyEmailPage`:**
  - It shows a short explanation, the line `Only confirm if you created an Estori account with this address.` and a primary **Confirm my email** button. It posts the token once when the visitor clicks Confirm my email, never on load, because link scanners open pages without clicking (a ref guards against double posts and the button is disabled while pending).
  - It then shows either `Your email is confirmed.` with a link to `/`, or `This confirmation link is invalid or has expired.` with "Resend it from Settings" linking to `/settings` (if signed out, `/settings` asks them to sign in).
  - It refreshes the user (`refreshUser`) after success when signed in.
- **Settings,** account section, near the email:
  - with `emailSending` on, `Email confirmed` or `Email not confirmed` (hidden when email sending is off, since the address couldn't be confirmed);
  - for unconfirmed email accounts (`user.provider === 'email'`) with `emailSending` on, a `Resend confirmation email` button that shows the server message as a toast.
- **Pages** set `<title>{pageTitle('Reset password')}</title>` and `<title>{pageTitle('Confirm email')}</title>`.

- [ ] **Step 1: Write the failing guard test.** `auth-pages-guard.test.ts` asserts:
  - the routes `reset-password` and `verify-email` are inside the `PublicShell` block and not in `ProtectedRoute`;
  - the modal contains `Forgot password?` and the condition `authProviders?.emailSending`;
  - the modal's forgot mode calls `apiClient.forgotPassword`;
  - `ResetPasswordPage` calls `apiClient.resetPassword` and contains both result strings;
  - `VerifyEmailPage` calls `apiClient.verifyEmail` once, from the Confirm my email click handler and not a mount effect (a ref guard is present);
  - Settings contains `Resend confirmation email` and `apiClient.resendVerification`;
  - TermsGate skips both new paths.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run it and watch it pass,** plus `npx vitest run src` and the typecheck.

- [ ] **Step 5: Check it live on localhost.** The dev server is at http://localhost:8100, and emails appear in the dev server log; find the log file through the running dev-server task or ask the controller.
  1. **Forgot password:** sign in with "Forgot password?" for a local test account → read the link in the log → open it → set a new password → sign in with it. The old session is signed out.
  2. **Reused link:** open the same link again and get the invalid message.
  3. **Confirmation:** create a new local account → read the confirmation link in the log → open it → it's confirmed → Settings shows it confirmed.
  4. **Resend:** with another new account, Resend in Settings logs a new link.

  Record new local accounts in `.superpowers/realtest/local-accounts.md` in its existing format, and never print passwords.

- [ ] **Step 6: Commit.** Use the message `feat(auth): forgot-password, reset and confirm-email pages, and confirmation status in Settings`.

---

### Task 5: Honest account deletion, debug-panel address, and a privacy text line

**Files:**
- Modify:
  - `src/routes/settings/index.tsx`: the delete dialog and handler (around lines 142-144 and 695-765).
  - `src/routes/chat/components/debug-panel.tsx` (around line 508).
  - `src/content/legal/privacy.md`, section 3, the Cloudflare bullet.
  - `src/content/legal/legal-documents.test.ts`.
- Create: `src/routes/account-honesty-guard.test.ts`.

**Behavior:**
- **The delete dialog:**
  - title `Delete your account`;
  - description `To delete your account and all your data, email privacy@estori.app from {user.email}. We complete erasure within 45 days.`, with the email interpolated from the current user and the address from `LEGAL_CONTACT.privacy` via `@/api-types`;
  - buttons `Cancel` and an `Email us` link button with href `mailto:${LEGAL_CONTACT.privacy}?subject=${encodeURIComponent('Delete my Estori account')}`.
  - Remove `handleDeleteAccount` and the "not yet implemented" toast.
  - The section's description line becomes `Ask us to erase your account and all your data`.
- **The debug panel's mailto** goes to `LEGAL_CONTACT.support`.
- **The privacy Cloudflare bullet** becomes exactly: `- **Cloudflare**: hosting, databases, file storage, AI request routing, browser rendering for site screenshots and for pages you ask the AI to look at, sending account emails such as password resets and email confirmations, and operational logs.`

- [ ] **Step 1: Write the failing tests.**
  - The guard asserts that the settings source contains `LEGAL_CONTACT.privacy`, `Delete my Estori account` and `We complete erasure within 45 days`, and doesn't contain `not yet implemented`.
  - It asserts that the debug panel doesn't contain `ashishsingh` or `cloudflare.com` mailto, and does contain `LEGAL_CONTACT.support`.
  - `legal-documents.test.ts` asserts that privacy contains `sending account emails such as password resets and email confirmations`.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them and watch them pass,** plus `npx vitest run src` and the typecheck.

- [ ] **Step 5: Commit.** Use the message `fix(account): ask for erasure by email instead of a fake delete, fix the debug-panel address, list account emails in the privacy policy`.

---

### Task 6: Full verification

- [ ] **Step 1: Run the suites.** Run `npx vitest run src`, `npx vitest run shared`, `npx vitest run worker/database`, `npx vitest run worker/services` and `npx vitest run worker/api`. Everything should pass; rerun a batch after a flake.
- [ ] **Step 2: Run the typecheck,** which should be clean apart from the 4 known artifacts-viewer errors.
- [ ] **Step 3: Rerun the live checks from Task 4 Step 5,** plus:
  - the landing page, `/pricing` and `/terms` still render signed out;
  - sign-up still requires the terms box;
  - the delete dialog shows the mailto.
- [ ] **Step 4: Record the results** in the ledger.
