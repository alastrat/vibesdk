# Billing, subscriptions and plan limits: design

- **Date:** 2026-10-19
- **Status:** written while the owner was away, at their request ("work autonomously on the billing and subscription
  system"). Every choice the owner didn't make is in section 15, "Decisions made on the owner's behalf", for review.
  Nothing is built until the owner approves this spec and its plan.
- **Related:**
  - pricing and plans: `docs/superpowers/specs/2026-10-15-pricing-and-contact-design.md`;
  - seller levels and limits: `docs/superpowers/specs/2026-10-16-seller-risk-safeguards-design.md`;
  - analytics and feature flags: `docs/superpowers/specs/2026-10-19-posthog-analytics-monitoring-flags-design.md`;
  - launch gaps: `docs/superpowers/specs/2026-10-19-launch-readiness-review.md`.

## 1. Purpose

**The gap today.** The pricing page sells three plans. The product knows none of them:
- Premium can't be bought: its button opens the contact form.
- There are no subscriptions, no Stripe customers and no monthly credits.
- The only AI limit is a free counter of 200 credits a day.
- Nothing marked "paid" on the pricing page is limited. For example, the supplier catalog works for everyone.

**What this adds:**
- **Premium you can buy:** Basic sellers can buy Premium by card, pick a credit tier, change tiers, update their card,
  see invoices and cancel, all from Estori.
- **Plan limits:** each plan's limits are defined once in shared code and enforced wherever they matter: credits, new
  stores, live stores, own domains, the supplier catalog and drafts. The pricing page reads the same definitions.
- **Clear messages:** sellers see clear messages when they reach a limit, with a way to upgrade.
- **Enterprise:** admins can put an account on Enterprise with custom limits and invoiced billing.
- **Estori's own emails:** subscription emails come from Estori, not Stripe (the owner's standing preference).
- **Tests:** a test suite and a written scenario list cover every billing path, including renewals and failed payments,
  using Stripe's test clocks.

**Success means:**
- a seller upgrades from the pricing page in under a minute;
- their limits change as soon as Stripe confirms;
- they never lose a live store because of billing;
- every money path has a test.

**Anti-goals:**
- **Never take a store offline over billing:** a downgrade or a failed card never takes a live store offline or stops
  its checkout. Shoppers are never punished for their seller's billing.
- **Never charge a card without Stripe's confirmation:** Estori's records follow Stripe and never the other way round.
- **Never a surprise charge:** no overage billing, and no automatic tier jumps.

## 2. What exists today

