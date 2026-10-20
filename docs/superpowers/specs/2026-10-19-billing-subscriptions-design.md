# Billing, subscriptions and plan limits: design

- **Date:** 2026-10-19
- **Status:** written while the owner was away, at their request ("work autonomously on the billing and subscription
  system"). **The owner approved it with corrections on 2026-10-19.** Section 15 records every decision and who made
  it: the owner, the coordinator, or the planner on the owner's behalf.
- **Related:**
  - pricing and plans: `docs/superpowers/specs/2026-10-15-pricing-and-contact-design.md`;
  - seller levels and limits: `docs/superpowers/specs/2026-10-16-seller-risk-safeguards-design.md`;
  - analytics and feature flags: `docs/superpowers/specs/2026-10-19-posthog-analytics-monitoring-flags-design.md`;
  - launch gaps: `docs/superpowers/specs/2026-10-19-launch-readiness-review.md`.

## 1. Purpose

**The gap today.** The pricing page sells three plans. The product knows none of them:
- Premium can't be bought: its button opens the contact form.
- There are no subscriptions, no Stripe customers and no monthly credits.
- The only AI limit is a free counter of 200 credits a day, and a credit is a flat charge per AI step whatever the
  step really costs.
- Nothing marked "paid" on the pricing page is limited. For example, the supplier catalog works for everyone.

**What this adds:**
- **Plans you can buy:** Basic sellers can buy Pro or Premium by card, move between them, update their card, see
  invoices and cancel, all from Estori.
- **Credits that follow real AI cost:** each AI step is charged from the tokens it really used, at the model's list
  price plus a margin.
- **Extra credits:** Premium sellers can buy more credits when the month's pool runs out.
- **Plan limits:** each plan's limits are defined once in shared code and enforced wherever they matter: credits, stores,
  live stores, own domains, the supplier catalog and drafts. The pricing page reads the same definitions.
- **Clear messages:** sellers see clear messages when they reach a limit, with a way to upgrade.
- **Enterprise:** admins can put an account on Enterprise with custom limits and invoiced billing.
- **Estori's own emails:** subscription and credit emails come from Estori, not Stripe (the owner's standing preference).
- **Tests:** a test suite and a written scenario list cover every billing path, including renewals, failed payments and
  extra credits, using Stripe's test clocks.

**Success means:**
- a seller upgrades from the pricing page in under a minute;
- their limits change as soon as Stripe confirms;
- they never lose a live store because of billing;
- every money path has a test, and the credit balance is exact.

**Anti-goals:**
- **Never take a store offline over billing:** a downgrade or a failed card never takes a live store offline or stops
  its checkout. Shoppers are never punished for their seller's billing.
- **Never charge a card without Stripe's confirmation:** Estori's records follow Stripe and never the other way round.
- **Never a surprise charge:** no usage billed after the fact. Extra credits are bought upfront, and plans never change
  by themselves.

## 2. What exists today

| Area | Today | Where |
| --- | --- | --- |
| Plans as marketed | Basic (free, daily allowance), Premium (four monthly tiers: 20k credits $99, 50k $199, 100k $349, 200k $599), Enterprise (contact sales); the comparison table marks paid rows | `src/lib/plans.ts`, `src/routes/pricing.tsx`, `src/components/pricing/*` |
| Premium button | links to `/contact` with the tier; "Paid plans are coming soon" | `PlanCards.tsx:103-106`; pinned by `src/routes/pricing-guard.test.ts:79` |
| AI credits | each AI step costs the model's flat `creditCost` (Gemini Flash 3, Sonnet 8, Opus 16 a step), whatever tokens it used | `worker/agents/think/model-config.ts`, `worker/agents/inferutils/config.types.ts`, `src/lib/credits.ts` |
| AI limit | 200 credits per UTC day, counted per user in a Durable Object. A second 200-a-day bucket (`…user:<id>apps`) exists for an old template proxy that no Think store uses; no store assistant exists yet | `worker/services/rate-limit/config.ts:103-112`, `rateLimits.ts:587-666`, `aigateway-proxy/controller.ts:251` |
| When the limit applies | **In production and staging, it doesn't.** The check before a turn (`checkUsageAndBalance`) returns unlimited unless `ENABLE_CLOUDFLARE_LIMITS=true` and `CF_OAUTH_ENCRYPTION_KEY` are set; neither is set on either Worker (checked 2026-10-19). The Think agent counts each step but never stops | `usageChecker.ts:73-98`, `ThinkAgent.ts:365` |
| Step usage | the Think agent's steps report their token usage (input, cache reads and writes, output with reasoning) through the AI SDK's `onStepFinish`; nothing reads it. The older `infer` paths stream without usage | `@cloudflare/think` `StepContext.usage`, `worker/agents/inferutils/core.ts:735` |
| New stores | 3 a day; apps are deleted outright, so nothing counts stores an account ever made | `rate-limit/config.ts:96-102`, `AppService.deleteApp` |
| Overrides | KV `platform_configs` (global) and `user_config:<userId>` (per user), deep-merged; cached for an isolate's life | `worker/config/index.ts:95-184` |
| Plan gating | none: no plan or Stripe customer on `users`; nothing reads a plan | `worker/database/schema.ts:46-103` |
| Stripe | fetch client, API `2026-03-25.dahlia`; Connect Express (sellers), Checkout for template purchases and store sales; webhook `POST /api/stripe/webhook` with platform and Connect secrets; no Billing code | `worker/services/payments/stripe-client.ts`, `worker/api/controllers/payments/webhook.ts` |
| Usage UI | limit dialogs ("Connect your Cloudflare account to continue"), a usage badge hidden when Cloudflare Connect is off, a credits banner, `GET /api/limits/plan` and `/api/limits/usage`; the calculator, the credits explainer and the model picker show each model's flat credits per step | `src/utils/usage-limit-checker.tsx`, `src/components/usage-limits-badge.tsx:42`, `src/components/pricing/*`, `src/utils/credit-change.ts` |
| Admin | no admin user page; the only per-user admin endpoint is `PUT /api/admin/sellers/:userId/limits` (seller levels), which writes KV `user_config` | `worker/api/routes/storeRoutes.ts:12` |
| Catalog | the AI's catalog tools only search and read; a product is added by writing a `catalogVariantId` into `estori-store.json` (by the AI, the Code tab or the `/catalog` page) | `worker/agents/think/catalog-tools.ts:16-24` |
| Terms | "Purchases are one-time payments"; nothing on subscriptions, renewal, cancelling or credits | `src/content/legal/terms.md:51`, `src/content/legal/refunds.md` |
| Tests | real-D1 helpers (`migratedD1`, `envWith`, seed helpers), a Stripe client with injectable fetch, signed webhook tests | `worker/database/test-support/real-d1.ts`, `worker/api/controllers/payments/webhook*.test.ts` |

