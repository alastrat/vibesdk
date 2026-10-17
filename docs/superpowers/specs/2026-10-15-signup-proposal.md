# Signup: proposal

Date: 2026-10-15. Status: **proposal for the owner's review**. Nothing here is built. The owner's answers to the questions at the end turn this into a spec, then an implementation plan.

## Goal

A visitor who clicks **Start building free**, or types a store idea into the landing build box, has a free account and a first store preview in about two minutes. The signup should look and sound like the rest of the new Estori site.

## How signup works today

Mapped from the code on 2026-10-15, with the key points checked by hand.

- **One modal for everything.** `LoginModal` (`src/components/auth/login-modal.tsx`) has login, register and forgot modes. It opens through `useAuthGuard.requireAuth`, `showAuthModal()` or any 401 response.
- **Signup is never opened directly.** The sign-up view exists (`initialMode: 'register'`), but no call site asks for it, so every new person lands on "Welcome back" and has to find the footer link.
- **Start building free doesn't sign anyone up.** It scrolls to the landing build box (`/#build`). Signup only starts once the person types a prompt and presses build.
- **Methods:**
  - Email and password (on by default).
  - Google, GitHub and Cloudflare OAuth, each switched on by its client id and secret.
  - No magic link, passkeys or one-time codes. The `verification_otps` table is unused.
- **After sign-up:**
  - The account and session are created immediately, and a confirmation email is sent (the link lasts 24 hours).
  - Nothing waits for the confirmation, nothing is blocked without it, and resend lives only in Settings.
- **Terms:**
  - Email signups tick "I'm 18 or older and agree to…" in the modal.
  - OAuth signups are created without terms, so `TermsGate` stops them with copy written for existing users ("We've published our Terms…").
- **The prompt survives sign-in, then gets questioned.** The build-box prompt rides through sign-in in the return URL. The chat page then asks "This link wants to start a new project with the prompt…". This is deliberate: a URL restored after sign-in might come from someone else's link, and `auth-redirect-guard.test.ts` pins it. The person who just typed the prompt still has to confirm their own idea, though. Images travel base64-encoded in the URL.
- **Data collected:** name, email and password only. There are no profile fields for what the person sells or where.
- **Protection:**
  - CSRF on every POST.
  - `/register` and `/login` have only the global API limit; there is no per-IP signup or login limit.
  - No bot check.
  - Two disposable domains are blocked.
  - The lockout columns (`failedLoginAttempts`, `lockedUntil`, `auth_attempts`) are written but never enforced.
- **Rough copy:**
  - "Join to start building amazing applications", "Sign in to create applications" and a key icon: pre-rebrand language.
  - "Sign In" versus "Sign in" in the top bars.
  - The client asks for a special character in the password, but the server doesn't.
  - Name is required on the client but optional on the server.
- **Account enumeration:** register answers 400 for an existing email-and-password account and 409 for an OAuth-only one, so the response reveals which accounts exist.

## Proposed experience

### 1. Dedicated pages for marketing entry points, the modal for in-app moments

- **New pages:**
  - `/signup` and `/login` in the public-site style.
  - A split layout like Apollo's and 1Password's: the form on the left, and on the right a live product visual (the Brass Wolf preview) with the free allowance ("200 AI credits a day, free").
- **Where people arrive:**
  - **Start building free**, **Sign in** and pricing's **Start building free** go to the pages.
  - The build box opens the modal in **register** mode and shows the person's own prompt: "Create your free account to build: *a store for handmade candles…*".
  - In-app moments (save, favorite, use a template) keep the modal and open it in the mode that fits.
- **Order on the form:** Google first, then GitHub, then email and password. Cloudflare sign-in moves to the developers page, where it belongs (it also connects the AI Gateway).

### 2. A form that matches the server

- Name, work email and password, with one set of rules shared by client and server, shown as a live checklist.
- The terms checkbox stays as it is: it's already pinned by tests and required by the server.
- One generic answer for "this email can't be used", so the response no longer reveals which accounts exist.

### 3. Build first, confirm before selling

- After signup, go straight to the builder. Confirming the email doesn't block building.
- A slim banner reads "Confirm your email to publish and sell", with a Resend button.
- Confirmation becomes required before **publishing to Discover** or **receiving payouts**. That is where a real address matters, and it stops throwaway accounts from listing stores.

### 4. Two quick questions, then the first store

- One skippable screen:
  - **What will you sell?** Physical products, digital products, other brands' products, or stores for clients.
  - **Do you already have a store?** No, Shopify, or somewhere else.
- **What the answers do:**
  - They're stored on the profile.
  - They tailor the starter prompts and templates on the builder home.
  - They map onto the site's existing Solutions pages: brands, resellers, digital and developers.
- **A prompt the person typed starts building right away.** The build box keeps the prompt and images in session storage, marked as typed on this device. The chat page skips the confirmation only for that stored prompt. A URL restored after sign-in, which might be someone else's link, still asks, as the guard test requires.

### 5. OAuth signups

New OAuth accounts get the same terms checkbox inside the first-run screen, with new-user copy. `TermsGate` keeps its current copy for existing users when the terms change.

### 6. Protection

- A per-IP limit on `/register` and `/login`, in the durable-object store like the contact form.
- Enforce the lockout that the schema already supports, or remove the unused columns.
- Cloudflare **Turnstile** in invisible mode on signup (owner decision: it needs a site key).
- A maintained disposable-email list instead of two hard-coded domains.

## Phases

1. **Signup itself:**
   - the `/signup` and `/login` pages and register-mode entry points;
   - the copy and brand pass;
   - unified password and name rules, and no account enumeration;
   - the prompt carried through without the confirmation step;
   - the OAuth first-run terms;
   - per-IP limits.
2. **First run:** the two questions and the profile fields, the tailored builder home, the confirm-email banner, and the publish and payout gate.
3. **With subscriptions:** choosing Premium at signup and paying with Stripe, once paid plans exist (today Get Premium leads to contact sales).

Each phase ships on its own, with guard tests for the copy and unit tests for the rules. The full flow is checked on localhost with throwaway test accounts.

## Questions for the owner

1. **Pages or modal?** I recommend pages for marketing entry points and the modal for in-app moments.
2. **Confirm email before building?** I recommend no: confirm before publishing to Discover and before payouts.
3. **The two first-run questions:** are these the right ones, and should they be skippable? I recommend skippable.
4. **Turnstile on signup?** I recommend yes, in invisible mode. It needs a Turnstile site key from the Estori Cloudflare account, which you'd create.
5. **Cloudflare sign-in on the public signup?** I recommend moving it to the developers page.
6. **Name: required or optional?** I recommend required: we use it in emails and on the profile.
7. **Start building free:** should it go to `/signup`, or keep scrolling to the build box for signed-out visitors? I recommend `/signup`, with the build box kept as the second path.