| Area | Today | Where |
| --- | --- | --- |
| Plans as marketed | Basic (free, daily allowance), Premium (four monthly tiers: 20k credits $99, 50k $199, 100k $349, 200k $599), Enterprise (contact sales); the comparison table marks paid rows | `src/lib/plans.ts`, `src/routes/pricing.tsx`, `src/components/pricing/*` |
| Premium button | links to `/contact` with the tier; "Paid plans are coming soon" | `PlanCards.tsx:103-106`; pinned by `src/routes/pricing-guard.test.ts:79` |
| AI credits | each AI step costs the model's `creditCost` (default model 8 a step; a build is about 30 steps, a change about 4) | `worker/agents/inferutils/config.types.ts`, `src/lib/credits.ts` |
| AI limit | 200 credits per UTC day, counted per user in a Durable Object. A second 200-a-day bucket (`…user:<id>apps`) exists for an old template proxy that no Think store uses; no store assistant exists yet | `worker/services/rate-limit/config.ts:103-112`, `rateLimits.ts:587-666`, `aigateway-proxy/controller.ts:251`, `DeploymentManager.ts:561-571` |
| When the limit applies | **In production and staging, it doesn't.** The check before a turn (`checkUsageAndBalance`) returns unlimited unless `ENABLE_CLOUDFLARE_LIMITS=true` and `CF_OAUTH_ENCRYPTION_KEY` are set; neither is set on either Worker (checked 2026-10-19). The Think agent counts each step but never stops. A seller with Cloudflare connected and a balance passes the check even when it's on, yet Think always runs on Estori's own gateway. The counter stops counting at the limit, so steps past it are never recorded | `usageChecker.ts:73-98`, `shared/constants/limits.ts:47-80`, `think.ts:291-298`, `DORateLimitStore.ts:83-91`, `ThinkAgent.ts:365` |
| New stores | 3 a day | `rate-limit/config.ts:96-102` |
| Overrides | KV `platform_configs` (global) and `user_config:<userId>` (per user), deep-merged; cached for an isolate's life | `worker/config/index.ts:95-184` |
| Plan gating | none: no plan, tier or Stripe customer on `users`; nothing reads a plan | `worker/database/schema.ts:46-103` |
| Stripe | fetch client, API `2026-03-25.dahlia`; Connect Express (sellers), Checkout for template purchases and store sales; webhook `POST /api/stripe/webhook` with platform and Connect secrets; no Billing code | `worker/services/payments/stripe-client.ts`, `worker/api/controllers/payments/webhook.ts` |
| Usage UI | limit dialogs ("Connect your Cloudflare account to continue"), a usage badge hidden when Cloudflare Connect is off, a credits banner, `GET /api/limits/plan` (live config; the pricing page shows it, pinned by a test) and `/api/limits/usage` | `src/utils/usage-limit-checker.tsx`, `src/components/usage-limits-badge.tsx:42`, `worker/services/rate-limit/public-plan.ts`, `src/routes/pricing-guard.test.ts` |
| Admin | no admin user page; the only per-user admin endpoint is `PUT /api/admin/sellers/:userId/limits` (seller levels), which writes KV `user_config` | `worker/api/routes/storeRoutes.ts:12` |
| Catalog | the AI's catalog tools only search and read; a product is added by writing a `catalogVariantId` into `estori-store.json` (by the AI, the Code tab or the `/catalog` page) | `worker/agents/think/catalog-tools.ts:16-24` |
| Terms | "Purchases are one-time payments"; nothing on subscriptions, renewal or cancelling | `src/content/legal/terms.md:51`, `src/content/legal/refunds.md` |
| Tests | real-D1 helpers (`migratedD1`, `envWith`, seed helpers), a Stripe client with injectable fetch, signed webhook tests | `worker/database/test-support/real-d1.ts`, `worker/api/controllers/payments/webhook*.test.ts` |

Store drafts (PR #25) limits drafts to 5 per store on every plan, and this spec keeps that.

## 3. Plans and limits

One table in shared code, `shared/types/plans.ts` (`PLAN_LIMITS`), defines every plan's limits. Basic's AI credits and new stores keep coming from the live configuration (code defaults plus the global KV overrides), as today, because the pricing page promises "the live limits, never typed in":
- the Worker enforces it;
- the pricing page renders it;
- admins override it per account.

`src/lib/plans.ts` keeps the marketing copy and reads its numbers from here.

| Limit | Basic (free) | Premium (by tier) | Enterprise |
| --- | --- | --- | --- |
| AI credits | 200 a day (UTC), as today | the tier's monthly pool: 20,000 / 50,000 / 100,000 / 200,000 | set per account (monthly pool) |
| Store AI credits (future store assistants) | not built; when it is, it shares the daily allowance | shares the monthly pool | shares the pool |
| New stores | 3 a day | 25 a day | set per account |
| Live stores (published, at once) | 1 | 10 | set per account |
| Own domains | 0 | 1 per live store | set per account |
| Supplier catalog (add catalog products, place catalog orders) | no | yes | yes |
| Drafts per store | 5 | 5 | 5 |
| Delivery checks on orders you ship | — (not built yet) | yes, once built | yes |
| Support | Email | Priority email | A named contact |
| Store payments, template selling, Discover | yes (seller levels set the money limits) | yes | yes |

Seller levels keep setting the money limits (largest order, weekly sales, payout delay) on every plan; plans don't touch
them.

**Coming soon:** rows the pricing page tags as coming soon (store assistants, personalized shopping, AI
recommendations, digital products) aren't limits yet. When one ships, it adds a key to `PLAN_LIMITS`.

**The shape of a plan:** `{ plan: 'basic' | 'premium' | 'enterprise', tier: 1 | 2 | 3 | 4 | null }`. The
account's limits are worked out in this order, later steps winning:
1. the plan's row in `PLAN_LIMITS` (for Basic, credits and new stores from the live global configuration);
2. the tier's credit pool;
3. the existing per-user KV overrides (`user_config:<userId>` rate limits), so today's overrides keep working (the
   owner's account is raised to 1000 new stores a day this way);
4. an admin plan override (section 9).

A pure function, `limitsFor(account)`, does this, and every check calls it.

## 4. Subscriptions with Stripe Billing

**Products and prices.**
- One Stripe product, "Estori Premium", with four monthly prices, one per tier.
- Each price carries `metadata.estori_tier = 1..4`.
- A script, `scripts/stripe-billing-setup.ts`, creates them in test mode and prints their IDs. The IDs go in the
  `STRIPE_PREMIUM_PRICE_IDS` variable (JSON, tier to price ID) for each environment.
- Live-mode prices are created on launch day by the owner, with the same script.

**Customers.**
- One Stripe customer per Estori account, on the platform account (not Connect).
- It's created when a seller first starts checkout, and stored in a D1 table, `billing_customers` (`user_id`,
  `stripe_customer_id`).