Store drafts (PR #25) limits drafts to 5 per store on every plan, and this spec keeps that.

## 3. Plans and limits

One table in shared code, `shared/types/plans.ts` (`PLAN_LIMITS`), defines every plan's limits and prices:
- the Worker enforces it;
- the pricing page renders it;
- admins override it per account.

`src/lib/plans.ts` keeps the marketing copy and reads its numbers from here.

| Limit | Basic (free) | Pro, $49 a month | Premium, $199 a month | Enterprise |
| --- | --- | --- | --- | --- |
| AI credits | 5,000 a month | 20,000 a month | 100,000 a month | per account |
| Extra credits | no | no | yes: $1.50 per 1,000, any amount from 5,000 in steps of 1,000 | admin grants |
| Stores | 3 in the account's lifetime; deleting one doesn't free its place. Accounts already over 3 keep theirs but can't start more | 10 new a day | 25 new a day | per account |
| Live stores (published, at once) | 1 | 3 | 10 | per account |
| Own domains | 0 | 1 per live store | 1 per live store | per account |
| Supplier catalog (add catalog products, place catalog orders) | no | yes | yes | yes |
| Drafts per store | 5 | 5 | 5 | 5 |
| Store AI credits (future store assistants) | share the month's credits | share the month's credits | share the month's credits | share the month's credits |
| Delivery checks on orders you ship | — (not built yet) | yes, once built | yes, once built | yes |
| Support | Email | Email | Priority email | A named contact |
| Store payments, template selling, Discover | yes (seller levels set the money limits) | yes | yes | yes |

Seller levels keep setting the money limits (largest order, weekly sales, payout delay) on every plan; plans don't touch
them.

**Enterprise** without custom limits starts at Premium's numbers.

**Coming soon:** rows the pricing page tags as coming soon (store assistants, personalized shopping, AI
recommendations, digital products) aren't limits yet. When one ships, it adds a key to `PLAN_LIMITS`.

**The shape of a plan:** `plan: 'basic' | 'pro' | 'premium' | 'enterprise'`. There are no tiers. The account's limits
are worked out in this order, later steps winning:
1. the plan's row in `PLAN_LIMITS`;
2. an admin plan override (section 9);
3. admin credit grants, added to the month's credits.

The per-user KV rate-limit overrides (`user_config:<userId>`) keep working only while billing is off: they count daily
credits and daily stores, which no longer match the plans' units. With billing on, an admin plan override is the way to
change one account. Before billing turns on, the owner's own account goes on an Enterprise override (section 14).

A pure function, `limitsFor(account)`, does this, and every check calls it.

## 4. Subscriptions with Stripe Billing

**Products and prices.**
- Three Stripe products: "Estori Pro" and "Estori Premium", each with one monthly price, and "Estori AI credits",
  with a one-time price of $1.50 for 1,000 credits.
- Each price carries `metadata.estori_plan` (`pro` or `premium`) or `metadata.estori_kind = credits`.
- A script, `scripts/stripe-billing-setup.ts`, creates them and prints their IDs. The IDs go in the `STRIPE_PRICE_IDS`
  variable (JSON `{ pro, premium, credits }`) for each environment.
- Live-mode prices are created on launch day by the owner, with the same script.

**Customers.**
- One Stripe customer per Estori account, on the platform account (not Connect).
- It's created when a seller first starts a checkout, and stored in a D1 table, `billing_customers` (`user_id`,
  `stripe_customer_id`).
- The customer's email is the account's email, and its metadata carries `estori_user_id`.

**Buying Pro or Premium.**
1. **The button:** on `/pricing`, or on a limit message, "Get Pro" or "Get Premium".
   - Signed out, it goes to sign-up and then comes back.
   - Signed in, it calls `POST /api/billing/checkout` with `{ plan }`.
2. **The checkout:** the server creates a Stripe Checkout Session with:
   - `mode: 'subscription'` and the plan's price;
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

**Moving between Pro and Premium.**
- `/settings/billing` shows Pro and Premium side by side.
- Choosing the other one calls `POST /api/billing/change-plan`:
  - **Pro to Premium:** right away, prorated and charged now (`proration_behavior: 'always_invoice'`,
    `payment_behavior: 'error_if_incomplete'`, so a declined card changes nothing). The bigger pool applies as soon as
    Stripe confirms, and the credits already used this period count against it.
  - **Premium to Pro:** at the next renewal, with no refund for the rest of the period, through a Stripe subscription
    schedule. Until then Premium stays.
