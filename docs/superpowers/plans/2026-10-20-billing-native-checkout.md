# Native Billing Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers subscribe, buy extra credits, change their card, pay a failed renewal and download invoices without ever leaving estori.app. Stripe Elements runs on Estori's own pages and replaces Stripe-hosted Checkout and the Billing Portal.

**Architecture:**
- **Sessions.** Billing's Checkout Sessions switch to `ui_mode: 'elements'`, the same approach as the store pay page. The server answers a client secret instead of a URL, and the existing webhook stays the recorder.
- **Consent.** The page asks the server for the renewal terms, so a promotion code is reflected. It stores consent through its own call before `actions.confirm()`.
- **Card and history.** Card changes are setup-mode Elements sessions. The history and invoice PDFs come from Stripe's invoices, served through Estori.

**Tech Stack:**
- Cloudflare Workers with Hono controllers;
- the hand-written Stripe client (`worker/services/payments/stripe-client.ts`, API `2026-03-25.dahlia`);
- D1 with drizzle;
- React 19 with React Router and TanStack Query;
- Stripe.js from `js.stripe.com` with no npm package;
- vitest-pool-workers.

**Spec:** `docs/superpowers/specs/2026-10-20-billing-native-checkout-design.md`

## Global Constraints

**Repo and commits:**
- Branch `feat/billing-elements`, stacked on `feat/posthog`.
- Never stage `.dev.vars`, `bun.lockb`, `.superpowers/`, `.playwright-mcp/`, `src/routes/landing/LandingPage.tsx`, `wrangler.jsonc`, or `docs/superpowers/specs/2026-10-18-shopper-order-access-design.md`. Stage by explicit path.
- Commit messages: a lowercase subject after the conventional type, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests run from the repo root, a few files at a time: `rtk proxy bun run test -- <files>`. Type-check with `bun run typecheck`.

**Code rules:**
- No `any`, and no emojis.
- Comments state purpose, briefly.
- Seller copy follows `src/routes/copy-rules.ts`: no supplier or AI-assistant names.

**Stripe pages and URLs:**
- No Stripe-hosted page or `stripe.com` URL is shown to a seller anywhere in billing: pages, links, emails.
- Card data never touches Estori's servers; the Payment Element stays in Stripe's iframe.
- Stripe.js loads from `https://js.stripe.com/dahlia/stripe.js` (derived from `STRIPE_API_VERSION = '2026-03-25.dahlia'`), and only on the checkout and card pages.

**Unchanged behavior:**
- Card only (`payment_method_types: ['card']`); no wallets.
- Billing records come only from the idempotent paths in `worker/services/billing/events.ts`.
- PostHog billing events stay server-side, once per recorded change.
- `billing-checkout-paused` refuses new subscriptions, credit purchases and paid plan changes (503 with `BILLING_CHECKOUT_PAUSED_MESSAGE`).
  - It never blocks changing the card, paying a failed invoice, cancel, keep-plan or the history.
- Session `expires_at`, idempotency keys and the "one live subscription" rule stay as they are today.

**Consent and promotion codes:**
- Consent copy with no code: "I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel." The plan name and price are filled in; "Terms" links to `/terms`.
- Promotion codes are allowed on subscriptions.
- The terms phrase by coupon duration:
  - `once`: "$24.50 today, then $49 a month";
  - `repeating`: "$24.50 a month for 3 months, then $49 a month";
  - `forever`: "$24.50 a month".
- Credit purchases set `invoice_creation.enabled: true`.
- Billing history shows the last 24 invoices.
- A missing `STRIPE_PUBLISHABLE_KEY` answers 503 "Payments aren't set up yet".

## Review Focus

1. **The seller closes the tab after paying, before the return page loads.**
   - Expect: the webhook alone records the plan or the credits.
   - When both the return and the webhook run, the payment is recorded once, with one PostHog event.
   - Pinned in Task 4: "status and webhook together record one purchase and one subscription event".
2. **A 100%-off `once` code makes the first payment $0.**
   - Expect: the consent and button say "$0 today, then $49 a month".
   - A session with `payment_status: 'no_payment_required'` counts as paid.
   - Pinned in Tasks 1 and 4.
3. **The session expires while the page is open** (35 to 45 minutes).
   - Expect: the page shows "This checkout timed out" and a "Start again" button that creates a fresh session. Never a dead form.
   - Pinned in Tasks 4 and 9.
4. **Stripe's own retry paid the invoice before the seller pressed "Pay now" or finished "Update card and pay".**
   - Expect: "Your payment went through", never an error, and no second charge.
   - Pinned in Task 5: `nothing_due`.
5. **The seller double-clicks the pay button,** or the consent call is slow.
   - Expect: one consent record and one `confirm()`. The button stays disabled until the result.
   - Pinned in Task 9.

---

### Task 1: Shared Stripe constants, renewal wording and billing types

**Files:**
- Create: `shared/types/stripe.ts`
- Modify:
  - `worker/services/payments/stripe-client.ts`: import the version from shared, delete the local constant;
  - `worker/services/store-payments/pay-page.ts`: import `STRIPE_JS_URL` from shared;
  - `shared/types/billing.ts`.
- Test: `shared/types/billing-checkout.test.ts`