- The customer's email is the account's email, and its metadata carries `estori_user_id`.

**Buying Premium.**
1. **The button:** on `/pricing`, or on a limit message, "Get Premium" with a tier.
   - Signed out, it goes to sign-up and then comes back.
   - Signed in, it calls `POST /api/billing/checkout` with `{ tier }`.
2. **The checkout:** the server creates a Stripe Checkout Session with:
   - `mode: 'subscription'` and the tier's price;
   - the customer;
   - `client_reference_id = userId`;
   - `allow_promotion_codes: true`;
   - success and cancel URLs back to `/settings/billing`.
   The server answers with the session URL.
3. **After payment:** Stripe sends the seller back. `/settings/billing` shows "Confirming your payment…" until the
   webhook has recorded the subscription.
   - It polls `GET /api/billing` every 2 seconds for up to 30 seconds.
   - After that it shows "Your payment is being confirmed. Refresh in a minute."
4. **Already paying:** a seller with an active subscription can't start a second checkout; the server answers 409 and
   the page shows the billing page.

**Changing tiers.**
- `/settings/billing` lists the four tiers.
- Choosing another calls `POST /api/billing/change-tier`, which updates the subscription's price on Stripe:
  - **Upgrades:** prorated and charged right away (`proration_behavior: 'always_invoice'`). The new pool applies as
    soon as Stripe confirms.
  - **Downgrades:** take effect at the next renewal, with no refund for the rest of the period, through a Stripe
    subscription schedule. Until then the bigger pool stays.
- **One change at a time:** a pending downgrade shows on the page and can be cancelled. A tier change is refused while
  a payment is failing.

**Card, invoices and cancelling.**
- **Manage billing** opens Stripe's customer portal (`POST /api/billing/portal`), configured to allow:
  - updating the card and seeing invoices;
  - cancelling at the period's end.
