# Account basics for public users

Status: written overnight on 2026-10-14 by Claude while the owner slept. The owner approved the three-part split on 2026-10-13: pages, then account basics, then opening the site. They asked for "the app for users" to be ready by morning. This spec covers part 2. Every decision below was made on the owner's behalf and is listed under "Decisions made without the owner" for review.

It builds on `2026-10-13-public-launch-pages-design.md`, which added the legal pages, the terms agreement and the landing page.

## Why

Before strangers can use Estori:
- **No email is ever sent.** Nobody who forgets their password can get back in.
- **Sign-up marks every address as verified without checking it.** Combined with how a Google or GitHub sign-in is attached to an existing account by email (`AuthService.findOrCreateOAuthUser`), this allows account pre-hijacking. Someone signs up with another person's email and a password; when the real owner later signs in with Google, they're attached to that account, and the attacker still has the password.
- **The Settings page's "Delete account" button only says "not yet implemented".** Its dialog also promises immediate permanent deletion.
- **A debug panel in the chat screen** opens an email addressed to a Cloudflare engineer, left over from VibeSDK.

## What people see

### Forgot password
- **Where it starts:** the sign-in view of the auth window shows "Forgot password?" under the password field. It shows only when email sending is available, which the server reports.
- **Requesting a link:** it opens a view in the same window with an email field and **Send reset link**. Whatever is typed, the answer is the same: "If an account exists for that email, we've sent a link to reset your password. It expires in 30 minutes." Then a **Back to sign in** link.
- **The email:** subject "Reset your Estori password". It contains a button and a plain link to `/reset-password?token=…`, and says "This link expires in 30 minutes. If you didn't ask for it, ignore this email."
- **`/reset-password`** is a public page with:
  - "New password" and "Confirm password" fields, with the same strength rules and hints as sign-up;
  - **Update password**.
  - **On success:** "Your password is updated. Sign in with your new password." with a **Sign in** button that opens the auth window. Every session of that user is signed out.
  - **On a bad or expired link:** "This reset link is invalid or has expired." with a **Request a new link** button that opens the forgot-password view.

### Confirm your email
- **Sign-up:** new email accounts start unconfirmed. When email sending is available, sign-up sends "Confirm your email for Estori", with a link to `/verify-email?token=…` that is valid for 24 hours.
- **`/verify-email`** is a public page. It confirms the address and shows either "Your email is confirmed." with a link to the app, or "This confirmation link is invalid or has expired." with a hint to resend from Settings.
- **Settings** shows "Email: confirmed" or "Email: not confirmed". An unconfirmed email account gets a **Resend confirmation email** button, shown when email sending is available.
- **No feature is locked behind confirmation yet.** During the beta, confirmation only proves ownership. That ownership protects the account when the same address later signs in with Google or GitHub (below).
- **Existing accounts** keep their current flag.

### Signing in with Google or GitHub when an account with that email exists
- **Confirmed email:** the provider is attached to the existing account, as today.
- **Unconfirmed email:**
  - The provider sign-in proves who owns the address, so the provider is attached and the email is marked confirmed.
  - The account's password is removed, and all its other sessions are signed out. Anyone who signed up with someone else's address loses access.
  - The real owner can set a password later through Forgot password.

### Deleting an account
- **The Settings "Delete account" dialog** becomes honest: "To delete your account and all your data, email privacy@estori.app from {your account's email}. We complete erasure within 45 days." It has an **Email us** button, a `mailto:` with the subject "Delete my Estori account", and **Cancel**. This matches the privacy policy.
- **Self-service erasure** is out of scope. It needs cleanup across Durable Objects, R2, Artifacts and D1.

### Debug panel
The chat debug panel's "email this dump" goes to support@estori.app instead of the old upstream address.

## Email sending

**Provider: Cloudflare Email Service** (Email Sending).
- It's in beta on the Workers Paid plan. estori.app already uses Cloudflare DNS.
- **Binding:** `send_email: [{ name: "EMAIL", remote: true }]`. It's called with `env.EMAIL.send({ to, from, subject, html, text })` and returns `{ messageId }`.
- **Onboarding:** the domain is onboarded under Compute > Email Service > Email Sending > Onboard Domain. Cloudflare adds the SPF, DKIM, DMARC and bounce MX records on `cf-bounce`.

**Sender:** `Estori <no-reply@estori.app>`.

**Which sender is used:**
- With the `EMAIL` binding configured, Estori sends through Cloudflare.
- In local development with no binding, Estori writes each email to the dev server log: recipient, subject and the plain-text body with its link. The owner can then follow the links locally.
- In production with no binding, email sending is unavailable:
  - the server reports it as off;
  - "Forgot password?" and "Resend confirmation email" are hidden;
  - sign-up still works, and the account starts unconfirmed.