**Interfaces:**
- Produces:
  - In `shared/types/stripe.ts`:
    - `STRIPE_API_VERSION = '2026-03-25.dahlia'`;
    - `STRIPE_JS_URL = 'https://js.stripe.com/dahlia/stripe.js'`, derived as today.
  - In `shared/types/billing.ts`:
    - `PromotionTerms { duration: 'once' | 'repeating' | 'forever'; durationInMonths: number | null; discountedCents: number }`;
    - `renewalTermsPhrase(plan: PaidPlanId, promotion: PromotionTerms | null): string`;
    - `subscriptionConsentText(plan: PaidPlanId, promotion: PromotionTerms | null): string`;
    - `subscribeButtonText(plan: PaidPlanId, promotion: PromotionTerms | null): string`;
    - `CheckoutOrder = { kind: 'plan'; plan: PaidPlanId; priceCents: number; includes: string[] } | { kind: 'credits'; credits: number; amountCents: number }`;
    - `CheckoutTermsView { consentText: string; buttonText: string; dueTodayCents: number }`;
    - `CheckoutClientStart { clientSecret: string; publishableKey: string; sessionId: string; order: CheckoutOrder; terms: CheckoutTermsView | null }`, with `terms` null for credits;
    - `CheckoutConsentRequest { sessionId: string; termsVersion: string; consentText: string }`;
    - `CheckoutSessionState = 'paid' | 'processing' | 'open' | 'expired'`;
    - `CheckoutStatusView { state: CheckoutSessionState; kind: 'plan' | 'credits' }`;
    - `CardSetupMode = 'save' | 'pay'`;
    - `CardSetupStart { clientSecret: string; publishableKey: string; sessionId: string; mode: CardSetupMode }`;
    - `InvoicePaymentResult = { state: 'paid' } | { state: 'saved' } | { state: 'nothing_due' } | { state: 'requires_action'; clientSecret: string } | { state: 'declined'; message: string }`;
    - `CardOnFile { brand: string; last4: string; expMonth: number; expYear: number }`;
    - `InvoiceView { id: string; date: number; description: string; amountCents: number; currency: string; status: 'paid' | 'open' | 'void' | 'uncollectible' }`;
    - `BillingView` gains `card: CardOnFile | null`;
    - `PAYMENTS_NOT_SET_UP_MESSAGE = "Payments aren't set up yet."`;
    - `CHECKOUT_EXPIRED_MESSAGE = 'This checkout timed out.'`.
  - `CheckoutStarted` and `BillingRedirect` are deleted in Task 7, once their last users are gone. Keep them until then.

- [ ] **Step 1: Write the failing tests** in `shared/types/billing-checkout.test.ts`:

```ts
const half = (duration: PromotionTerms['duration'], months: number | null = null): PromotionTerms => ({ duration, durationInMonths: months, discountedCents: 2450 });
it('says the plain price without a code', () => {
	expect(subscriptionConsentText('pro', null)).toBe('I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel.');
	expect(subscribeButtonText('pro', null)).toBe('Subscribe: $49 a month');
	expect(subscribeButtonText('premium', null)).toBe('Subscribe: $199 a month');
});
it('names each coupon duration', () => {
	expect(renewalTermsPhrase('pro', half('once'))).toBe('$24.50 today, then $49 a month');
	expect(renewalTermsPhrase('pro', half('repeating', 3))).toBe('$24.50 a month for 3 months, then $49 a month');
	expect(renewalTermsPhrase('pro', half('repeating', 1))).toBe('$24.50 a month for 1 month, then $49 a month');
	expect(renewalTermsPhrase('pro', half('forever'))).toBe('$24.50 a month');
	expect(subscriptionConsentText('pro', half('once'))).toBe('I agree to the Terms, and that Estori Pro costs $24.50 today, then $49 a month, until I cancel.');
	expect(subscribeButtonText('pro', half('repeating', 3))).toBe('Subscribe: $24.50 a month for 3 months, then $49 a month');
});
it('handles a free first payment', () => {
	expect(renewalTermsPhrase('pro', { duration: 'once', durationInMonths: null, discountedCents: 0 })).toBe('$0 today, then $49 a month');
});
it('builds the stripe.js url from the pinned version', () => {
	expect(STRIPE_JS_URL).toBe('https://js.stripe.com/dahlia/stripe.js');
});
```

- [ ] **Step 2: Run it and watch it fail.** Run `rtk proxy bun run test -- shared/types/billing-checkout.test.ts`. Expected: FAIL, because the functions aren't exported.

- [ ] **Step 3: Implement.**
  - The consent sentence:
    - with no code: `I agree to the Terms, and that Estori ${planName} renews at ${phrase} until I cancel.`;
    - with any code: `I agree to the Terms, and that Estori ${planName} costs ${phrase}, until I cancel.`
  - The button is `Subscribe: ${phrase}`.
  - Use `formatUsd` and `PLAN_PRICES_CENTS` from `shared/types/plans.ts`.
  - Move the version constant to `shared/types/stripe.ts` and point both worker files at it.

- [ ] **Step 4: Verify.** Run the test file, plus `worker/services/store-payments/pay-page.test.ts` and `worker/services/payments/stripe-client.test.ts`. Expected: PASS. `bun run typecheck` passes.

- [ ] **Step 5: Commit:** `feat(billing): shared renewal wording for promotion codes and the stripe.js version`

### Task 2: Stripe client: Elements sessions, card setup, invoices

**Files:**
- Modify: `worker/services/payments/stripe-client.ts`
- Test: `worker/services/payments/stripe-billing-client.test.ts`