- **One change at a time:** a pending move to Pro shows on the page and can be cancelled by choosing Premium again. A
  change is refused while a payment is failing.

**Card, invoices and cancelling.**
- **Manage billing** opens Stripe's customer portal (`POST /api/billing/portal`), configured to allow:
  - updating the card and seeing invoices;
  - cancelling at the period's end.
- Plan changes happen on Estori's page, not in the portal, so the portal's "switch plan" is off.
- **Cancel** (on Estori's page, or in the portal) cancels at the period's end. The page then shows "Premium until
  <date>" (or Pro) with **Keep Premium**, which undoes the cancel.

**Webhooks** are handled by the existing `POST /api/stripe/webhook`, platform events only:
- `checkout.session.completed`: `mode=subscription` for plans, and `metadata.kind=credits` for extra credits;
- `customer.subscription.created`, `.updated`, `.deleted`;
- `invoice.paid`, `invoice.payment_failed`;
- `subscription_schedule.created`, `.updated`, `.released`, `.canceled`, so a scheduled move to Pro shows and clears;
- `charge.refunded`, for refunded extra credits;
- `customer.subscription.trial_will_end` is ignored, since there are no trials.

Each event is recorded once in `billing_events` (`stripe_event_id` primary key) before it's applied, so a retry is a
no-op. The subscription row is rebuilt from the subscription as Stripe's API returns it at that moment, never from
the copy inside the event and never patched field by field. Events arriving out of order then converge on Stripe's
latest state, and invoice events, which don't carry the subscription, work the same way.

**The subscription record.** D1 table `subscriptions`, one row per account:
- `user_id`, `stripe_subscription_id`, `status`, `plan` (`pro` or `premium`);
- `current_period_start`, `current_period_end`;
- `cancel_at_period_end`, `pending_plan`, `pending_plan_at`, `stripe_schedule_id`;
- `stripe_created_at`, `updated_at`.

The account's plan is worked out from it:
- `active` and `trialing` mean its `plan`;
- `past_due` means its `plan` for the grace period (section 7);
- `unpaid`, `canceled`, `incomplete`, `incomplete_expired` or no row means Basic.

Admin plan overrides (section 9) beat it.

**Repair job.** The daily cron re-reads, from Stripe, every subscription that's been `past_due` for over a day or that
has `cancel_at_period_end` set and has passed its period end. It rebuilds those rows, in case a webhook was missed.

## 5. Credits

**What a credit is.** A credit is $0.001 of AI work at the model's list price plus a 50% margin. A step's credits are:

> ceil(the step's AI cost at the provider's list price × 1.5 ÷ $0.001)

- **The step's cost** comes from the token usage the provider reports for that step: input, output (reasoning
  included), and cache reads and writes when reported. A step with no usage reported is charged the model's typical
  credits per step.
- **List prices** live in the Think model table, `worker/agents/think/model-config.ts`, per 1M tokens, pinned by a test.
  They were measured from 589 AI Gateway log rows, which fit exactly:

| Model | Input | Output | Cache read | Cache write | About this many credits per step |
| --- | --- | --- | --- | --- | --- |
| Claude Sonnet 5.5 | $2 | $10 | $0.20 | $2.50 | 136 |
| Claude Opus 5.5 | $4 | $20 | $0.40 | $5 | 445 |
| Gemini 3.6 Flash | $0.75 (promotional through 2026-12-31) | about $3.75 (fitted; to confirm) | $0.1875 | $0.75 | 16 |
| Gemini 3.8 Flash | the same as 3.6 Flash | the same | the same | the same | 16 |

  Cache prices follow each provider's usual ratio: Anthropic charges 10% of input to read the cache and 125% to write
  it; Gemini charges 25% to read and nothing extra to write.
- **Typical credits per step** (the last column) are measured averages. The pricing calculator, the credits explainer and
  the model picker use them, always as "about N credits per step".

**When credits are charged.** After each step, from its reported usage. This replaces today's flat charge per step.
- **Before a turn:** the turn starts if the account has any credit left.
- **A started turn always finishes,** and its full usage is recorded, even past the limit. The overrun is taken from
  purchased credits (section 5a), or, without any, forgiven when the period ends.
- **Older AI paths** (the `infer` calls the earlier builders and the page-copy drafts make) stream without usage, so they
  keep a per-call estimate: the model's old flat cost converted to the new unit. The old template proxy keeps its own
  daily bucket, outside the plans.

**Periods.** A plan's credits come as a pool per period, and pools don't carry over.
- **Pro and Premium:** the Stripe billing period. Moving from Pro to Premium keeps the period, so credits already used
  count against the bigger pool.
- **Basic, and Enterprise without a subscription:** monthly from the account's sign-up date, in UTC. When a month is
  shorter, the day is clamped to its last day: an account made on January 31 renews on February 28, then March 31.
- **Admin grants** add credits to the current period (section 9).

**The order credits are used in:** first the period's pool and admin grants, then purchased credits, oldest purchase
first.

**The ledger.** Credits are kept in D1, not in a Durable Object:
- `credit_periods`: one row per account and period, with the pool, the grants, the credits used, and how much of the
  overrun has been taken from purchases.
- `credit_uses`: one row per charged step, keyed by the step, so a retried write charges nothing twice. It's also the
  usage log, kept 90 days.