- Tier changes happen on Estori's page, not in the portal, so the portal's "switch plan" is off.
- **Cancel** (on Estori's page, or in the portal) cancels at the period's end. The page then shows "Premium until
  <date>" with **Keep Premium**, which undoes the cancel.

**Webhooks** are handled by the existing `POST /api/stripe/webhook`, platform events only:
- `checkout.session.completed` with `mode=subscription`;
- `customer.subscription.created`, `.updated`, `.deleted`;
- `invoice.paid`, `invoice.payment_failed`;
- `subscription_schedule.created`, `.updated`, `.released`, `.canceled`, so a scheduled downgrade shows and clears;
- `customer.subscription.trial_will_end` is ignored, since there are no trials.

Each event is recorded once in `billing_events` (`stripe_event_id` primary key) before it's applied, so a retry is a
no-op. The subscription row is rebuilt from the subscription as Stripe's API returns it at that moment, never from
the copy inside the event and never patched field by field. Events arriving out of order then converge on Stripe's
latest state, and invoice events, which don't carry the subscription, work the same way.

**The subscription record.** D1 table `subscriptions`, one row per account:
- `user_id`, `stripe_subscription_id`, `status`, `tier`;
- `current_period_start`, `current_period_end`;
- `cancel_at_period_end`, `pending_tier`, `pending_tier_at`;
- `updated_at`.

The account's plan is worked out from it:
- `active` and `trialing` mean Premium at `tier`;
- `past_due` means Premium for the grace period (section 7);
- `unpaid`, `canceled`, `incomplete`, `incomplete_expired` or no row means Basic.

Admin plan overrides (section 9) beat it.

**Repair job.** The daily cron re-reads, from Stripe, every subscription that's been `past_due` for over a day or that
has `cancel_at_period_end` set and has passed its period end. It rebuilds those rows, in case a webhook was missed.

## 5. Credits

**Counting.** The Durable Object counter stays the meter. Credits are counted per step, exactly as today.

**Bucket per plan.** What changes is the bucket and its limit:
- **Basic:** today's two daily buckets, 200 each.
- **Premium and Enterprise:** one bucket per billing period, keyed `plan:credits:user:<id>:<periodStart>`, with the
  pool as its limit. The builder and the store assistant draw on it together.

**Resets.**
- **Renewal:** the period start comes from the subscription row, so a renewal starts a fresh bucket automatically.
- **Mid-period upgrade:** keeps the same bucket with the larger limit, so used credits carry over.
- **Admin grants:** they add credits to the current bucket, through a one-off grant row added to the limit.

**Turning the check on.** A new plan check, `assertWithinLimit(account, 'aiCredits')`, runs before every turn and
every new store, on every environment, whatever `ENABLE_CLOUDFLARE_LIMITS` says. It ignores Cloudflare Connect and
own keys: Think always runs on Estori's gateway, so Estori pays either way. The old balance check stays only for the
older non-Think paths that really use the seller's Cloudflare account. The limit dialogs stop saying "Connect your
Cloudflare account" and offer Premium instead, and the usage badge shows for everyone. This is a new restriction in
production, where no limit applies today, so it turns on with the `billing` flag after notice (section 11).

**When credits run out.** A turn that has started always finishes, even if it goes over. The counter stops counting at
the limit, so those last steps are free and unrecorded.
- After that, new turns are refused with a message:
  - **Basic:** "You've used today's free AI credits. They reset at midnight UTC, or get Premium for a monthly pool."
  - **Premium:** "You've used this month's credits. Move to a bigger pool now, or wait until <renewal date>."

**Warnings.** At 80% and at 100% of a monthly pool:
- the seller gets an in-app banner and an email from Estori;
- each is sent once per period and recorded in `billing_notices`.

**Usage page.** `/settings/billing` shows the credits used this period (or today, for Basic), the pool, and the
renewal or reset time. `GET /api/limits/usage` returns the same numbers, so the existing badge follows.

## 6. Where limits are enforced

| Limit | Enforced at | Message |
| --- | --- | --- |
| AI credits | `ensureCanPrompt` and the agent controller before a turn, with the limit from `limitsFor`, independent of `ENABLE_CLOUDFLARE_LIMITS` and Cloudflare Connect | section 5 |
| New stores | the agent controller's creation check, limit from `limitsFor` | "You've started N new stores today…" with upgrade |
| Live stores | the live-store publish controller, when publishing a store that isn't live yet; republishing a live store is always allowed | "Basic includes 1 live store. Get Premium for up to 10." |
| Own domains | the add-domain endpoint | "Own domains come with Premium." |
| Supplier catalog | **at publish (Go live):** a store on an account without the catalog may be published only if every catalog product in it (each `catalogVariantId` in its `estori-store.json`) is already in its live version; new catalog products are refused. Shopper checkout never refuses. The AI's catalog search tells a Basic seller, in plain words, that adding catalog products needs Premium. | "Adding catalog products to your store comes with Premium. Products already live keep selling." |
| Drafts | unchanged (5 per store, every plan) | unchanged |

**Rules for every check:**
- It goes through one helper, `assertWithinLimit(account, limitKey, currentCount?)`, which returns a typed refusal the
  controllers turn into a 402 with `{ code: 'plan_limit', limit, plan, upgradeTo }`.
- The frontend shows one shared "Upgrade" dialog for every `plan_limit` refusal, so the copy lives in one place.
- The AI's tools turn the same refusal into a plain sentence for the seller.

## 7. Downgrades, cancellations and failed payments

**Nothing live breaks.** When an account drops to Basic, or to a smaller tier:
- **Live stores and their own domains stay up.** If the account has more than its plan's live stores, all of them keep
  serving and taking orders, but it can't publish a store that isn't live yet until it's within the limit. The same
  goes for own domains: they keep working, and no new ones can be added.
- **Catalog products already in a store keep selling:** catalog orders keep being placed and fulfilled. The account
  can't publish a version with new catalog products (section 6); the comparison is with the store's live version, so
  no snapshot table is needed.
- **Credits:** Basic's daily allowance applies from the moment the plan ends.

**Failed renewals.**
- Stripe retries the card (Smart Retries, as configured in the dashboard).
- During `past_due`, Premium continues for 7 days. The seller gets an email from Estori with a link to update the card,
  and a banner on every page.
- After 7 days without payment the account is treated as Basic, even while Stripe keeps retrying. A successful payment
  restores Premium immediately.
- When Stripe gives up, the subscription is cancelled and the seller is told.

**Cancelling** keeps Premium until the period ends, then Basic, with an email the day it ends.

## 8. Emails from Estori

Every subscription email comes from Estori, through the existing email service and templates, with the "[Staging]"
prefix and allowlist on staging. The emails:
- Premium started (tier, pool, next renewal);
- receipt for each payment (amount, period, a link to the invoice PDF from Stripe's hosted invoice URL);
- tier changed (upgrade charged now, or a downgrade scheduled);
- payment failed (update-card link, grace period end);
- Premium ending (after a cancel, on the last day) and Premium ended;
- credits at 80% and 100%.

**Owner step:** turn off Stripe's own customer emails for subscriptions and invoices (Settings → Customer emails:
"Successful payments" is already off; also turn off invoice emails and failed-payment emails). Estori's emails replace
them.

## 9. Admin

- **Endpoints only at launch:** there is no admin user page today, and this build doesn't add one.
  `GET /api/admin/users/:id/billing` returns plan, tier, Stripe status, period, credits used and links to the Stripe
  customer and subscription. An admin page can come later.
- **Plan override:** `PUT /api/admin/users/:id/plan` with `{ plan, tier?, limits?, until? }`. It records a row in
  `plan_overrides` with the admin and a reason. It's used for:
  - Enterprise accounts, with custom limits and invoiced outside the self-serve flow;
  - comps, such as a free month for a partner;
  - fixing a wrong state.
- **Credit grants:** `POST /api/admin/users/:id/credits` adds credits to the current period. They're recorded in
  `credit_grants` and shown on the seller's usage page as "Added by Estori".
- **Admin-only:** both endpoints use the existing admin check (`isPlatformAdmin`) and write an audit log entry.

## 10. Security and correctness

- **Webhooks:** the existing signature check comes first, as today. The subscription's `metadata.estori_user_id`, set
  at checkout, must match `client_reference_id` and the stored customer; a mismatch is logged as an alert and not
  applied.
- **Idempotency:** events go through `billing_events`, and calls to Stripe use idempotency keys tied to the
  account and action, like the existing client.
- **Prices:** the price comes only from the server's tier table, never from the browser.
- **Writes:** every D1 write of a billing state happens inside the event handler's transaction (`db.batch`), with the
  event recorded in the same batch.
- **Tax:** Stripe Tax is off at launch (section 15, decision 9). Invoices show no tax.
- **Live and test keys:** the existing `STRIPE_SECRET_KEY` decides the mode. The billing price IDs must belong to the
  same mode, and the setup script checks that.

## 10a. Terms, refunds and the checkout agreement

- **Terms** (`src/content/legal/terms.md`): add Premium subscriptions, monthly automatic renewal until cancelled, how to
  cancel (any time, effective at the period's end), no refunds for part of a period or a downgrade, credits that don't
  carry over between periods and have no cash value, and price changes with 30 days' notice. Replace "Purchases are
  one-time payments" with wording that covers both template purchases and subscriptions.
- **Refund policy** (`refunds.md`): Premium payments are refundable only when charged twice or when the account
  couldn't use Estori, requested within 14 days, as for other purchases.
- **Version:** `TERMS_VERSION` goes up, so every signed-in user accepts again through the existing `TermsGate`.
- **At checkout:** the Checkout Session requires agreement to the terms (`consent_collection.terms_of_service:
  'required'`) and shows the automatic-renewal disclosure as custom text above the pay button: "Premium renews every
  month at <price> until you cancel. Cancel any time in Estori; it ends at the end of the period."
- **Owner step:** a lawyer reviews the new wording (automatic-renewal laws differ by state).

## 11. Rollout

- **Behind a flag:** billing ships behind the `billing` flag. Billing ships before PostHog, so at first the flag is two
  environment variables: `BILLING=on` turns it on for everyone; `BILLING_USER_IDS` (comma-separated) turns it on only
  for those accounts while `BILLING` is off.
- **When PostHog lands:** the PostHog `billing` flag is added on top, never instead. An account has billing when
  `BILLING=on`, or its id is in `BILLING_USER_IDS`, or PostHog says so. Merging or misconfiguring PostHog can then
  never switch billing off for a paying seller. The environment variables are removed only in a later change, once
  PostHog's flag is at 100%.
- **Analytics:** the PostHog spec's catalog names five billing events. Billing ships first, so the PostHog change
  adds them at billing's own points:
  - `subscription_started` (`tier`), from the checkout-completed webhook;
  - `subscription_changed` (`from_tier`, `to_tier`, `direction`: `up` or `down`), from the subscription-updated
    webhook;
  - `subscription_cancelled` (`tier`, `reason`: `seller`, `payment_failed` or `admin`), when Premium ends;
  - `subscription_payment_failed` (`tier`, `attempt`), from the invoice-failed webhook;
  - `credits_limit_reached` (`plan`, `tier`, `threshold`: `80` or `100`), alongside the credit notices.
  It also sets the `plan` and `tier` person properties from the account's plan. Webhook retries don't double
  count, because the events are sent only after `billing_events` records the Stripe event the first time.
- **Flag off:** the pricing page keeps today's "coming soon" behaviour, `/settings/billing` isn't linked, and no limit
  beyond today's is enforced (`limitsFor` returns today's Basic for everyone).
- **Order:**
  1. Staging in Stripe test mode.
  2. Production in test mode, for the owner's own account only, by targeting the flag to their user ID.
  3. Production live mode on launch day.
- **When limits tighten:** turning the flag on starts enforcing Basic's live-store and catalog limits for existing
  accounts. Existing live stores keep working under section 7's rule.
  - **Every seller** gets an email from Estori a week before enforcement starts, because AI credits aren't limited in
    production today: the daily allowance, what Premium adds, and that their stores stay live.
  - Accounts that already have more than one live store, or catalog products, get a line about those: "Your stores
    stay live; to publish more, get Premium."
  - Founding sellers can be comped with a plan override.

## 12. Testing

**Unit tests:**
- `limitsFor` for every plan, tier, override and expiry;
- `assertWithinLimit` at, below and above each limit;
- the webhook-to-row mapping for every subscription status and event order;
- the grace-period clock;
- credit bucket keys across renewals and upgrades.

**Real-D1 tests** (signed webhook payloads, a fake Stripe fetch):
- checkout completed, then a subscription created;
- a duplicate event;
- out-of-order events (updated before created);
- an upgrade invoice;
- a scheduled downgrade reaching its date;
- a payment failure, the grace period and recovery;
- cancel and resume;
- deletion;
- a metadata mismatch is refused;
- the repair job.

**Enforcement tests:** each limit in section 6 refuses with `plan_limit` and allows within the limit, and
republishing a live store is never refused.

**Stripe test clocks:** `scripts/stripe-billing-scenarios.ts` drives real Stripe test mode end to end against a
deployed staging environment, using test clocks to move time:
1. subscribe with 4242 4242 4242 4242;
2. renew a month later;
3. upgrade tier 1 to 3 mid-period;
4. downgrade 3 to 2 at renewal;
5. a failed renewal with 4000 0000 0000 0341 (it attaches, then the charge fails), the grace period ending after
   7 days, then updating to a good card;
6. a 3-D Secure card, 4000 0025 0000 3155, at checkout;
7. cancel at the period's end;
8. resume before the end;
9. an expired checkout session.

After each step it reads Estori's `GET /api/billing` and asserts the plan, tier and credits.

**By eye, on staging,** with a test-mode card, the same journeys through the pages, plus:
- the limit dialogs, the upgrade from a limit message and the banners;
- each Estori email, with its "[Staging]" prefix.

**Written checklist:** `docs/estori/billing-test-scenarios.md` lists every scenario with its expected result, so
anyone can rerun it before a release.

## 13. Out of scope

- **Annual billing** and discounts (the pricing spec rules them out for now).
- **Trials:** Basic is the free way to try Estori.
- **Seats and team members.**
- **Usage-based overage billing:** sellers move up a tier instead.
- **Self-serve Enterprise:** admins set it up.
- **An admin billing page:** endpoints only at launch.
- **Taxes:** an owner decision, and needs registrations.
- **Blocking buyers outside the US:** nothing blocks them at checkout; the Terms limit the service to the US, and
  sales tax and VAT stay an owner decision (section 15, decision 9).
- **Building the coming-soon features:** only their limit keys are reserved.

## 14. Owner steps

1. **Run the setup script** in test mode for staging (this can be done for you) and, on launch day, in live mode;
   then set `STRIPE_PREMIUM_PRICE_IDS` per environment.
2. **Configure Stripe's customer portal** (card updates, invoices, cancel at period end; no plan switching) in each
   mode.
3. **Turn on Smart Retries** with a retry schedule of up to 2 weeks.
4. **Turn off Stripe's customer emails** for invoices and failed payments.
5. **Add the subscription events** to the platform webhook endpoint in each environment:
   `checkout.session.completed` (already there), `customer.subscription.created`, `.updated`, `.deleted`,
   `invoice.paid`, `invoice.payment_failed`, and `subscription_schedule.created`, `.updated`, `.released` and
   `.canceled`.
6. **Decide on sales tax** for Premium (Stripe Tax needs registrations in the states where Estori owes tax).
7. **Approve the limits table** (section 3) and the enforcement email to existing sellers (section 11).

## 15. Decisions made on the owner's behalf

| # | Decision | Why | If wrong |
| --- | --- | --- | --- |
| 1 | Premium's tiers and prices are the pricing page's (20k/$99 … 200k/$599), billed monthly | already published on the pricing page | change the four prices and `PLAN_LIMITS`; existing subscribers keep their price until moved |
| 2 | Limits: Basic 3 new stores a day, 1 live store, no own domains, no supplier catalog; Premium 25 a day, 10 live stores, 1 domain per live store, catalog on | the pricing page marks the catalog paid; the checkout spec suggested one live store on the free plan; generous Premium numbers avoid support load | every number lives in `PLAN_LIMITS`; admins can override any account |
| 3 | Basic keeps 200 credits a day (two buckets); Premium has one monthly pool for builder and store AI | the calculator already counts store AI in the monthly need; Basic's behaviour doesn't change for anyone | merge or split buckets in `limitsFor` |
| 4 | A turn that started always finishes, even over the limit; the next one is refused | stopping mid-build leaves a half-written store; this is today's behaviour | add a hard stop at, say, 110% of the pool |
| 5 | Upgrades are prorated and charged now; downgrades wait for renewal with no refund | the seller gets what they paid for, and nobody is surprised by a refund or a charge | switch the proration settings |
| 6 | Tier changes happen on Estori's page; the Stripe portal only handles cards, invoices and cancelling | one place for plan logic and messages, and Estori's own emails | turn on plan switching in the portal |
| 7 | 7-day grace on failed renewals, then Basic while Stripe keeps retrying | sellers fix cards without losing a week's work; Estori isn't out of pocket for long | change the grace constant |
| 8 | Nothing live ever breaks on a downgrade or failed card: stores, domains and existing catalog products keep working; only new ones are refused | shoppers shouldn't pay for a seller's billing, and broken stores create support and chargebacks | enforce harder after a longer grace |
| 9 | No sales tax on Premium at launch (Stripe Tax off) | tax is an open owner decision and needs registrations | turn on `automatic_tax` once registered; prices then show tax |
| 10 | No trials, no annual billing, no overage, promotion codes allowed at checkout | Basic is the free trial; the pricing spec ruled out annual; codes let the owner run launch offers without code | enable trials in the checkout session, or disallow codes |
| 11 | Estori sends every subscription email; Stripe's are turned off | the owner's standing rule that communications come from Estori | turn Stripe's emails back on |
| 12 | Billing ships behind a `billing` flag; existing sellers over a new limit get a week's notice, and nothing live is taken down | a tighter limit on existing accounts is a change they should hear about first | send no notice, or comp founding sellers with overrides |
| 13 | Enterprise is admin-set (plan override with custom limits, invoiced outside the app) | no self-serve Enterprise flow is wanted at launch | build an Enterprise checkout later |
| 14 | A daily repair job re-reads suspicious subscriptions from Stripe | a missed webhook would otherwise leave an account on the wrong plan | rely on webhooks only |
| 15 | **Check first:** AI credits are enforced for everyone when billing turns on, independent of `ENABLE_CLOUDFLARE_LIMITS` and of Cloudflare Connect or own keys | production applies no AI limit today (the flag and key are unset), and Think always spends Estori's credits; Premium means nothing without a limit | keep Connect as a way past the limit, or start with a higher Basic allowance |
| 16 | **Check first:** Terms gain subscription and automatic-renewal wording, `TERMS_VERSION` goes up (everyone accepts again), and checkout requires agreement with a renewal disclosure | US automatic-renewal laws want clear disclosure and consent; today's Terms say purchases are one-time | skip the re-acceptance and rely on the checkout consent only |
| 17 | The catalog limit is checked at publish against the store's live version; shopper checkout never refuses | the AI tools only read, and products are added by editing the store file; refusing at checkout would punish shoppers | add a snapshot table of allowed products per store |
| 18 | Basic's credits and new stores stay in the live configuration; existing per-user KV overrides keep working; admin plan overrides win over both | the pricing page promises live numbers, and the owner's own override must keep working | move all overrides into `plan_overrides` |
| 19 | Admin billing is endpoints only at launch | no admin user page exists; endpoints match the seller-limits pattern | build an admin billing page |
| 20 | Until PostHog flags exist, `BILLING_USER_IDS` targets the owner-only phase | an environment variable can't target one user otherwise | wait for PostHog flags |
| 21 | Nothing blocks non-US buyers at checkout | Stripe Checkout can't limit card countries without extra signals; the Terms limit the service to the US | require a US billing address and refund others |
| 22 | Billing ships before PostHog; afterwards the PostHog `billing` flag is OR'd with `BILLING` and `BILLING_USER_IDS` | billing is the launch blocker; a flag service outage or a mistaken flag must never take Premium away from paying sellers | ship PostHog first and use only its flag |
| 23 | The five billing analytics events are added by the PostHog change, at billing's webhook and notice points, after `billing_events` dedupes | billing ships first, before any analytics client exists | add a no-op analytics hook in billing now |