**Interfaces:**
- Consumes: Task 1's `STRIPE_API_VERSION`.
- Produces: `StripeClient` gains or changes the following. All are form-encoded through the existing `request`.
  - **`createSubscriptionCheckoutSession(input: SubscriptionCheckoutInput)`:**
    - `ui_mode: 'elements'`, and `return_url: input.returnUrl` replacing `successUrl` and `cancelUrl`;
    - no `consent_collection` and no `custom_text`;
    - everything else unchanged, including the idempotency key.
  - **`createCreditsCheckoutSession(input: CreditsCheckoutInput)`:** the same switch, plus `invoice_creation: { enabled: true, invoice_data: { metadata } }`.
  - **`createCardSetupSession(input: { customerId: string; userId: string; mode: CardSetupMode; returnUrl: string; nowMs: number }): Promise<StripeCheckoutSession>`:**
    - `mode: 'setup'`, `ui_mode: 'elements'`, `currency: 'usd'`, `payment_method_types: ['card']`;
    - `metadata: { kind: 'card', estori_user_id, card_mode }`;
    - `expires_at: billingCheckoutExpiresAt(nowMs)`;
    - key `billing-card-${userId}-${mode}-${bucket}`.
  - **`retrieveCheckoutSession(sessionId, expand?: readonly string[])`:** the optional `expand` adds `expand[]`. Billing uses `['discounts.coupon', 'discounts.promotion_code.coupon', 'setup_intent']`.
  - **`StripeCheckoutSession`** gains:
    - `discounts?: Array<{ coupon?: StripeCoupon | string | null; promotion_code?: { coupon: StripeCoupon } | string | null }> | null`;
    - `setup_intent?: { id: string; payment_method: string | null } | string | null`;
    - `expires_at?: number`.

    `StripeCoupon { id: string; duration: 'once' | 'repeating' | 'forever'; duration_in_months: number | null }`.
  - **Payment methods and invoices:**
    - `setDefaultPaymentMethod(input: { customerId: string; subscriptionId: string | null; paymentMethodId: string }): Promise<void>` updates `invoice_settings[default_payment_method]` on the customer, and `default_payment_method` on the subscription when given. Both use idempotency keys from the payment method id.
    - `retrievePaymentMethod(id: string): Promise<{ id: string; card: { brand: string; last4: string; exp_month: number; exp_year: number } | null }>`.
    - `listInvoices(customerId: string, limit: number): Promise<StripeInvoice[]>` uses `GET /invoices?customer=…&limit=24`.
    - `retrieveInvoice(id: string): Promise<StripeInvoice>` expands `payment_intent` where the API version allows. Check the dahlia invoice shape: `payments` or `confirmation_secret` may replace `payment_intent`. Write the client to what the pinned version returns, and note it in the report.
    - `payInvoice(id: string, paymentMethodId: string | null, idempotencyKey: string): Promise<StripeInvoice>` uses `POST /invoices/{id}/pay`, with `payment_method` when given and `off_session: false`.
    - `fetchInvoicePdf(url: string): Promise<Response>`: a plain GET of `invoice_pdf` with the secret key.
  - **`StripeInvoice`** gains:
    - `status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'`;
    - `created: number`, `amount_due: number`, `total: number`;
    - `invoice_pdf: string | null`;
    - `description: string | null`, `lines?: { data: Array<{ description: string | null }> }`;
    - whatever field carries the PaymentIntent's client secret and status in dahlia.
  - **Removed:** `createBillingPortalSession`.

- [ ] **Step 1: Write the failing tests**, in the file's existing fake-fetch style (read it first). Assert the encoded form bodies:
  - `the subscription session is an elements session with a return url and no stripe consent`:
    - `ui_mode=elements`;
    - `return_url=…`;
    - no `consent_collection`, `success_url` or `cancel_url` key;
    - `allow_promotion_codes=true`;
    - the same idempotency key as before.
  - `the credits session creates an invoice with the purchase metadata`: `invoice_creation[enabled]=true`, and `invoice_creation[invoice_data][metadata][kind]=credits`.
  - `a card setup session is a setup-mode elements session`: `mode=setup`, `metadata[kind]=card`, `metadata[card_mode]=pay`, key `billing-card-u1-pay-…`.
  - `setting the default card updates the customer and the subscription`: two requests, with the right paths and fields.
  - `paying an invoice sends the chosen card`.
  - `listing invoices asks for 24 for the customer`.
  - `the portal call is gone`: a type-level test via `// @ts-expect-error` on `client.createBillingPortalSession`.

- [ ] **Step 2: Run and watch them fail.** Run `rtk proxy bun run test -- worker/services/payments/stripe-billing-client.test.ts`. Expected: FAIL on the new fields and functions.

- [ ] **Step 3: Implement** the client changes above. Update the callers in `worker/services/billing/actions.ts` just enough to compile: pass `returnUrl`, and keep `openPortal` until Task 5 deletes it. `startCheckout` and `buyCredits` still return `url` until Task 4, so read `session.url ?? ''` with no new behavior.

- [ ] **Step 4: Verify.** Run that file plus `worker/services/billing/actions.test.ts`. Expected: PASS. Run `bun run typecheck`.

- [ ] **Step 5: Commit:** `feat(billing): the stripe client makes elements sessions for plans, credits and cards, and reads invoices`

### Task 3: Consent records in D1

**Files:**
- Create: `migrations/0030_billing_consents.sql`
- Modify:
  - `worker/database/schema.ts`: a `billingConsents` table near `billingCustomers`;
  - `worker/database/services/BillingService.ts`.
- Test: `worker/database/services/billing.sql.test.ts`, which exists; extend it.

**Interfaces:**
- Produces:
  - Table `billing_consents`, with columns:
    - `stripe_checkout_session_id` TEXT PRIMARY KEY;
    - `user_id` TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE;
    - `plan` TEXT NOT NULL;
    - `terms_version` TEXT NOT NULL;
    - `consent_text` TEXT NOT NULL;
    - `created_at` INTEGER NOT NULL.

    It has an index on `user_id`.
  - `BillingService.recordConsent(input: { sessionId: string; userId: string; plan: PaidPlanId; termsVersion: string; consentText: string; now: Date }): Promise<void>` upserts by session id. The latest wording wins, because applying a code changes it.
  - `BillingService.consentFor(sessionId: string): Promise<{ userId: string; plan: PaidPlanId; termsVersion: string; consentText: string; createdAt: Date } | null>`.