- `credit_purchases`: one row per purchase (section 5a).
- Each step is recorded in one D1 batch, which is one transaction. The balance is always computed from these rows, so it
  is exact, survives restarts, and doesn't depend on any Durable Object's memory.

**Warnings.** At 20% and at 5% of the credits left:
- the share is of everything available this period: the pool, grants and purchased credits;
- the seller gets an email from Estori and an in-app banner;
- each is sent once per period and recorded in `billing_notices`.

**When credits run out.** New turns are refused, with the in-app limit dialog only (no email):
- **Basic:** "You've used this month's free AI credits. They refill on <date>, or get Pro for 20,000 a month."
- **Pro:** "You've used this month's AI credits. They refill on <date>, or move to Premium for 100,000 a month."
- **Premium:** "You've used this month's AI credits. Buy more credits now, or wait until <date>."

**Credits renewed.** Every plan's sellers get an email when their period renews:
- **Pro and Premium:** when the renewal invoice is paid (`billing_reason=subscription_cycle`);
- **Basic, and Enterprise without a subscription:** from the daily cron, for accounts whose period renewed that day,
  verified emails only.

**Usage page.** `/settings/billing` shows the credits used this period, the pool, grants ("Added by Estori"),
purchased credits with their expiry dates, and the renewal date. `GET /api/limits/usage` returns the same numbers, so the
existing badge follows.

**Turning the check on.** The credit check runs before every turn and every new store, on every environment, whatever
`ENABLE_CLOUDFLARE_LIMITS` says. It ignores Cloudflare Connect and own keys: Think always runs on Estori's gateway, so
Estori pays either way. The old balance check stays only for the older non-Think paths that really use the seller's
Cloudflare account. The limit dialogs stop saying "Connect your Cloudflare account" and offer a plan instead, and the
usage badge shows for everyone. This is a new restriction in production, where no limit applies today, so it turns on
with the `billing` flag after notice (section 11).

## 5a. Extra credits

- **Who:** Premium sellers. Buying needs Premium; credits already bought stay usable on any plan.
- **How much:** any amount from 5,000 credits in steps of 1,000, up to 1,000,000 in one purchase, at $1.50 per 1,000.
- **How:** `POST /api/billing/credits` with `{ credits }` opens a Checkout Session with `mode: 'payment'`, one line item
  "1,000 AI credits" at the credits price with the quantity, the customer, and metadata `estori_user_id` and
  `kind: 'credits'`.
- **Recording:** on `checkout.session.completed` with `payment_status: 'paid'`, through `billing_events`, after the same
  account check as subscriptions. The purchase is stored in `credit_purchases`, and its receipt comes from Estori.
- **Use:** after the period's pool and grants, oldest purchase first. They carry over from period to period.
- **Expiry:** 12 months after purchase, at the next daily run; unused credits are then gone. Usage up to that moment is
  first taken from the expiring purchase.
- **Refunds:** a refunded purchase (`charge.refunded`) loses its unused credits. A partial refund removes the refunded
  share. The refund email comes from Estori.

## 6. Where limits are enforced

| Limit | Enforced at | Message |
| --- | --- | --- |
| AI credits | `ensureCanPrompt` and the agent controller before a turn, with the limit from `limitsFor`, independent of `ENABLE_CLOUDFLARE_LIMITS` and Cloudflare Connect | section 5 |
| Stores | the agent controller's creation check: Basic's 3 in the account's lifetime from a counter that deleting doesn't lower; Pro's and Premium's per day | "Basic includes 3 stores, counting ones you've deleted. Get Pro to start up to 10 a day." / "You've started 10 new stores today…" with upgrade |
| Live stores | the live-store publish controller, when publishing a store that isn't live yet; republishing a live store is always allowed | "Basic includes 1 live store. Get Pro for up to 3, or Premium for up to 10." |
| Own domains | the add-domain endpoint | "Own domains come with Pro and Premium." |
| Supplier catalog | **at publish (Go live):** a store on an account without the catalog may be published only if every catalog product in it (each `catalogVariantId` in its `estori-store.json`) is already in its live version; new catalog products are refused. Shopper checkout never refuses. The AI's catalog search tells a Basic seller, in plain words, that adding catalog products needs Pro or Premium. | "Adding catalog products to your store comes with Pro and Premium. Products already live keep selling." |
| Extra credits | the extra-credits checkout | "Buying extra credits comes with Premium." |
| Drafts | unchanged (5 per store, every plan) | unchanged |

**Rules for every check:**
- It goes through one helper, `assertWithinLimit(account, limitKey, currentCount?)`, which returns a typed refusal the
  controllers turn into a 402 with `{ code: 'plan_limit', limit, plan, upgradeTo }`. `upgradeTo` is the next plan that
  lifts that limit, `credits` for Premium's credits, or none.
- The frontend shows one shared "Upgrade" dialog for every `plan_limit` refusal, so the copy lives in one place.
- The AI's tools turn the same refusal into a plain sentence for the seller.

## 7. Downgrades, cancellations and failed payments

**Nothing live breaks.** When an account drops to Basic, or from Premium to Pro:
- **Live stores and their own domains stay up.** If the account has more than its plan's live stores, all of them keep
  serving and taking orders, but it can't publish a store that isn't live yet until it's within the limit. The same
  goes for own domains: they keep working, and no new ones can be added.
- **Catalog products already in a store keep selling:** catalog orders keep being placed and fulfilled. The account
  can't publish a version with new catalog products (section 6); the comparison is with the store's live version, so
  no snapshot table is needed.
- **Credits:** the new plan's pool applies from its next period. Purchased credits stay usable.