**Link domain:**
- **Production:** `https://{CUSTOM_DOMAIN}`, never the request's Host header. This prevents a forged-Host attack from planting a link to another domain.
- **Local development** (empty `CUSTOM_DOMAIN`, or a loopback request): the request's origin.

**Templates:** plain, readable HTML with the Estori name and one button, plus a text version. No images, tracking pixels or tracked links.

## Tokens

- **Creation:** 32 random bytes, encoded as base64url. Only a SHA-256 hash is stored, in the existing `password_reset_tokens` and `email_verification_tokens` tables.
- **Expiry:** reset links last 30 minutes; confirmation links last 24 hours.
- **Single use:** each link is marked used when it's consumed.
- **Replacement:** a new link marks the user's earlier unused links of the same kind as used.
- **Email change:** a confirmation link carries the email it was sent for, so it only confirms that address.

## Server

- `POST /api/auth/forgot-password` with `{ email }`:
  - public, and rate limited per client;
  - answers 200 with the same message for every input;
  - sends an email only to an existing account that has a password;
  - an account that signs in only through a provider gets nothing.
- `POST /api/auth/reset-password` with `{ token, newPassword, confirmPassword }` (the existing schema):
  - public, and rate limited per client;
  - 400 "This reset link is invalid or has expired." for a bad, used or expired token;
  - 400 with the password rule messages for a weak password;
  - on success:
    - updates the password hash;
    - sets `passwordChangedAt`;
    - clears failed attempts and the lock;
    - marks the token used;
    - signs out every session.
- `POST /api/auth/verify-email` with `{ token }`:
  - public;
  - marks the user confirmed when the token is valid and its email matches the user's current email;
  - 400 "This confirmation link is invalid or has expired." otherwise.
- `POST /api/auth/resend-verification`:
  - for signed-in users;
  - rate limited to 3 an hour per user;
  - sends nothing to an account that is already confirmed or has no password.
- **The auth providers response** (`GET /api/auth/providers`, which the auth window already reads) gains `emailSending: boolean`.
- **Sign-up** stores `emailVerified: false` and sends the confirmation email when sending is available. An email failure never fails the sign-up; it's logged.
- **`findOrCreateOAuthUser`** applies the confirmed or unconfirmed rule above when it attaches a provider by email.

## Privacy policy

Section 3 (Cloudflare) changes to: "hosting, databases, file storage, AI request routing, browser rendering for site screenshots and for pages you ask the AI to look at, sending account emails such as password resets and email confirmations, and operational logs."

The version stays `2026-10-13`, because it hasn't been published.

## Testing

- **Unit:**
  - token creation, hashing and expiry;
  - choosing a sender (binding, dev log, or none);
  - the link domain (production ignores Host);
  - the email templates contain the link and the expiry text.
- **Service** (with the recording D1, plus mocks where needed):
  - forgot-password invalidates old tokens and stores only the hash;
  - reset rejects used or expired tokens and revokes sessions;
  - verify checks that the email matches;
  - sign-up stores unconfirmed and sends the email;
  - OAuth attaches to an unconfirmed account by removing its password and revoking its sessions.
- **Controllers:** status codes and messages, and the same answer for an unknown email.
- **Guards:**
  - "Forgot password?" shows only when `emailSending` is on;
  - the reset and verify pages are public;
  - the delete dialog carries the privacy@ mailto;
  - the debug panel no longer has the old address.
- **Live, local** (the dev log shows the emails):
  - forgot password, then reset, then sign in with the new password, while the old session is signed out;
  - sign up, then read the confirmation link in the log, then confirm, and Settings shows it confirmed;
  - resend works;
  - an expired or reused link shows its message.

## Launch checklist (owner)

1. Onboard estori.app in Cloudflare Email Service. The Workers Paid plan is required, and the service is in beta.
2. Add `"send_email": [{ "name": "EMAIL", "remote": true }]` to `wrangler.estori.jsonc` and deploy.
3. Test one forgot-password email to your own address in production.

## Decisions made without the owner

1. **Email provider:** Cloudflare Email Service, not a third-party service like Resend. It's in the same account and the domain is on Cloudflare DNS. The cost is that it's in beta; switching providers means changing one module.
2. **Confirmation doesn't lock any feature during the beta.** Its main job is to stop account pre-hijacking. The cost is that unconfirmed accounts can still publish and sell.
3. **An unconfirmed account loses its password** when the address's owner signs in with Google or GitHub. This is the standard defense against pre-hijacking. The cost is that a real owner who used both methods must reset their password once.
4. **Self-service account erasure is deferred.** Deletion goes through privacy@ by email, as the privacy policy now says. The cost is manual work per request.
5. **The `send_email` binding isn't added to `wrangler.estori.jsonc` in this branch.** Production keeps working with email off until the domain is onboarded. The cost is one config line at launch.
6. **The reset link lasts 30 minutes and the confirmation link 24 hours,** which are common defaults.