- [ ] **Step 1: Write the failing SQL tests:**
  - `stores a consent and reads it back by session`;
  - `a second consent for the same session replaces the wording`;
  - `a consent for an unknown session reads null`.
- [ ] **Step 2: Run and watch them fail.** Run `rtk proxy bun run test -- worker/database/services/billing.sql.test.ts`. Expected: FAIL, no such table.
- [ ] **Step 3: Implement** the migration (follow `0029_billing.sql`'s style), the schema and the two methods. Check that `drizzle-kit` agrees with the migration, the same way 0029 was checked.
- [ ] **Step 4: Verify** the same command passes.
- [ ] **Step 5: Commit:** `feat(billing): a consent record for each subscription checkout`

### Task 4: Checkout actions: client secret, terms, consent, status

**Files:**
- Create: `worker/services/billing/checkout-session.ts`
- Modify:
  - `worker/services/billing/actions.ts`: `startCheckout`, `buyCredits`, new actions;
  - `worker/services/billing/events.ts`: export what the status action reuses.
- Test:
  - `worker/services/billing/checkout-session.test.ts`;
  - `worker/services/billing/actions.test.ts`;
  - `worker/services/billing/checkout-status.sql.test.ts`.

**Interfaces:**
- Consumes: Task 1 types and wording; Task 2's client; Task 3's consent methods.
- Produces:
  - In `checkout-session.ts`:
    - `promotionTermsOf(session: StripeCheckoutSession): PromotionTerms | null`. It reads the first discount's coupon, from either `coupon` or `promotion_code.coupon`. `discountedCents` is `session.amount_total`.
    - `sessionStateOf(session: StripeCheckoutSession): CheckoutSessionState`:
      - `complete` with `paid` or `no_payment_required` gives `paid`;
      - `complete` with `unpaid` gives `processing`;
      - `expired` gives `expired`;
      - otherwise `open`.
    - `termsViewOf(plan: PaidPlanId, session: StripeCheckoutSession): CheckoutTermsView`.
  - In `actions.ts`:
    - `startCheckout(deps, user, plan): Promise<BillingActionResult<CheckoutClientStart>>`;
    - `buyCredits(deps, user, account, credits): Promise<BillingActionResult<CheckoutClientStart>>`;
    - `checkoutTerms(deps, userId: string, sessionId: unknown): Promise<BillingActionResult<CheckoutTermsView>>`;
    - `recordCheckoutConsent(deps, userId: string, body: unknown): Promise<BillingActionResult<{ recorded: true }>>`;
    - `checkoutStatus(deps, userId: string, sessionId: unknown): Promise<BillingActionResult<CheckoutStatusView>>`.
  - `BillingActionDeps` gains:
    - `publishableKey: string | null`, from `env.STRIPE_PUBLISHABLE_KEY` in `billingActionDepsFromEnv`;
    - `consents: Pick<BillingService, 'recordConsent' | 'consentFor'>`;
    - `record: { subscription(sessionId: string, subscriptionId: string, userId: string): Promise<void>; credits(sessionId: string): Promise<void> }`.

    `record` is built in `billingActionDepsFromEnv` from `applySubscription` and `applyCreditPurchase` with event id `return:${sessionId}`.
  - Return URL: `${baseUrl}${BILLING_PATH}/checkout/return?session_id={CHECKOUT_SESSION_ID}`, with the braces left for Stripe to fill in.

- [ ] **Step 1: Write the failing tests:**
  - **`checkout-session.test.ts`:**
    - `reads a once coupon from a promotion code`;
    - `reads a repeating coupon`;
    - `no discount reads null`;
    - `a complete session with no payment required is paid`;
    - `an expired session is expired`.
  - **`actions.test.ts`:**
    - `a plan checkout answers the client secret, the publishable key and the order`:
      - `order` is `{ kind: 'plan', plan: 'pro', priceCents: 4900, includes: [...] }`, with `includes` from the plan table;
      - `terms.consentText` is the no-code sentence.
    - `a credits checkout answers no terms`: `terms` is null, and `order` is `{ kind: 'credits', credits: 5000, amountCents: 750 }`.
    - `without a publishable key the checkout answers 503 PAYMENTS_NOT_SET_UP_MESSAGE before asking stripe`.
    - Keep the existing refusal tests (paused, already paying, past due, limits) passing unchanged.
    - `terms for a session that isn't the seller's answer 404`: the session's `client_reference_id` differs.
    - `consent is stored with the server's own wording`.
    - `consent with stale wording answers 409 and stores nothing`, with message `The price changed. Check it and agree again.`
    - `consent with an old terms version answers 400`.
    - `consent for a credits or expired session answers 400`.
  - **`checkout-status.sql.test.ts`,** against D1:
    - `a paid plan session records the subscription once`;
    - `status and webhook together record one purchase and one subscription event`. Run the status action, then `handleBillingEvent` for `checkout.session.completed` of the same session. Assert:
      - one `credit_purchases` row;
      - one subscription row;
      - one `subscription_started` captured by the analytics fake.
    - `status for another seller's session answers 404`;
    - `status of an expired session answers expired`.

- [ ] **Step 2: Run and watch them fail.** Run `rtk proxy bun run test -- worker/services/billing/checkout-session.test.ts worker/services/billing/actions.test.ts`, then the SQL file on its own. Expected: FAIL on the missing exports.

- [ ] **Step 3: Implement.**
  - Retrieve sessions with the Task 2 expand list.
  - Recording on return is best-effort. A failure logs a warning and still answers the state, because the webhook records anyway.
  - The 10-minute bucket keeps the same session for repeat starts.

- [ ] **Step 4: Verify.** The three files pass, and so do `worker/services/billing/*.test.ts` and `worker/api/controllers/billing/controller.sql.test.ts`, in batches.

- [ ] **Step 5: Commit:** `feat(billing): checkouts answer a client secret, the renewal terms follow promotion codes, and consent is stored before paying`

### Task 5: Card, failed-renewal payment and history actions

**Files:**
- Modify: `worker/services/billing/actions.ts`
- Create: `worker/services/billing/invoices.ts`, for the invoice and card mapping.
- Test:
  - `worker/services/billing/invoices.test.ts`;
  - `worker/services/billing/actions.test.ts`.

**Interfaces:**
- Consumes: Task 2's client and Task 1's types.
- Produces:
  - `startCardSetup(deps, user, mode: unknown): Promise<BillingActionResult<CardSetupStart>>`:
    - 404 `BILLING_MESSAGES.noCustomer` without a customer;
    - `mode` is `'save'` or `'pay'`, otherwise 400;
    - the return URL is `${baseUrl}${BILLING_PATH}/card/return?session_id={CHECKOUT_SESSION_ID}`.
  - `completeCardSetup(deps, userId, sessionId: unknown): Promise<BillingActionResult<InvoicePaymentResult>>`:
    - checks the session is the seller's, `mode: 'setup'`, kind `card` and complete;
    - sets the default card on the customer and the live subscription;
    - in pay mode, it then runs `payOpenInvoice` with the new card; in save mode it answers `{ state: 'saved' }`.
  - `payOpenInvoice(deps, userId, paymentMethodId: string | null): Promise<BillingActionResult<InvoicePaymentResult>>`:
    - finds the newest `open` invoice of the live subscription;
    - with none, it answers `nothing_due`;
    - a card error gives `declined` with Stripe's decline message, mapped through the existing `askStripe` path;
    - an authentication need gives `requires_action` with the PaymentIntent's client secret.
  - `billingHistory(deps, userId): Promise<BillingActionResult<InvoiceView[]>>`, newest first, at most 24, `draft` left out.
  - `invoicePdf(deps, userId, invoiceId: string): Promise<BillingActionResult<Response>>`:
    - 404 unless the invoice's customer is the seller's;
    - streams the body with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="estori-invoice-<number or id>.pdf"`.
  - `cardOnFile(stripe, customerId): Promise<CardOnFile | null>`, in `invoices.ts`, used by the billing view in Task 7.
  - Deleted: `openPortal`, and `createBillingPortalSession` from `BillingStripe`.
  - `billing-checkout-paused` is not checked by any of these.

- [ ] **Step 1: Write the failing tests:**
  - **`invoices.test.ts`:**
    - `maps a stripe invoice to the history row`: the description comes from the first line item, `amount_paid` when paid, else `amount_due`.
    - `drafts are left out`.
    - `reads the card on file from the default payment method`.
  - **`actions.test.ts`:**
    - `a card setup needs a customer`;
    - `completing a save setup sets the default card on the customer and the subscription`;
    - `completing a pay setup pays the open invoice with the new card`;
    - `paying when nothing is open answers nothing_due`;
    - `a declined invoice payment answers declined with the bank's message`;
    - `an invoice that needs authentication answers requires_action with the client secret`;
    - `card changes and invoice payment stay open while billing checkout is paused`;
    - `the pdf of another customer's invoice answers 404`;
    - `the pdf streams with an estori filename`.
- [ ] **Step 2: Run and watch them fail.** Run `rtk proxy bun run test -- worker/services/billing/invoices.test.ts worker/services/billing/actions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions above.
- [ ] **Step 4: Verify** the same files pass, plus `worker/services/billing/checkout-pause-wiring.test.ts`, updated so that card and invoice actions are pinned as unpaused.
- [ ] **Step 5: Commit:** `feat(billing): sellers change their card, pay a failed renewal and read their invoices inside estori`

### Task 6: Webhook and email changes

**Files:**
- Modify:
  - `worker/services/billing/events.ts`;
  - `worker/services/billing/subscription-row.ts`: the receipt notice;
  - `worker/services/billing/notices.ts`;
  - `worker/services/email/billing-templates.ts`;
  - `worker/services/billing/metering.ts`: `PAYMENT_FAILED_MESSAGE`;
  - `worker/services/billing/actions.ts`: `BILLING_MESSAGES` wording.
- Test: the existing `events` and `webhook-billing` SQL tests, `worker/services/email/billing-templates.test.ts`, `worker/services/billing/metering.sql.test.ts`, and `subscription-row.test.ts`.

**Interfaces:**
- Consumes: Task 3's `consentFor`, Task 2's `setDefaultPaymentMethod`, and Task 5's default-card helper. Extract one shared helper, `setDefaultCard(stripe, customerId, subscriptionId, paymentMethodId)`, used by both.
- Produces:
  - **Card sessions:**
    - `checkout.session.completed` with `mode: 'setup'` and `metadata.kind === 'card'` sets the default card, with the same helper and the same ownership check as `applySubscription`. It answers `applied`.
    - It never pays an invoice; only the page's pay mode does.
  - **Consent on subscriptions:**
    - The subscription-mode `checkout.session.completed` branch, after `applySubscription`, stamps `metadata[terms_version]` and `metadata[renewal_consent_at]` onto the subscription, from `consentFor(session.id)`, when they're missing.
    - With no consent record, it logs `warn('A subscription started without a stored consent', { sessionId })`.
  - **Failed renewals:**
    - `invoice.payment_action_required` joins `invoice.payment_failed` in `applySubscription`.
    - The `payment_failed` notice gains `needsConfirmation: boolean`. It is true when the invoice's payment needs the customer's authentication, per the dahlia invoice shape from Task 2.
  - **Email copy.** Billing links stay `links.billing`. "Manage billing" becomes "Open billing".
    - The receipt's "View invoice" goes to `${links.billing}#history`. The receipt notice drops `invoiceUrl`, so no Stripe URL is in any email.
    - The payment-failed email says, with `needsConfirmation`: "Your bank asked you to confirm this payment. Open billing and choose Pay now."
    - Otherwise: "Your card was declined. Open billing to pay with this card again or a new one."
  - **Messages:**
    - `BILLING_MESSAGES.paymentFailing`: `"Your last payment didn't go through. Pay it on the billing page first."`
    - `BILLING_MESSAGES.declined`: `'Your card was declined. Change your card on the billing page, then try again.'`
    - `PAYMENT_FAILED_MESSAGE` in metering: `"Your last payment didn't go through, so this month's AI credits haven't started. Pay it on the billing page to keep building."`

- [ ] **Step 1: Write the failing tests:**
  - `a completed card session sets the default card once`, for the event delivered twice;
  - `a subscription checkout stamps the stored consent onto the subscription`;
  - `a subscription without a stored consent is still recorded and warns`;
  - `an action-required invoice sends a payment failed notice that asks to confirm`;
  - `no billing email contains a stripe.com link`: render every billing template kind with fixtures, and assert `!/stripe\.com/.test(html + text)`.

  Update the existing tests that pin the old messages.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** The changed tests pass, plus `worker/api/controllers/payments/webhook-billing.sql.test.ts`, in batches.
- [ ] **Step 5: Commit:** `feat(billing): the webhook records card changes and consent, and billing emails never link to stripe`

### Task 7: Routes, controller, API client and the billing view

**Files:**
- Modify:
  - `worker/api/controllers/billing/controller.ts`;
  - `worker/api/routes/billingRoutes.ts`;
  - `worker/services/billing/view.ts`: `card` on the view, from Task 5's `cardOnFile`;
  - `src/lib/api-client.ts`;
  - `src/api-types.ts`;
  - `shared/types/billing.ts`: delete `CheckoutStarted` and `BillingRedirect`.
- Test:
  - `worker/api/controllers/billing/billing-routes-wiring.test.ts`;
  - `worker/api/controllers/billing/controller.sql.test.ts`.

**Interfaces:**
- Produces the following routes. All are `AuthConfig.authenticated` and behind the billing flag, as the existing ones are.
  - `POST /api/billing/checkout` with body `{ plan }`, answering `CheckoutClientStart`;
  - `POST /api/billing/credits` with body `{ credits }`, answering `CheckoutClientStart`;
  - `GET /api/billing/checkout/terms?session_id=`, answering `CheckoutTermsView`;
  - `POST /api/billing/checkout/consent` with a `CheckoutConsentRequest` body, answering `{ recorded: true }`;
  - `GET /api/billing/checkout/status?session_id=`, answering `CheckoutStatusView`;
  - `POST /api/billing/card` with body `{ mode }`, answering `CardSetupStart`;
  - `POST /api/billing/card/complete` with body `{ sessionId }`, answering `InvoicePaymentResult`;
  - `POST /api/billing/invoices/pay`, answering `InvoicePaymentResult` and using the card on file;
  - `GET /api/billing/history`, answering `InvoiceView[]`;
  - `GET /api/billing/invoices/:id/pdf`, answering the PDF, not JSON.

  `POST /api/billing/portal` is removed.
- `apiClient` gains `startPlanCheckout(plan)`, `buyCredits(credits)` (both now `CheckoutClientStart`), `getCheckoutTerms(sessionId)`, `recordCheckoutConsent(body)`, `getCheckoutStatus(sessionId)`, `startCardSetup(mode)`, `completeCardSetup(sessionId)`, `payOpenInvoice()`, `getBillingHistory()`, and `invoicePdfUrl(id): string`, a plain path for an anchor's `href`. `openBillingPortal` is removed.
- Writes send the CSRF header the way the existing billing writes do.

- [ ] **Step 1: Write the failing tests:**
  - **Wiring:** each new route's line, with its auth level, and that no `/api/billing/portal` line exists.
  - **Controller SQL:**
    - `the billing view carries the card on file`;
    - `history answers the seller's invoices`;
    - `a pdf request for another seller's invoice answers 404`.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** The PDF route returns the action's `Response` directly, without the JSON envelope.
- [ ] **Step 4: Verify.** Run the controller and route tests, then `bun run typecheck`. The type check will now fail in `src/hooks/use-billing.ts` and `src/routes/settings/billing.tsx`. Fix only the types there, so it compiles: the `CheckoutClientStart` shape, and the portal hook deleted along with its button. The real UI comes in Tasks 9 and 10.
- [ ] **Step 5: Commit:** `feat(billing): routes for elements checkout, consent, card changes, invoice payment and history; the portal route is gone`

### Task 8: Stripe.js in the app: loader, appearance and CSP

**Files:**
- Create:
  - `src/lib/stripe/stripe-js.ts`: the loader and the minimal typed surface;
  - `src/lib/stripe/appearance.ts`.
- Modify: `index.html`, the CSP `script-src`.
- Test:
  - `src/lib/stripe/appearance.test.ts`;
  - `src/routes/billing-checkout-csp-guard.test.ts`.

**Interfaces:**
- Consumes: Task 1's `STRIPE_JS_URL`.
- Produces:
  - `loadStripe(publishableKey: string): Promise<StripeJs>` injects one `<script src=STRIPE_JS_URL>` per page, shared, then calls `window.Stripe(publishableKey)`. A load failure rejects with `Error('Stripe could not load')`.
  - Minimal types, with no `any`, for exactly what the pages call:
    - `initCheckoutElementsSdk({ clientSecret, elementsOptions: { appearance } }): StripeCheckoutSdk`;
    - `StripeCheckoutSdk.createPaymentElement()`, `.loadActions()`, `.on('change', cb)`;
    - the actions: `confirm()`, `applyPromotionCode(code)`, `removePromotionCode()`;
    - `stripe.handleNextAction({ clientSecret })`.

    Match the names the store page uses (`worker/services/store-payments/pay-page.ts:437-568`) and Stripe's dahlia docs.
  - `billingAppearance(theme: 'light' | 'dark', tokens: Record<string, string>): StripeAppearance` maps Estori's CSS custom properties (read with `getComputedStyle`) to Stripe's `variables`: `colorPrimary`, `colorBackground`, `colorText`, `colorDanger`, `fontFamily`, `borderRadius`.
  - The CSP `script-src` adds `https://js.stripe.com https://*.js.stripe.com`.

- [ ] **Step 1: Write the failing tests:**
  - `maps light and dark tokens to stripe variables`;
  - `the spa csp allows stripe.js scripts`: read `index.html` and assert both origins in `script-src`.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** A loader test is optional; the Workers test pool has no DOM.
- [ ] **Step 4: Verify** the tests pass.
- [ ] **Step 5: Commit:** `feat(billing): load stripe.js in the app with estori's look`

### Task 9: The checkout page

**Files:**
- Create:
  - `src/routes/settings/billing-checkout.tsx`;
  - `src/routes/settings/billing-checkout-return.tsx`;
  - `src/routes/settings/checkout-state.ts`: pure state logic;
  - `src/hooks/use-billing-checkout.ts`.
- Modify:
  - `src/routes.tsx`: routes `settings/billing/checkout` and `settings/billing/checkout/return`, both requiring sign-in like Settings;
  - `src/hooks/use-billing.ts`: `usePlanCheckout` navigates to `/settings/billing/checkout?plan=…` instead of fetching a URL;
  - `src/routes/settings/billing-view.ts`: return handling.
- Test:
  - `src/routes/settings/checkout-state.test.ts`;
  - `src/routes/billing-checkout-guard.test.ts`.

**Interfaces:**
- Consumes:
  - Task 7's API client;
  - Task 8's `loadStripe` and `billingAppearance`;
  - Task 1's types and the `CHECKOUT_EXPIRED_MESSAGE` and `PAYMENTS_NOT_SET_UP_MESSAGE` constants.
- Produces:
  - `checkoutRequestOf(search: string): { kind: 'plan'; plan: PaidPlanId } | { kind: 'credits'; credits: number } | null`. Credits use `isExtraCreditsAmount`.
  - `canPay(state: { consented: boolean; termsLoading: boolean; paying: boolean; complete: boolean; kind: 'plan' | 'credits' }): boolean`. Credits need no consent.
  - `returnTargetOf(status: CheckoutStatusView): string` gives the next route:
    - `paid` and `processing` go to `/settings/billing?confirm=plan` or `?confirm=credits`;
    - `open` goes back to the checkout page;
    - `expired` goes to the checkout page with `expired=1`.
  - Page behavior, following spec 4.1 and 4.2:
    - The page starts the session on mount, then shows the order on the left and the Payment Element on the right. The order stacks above the form below `md`.
    - **Promotion codes:** a code field calls `applyPromotionCode`. After it applies or is removed, the page refetches the terms, which unticks the box and replaces the consent and button text.
    - **The pay button:**
      - it records consent first for plans, then calls `confirm()`;
      - it is disabled while paying, so a double click sends one consent and one `confirm()`;
      - a declined card shows Stripe's message under the form, with the box still ticked.
    - **Refusals:**
      - an expired session or a `confirm()` expiry error shows `CHECKOUT_EXPIRED_MESSAGE` and "Start again";
      - 503 messages, including the pause and a missing key, show in place of the form;
      - a 409 "already paying" goes back to Billing, as today.
    - "Back to billing" returns to `/settings/billing`.
    - **Credit amount:** the amount picked on Billing carries over in `?credits=`. The page offers the same amount picker as Billing, within `isExtraCreditsAmount`. Changing the amount starts a new session; the old session is simply left to expire.
  - The return route calls `getCheckoutStatus` and navigates with `returnTargetOf`. The billing page's confirm polling reads `?confirm=` in place of `?checkout=success` and `?credits=success`.

- [ ] **Step 1: Write the failing tests:**
  - **`checkout-state.test.ts`:**
    - `reads a plan or credits request and refuses junk`;
    - `a plan needs consent before paying`;
    - `credits need no consent`;
    - `a credits request keeps the amount from billing`;
    - `paying disables the button`;
    - `paid and processing return to billing to confirm`;
    - `an expired session returns to a fresh checkout`.
  - **`billing-checkout-guard.test.ts`,** reading the sources:
    - no `window.location.href` in `src/hooks/use-billing.ts`;
    - `billing-checkout.tsx` renders `subscriptionConsentText` through the server's `terms`, never builds it itself, and links `/terms`;
    - no `stripe.com` URL in `src/routes/settings` or `src/hooks`.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.** Follow the existing Settings page patterns: kumo components, `LayerCard`, `Button` and `Banner`.
- [ ] **Step 4: Verify** the tests pass, then `bun run typecheck` and `rtk proxy npx eslint src/routes/settings src/hooks src/lib/stripe`.
- [ ] **Step 5: Commit:** `feat(billing): estori's own checkout page for plans and extra credits`

### Task 10: Billing page: card on file, history, failed payments, card page

**Files:**
- Create:
  - `src/routes/settings/billing-card.tsx`: setup and pay modes;
  - `src/routes/settings/billing-card-return.tsx`;
  - `src/components/billing/PaymentMethodCard.tsx`;
  - `src/components/billing/BillingHistory.tsx`.
- Modify:
  - `src/routes/settings/billing.tsx`: remove "Manage billing", and add the two sections and the past-due actions;
  - `src/routes.tsx`;
  - `src/hooks/use-billing.ts`: credits navigate to `/settings/billing/checkout?credits=…`, and new hooks for card, pay-now and history.
- Test:
  - `src/routes/billing-page-guard.test.ts`, which exists; extend it;
  - `src/routes/settings/billing-view.test.ts`.

**Interfaces:**
- Consumes: Task 7's API client, Task 8's loader, and Task 1's types.
- Produces, following spec 4.3:
  - **Payment method:** "Visa ending 4242, expires 08/28" and "Change card", linking `/settings/billing/card`.
  - **Billing history:** at most 24 rows, newest first, each with date, description, amount and status, and a "Download" anchor to `apiClient.invoicePdfUrl(id)`.
    - The section has `id="history"`, for the email link.
    - It's empty with "No invoices yet."
  - **Past-due banner:**
    - "Pay now with {Brand} ending {last4}" calls `payOpenInvoice()`. A `requires_action` result runs `stripe.handleNextAction({ clientSecret })`.
    - "Update card and pay" links `/settings/billing/card?mode=pay`.
  - **Results:**
    - `paid` and `nothing_due` show "Your payment went through.";
    - `saved` shows "Your card is saved.";
    - `declined` shows its message;
    - each refetches the billing view.
  - **The card page** mounts the Payment Element on a setup session, with a "Save card" button, or "Save card and pay" in pay mode. Its return route calls `completeCardSetup` and shows the result, then returns to Billing.
  - Removed: `useBillingPortal` and every "Manage billing" string in `src`.

- [ ] **Step 1: Write the failing tests:**
  - **The guard:**
    - no "Manage billing" in `src`;
    - the billing page renders `PaymentMethodCard` and `BillingHistory`;
    - the past-due banner offers both "Pay now" and "Update card and pay".
  - **`billing-view.test.ts`:**
    - `formats the card on file`: "Visa ending 4242, expires 08/28";
    - `describes each payment result`, mapping `paid`, `saved`, `nothing_due` and `declined` to their messages.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** the tests, typecheck and eslint, as in Task 9.
- [ ] **Step 5: Commit:** `feat(billing): change card, pay a failed renewal and download invoices on the billing page`

### Task 11: Scenarios script, docs and copy

**Files:**
- Modify:
  - `scripts/stripe-billing-scenarios.ts`;
  - `docs/estori/launch-checklist.md`;
  - `scripts/stripe-billing-setup.ts`: drop the Terms URL step's message;
  - the privacy or Terms page, only if they name Stripe's portal (check with `rg -n "portal" src/content`).
- Test: `scripts/stripe-billing-scenarios.test.ts`, if it exists, or a small one for the confirm helper.

**Interfaces:**
- Consumes: Task 7's endpoints.
- Produces: the scenarios confirm Elements sessions server-side, with Stripe's test payment methods (`pm_card_visa`, `pm_card_threeDSecure2Required`, `pm_card_chargeDeclined`), so no browser is needed. Read Stripe's dahlia docs for confirming an `ui_mode: 'elements'` session from the server in test mode. If that's impossible, the script prints the checkout page URL and waits, as the old one did for hosted pages.
- The launch checklist:
  - says `STRIPE_PUBLISHABLE_KEY` must be set for both Workers;
  - says the Stripe Terms URL step is no longer needed for billing;
  - removes the Billing Portal configuration step.

- [ ] **Step 1: Write a failing test** for the script's confirm helper: its request body.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify the test passes.**
- [ ] **Step 5: Commit:** `chore(billing): scenarios and launch checklist for the native checkout`

### Task 12: Local end to end, CI, final review and pull request

Run by the controller. There are no new files; each fix gets its own failing test first.

- [ ] **Step 1: Set up.**
  - Restart the dev server on port 8100. `STRIPE_PUBLISHABLE_KEY` must be in `.dev.vars` (test mode). If it's missing, ask the owner; never read `.dev.vars`.
  - Keep the local Stripe listener running.
  - Sign in as the local creator, who is in `BILLING_USER_IDS`.
  - The creator's stale Stripe test customer must be relinked or cleared first, with the admin `stripe-customer` route.
- [ ] **Step 2: Walk the spec's section 7 list in the browser.**
  1. Pro with 4242.
  2. A 3-D Secure card (4000 0025 0000 3155).
  3. A decline (4000 0000 0000 0002), then a retry.
  4. A promotion code, created in Stripe test mode with a `once` 50% coupon: the consent and button read "$24.50 today, then $49 a month".
  5. 5,000 extra credits.
  6. Change card.
  7. With a test clock, fail a renewal (4000 0000 0000 0341), then "Update card and pay" with 4242.
  8. "Pay now" on a renewal that needs 3-D Secure.
  9. A PDF download.
  10. `billing-checkout-paused` set through `FEATURE_FLAG_OVERRIDES`: checkout refused, Change card works.

  Check every payment is recorded once in D1, and that no Stripe-hosted page or URL appears.
- [ ] **Step 3: CI.** Run `npx eslint .`, `bun run typecheck`, `bun run build`, `bun run bundle:check` and `bun run test`. If a shard fails with `EADDRNOTAVAIL`, re-run its files as two smaller shards.
- [ ] **Step 4: Final whole-branch review,** with this plan's Review Focus. Then one fix pass.
- [ ] **Step 5: Push `feat/billing-elements` and open the pull request into `feat/posthog`.** Don't merge. The description covers:
  - what changed;
  - the decisions table (spec section 9);
  - the owner steps: the publishable key, plus a test coupon if they want one;
  - the end-to-end results;
  - the test totals.