**Failed renewals.**
- Stripe retries the card (Smart Retries, as configured in the dashboard).
- During `past_due`, the plan continues for 7 days. The seller gets an email from Estori with a link to update the card,
  and a banner on every page.
- After 7 days without payment the account is treated as Basic, even while Stripe keeps retrying. A successful payment
  restores the plan immediately.
- When Stripe gives up, the subscription is cancelled and the seller is told.

**Cancelling** keeps the plan until the period ends, then Basic, with an email the day it ends.

## 8. Emails from Estori

Every billing email comes from Estori, through the existing email service and templates, with the "[Staging]" prefix
and allowlist on staging. The emails:
- plan started (plan, credits, next renewal);
- receipt for each payment (amount, period, a link to the invoice from Stripe's hosted invoice URL);
- plan changed (Premium charged now, or a move to Pro scheduled);
- payment failed (update-card link, grace period end);
- plan ending (sent when the cancel is recorded, naming the last day) and plan ended;
- credits renewed, for every plan (section 5);
- credits at 20% and at 5% left;
- extra credits receipt, and extra credits refunded.

Running out of credits sends no email: the in-app limit dialog says it.

**Owner step:** turn off Stripe's own customer emails for subscriptions and invoices (Settings → Customer emails:
"Successful payments" is already off; also turn off invoice emails and failed-payment emails). Estori's emails replace
them.

## 9. Admin

- **Endpoints only at launch:** there is no admin user page today, and this build doesn't add one.
  `GET /api/admin/users/:id/billing` returns the plan, Stripe status, period, credits used and left, purchases, and
  links to the Stripe customer and subscription. An admin page can come later.
- **Plan override:** `PUT /api/admin/users/:id/plan` with `{ plan, limits?, until?, reason }`. It records a row in
  `plan_overrides` with the admin and the reason. It's used for:
  - Enterprise accounts, with custom limits and invoiced outside the self-serve flow;
  - comps, such as a free month of Premium for a partner;
  - fixing a wrong state.
- **Credit grants:** `POST /api/admin/users/:id/credits` adds credits to the current period. They're recorded in
  `credit_grants` and shown on the seller's usage page as "Added by Estori".
- **Admin-only:** the endpoints use the existing admin check (`isPlatformAdmin`) and write an audit log entry.

## 10. Security and correctness

- **Webhooks:** the existing signature check comes first, as today. The subscription's and the extra-credits session's
  `metadata.estori_user_id`, set at checkout, must match `client_reference_id` (when there is one) and the stored
  customer; a mismatch is logged as an alert and not applied.
- **Idempotency:** events go through `billing_events`, each charged step through its key in `credit_uses`, and calls to
  Stripe use idempotency keys tied to the account and action, like the existing client.
- **Exact credits:** credits are whole numbers computed with integer arithmetic. Every credit of overrun is taken from
  exactly one purchase, or forgiven; settling it is a compare-and-set batch, so two runs can't take it twice.
- **Prices:** the price comes only from the server's table, never from the browser.
- **Writes:** every D1 write of a billing state happens inside the event handler's transaction (`db.batch`), with the
  event recorded in the same batch.
- **Tax:** Stripe Tax is off at launch (section 15, decision 9). Invoices show no tax.
- **Live and test keys:** the existing `STRIPE_SECRET_KEY` decides the mode. The price IDs must belong to the same mode,
  and the setup script checks that.

## 10a. Terms, refunds and the checkout agreement

- **Terms** (`src/content/legal/terms.md`):
  - add Pro and Premium subscriptions, monthly automatic renewal until cancelled, how to cancel (any time, effective at
    the period's end), and no refunds for part of a period or a move to Pro;
  - credits that don't carry over between periods, have no cash value, and are charged from the AI's real usage;
  - extra credits: bought upfront, used after the month's credits, expire 12 months after purchase, non-refundable
    except when charged twice or when the account couldn't use them;
  - price changes with 30 days' notice;
  - replace "Purchases are one-time payments" with wording that covers template purchases, subscriptions and extra
    credits.
- **Refund policy** (`refunds.md`): Pro, Premium and extra-credit payments are refundable only when charged twice or when
  the account couldn't use Estori, requested within 14 days, as for other purchases.
- **Version:** `TERMS_VERSION` goes up, so every signed-in user accepts again through the existing `TermsGate`.
- **At checkout:** the subscription Checkout Session requires agreement to the terms
  (`consent_collection.terms_of_service: 'required'`) and shows the automatic-renewal disclosure as custom text above
  the pay button: "<Plan> renews every month at <price> until you cancel. Cancel any time in Estori; it ends at the end
  of the period." The extra-credits session shows: "Extra credits are used after your monthly credits and expire 12
  months after purchase."
- **Owner step:** a lawyer reviews the new wording (automatic-renewal laws differ by state).

## 11. Rollout

- **Behind a flag:** billing ships behind the `billing` flag. Billing ships before PostHog, so at first the flag is two
  environment variables: `BILLING=on` turns it on for everyone; `BILLING_USER_IDS` (comma-separated) turns it on only
  for those accounts while `BILLING` is off.
- **When PostHog lands:** the PostHog `billing` flag is added on top, never instead. An account has billing when
  `BILLING=on`, or its id is in `BILLING_USER_IDS`, or PostHog says so. Merging or misconfiguring PostHog can then
  never switch billing off for a paying seller. The environment variables are removed only in a later change, once
  PostHog's flag is at 100%.
- **Analytics:** billing ships first and sends nothing. The PostHog change adds these events at billing's own points:
  - `subscription_started` (`plan`), from the checkout-completed webhook;
  - `subscription_changed` (`from_plan`, `to_plan`, `direction`: `up` or `down`), from the subscription-updated
    webhook;
  - `subscription_cancelled` (`plan`, `reason`: `seller`, `payment_failed` or `admin`), when the plan ends;
  - `subscription_payment_failed` (`plan`, `attempt`), from the invoice-failed webhook;
  - `credits_purchased` (`credits`, `amount_cents`), when extra credits are recorded;
  - `credits_low` (`plan`, `threshold`: `20` or `5`), alongside the credit notices;
  - `credits_limit_reached` (`plan`), when a turn is refused for credits.
  It also sets the `plan` person property from the account's plan. Webhook retries don't double count, because the
  events are sent only after `billing_events` records the Stripe event the first time.
- **Flag off:** the pricing page keeps today's Basic numbers (200 credits a day, 3 new stores a day) and "coming soon"
  on Pro and Premium, `/settings/billing` isn't linked, and no limit beyond today's is enforced (`limitsFor` returns
  today's Basic for everyone, and steps are counted as today).
- **Order:**
  1. Staging in Stripe test mode.
  2. Production in test mode, for the owner's own account only, by targeting the flag to their user ID.
  3. Production live mode on launch day.
- **When limits tighten:** turning the flag on starts enforcing Basic's credits, stores, live-store and catalog limits for
  existing accounts. Existing live stores keep working under section 7's rule.
  - **Every seller** gets an email from Estori a week before enforcement starts, because AI credits aren't limited in
    production today: Basic's monthly credits and stores, what Pro and Premium add, and that their stores stay live.
  - Accounts that already have more than one live store, more than three stores, or catalog products, get a line about
    those: "Your stores stay live; to publish more, get Pro or Premium."
  - Founding sellers can be comped with a plan override.

## 12. Testing

**Unit tests:**
- `limitsFor` for every plan, override and expiry;
- `assertWithinLimit` at, below and above each limit, with `upgradeTo`;
- the step-credit formula for each model, with and without cache and reasoning tokens;
- periods from the sign-up date, with clamped days, and from Stripe;
- the balance and the settling of overrun against purchases, with expiry and refunds;
- the webhook-to-row mapping for every subscription status and event order;
- the grace-period clock.

**Real-D1 tests** (signed webhook payloads, a fake Stripe fetch):
- checkout completed, then a subscription created;
- a duplicate event;
- out-of-order events (updated before created);
- Pro to Premium with its invoice;
- a scheduled move to Pro reaching its date;
- a payment failure, the grace period and recovery;
- cancel and resume;
- deletion;
- a metadata mismatch is refused;
- extra credits bought, used after the pool, refunded and expired;
- a step recorded twice is charged once;
- the repair job and the credits-renewed run.

**Enforcement tests:** each limit in section 6 refuses with `plan_limit` and allows within the limit, and
republishing a live store is never refused.

**Stripe test clocks:** `scripts/stripe-billing-scenarios.ts` drives real Stripe test mode end to end against a
deployed staging environment, using test clocks to move time:
1. subscribe to Pro with 4242 4242 4242 4242;
2. renew a month later;
3. move Pro to Premium mid-period;
4. move Premium to Pro at renewal;
5. a failed renewal with 4000 0000 0000 0341 (it attaches, then the charge fails), the grace period ending after
   7 days, then updating to a good card;
6. a 3-D Secure card, 4000 0025 0000 3155, at checkout (by eye);
7. cancel at the period's end;
8. resume before the end;
9. an expired checkout session;
10. buy 5,000 extra credits on Premium, then refund them.

After each step it reads Estori's billing view and asserts the plan and credits.

**By eye, on staging,** with a test-mode card, the same journeys through the pages, plus:
- the limit dialogs, the upgrade from a limit message and the banners;
- each Estori email, with its "[Staging]" prefix.

**Written checklist:** `docs/estori/billing-test-scenarios.md` lists every scenario with its expected result, so
anyone can rerun it before a release.

## 13. Out of scope

- **Annual billing** and discounts (the pricing spec rules them out for now).
- **Trials:** Basic is the free way to try Estori.
- **Seats and team members.**
- **Billing usage after the fact:** sellers buy extra credits upfront, or move up a plan.
- **Extra credits on Basic or Pro.**
- **Self-serve Enterprise:** admins set it up.
- **An admin billing page:** endpoints only at launch.
- **Taxes:** an owner decision, and needs registrations.
- **Blocking buyers outside the US:** nothing blocks them at checkout; the Terms limit the service to the US, and
  sales tax and VAT stay an owner decision (section 15, decision 9).
- **Building the coming-soon features:** only their limit keys are reserved.

## 14. Owner steps

1. **Run the setup script** in test mode for staging (this can be done for you) and, on launch day, in live mode;
   then set `STRIPE_PRICE_IDS` per environment.
2. **Configure Stripe's customer portal** (card updates, invoices, cancel at period end; no plan switching) in each
   mode, and set a Terms of Service URL under Public details (Checkout's terms agreement needs it).
3. **Turn on Smart Retries** with a retry schedule of up to 2 weeks.
4. **Turn off Stripe's customer emails** for invoices and failed payments.
5. **Add the billing events** to the platform webhook endpoint in each environment:
   `checkout.session.completed` (already there), `customer.subscription.created`, `.updated`, `.deleted`,
   `invoice.paid`, `invoice.payment_failed`, `subscription_schedule.created`, `.updated`, `.released` and
   `.canceled`, and `charge.refunded`.
6. **Decide on sales tax** (Stripe Tax needs registrations in the states where Estori owes tax).
7. **Put your own account on an Enterprise override** before billing turns on, since KV overrides stop applying.
8. **Confirm the Gemini prices:** Flash's output price (fitted at about $3.75 per 1M tokens) and its input price after
   the promotion ends on 2026-12-31.
9. **Approve the enforcement email** to existing sellers (section 11).

## 15. Decisions

"Owner, 2026-10-19" marks the owner's corrections. "Coordinator" and "Planner" mark calls made on the owner's behalf.
Rows marked "approved" were the planner's original calls, kept by the owner's review.

| # | Decision | Why | If wrong | By |
| --- | --- | --- | --- | --- |
| 1 | Plans: Basic free, Pro $49 a month, Premium $199 a month, Enterprise per account; no tiers | the owner's pricing | change `PLAN_LIMITS` and the Stripe prices; existing subscribers keep their price until moved | Owner, 2026-10-19 (replaces four Premium tiers) |
| 2 | Basic: 5,000 credits a month, 3 stores in the account's lifetime, 1 live store, no own domains, no catalog. Premium: 100,000 credits, 25 new stores a day, 10 live stores, 1 domain per live store, the catalog. Pro: 20,000 credits | the owner's limits table | every number lives in `PLAN_LIMITS`; admins can override any account | Owner, 2026-10-19 |
| 2a | Pro: 10 new stores a day, 3 live stores, 1 own domain per live store, the catalog | Pro sits between Basic and Premium on every limit | change Pro's row | Coordinator |
| 3 | A credit is $0.001 of AI work at list price × 1.5, charged after each step from its reported tokens, replacing the flat per-step charge | credits follow what Estori really pays, with a margin | change the margin or the unit in one constant | Owner, 2026-10-19 |
| 3a | List prices per 1M tokens: Sonnet 5.5 $2/$10, Opus 5.5 $4/$20, Gemini 3.6 and 3.8 Flash $0.75 in (promotional through 2026-12-31) and about $3.75 out (fitted); typical steps about 136, 445 and 16 credits | measured from 589 AI Gateway log rows | update the model table; its test pins the numbers | Owner, 2026-10-19 |
| 3b | Cache reads cost 10% of input and writes 125% on Anthropic; reads 25% and no write surcharge on Gemini | the providers' usual list ratios; the measured fit covers input and output only | correct the cache prices in the model table | Planner |
| 3c | A step with no usage reported is charged the model's typical credits per step | a provider that omits usage shouldn't make steps free | log and charge zero instead | Planner |
| 3d | The older `infer` paths keep a per-call estimate (the old flat cost converted to the new unit), because they stream without usage; the old template proxy keeps its own daily bucket | their responses carry no usage to charge from, and the proxy serves no Think store | add `stream_options.include_usage` and per-model prices to those paths | Planner |
| 4 | A started turn always finishes and its full usage is recorded; the overrun comes from purchased credits, otherwise it's forgiven at the period's end; the next turn needs some credit left | stopping mid-build leaves a half-written store, and every step should be on record | add a hard stop at, say, 110% of the pool | Owner, 2026-10-19 (replaces "the counter stops at the limit") |
| 5 | Pro to Premium happens now, prorated and charged, refused if the card fails; Premium to Pro at renewal, no refund | the seller gets what they paid for, and nobody is surprised | switch the proration settings | Owner, 2026-10-19 |
| 6 | Plan changes happen on Estori's page; the Stripe portal only handles cards, invoices and cancelling | one place for plan logic and messages, and Estori's own emails | turn on plan switching in the portal | Planner, approved |
| 7 | 7-day grace on failed renewals, then Basic while Stripe keeps retrying | sellers fix cards without losing a week's work; Estori isn't out of pocket for long | change the grace constant | Planner, approved |
| 8 | Nothing live ever breaks on a downgrade or failed card: stores, domains and existing catalog products keep working; only new ones are refused | shoppers shouldn't pay for a seller's billing, and broken stores create support and chargebacks | enforce harder after a longer grace | Planner, approved |
| 9 | No sales tax at launch (Stripe Tax off) | tax is an open owner decision and needs registrations | turn on `automatic_tax` once registered; prices then show tax | Planner, approved |
| 10 | No trials, no annual billing, promotion codes allowed at checkout; usage beyond the plan only as extra credits bought upfront | Basic is the free trial; the pricing spec ruled out annual; codes let the owner run launch offers | enable trials in the checkout session, or disallow codes | Planner, approved; extra credits Owner, 2026-10-19 |
| 11 | Estori sends every billing email; Stripe's are turned off | the owner's standing rule that communications come from Estori | turn Stripe's emails back on | Planner, approved |
| 12 | Billing ships behind a `billing` flag; existing sellers over a new limit get a week's notice, and nothing live is taken down | a tighter limit on existing accounts is a change they should hear about first | send no notice, or comp founding sellers with overrides | Planner, approved |
| 13 | Enterprise is admin-set (plan override with custom limits, invoiced outside the app); without custom limits it starts at Premium's numbers | no self-serve Enterprise flow is wanted at launch | build an Enterprise checkout later | Planner, approved |
| 14 | A daily repair job re-reads suspicious subscriptions from Stripe | a missed webhook would otherwise leave an account on the wrong plan | rely on webhooks only | Planner, approved |
| 15 | AI credits are enforced for everyone when billing turns on, independent of `ENABLE_CLOUDFLARE_LIMITS` and of Cloudflare Connect or own keys | production applies no AI limit today, and Think always spends Estori's credits | keep Connect as a way past the limit | Planner, approved |
| 16 | Terms gain subscription, credit and automatic-renewal wording, `TERMS_VERSION` goes up (everyone accepts again), and checkout requires agreement with a renewal disclosure | US automatic-renewal laws want clear disclosure and consent; today's Terms say purchases are one-time | skip the re-acceptance and rely on the checkout consent only | Planner, approved |
| 17 | The catalog limit is checked at publish against the store's live version, inside SpaceDO's publish; shopper checkout never refuses | the AI tools only read, and products are added by editing the store file; refusing at checkout would punish shoppers | add a snapshot table of allowed products per store | Planner, approved |
| 18 | Per-user KV rate-limit overrides apply only while billing is off; with billing on, admin plan overrides are the only per-account change, and the owner's account goes on an Enterprise override first | the KV overrides count daily credits and daily stores, which no longer match monthly credits and lifetime stores | translate KV overrides into plan overrides with a script | Planner (replaces "KV overrides keep working") |
| 19 | Admin billing is endpoints only at launch | no admin user page exists; endpoints match the seller-limits pattern | build an admin billing page | Planner, approved |
| 20 | Until PostHog flags exist, `BILLING_USER_IDS` targets the owner-only phase | an environment variable can't target one user otherwise | wait for PostHog flags | Planner, approved |
| 21 | Nothing blocks non-US buyers at checkout | Stripe Checkout can't limit card countries without extra signals; the Terms limit the service to the US | require a US billing address and refund others | Planner, approved |
| 22 | Billing ships before PostHog; afterwards the PostHog `billing` flag is OR'd with `BILLING` and `BILLING_USER_IDS` | billing is the launch blocker; a flag service outage or a mistaken flag must never take a plan away from paying sellers | ship PostHog first and use only its flag | Coordinator |
| 23 | Billing's analytics events (section 11) are added by the PostHog change, at billing's webhook, purchase and notice points, after `billing_events` dedupes | billing ships first, before any analytics client exists | add a no-op analytics hook in billing now | Coordinator; the event list Owner, 2026-10-19 |
| 24 | Periods: Pro and Premium follow the Stripe period; Basic and Enterprise without a subscription run monthly from the sign-up date in UTC, with the day clamped to the month's end; pools don't carry over | every plan has one clear renewal date | use calendar months for Basic | Owner, 2026-10-19 |
| 24a | Accounts with no readable sign-up date renew on the 1st | a few old rows may lack the date | backfill sign-up dates | Planner |
| 25 | Extra credits: Premium only, $1.50 per 1,000, from 5,000 in steps of 1,000; used after the pool and grants, oldest purchase first; they carry over, expire 12 months after purchase, and stay usable after a plan change; a refunded purchase loses its unused credits | the owner's top-up rules | change the price or the expiry in `PLAN_LIMITS` | Owner, 2026-10-19 |
| 25a | One purchase buys at most 1,000,000 credits ($1,500) | a typo shouldn't charge a card thousands; Enterprise covers more | raise the cap | Planner |
| 25b | A partial refund removes the refunded share of the purchase's unused credits | the owner's rule covers a full refund; this keeps a partial one fair | remove all unused credits on any refund | Planner |
| 25c | A purchase expires at the first daily run after its 12 months, and the overrun so far is taken from it just before | the run settles expiries in one place, at most a day late, in the seller's favor | expire on the exact second | Planner |
| 26 | The credit ledger lives in D1 (periods, uses, purchases), not in a Durable Object | whole-number credits, one transaction per step, a key per step so a retry charges nothing, purchases that last months, and no new Durable Object class or migration | move the ledger into a per-account Durable Object | Planner |
| 26a | A step recorded after its period has closed stays in the usage log but isn't charged | a period is closed once, by the daily run; reopening it would move credits already settled | charge it to the next period | Planner |
| 27 | "Credits renewed" goes to every plan: Pro and Premium when the renewal invoice is paid, Basic and Enterprise without a subscription from the daily cron, verified emails only | sellers learn their credits are back | send it only to paying sellers | Owner, 2026-10-19 |
| 27a | The cron sends the Basic renewal emails from the hourly run, at most 100 accounts a run, each claimed once in `billing_notices` | spreads the sending through the day within a Worker's request limits | send them all from the daily run | Planner |
| 28 | Credit alerts at 20% and 5% of everything left this period (pool, grants, purchased), by email and an in-app banner, once each per period | the owner's thresholds | change the two thresholds | Owner, 2026-10-19 (replaces 80% and 100% used) |
| 28a | Running out of credits shows the in-app limit dialog only, with no email | the seller is in the app when it happens | email them too | Coordinator |
| 29 | Basic's 3 stores count every store the account ever started, kept in a counter that deleting doesn't lower and backfilled from today's stores; accounts over 3 keep their stores | the owner's lifetime rule | count only today's stores | Owner, 2026-10-19 |
| 29a | A start that fails after its store is reserved still counts | the counter is taken atomically when a start begins, so two starts can't both take the last place | release the place when a start fails | Planner |
| 30 | With billing off, the pricing page keeps today's Basic numbers and "coming soon" on Pro and Premium | before launch the product still gives today's allowance | show the new plans early | Planner |
| 31 | The calculator recommends Basic up to 5,000 credits a month, Pro up to 20,000, Premium up to 100,000, Premium with extra credits up to 500,000, and Enterprise above that | the owner said Enterprise is for very large needs | change the 500,000 threshold | Planner; the plans Owner, 2026-10-19 |
