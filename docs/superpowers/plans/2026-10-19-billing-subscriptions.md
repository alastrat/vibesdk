# Billing and Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers buy Pro or Premium by card and manage it from Estori, Premium sellers buy extra credits, every AI step is charged from its real cost, and every plan's limits live in one shared table, enforced where they matter.

**Architecture:**
- **One limits table.** `shared/types/plans.ts` holds the plans, their prices, `PLAN_LIMITS`, the pure `limitsFor` and `assertWithinLimit`, and the `plan_limit` refusal. The Worker, the pricing page and the AI's tools all read it.
- **Credits follow real cost.** The Think model table carries each model's list prices. After every step, ThinkAgent turns the step's reported tokens into credits with `stepCredits`: ceil(cost × 1.5 ÷ $0.001), in integer arithmetic.
- **A D1 credit ledger.** `credit_periods` (pool, grants, credits used, overrun settled), `credit_uses` (one row per charged step, keyed, so a retry charges nothing) and `credit_purchases`. Every write is one D1 batch. The balance is computed from rows, so it's exact and survives restarts. A daily run settles overruns against purchases (oldest first), closes ended periods and expires purchases.
- **The account's plan** comes from D1: the `subscriptions` row (Stripe's state), the 7-day grace, and the latest `plan_overrides` row. Its period is the Stripe period, or monthly from the sign-up date. `loadAccount(env, userId)` puts it together.
- **Stripe is the source of truth.** The webhook re-reads subscriptions and extra-credit sessions from Stripe's API, then records the event, the rebuilt row or purchase, and the notices to send in one D1 batch. Billing API calls only ask Stripe for changes; the page polls until the webhook lands.
- **Everything new is behind the `billing` flag** (`BILLING=on`, or `BILLING_USER_IDS`). With the flag off, nothing new is enforced and steps are counted exactly as today.

**Tech Stack:** Cloudflare Workers, D1 with drizzle, Durable Objects (`DORateLimitStore`, `ThinkAgent`, SpaceDO), the AI SDK step usage from `@cloudflare/think`, the Stripe REST API `2026-03-25.dahlia` over fetch (no SDK), Hono, React 19, TanStack Query, vitest-pool-workers.

**Spec:** `docs/superpowers/specs/2026-10-19-billing-subscriptions-design.md` (approved by the owner with corrections on 2026-10-19)

## Rulings against the spec

None. The three rulings of the first draft are now part of the spec:
- subscription rows are rebuilt from Stripe's API, not from the event's copy (section 4);
- the webhook handles the four `subscription_schedule` events (section 4 and owner step 5);
- 3-D Secure at checkout is a by-eye scenario (section 12).

## Choices the spec leaves open

Made here, one line each. Task 1's ledger records them.

1. **Ledger keys.** A period is keyed `sub:{subscriptionId}:{startSeconds}` for a subscription and `acct:{startSeconds}` otherwise, so a Basic month and a Stripe period that start on the same second never share a row. A step is keyed `{agent name}:{turn id}:{step number}`.
2. **Settling is compare-and-set.** One batch reads the unclosed periods and valid purchases; a second writes each changed row only if it still holds the value read. Two runs can't take the same overrun twice.
3. **Alerts read the full balance only when the pool is low.** Credits left over credits available can't fall to 20% while the pool alone is above 20%, so most steps skip the extra read.
4. **The older `infer` calls** charge `ceil(creditCost × 17)` credits a call, because Sonnet's old flat 8 matches its typical 136. They charge before the call, as today, and don't refuse.
5. **Steps are recorded with up to 3 tries**, with the same key, so a passing D1 error neither loses nor doubles a step.
6. **The lifetime store counter** is reserved with one conditional `UPDATE … RETURNING`, so two starts can't both take Basic's last place. The migration backfills it from today's apps.
7. **Billing-off accounts** keep today's metering (`enforceLLMCallsRateLimit` with the model's flat `creditCost` into the daily Durable Object counter).
8. **ThinkAgent exposes `turnCreditsUsed()`** (the sum of the turn's charged credits), for the PostHog change's `build_finished.credits_used`.
9. **Task order:** emails (Task 7) come before the billing API and the webhook, which send them. The shared Upgrade dialog arrives with credits (Task 10), its first user.
10. **Test clocks need a linked customer.** Checkout can't put a customer on a test clock, so the scenarios script makes one and links it through a test-mode-only admin endpoint (Task 13).
11. **The enforcement notice goes out from the hourly run,** 100 accounts an hour, from `BILLING_ENFORCEMENT_FROM` until that day. Only the Worker can send through the Email binding (Task 15).

## Global Constraints

- No `any`. No emojis in code, comments or copy.
- **Anti-goals (spec section 1):**
  - a downgrade or a failed card never takes a live store offline, stops its checkout, or removes its domain;
  - Estori's records follow Stripe: no row changes until Stripe confirms;
  - nothing is billed after the fact; extra credits are bought upfront, and plans never change by themselves.
- **Plans:** `plan: 'basic' | 'pro' | 'premium' | 'enterprise'`, no tiers. Pro is $49 and Premium $199 a month.
- **Limits (spec section 3):**
  - **Basic:** 5,000 credits a month; 3 stores in the account's lifetime; 1 live store; no own domains; no catalog; no extra credits.
  - **Pro:** 20,000 credits; 10 new stores a day; 3 live stores; 1 own domain per live store; the catalog.
  - **Premium:** 100,000 credits; 25 new stores a day; 10 live stores; 1 own domain per live store; the catalog; extra credits.
  - **Enterprise:** per account, starting at Premium's numbers.
  - **Drafts:** 5 per store on every plan.
- **Limits are worked out in this order, later steps winning:** the plan's row, then the admin plan override. Grants add to the period's credits.
- **Credits:**
  - a step costs `ceil(list-price cost × 1.5 ÷ $0.001)`, from its reported input, output (reasoning included) and cache tokens;
  - list prices per 1M tokens: Sonnet 5.5 $2 in, $10 out; Opus 5.5 $4, $20; Gemini 3.6 and 3.8 Flash $0.75, $3.75;
  - typical steps: Sonnet 136, Opus 445, Flash 16 credits, shown as "about N credits per step";
  - credits are used in this order: pool and grants, then purchases, oldest first;
  - a turn needs some credit left to start; a started turn always finishes, and all its usage is recorded.
- **Extra credits:** Premium only; $1.50 per 1,000; 5,000 to 1,000,000 in steps of 1,000; they carry over and expire 12 months after purchase.
- **Periods:** Pro and Premium follow the Stripe period. Basic, and Enterprise without a subscription, run monthly from the sign-up date in UTC, clamped to the month's last day.
- **Grace:** `past_due` keeps the plan for 7 days, then Basic while Stripe keeps retrying. A successful payment restores it.
- **Prices come only from `STRIPE_PRICE_IDS`** (JSON `{ pro, premium, credits }`), never from the browser. Every Stripe call goes through `createStripeClient`, which pins `Stripe-Version: 2026-03-25.dahlia`.
- **Billing emails** come from Estori through `createEmailSender`, so staging's "[Staging] " prefix and recipient allowlist apply. Running out of credits sends no email.
- **Flag:** `BILLING=on` turns billing on for everyone. `BILLING_USER_IDS` (comma-separated) turns it on for those accounts while `BILLING` isn't `on`. With the flag off, nothing new is enforced, KV rate-limit overrides still apply, and the pricing page keeps "coming soon" on Pro and Premium.
- **No analytics here.** Billing ships before PostHog and sends nothing. The PostHog change adds billing's events (spec section 11) at these points, after `billing_events` records the Stripe event:
  - `applySubscription` (Task 9), for the subscription events;
  - `applyCreditPurchase` (Task 9), for `credits_purchased`;
  - `noticeCreditUse` (Task 10), for `credits_low`;
  - the refusal from `checkCreditsBeforeTurn` (Task 10), for `credits_limit_reached`.
- **Refusals** are HTTP 402 with `error: { code: 'plan_limit', planLimit: { code, limit, plan, upgradeTo, message } }`. Over WebSocket they are `{ type: 'error', code: 'PLAN_LIMIT', planLimit }`. Their copy is built once, in `assertWithinLimit`.
- **Seller copy:**
  - follows `src/routes/copy-rules.ts`, so no supplier or AI assistant names (saying "the AI" is fine);
  - says "AI credits", "extra credits", "Pro", "Premium", "Basic";
  - never says "subscription schedule", "proration" or "tokens".
- **Admin endpoints** use `AuthConfig.admin` (`isPlatformAdmin`) and write an `audit_logs` row in the same batch as their change.
- **Migrations:** one drizzle migration, generated with `bun run db:generate -- --name billing`. It takes the next free number (0029 on this branch, unless another branch merged one first).
- **Never read `.dev.vars`.** To try billing locally, the person running it adds `BILLING`, `STRIPE_PRICE_IDS` and the test keys there themselves.
- **Branch:** work on `feat/billing`.
  - Cut it from `main` once store drafts (PR #25) has merged. Tasks 1 and 11 build on its drafts code (`shared/types/drafts.ts`, SpaceDO's `publishDraft`).
  - Until then, cut it from `feat/store-drafts`, and rebase onto `main` after #25 merges.
- **Commits:** subjects are lowercase after the type. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:**
  - `.dev.vars` or `bun.lockb`;
  - anything under `.superpowers/` or `.playwright-mcp/`;
  - `src/routes/landing/LandingPage.tsx` or `wrangler.jsonc`, which carry local changes;
  - the untracked `docs/superpowers/specs/2026-10-18-shopper-order-access-design.md`.
- **Tests:**
  - Run from the repo root, as `rtk proxy bun run test -- <files>`.
  - Run a few files at a time: many files at once exhausts ports.
  - Each test's D1 writes roll back after it; shared rows go in `beforeAll`.
  - Type-check with `bun run typecheck`.
- **Before the PR:** `npx eslint .`, `bun run typecheck`, `bun run build`, `bun run bundle:check`, and `bun run test` (sharded).
- **Don't merge the PR.** The owner merges.

## Review Focus

1. **The credit ledger under retries and concurrency.** Cases: a step recorded twice, two stores building at once for one account, two settling runs, a purchase expiring mid-period, a refund after part of a purchase was used.
   - **Expect:**
     - the balance is exact to the credit;
     - no overrun is taken twice;
     - an expiring purchase pays for usage before its expiry;
     - a refund removes only unused credits.
   - **Guarded by:** the ledger tests in Task 4.
2. **Webhook deliveries that repeat, arrive out of order, or come from another subscription.** This covers a retry, `updated` before `created`, a late event from an ended subscription, a second paid subscription from two checkout tabs, and a repeated extra-credit session.
   - **Expect:**
     - the row ends at Stripe's latest state;
     - each purchase and each email is recorded once;
     - a second live subscription is refused and alerted, and the first is kept.
   - **Guarded by:** the webhook tests in Task 9.
3. **An account over its plan after a downgrade or a failed card,** for example 3 live stores and 12 stores on Basic, with catalog products live.
   - **Expect:**
     - every store keeps serving, and republishing a live store always works;
     - publishing a store that isn't live is refused;
     - starting a store is refused;
     - a version that adds a new catalog product is refused.
   - **Guarded by:** the store and publish tests in Task 11.
4. **Periods and the grace clock.** Cases: a Basic account made on January 31, the renewal emails, day 6 and day 8 of a failed renewal, and a payment on day 9.
   - **Expect:**
     - Basic renews on February 28, then March 31;
     - one renewal email per period;
     - the plan on day 6, Basic on day 8, the plan again once paid.
   - **Guarded by:** the period tests in Task 5 and the jobs and grace tests in Task 9.
5. **The flag.** Cases: `BILLING` off with or without the account in `BILLING_USER_IDS`, spaces and empty entries in the list, and signed-out visitors.
   - **Expect:**
     - accounts outside the flag see exactly today's behavior: no new refusals, today's daily counter, "coming soon" on pricing;
     - accounts inside it see billing.
   - **Guarded by:** the flag tests in Task 5, the flag-off tests in Tasks 10 and 11, and the pricing guard in Task 12.

---

### Task 1: The plan limits module

**Files:**
- Create `shared/types/plans.ts`.
- Modify:
  - `shared/types/drafts.ts` (add `DRAFT_LIMIT`);
  - `src/api-types.ts` (re-export);
  - `src/lib/plans.ts`.
- Test:
  - `shared/types/plans.test.ts`;
  - `src/lib/plans.test.ts`.

**Interfaces:**
- **Consumes:** nothing.
- **Produces** (all from `shared/types/plans.ts`, re-exported through `@/api-types`):
  - constants:
    - `PLAN_IDS = ['basic', 'pro', 'premium', 'enterprise']`, `PAID_PLAN_IDS = ['pro', 'premium']`;
    - `PLAN_PRICES_CENTS: Record<PaidPlanId, number>`;
    - `PLAN_LIMITS: Record<PlanId, PlanLimits>`;
    - `EXTRA_CREDITS = { creditsPerUnit: 1_000, unitPriceCents: 150, minCredits: 5_000, maxCredits: 1_000_000, monthsValid: 12 }`;
    - `PLAN_LIMIT_CODE = 'plan_limit'`, `GRACE_PERIOD_DAYS = 7`.
  - types:
    - `PlanId`, `PaidPlanId`;
    - `PlanLimits { aiCredits: number; storesLifetime: number | null; newStoresPerDay: number | null; liveStores: number | null; ownDomainsPerLiveStore: number; supplierCatalog: boolean; extraCredits: boolean; draftsPerStore: number }` (null means no limit);
    - `PlanLimitKey = 'aiCredits' | 'storesLifetime' | 'newStoresPerDay' | 'liveStores' | 'ownDomainsPerLiveStore' | 'supplierCatalog' | 'extraCredits'`;
    - `PlanLimitOverrides` (the admin's partial limits);
    - `PlanAccountInput { billing: boolean; plan: PlanId; adminLimits: PlanLimitOverrides | null }`;
    - `PlanAccount { billing: boolean; plan: PlanId; limits: PlanLimits; creditsResetAt: number }`;
    - `PlanLimitRefusal { code: 'plan_limit'; limit: PlanLimitKey; plan: PlanId; upgradeTo: 'pro' | 'premium' | 'enterprise' | 'credits' | null; message: string }`.
  - functions:
    - `isPaidPlanId(value: unknown): value is PaidPlanId`, `planName(plan: PlanId): string`;
    - `extraCreditsPriceCents(credits: number): number`, `isExtraCreditsAmount(value: unknown): value is number`;
    - `limitsFor(input: PlanAccountInput): PlanLimits`;
    - `assertWithinLimit(account: PlanAccount, key: PlanLimitKey, current?: number): PlanLimitRefusal | null`. For `aiCredits`, `current` is the pool minus the credits left, so it refuses once nothing is left.
    - `isPlanLimitRefusal(value: unknown): value is PlanLimitRefusal`;
    - `planLimitOverridesFrom(value: unknown): PlanLimitOverrides | null`;
    - `formatBillingDate(ms: number): string` ("November 19", UTC);
    - `formatUsd(cents: number): string`, `formatCredits(credits: number): string`. Both move here from `src/lib/plans.ts`, which re-exports them.

- [ ] **Step 1: Ledger the choices.** Write the eleven choices from "Choices the spec leaves open" into the ledger, one `Choice:` line each.

- [ ] **Step 2: Write the failing test** `shared/types/plans.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DRAFT_LIMIT } from './drafts';
import {
	EXTRA_CREDITS,
	PLAN_LIMITS,
	PLAN_PRICES_CENTS,
	assertWithinLimit,
	extraCreditsPriceCents,
	formatBillingDate,
	isExtraCreditsAmount,
	isPlanLimitRefusal,
	limitsFor,
	planLimitOverridesFrom,
	type PlanAccount,
	type PlanAccountInput,
} from './plans';

const RESET = Date.UTC(2026, 10, 19);

function account(overrides: Partial<PlanAccountInput> = {}): PlanAccount {
	const input: PlanAccountInput = { billing: true, plan: 'basic', adminLimits: null, ...overrides };
	return { billing: input.billing, plan: input.plan, limits: limitsFor(input), creditsResetAt: RESET };
}

const PREMIUM_ROW = { aiCredits: 100_000, storesLifetime: null, newStoresPerDay: 25, liveStores: 10, ownDomainsPerLiveStore: 1, supplierCatalog: true, extraCredits: true, draftsPerStore: 5 };

describe('the plan table', () => {
	it("holds the owner's plans, prices and limits", () => {
		expect(PLAN_PRICES_CENTS).toEqual({ pro: 4_900, premium: 19_900 });
		expect(PLAN_LIMITS).toEqual({
			basic: { aiCredits: 5_000, storesLifetime: 3, newStoresPerDay: null, liveStores: 1, ownDomainsPerLiveStore: 0, supplierCatalog: false, extraCredits: false, draftsPerStore: 5 },
			pro: { aiCredits: 20_000, storesLifetime: null, newStoresPerDay: 10, liveStores: 3, ownDomainsPerLiveStore: 1, supplierCatalog: true, extraCredits: false, draftsPerStore: 5 },
			premium: PREMIUM_ROW,
			enterprise: PREMIUM_ROW,
		});
		expect(DRAFT_LIMIT).toBe(5);
	});

	it('sells extra credits from 5,000 to 1,000,000 in steps of 1,000, at $1.50 per 1,000', () => {
		expect(EXTRA_CREDITS).toEqual({ creditsPerUnit: 1_000, unitPriceCents: 150, minCredits: 5_000, maxCredits: 1_000_000, monthsValid: 12 });
		expect(extraCreditsPriceCents(5_000)).toBe(750);
		expect(extraCreditsPriceCents(12_000)).toBe(1_800);
		for (const amount of [5_000, 6_000, 1_000_000]) expect(isExtraCreditsAmount(amount)).toBe(true);
		for (const amount of [4_000, 5_500, 1_001_000, '5000', 5_000.5, null]) expect(isExtraCreditsAmount(amount)).toBe(false);
	});
});

describe('limitsFor', () => {
	it("gives each plan its row, and an admin override wins", () => {
		expect(limitsFor({ billing: true, plan: 'pro', adminLimits: null })).toEqual(PLAN_LIMITS.pro);
		expect(limitsFor({ billing: true, plan: 'enterprise', adminLimits: { aiCredits: 1_000_000, liveStores: 50 } })).toMatchObject({ aiCredits: 1_000_000, liveStores: 50, newStoresPerDay: 25 });
		expect(limitsFor({ billing: true, plan: 'basic', adminLimits: { storesLifetime: null } }).storesLifetime).toBeNull();
	});

	it('enforces nothing new while billing is off', () => {
		expect(limitsFor({ billing: false, plan: 'premium', adminLimits: { liveStores: 2 } })).toEqual({ ...PLAN_LIMITS.basic, storesLifetime: null, liveStores: null, ownDomainsPerLiveStore: 1, supplierCatalog: true });
	});
});

describe('assertWithinLimit', () => {
	it('refuses Basic at each limit with the copy from the spec, pointing at the next plan that lifts it', () => {
		const basic = account();
		expect(assertWithinLimit(basic, 'aiCredits', 4_999)).toBeNull();
		expect(assertWithinLimit(basic, 'aiCredits', 5_000)).toEqual({
			code: 'plan_limit',
			limit: 'aiCredits',
			plan: 'basic',
			upgradeTo: 'pro',
			message: "You've used this month's free AI credits. They refill on November 19, or get Pro for 20,000 a month.",
		});
		expect(assertWithinLimit(basic, 'storesLifetime', 2)).toBeNull();
		expect(assertWithinLimit(basic, 'storesLifetime', 3)).toMatchObject({ upgradeTo: 'pro', message: "Basic includes 3 stores, counting ones you've deleted. Get Pro to start up to 10 a day." });
		expect(assertWithinLimit(basic, 'newStoresPerDay', 99)).toBeNull();
		expect(assertWithinLimit(basic, 'liveStores', 1)).toMatchObject({ upgradeTo: 'pro', message: 'Basic includes 1 live store. Get Pro for up to 3, or Premium for up to 10.' });
		expect(assertWithinLimit(basic, 'ownDomainsPerLiveStore', 0)).toMatchObject({ upgradeTo: 'pro', message: 'Own domains come with Pro and Premium.' });
		expect(assertWithinLimit(basic, 'supplierCatalog')).toMatchObject({ upgradeTo: 'pro', message: 'Adding catalog products to your store comes with Pro and Premium. Products already live keep selling.' });
		expect(assertWithinLimit(basic, 'extraCredits')).toMatchObject({ upgradeTo: 'premium', message: 'Buying extra credits comes with Premium.' });
	});

	it('points Pro at Premium, Premium at extra credits or Enterprise, and Enterprise nowhere', () => {
		const pro = account({ plan: 'pro' });
		expect(assertWithinLimit(pro, 'aiCredits', 20_000)).toMatchObject({ upgradeTo: 'premium', message: "You've used this month's AI credits. They refill on November 19, or move to Premium for 100,000 a month." });
		expect(assertWithinLimit(pro, 'newStoresPerDay', 10)).toMatchObject({ upgradeTo: 'premium', message: "You've started 10 new stores today. Start more tomorrow, or move to Premium for up to 25 a day." });
		expect(assertWithinLimit(pro, 'liveStores', 3)).toMatchObject({ upgradeTo: 'premium', message: 'Pro includes 3 live stores. Move to Premium for up to 10.' });
		expect(assertWithinLimit(pro, 'supplierCatalog')).toBeNull();
		const premium = account({ plan: 'premium' });
		expect(assertWithinLimit(premium, 'aiCredits', 100_000)).toMatchObject({ upgradeTo: 'credits', message: "You've used this month's AI credits. Buy more credits now, or wait until November 19." });
		expect(assertWithinLimit(premium, 'newStoresPerDay', 25)).toMatchObject({ upgradeTo: 'enterprise', message: "You've started 25 new stores today. Start more tomorrow, or talk to us about Enterprise." });
		expect(assertWithinLimit(premium, 'liveStores', 10)).toMatchObject({ upgradeTo: 'enterprise', message: 'Premium includes 10 live stores. Talk to us about Enterprise for more.' });
		expect(assertWithinLimit(premium, 'extraCredits')).toBeNull();
		expect(assertWithinLimit(account({ plan: 'enterprise', adminLimits: { liveStores: 3 } }), 'liveStores', 3)).toMatchObject({ upgradeTo: null, message: 'Enterprise includes 3 live stores. Talk to us to raise it.' });
		expect(assertWithinLimit(account({ plan: 'enterprise' }), 'aiCredits', 100_000)).toMatchObject({ upgradeTo: null, message: "You've used this month's AI credits. Talk to us about more, or wait until November 19." });
	});

	it('refuses nothing while billing is off, and recognizes a refusal that crossed the network', () => {
		const off = account({ billing: false });
		for (const key of ['aiCredits', 'storesLifetime', 'liveStores', 'supplierCatalog', 'extraCredits'] as const) expect(assertWithinLimit(off, key, 1_000_000)).toBeNull();
		expect(isPlanLimitRefusal(JSON.parse(JSON.stringify(assertWithinLimit(account(), 'supplierCatalog'))))).toBe(true);
		for (const value of [null, 'plan_limit', { code: 'plan_limit', limit: 'nope', plan: 'basic', upgradeTo: null, message: 'x' }, { code: 'plan_limit', limit: 'liveStores', plan: 'gold', upgradeTo: null, message: 'x' }]) {
			expect(isPlanLimitRefusal(value)).toBe(false);
		}
	});
});

describe('admin limit overrides', () => {
	it('reads only known limits within range, with null lifting a store cap', () => {
		expect(planLimitOverridesFrom({ aiCredits: 300_000, liveStores: 25, storesLifetime: null, extraCredits: true })).toEqual({ aiCredits: 300_000, liveStores: 25, storesLifetime: null, extraCredits: true });
		expect(planLimitOverridesFrom({})).toEqual({});
		for (const bad of [{ aiCredits: 0 }, { liveStores: 1.5 }, { supplierCatalog: 'yes' }, { draftsPerStore: 9 }, { ownDomainsPerLiveStore: 2 }, { liveStores: null }, { toString: 1 }, 'x', null, []]) {
			expect(planLimitOverridesFrom(bad)).toBeNull();
		}
	});
});

describe('formatBillingDate', () => {
	it('names the day in UTC', () => {
		expect(formatBillingDate(Date.UTC(2026, 10, 19, 23, 59))).toBe('November 19');
	});
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `rtk proxy bun run test -- shared/types/plans.test.ts`
Expected: FAIL, "Failed to resolve import ./plans".

- [ ] **Step 4: Implement `shared/types/plans.ts`.** First add `export const DRAFT_LIMIT = 5;` to `shared/types/drafts.ts`, commented "Drafts per store, counting Main. Mirrors DRAFT_LIMIT in space/src/space/drafts-store.ts."

The types and tables are as Interfaces and the test give them. Enterprise's row is a copy of Premium's.

**`limitsFor(input)`:**
- Billing off: `{ ...PLAN_LIMITS.basic, storesLifetime: null, liveStores: null, ownDomainsPerLiveStore: 1, supplierCatalog: true }`. Credits aren't read while billing is off; today's daily counter applies.
- Billing on: `{ ...PLAN_LIMITS[input.plan], ...input.adminLimits }`.

**`assertWithinLimit(account, key, current = 0)`:**
- returns null when `!account.billing`;
- `supplierCatalog` and `extraCredits` are reached when false;
- the other keys are reached when the limit isn't null and `current >= limit`.

**`upgradeTo`:**
- `aiCredits` on Premium is `'credits'`;
- anything on Enterprise is null;
- on Premium, every other key is `'enterprise'`;
- otherwise it's the first plan after the account's, in `PLAN_IDS` order, whose `PLAN_LIMITS` value lifts the limit: a true flag, a null cap, or a bigger number.

**Messages,** keyed on plan and limit, numbers from `PLAN_LIMITS` through `formatCredits`. `count(n, noun)` writes "1 live store" and "3 stores". Dates use `formatBillingDate(account.creditsResetAt)`. The cases the test doesn't pin:
- `storesLifetime` on a plan other than Basic: "Your plan includes {n} stores. Talk to us to raise it.";
- `newStoresPerDay` on Enterprise: "You've started {n} new stores today. Start more tomorrow.";
- `ownDomainsPerLiveStore` on a plan other than Basic: "Own domains aren't on your plan. Talk to us to add them.";
- `supplierCatalog` on a plan other than Basic: the Basic sentence;
- `liveStores` on Enterprise: "Enterprise includes {n} live stores. Talk to us to raise it." (in the test).

**`planLimitOverridesFrom`:**
- a plain object whose own keys are known, checked with `Object.hasOwn`;
- `aiCredits` an integer from 1 to 100,000,000;
- `storesLifetime` null or an integer from 0 to 100,000;
- `newStoresPerDay` null or an integer from 1 to 10,000;
- `liveStores` an integer from 0 to 10,000;
- `ownDomainsPerLiveStore` 0 or 1;
- `supplierCatalog` and `extraCredits` booleans.

**The rest:**
- `formatBillingDate` uses `new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })`;
- `formatUsd` and `formatCredits` move unchanged from `src/lib/plans.ts`;
- `planName` answers "Basic", "Pro", "Premium" or "Enterprise".

- [ ] **Step 5: Run the test to verify it passes**

Run: `rtk proxy bun run test -- shared/types/plans.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Point `src/lib/plans.ts` at the table.**
- In `src/api-types.ts`, re-export the types and functions above, and `DRAFT_LIMIT`.
- In `src/lib/plans.ts`:
  - `PlanId`, `formatUsd` and `formatCredits` re-export the shared ones;
  - `PLANS` lists Basic, Pro, Premium and Enterprise, with Pro's tagline "More credits and live stores for sellers growing a few stores.";
  - delete `PremiumTier`, `PREMIUM_TIERS` and `premiumTierFor`. Their users change in Tasks 2 and 12; until then, `bun run typecheck` names them;
  - `PAID` becomes `{ basic: false, pro: true, premium: true, enterprise: true }`, and `ENTERPRISE` gains `pro: false`;
  - `CATALOG_PLANS` reads `PLAN_LIMITS[plan].supplierCatalog` for each plan;
  - every `ALL` and `onEveryPlan` cell gains `pro`.
- Add store-builder rows after "Live preview on desktop and phone":

```ts
		{ label: 'Stores', cells: { basic: `${PLAN_LIMITS.basic.storesLifetime}`, pro: `${PLAN_LIMITS.pro.newStoresPerDay} new a day`, premium: `${PLAN_LIMITS.premium.newStoresPerDay} new a day`, enterprise: 'Custom' } },
		{ label: 'Live stores at once', cells: { basic: String(PLAN_LIMITS.basic.liveStores), pro: String(PLAN_LIMITS.pro.liveStores), premium: String(PLAN_LIMITS.premium.liveStores), enterprise: 'Custom' } },
		{ label: 'Your own domain', cells: { basic: false, pro: 'One per live store', premium: 'One per live store', enterprise: 'One per live store' } },
		{ label: 'Extra AI credits', cells: { basic: false, pro: false, premium: '$1.50 per 1,000', enterprise: true } },
```

- [ ] **Step 7: Update `src/lib/plans.test.ts`.**
- Every `toEqual` over a cells object gains its `pro` value: `true` for `ALL`, the same text for `onEveryPlan`, and `true` for `PAID`.
- `PLANS.map((plan) => plan.id)` is `['basic', 'pro', 'premium', 'enterprise']`.
- Delete the `PREMIUM_TIERS` and `premiumTierFor` tests.
- Add:

```ts
	it('takes the store, live-store, domain, catalog and extra-credit cells from the shared limits table', () => {
		const builder = PLAN_COMPARISON.find((section) => section.capability === 'store-builder');
		const cells = (label: string) => builder?.rows.find((row) => row.label === label)?.cells;
		expect(cells('Stores')).toEqual({ basic: '3', pro: '10 new a day', premium: '25 new a day', enterprise: 'Custom' });
		expect(cells('Live stores at once')).toEqual({ basic: '1', pro: '3', premium: '10', enterprise: 'Custom' });
		expect(cells('Extra AI credits')).toEqual({ basic: false, pro: false, premium: '$1.50 per 1,000', enterprise: true });
		expect(PLAN_COMPARISON.find((section) => section.capability === 'product-catalog')?.rows[0]?.cells).toEqual({ basic: false, pro: true, premium: true, enterprise: true });
	});
```

- [ ] **Step 8: Run the tests**

Run: `rtk proxy bun run test -- shared/types/plans.test.ts src/lib/plans.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: errors only in `src/lib/credits.ts`, `src/components/pricing/*` and `src/lib/contact.ts`, which still read Premium tiers. Tasks 2 and 12 fix them.

- [ ] **Step 9: Commit**

```bash
git add shared/types/plans.ts shared/types/plans.test.ts shared/types/drafts.ts src/api-types.ts src/lib/plans.ts src/lib/plans.test.ts
git commit -m "feat(billing): one table of plans, prices and limits, with the refusal and its copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Model prices, step credits and the per-step copy

**Files:**
- Create:
  - `worker/services/billing/step-credits.ts`;
  - `worker/agents/think/model-prices.test.ts`.
- Modify:
  - worker: `worker/agents/think/model-config.ts`, `worker/agents/core/features/types.ts`;
  - frontend: `src/hooks/use-model-rates.ts`, `src/utils/credit-change.ts`, `src/components/ModelUnavailableNotice.tsx`, `src/components/pricing/CreditsExplainer.tsx`, `src/components/pricing/Calculator.tsx` (the model list only), `src/lib/credits.ts` (comments and the recommendation).
- Test:
  - `worker/services/billing/step-credits.test.ts`;
  - `worker/agents/think/model-prices.test.ts`;
  - `src/utils/credit-change.test.ts`;
  - `src/lib/credits.test.ts`.

**Interfaces:**
- **Consumes:** `PLAN_LIMITS`, `EXTRA_CREDITS` (Task 1).
- **Produces:**
  - `model-config.ts`:
    - `TokenPrices { inputUsd: number; outputUsd: number; cacheReadUsd: number; cacheWriteUsd: number }`, each per 1M tokens;
    - `ThinkModel` gains `prices: TokenPrices`, `creditsPerStep: number` (typical) and `pricesReviewBy: string | null`.
  - `ThinkModelOption.creditCost` is renamed `creditsPerStep` (typical credits per step).
  - `step-credits.ts`:
    - `CREDIT_USD = 0.001`, `CREDIT_MARGIN = 1.5`, `LEGACY_CREDIT_FACTOR = 17`;
    - `StepUsage { inputTokens?: number; noCacheInputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; outputTokens?: number; textTokens?: number; reasoningTokens?: number }`;
    - `stepUsageFrom(usage: LanguageModelUsage | undefined): StepUsage | null`;
    - `stepCredits(prices: TokenPrices, usage: StepUsage | null, typical: number): number`;
    - `legacyCallCredits(creditCost: number): number`.
  - `src/lib/credits.ts`: `Recommendation = { plan: 'basic' } | { plan: 'pro' } | { plan: 'premium'; extraCredits: number } | { plan: 'enterprise' }`, `recommendPlan(credits: number, basicCredits?: number): Recommendation`, `ENTERPRISE_FROM_CREDITS = 500_000`. `basicCredits` defaults to Basic's monthly credits; with billing off, the calculator passes today's daily allowance times `DAYS_PER_MONTH`.
  - `describeCreditChange(current, next)` writes "about N credits per step".

- [ ] **Step 1: Write the failing worker tests.** `worker/services/billing/step-credits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { legacyCallCredits, stepCredits, stepUsageFrom } from './step-credits';

const SONNET = { inputUsd: 2, outputUsd: 10, cacheReadUsd: 0.2, cacheWriteUsd: 2.5 };
const OPUS = { inputUsd: 4, outputUsd: 20, cacheReadUsd: 0.4, cacheWriteUsd: 5 };
const FLASH = { inputUsd: 0.75, outputUsd: 3.75, cacheReadUsd: 0.1875, cacheWriteUsd: 0.75 };

describe('stepCredits', () => {
	it("charges a step's list-price cost times 1.5, in credits of $0.001, rounded up", () => {
		// $0.08 + $0.03 = $0.11, × 1.5 = $0.165: exactly 165 credits, not 166.
		expect(stepCredits(SONNET, { inputTokens: 40_000, outputTokens: 3_000 }, 136)).toBe(165);
		// $0.015 + $0.00375 = $0.01875, × 1.5 = $0.028125: 29 credits.
		expect(stepCredits(FLASH, { inputTokens: 20_000, outputTokens: 1_000 }, 16)).toBe(29);
		expect(stepCredits(SONNET, { inputTokens: 1, outputTokens: 0 }, 136)).toBe(1);
	});

	it('prices cache reads and writes apart from fresh input, and counts reasoning as output', () => {
		// 10k fresh × $4 + 50k read × $0.40 + 2k written × $5 + 4k out × $20 = $0.15, × 1.5 = 225 credits.
		expect(stepCredits(OPUS, { inputTokens: 62_000, cacheReadTokens: 50_000, cacheWriteTokens: 2_000, outputTokens: 4_000 }, 445)).toBe(225);
		expect(stepCredits(OPUS, { inputTokens: 62_000, noCacheInputTokens: 10_000, cacheReadTokens: 50_000, cacheWriteTokens: 2_000, textTokens: 1_000, reasoningTokens: 3_000 }, 445)).toBe(225);
	});

	it("charges the model's typical step when the provider reports no usage", () => {
		expect(stepCredits(SONNET, null, 136)).toBe(136);
		expect(stepCredits(SONNET, {}, 136)).toBe(136);
	});

	it("reads the AI SDK's step usage", () => {
		expect(
			stepUsageFrom({
				inputTokens: 62_000,
				inputTokenDetails: { noCacheTokens: 10_000, cacheReadTokens: 50_000, cacheWriteTokens: 2_000 },
				outputTokens: 4_000,
				outputTokenDetails: { textTokens: 1_000, reasoningTokens: 3_000 },
				totalTokens: 66_000,
			}),
		).toEqual({ inputTokens: 62_000, noCacheInputTokens: 10_000, cacheReadTokens: 50_000, cacheWriteTokens: 2_000, outputTokens: 4_000, textTokens: 1_000, reasoningTokens: 3_000 });
		expect(stepUsageFrom(undefined)).toBeNull();
	});

	it("converts an older call's flat cost to the new unit, as Sonnet's 8 became its typical 136", () => {
		expect(legacyCallCredits(8)).toBe(136);
		expect(legacyCallCredits(1.2)).toBe(21);
		expect(legacyCallCredits(0)).toBe(0);
	});
});
```

Build the `stepUsageFrom` argument with the exact `LanguageModelUsage` shape from the installed `ai` package. If its type has more required fields, add them with `undefined`.

`worker/agents/think/model-prices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { THINK_MODELS, thinkModelOptions } from './model-config';

describe('the Think model prices', () => {
	it('pins each model to its list prices per 1M tokens and its typical credits per step', () => {
		expect(THINK_MODELS.map((model) => [model.id, model.prices, model.creditsPerStep, model.pricesReviewBy])).toEqual([
			['google-ai-studio/gemini-3.6-flash', { inputUsd: 0.75, outputUsd: 3.75, cacheReadUsd: 0.1875, cacheWriteUsd: 0.75 }, 16, '2026-12-31'],
			['google-ai-studio/gemini-3.8-flash', { inputUsd: 0.75, outputUsd: 3.75, cacheReadUsd: 0.1875, cacheWriteUsd: 0.75 }, 16, '2026-12-31'],
			['anthropic/claude-sonnet-5-5', { inputUsd: 2, outputUsd: 10, cacheReadUsd: 0.2, cacheWriteUsd: 2.5 }, 136, null],
			['anthropic/claude-opus-5-5', { inputUsd: 4, outputUsd: 20, cacheReadUsd: 0.4, cacheWriteUsd: 5 }, 445, null],
		]);
	});

	it('publishes the typical credits per step to the pricing page and the model picker', () => {
		expect(thinkModelOptions().map((option) => [option.id, option.creditsPerStep])).toEqual(THINK_MODELS.map((model) => [model.id, model.creditsPerStep]));
	});
});
```

- [ ] **Step 2: Write the failing frontend tests.** Replace the expectations in `src/utils/credit-change.test.ts` with:

```ts
	it('describes a change between models in typical credits per step', () => {
		expect(describeCreditChange(16, 136)).toBe('about 136 credits per step instead of about 16 (about 8.5x)');
		expect(describeCreditChange(136, 16)).toBe('about 16 credits per step instead of about 136 (about 88% cheaper)');
		expect(describeCreditChange(136, 136)).toBe('about 136 credits per step');
	});
```

In `src/lib/credits.test.ts`, replace the recommendation tests with:

```ts
	it('recommends the smallest plan whose monthly credits cover the need, then Premium with extra credits, then Enterprise', () => {
		expect(recommendPlan(0)).toEqual({ plan: 'basic' });
		expect(recommendPlan(5_000)).toEqual({ plan: 'basic' });
		expect(recommendPlan(5_001)).toEqual({ plan: 'pro' });
		expect(recommendPlan(20_000)).toEqual({ plan: 'pro' });
		expect(recommendPlan(100_000)).toEqual({ plan: 'premium', extraCredits: 0 });
		// Extra credits come in thousands, at least 5,000.
		expect(recommendPlan(101_200)).toEqual({ plan: 'premium', extraCredits: 5_000 });
		expect(recommendPlan(112_300)).toEqual({ plan: 'premium', extraCredits: 13_000 });
		expect(recommendPlan(500_000)).toEqual({ plan: 'premium', extraCredits: 400_000 });
		expect(recommendPlan(500_001)).toEqual({ plan: 'enterprise' });
		// With billing off, Basic is today's daily allowance over a month.
		expect(recommendPlan(5_500, 6_000)).toEqual({ plan: 'basic' });
		expect(recommendPlan(6_001, 6_000)).toEqual({ plan: 'pro' });
	});
```

Change any test that builds a `ThinkModelOption` to use `creditsPerStep`.

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/step-credits.test.ts worker/agents/think/model-prices.test.ts src/utils/credit-change.test.ts src/lib/credits.test.ts`
Expected: FAIL, missing modules and fields.

- [ ] **Step 4: Implement `step-credits.ts`**

```ts
/**
 * Credits from a step's real cost: ceil(list-price cost × 1.5 ÷ $0.001). Prices are turned into whole units of $0.0001
 * per 1M tokens, so the arithmetic is exact: credits = ceil(Σ tokens × units × 15 ÷ 10^8).
 */

export const CREDIT_USD = 0.001;
export const CREDIT_MARGIN = 1.5;
/** Older paths charged a flat cost per call; Sonnet's 8 matches its typical 136 credits a step. */
export const LEGACY_CREDIT_FACTOR = 17;

const UNITS_PER_USD = 10_000;
/** units × tokens × 15 ÷ 10^8 = (units ÷ 10^4 $) × (tokens ÷ 10^6) × 1.5 ÷ $0.001. */
const CREDIT_DIVISOR = 100_000_000;
const MARGIN_NUMERATOR = 15;

const units = (usd: number): number => Math.round(usd * UNITS_PER_USD);
const count = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export function stepCredits(prices: TokenPrices, usage: StepUsage | null, typical: number): number {
	if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined && usage.textTokens === undefined)) return typical;
	const cacheRead = count(usage.cacheReadTokens);
	const cacheWrite = count(usage.cacheWriteTokens);
	const fresh = usage.noCacheInputTokens !== undefined ? count(usage.noCacheInputTokens) : Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite);
	const output = usage.outputTokens !== undefined ? count(usage.outputTokens) : count(usage.textTokens) + count(usage.reasoningTokens);
	const total =
		fresh * units(prices.inputUsd) + cacheRead * units(prices.cacheReadUsd) + cacheWrite * units(prices.cacheWriteUsd) + output * units(prices.outputUsd);
	return Math.floor((total * MARGIN_NUMERATOR + CREDIT_DIVISOR - 1) / CREDIT_DIVISOR);
}
```

- **`stepUsageFrom`** copies `inputTokens`, `inputTokenDetails.noCacheTokens`, `cacheReadTokens`, `cacheWriteTokens`, `outputTokens` and `outputTokenDetails.textTokens`, `reasoningTokens`, leaving out undefined ones. It answers null for undefined usage.
- **`legacyCallCredits(creditCost)`** is `Math.ceil(creditCost * LEGACY_CREDIT_FACTOR)`.
- Import `TokenPrices` as a type from `../../agents/think/model-config`.

- [ ] **Step 5: The model table.** In `model-config.ts`:
- Replace the old "Credits: $0.25 per 1M input tokens" comment with "List prices per 1M tokens, from 589 AI Gateway log rows (2026-10-19). Cache reads cost 10% of input on Anthropic and 25% on Gemini; Anthropic cache writes cost 125%. Gemini Flash input is promotional through 2026-12-31: review its prices then."
- Give each model the `prices`, `creditsPerStep` and `pricesReviewBy` the test pins.
- Keep `config.creditCost`: billing-off metering still uses it.
- `thinkModelOptions()` publishes `creditsPerStep: model.creditsPerStep`.
- In `features/types.ts`, `ThinkModelOption.creditCost` becomes `creditsPerStep: number`, documented "Typical credits per step, from measured usage; each step is charged from its real cost."

- [ ] **Step 6: The frontend copy.**
- **`credit-change.ts`:** writes the strings the test pins, still rounding the ratio to one decimal and the saving to a whole percent.
- **`use-model-rates.ts`:** `rates` maps `model.creditsPerStep`, and its comment says "typical credits per step".
- **`ModelUnavailableNotice.tsx`:** passes `failed.creditsPerStep` and `alternative.creditsPerStep`.
- **`Calculator.tsx`:** reads `model?.creditsPerStep ?? 0`, and each model option says "about {entry.creditsPerStep} credits per step".
- **`CreditsExplainer.tsx`:** the footnote becomes "Estimates. Each AI step is charged from the work it does, at the price of the model you pick; bigger stores and longer requests take more steps."
- **`src/lib/credits.ts`:**
  - the header comment says the builder charges each step from its real cost, and the steps are priced at each model's typical credits per step;
  - keep `DAYS_PER_MONTH`: with billing off, the calculator still prices Basic from today's daily allowance;
  - `recommendPlan(credits, basicCredits = PLAN_LIMITS.basic.aiCredits)`, using `PLAN_LIMITS` and `EXTRA_CREDITS`, answers:
    - Basic up to `basicCredits`;
    - Pro up to Pro's;
    - Premium with `extraCredits: 0` up to Premium's;
    - Premium with extra credits (the shortfall rounded up to 1,000, at least `EXTRA_CREDITS.minCredits`) up to `ENTERPRISE_FROM_CREDITS`;
    - Enterprise above that.
  - Calculator's use of the recommendation changes in Task 12.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/step-credits.test.ts worker/agents/think/model-prices.test.ts src/utils/credit-change.test.ts src/lib/credits.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: errors only in `src/components/pricing/Calculator.tsx`, `PlanCards.tsx`, `ComparePlans.tsx` and `src/lib/contact.ts`, which Task 12 rewrites.

- [ ] **Step 8: Commit**

```bash
git add worker/services/billing/step-credits.ts worker/services/billing/step-credits.test.ts worker/agents/think/model-config.ts worker/agents/think/model-prices.test.ts worker/agents/core/features/types.ts src/hooks/use-model-rates.ts src/utils/credit-change.ts src/utils/credit-change.test.ts src/components/ModelUnavailableNotice.tsx src/components/pricing/CreditsExplainer.tsx src/components/pricing/Calculator.tsx src/lib/credits.ts src/lib/credits.test.ts
git commit -m "feat(billing): price each model per token, charge a step from its real cost, and say about how many credits a step takes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Billing tables and their services

**Files:**
- Create:
  - `shared/types/billing.ts`;
  - `worker/database/services/BillingService.ts`;
  - `worker/database/services/PlanAdminService.ts`;
  - `worker/database/services/unique-violation.ts`;
  - the generated migration `migrations/00NN_billing.sql` and its snapshot.
- Modify:
  - `worker/database/schema.ts`, `worker/database/index.ts`;
  - `worker/database/services/LiveStoreService.ts` (use the extracted `isUniqueViolation`);
  - `worker/database/test-support/real-d1.ts`.
- Test: `worker/database/services/billing.sql.test.ts`.

**Interfaces:**
- **Consumes:** `PLAN_IDS`, `PAID_PLAN_IDS`, `PlanId`, `PaidPlanId`, `PlanLimitOverrides` (Task 1).
- **Produces:**
  - `shared/types/billing.ts`:
    - status lists: `SUBSCRIPTION_STATUSES` and `SubscriptionStatus`; `LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due']`; `BILLING_EVENT_RESULTS = ['applied', 'ignored', 'refused']` and `BillingEventResult`;
    - notice kinds: `BILLING_NOTICE_KINDS = ['plan_started', 'receipt', 'plan_upgraded', 'downgrade_scheduled', 'payment_failed', 'plan_ending', 'plan_ended', 'credits_renewed', 'credits_20', 'credits_5', 'credits_receipt', 'credits_refunded', 'enforcement_notice']` and `BillingNoticeKind`;
    - `CREDIT_USE_SOURCES = ['think', 'infer']`;
    - paths and codes: `BILLING_PATH = '/settings/billing'`; `CHECKOUT_KIND_CREDITS = 'credits'`; `PLAN_LIMIT_ERROR_CODE = 'PLAN_LIMIT'`;
    - copy: `renewalDisclosure(plan: PaidPlanId): string`, `EXTRA_CREDITS_DISCLOSURE`.
    - Task 8 adds the view types.
  - Schema tables, each with its `$inferSelect` type:
    - `billingCustomers`;
    - `subscriptions` (`SubscriptionRecord`);
    - `billingEvents`, `billingNotices`;
    - `planOverrides` (`PlanOverrideRecord`);
    - `creditGrants` (`CreditGrantRecord`);
    - `accountStoreCounts`;
    - `creditPeriods` (`CreditPeriodRecord`), `creditUses`, `creditPurchases` (`CreditPurchaseRecord`).
  - `BillingService`:
    - customers: `customerOf(userId)`, `userOfCustomer(stripeCustomerId)`, `saveCustomer(userId, stripeCustomerId, now): Promise<string>`;
    - subscriptions: `subscriptionOf(userId): Promise<SubscriptionRecord | null>`, `subscriptionsToRepair(nowMs)`;
    - events: `eventSeen(eventId)`, `recordEvent(input: BillingEventInput): Promise<void>` (it throws when any key in the batch already exists);
    - notices: `sentNoticeKeys(userId, keys): Promise<Set<string>>`, `claimNotice(userId, key, kind, now): Promise<boolean>`;
    - stores: `reserveStore(userId: string, cap: number | null, now: Date): Promise<{ reserved: boolean; started: number }>`.
  - `PlanAdminService`: `latestOverride(userId)`, `addOverride(input: PlanOverrideInput)`.
  - Test helpers:
    - `insertUser(db, id, options?: { createdAt?: Date; emailVerified?: boolean })`, extended;
    - `insertSubscription(db, row)`;
    - `insertBillingCustomer(db, userId, stripeCustomerId)`;
    - `insertPurchase(db, row)`.

- [ ] **Step 1: Write the failing test** `worker/database/services/billing.sql.test.ts`:

```ts
/** The billing tables on real SQL: customers kept once, events written all-or-nothing, notices claimed once, Basic's store places reserved atomically. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertSubscription, insertUser, migratedD1 } from '../test-support/real-d1';
import { BillingService } from './BillingService';
import { PlanAdminService } from './PlanAdminService';
import type { SubscriptionRecord } from '../schema';

const migrationSql = import.meta.glob<string>('/migrations/*_billing.sql', { query: '?raw', import: 'default', eager: true });

let db: D1Database;
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_pay', 'u_two', 'u_admin', 'u_due', 'u_fresh', 'u_ending', 'u_stores', 'u_old']) await insertUser(db, id);
});

function row(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: 'u_two',
		stripeSubscriptionId: 'sub_two',
		status: 'active',
		plan: 'pro',
		currentPeriodStart: at('2026-10-01T00:00:00Z'),
		currentPeriodEnd: at('2026-11-01T00:00:00Z'),
		cancelAtPeriodEnd: false,
		pendingPlan: null,
		pendingPlanAt: null,
		stripeScheduleId: null,
		stripeCreatedAt: at('2026-10-01T00:00:00Z'),
		updatedAt: at('2026-10-01T00:00:05Z'),
		...overrides,
	};
}

describe('billing customers and events', () => {
	it('keeps the first Stripe customer an account gets, and finds the account from it', async () => {
		const billing = new BillingService(envWith(db));
		expect(await billing.saveCustomer('u_pay', 'cus_first', at('2026-10-19T00:00:00Z'))).toBe('cus_first');
		expect(await billing.saveCustomer('u_pay', 'cus_second', at('2026-10-19T00:01:00Z'))).toBe('cus_first');
		expect(await billing.userOfCustomer('cus_first')).toBe('u_pay');
		expect(await billing.userOfCustomer('cus_second')).toBeNull();
	});

	it('writes an event with its row and notices together, and refuses the same event twice', async () => {
		const billing = new BillingService(envWith(db));
		const input = { event: { id: 'evt_a', type: 'customer.subscription.created', objectId: 'sub_two', userId: 'u_two', result: 'applied' as const }, row: row(), notices: [{ key: 'plan_started:sub_two', kind: 'plan_started' as const }], now: at('2026-10-01T00:00:05Z') };
		await billing.recordEvent(input);
		expect(await billing.eventSeen('evt_a')).toBe(true);
		expect(await billing.subscriptionOf('u_two')).toMatchObject({ stripeSubscriptionId: 'sub_two', status: 'active', plan: 'pro' });
		expect(await billing.sentNoticeKeys('u_two', ['plan_started:sub_two', 'receipt:in_1'])).toEqual(new Set(['plan_started:sub_two']));
		await expect(billing.recordEvent(input)).rejects.toThrow();
	});

	it('writes nothing when a notice is already recorded, so the event can be retried', async () => {
		const billing = new BillingService(envWith(db));
		const notices = [{ key: 'plan_started:sub_two', kind: 'plan_started' as const }];
		await billing.recordEvent({ event: { id: 'evt_a2', type: 'customer.subscription.created', objectId: 'sub_two', userId: 'u_two', result: 'applied' }, row: row(), notices, now: at('2026-10-01T00:00:05Z') });
		await expect(billing.recordEvent({ event: { id: 'evt_b', type: 'customer.subscription.updated', objectId: 'sub_two', userId: 'u_two', result: 'applied' }, row: row({ plan: 'premium' }), notices, now: at('2026-10-02T00:00:00Z') })).rejects.toThrow();
		expect(await billing.eventSeen('evt_b')).toBe(false);
		expect((await billing.subscriptionOf('u_two'))?.plan).toBe('pro');
	});

	it('records an extra-credit purchase with its event, once per Checkout session', async () => {
		const billing = new BillingService(envWith(db));
		const purchase = { id: 'cp_1', userId: 'u_pay', credits: 5_000, amountCents: 750, stripeCheckoutSessionId: 'cs_credits_1', stripePaymentIntentId: 'pi_credits_1', purchasedAt: at('2026-10-19T00:00:00Z'), expiresAt: at('2027-10-19T00:00:00Z') };
		await billing.recordEvent({ event: { id: 'evt_c1', type: 'checkout.session.completed', objectId: 'cs_credits_1', userId: 'u_pay', result: 'applied' }, purchase, now: at('2026-10-19T00:00:00Z') });
		expect(await db.prepare("SELECT credits, used, refunded_cents FROM credit_purchases WHERE id = 'cp_1'").first()).toEqual({ credits: 5_000, used: 0, refunded_cents: 0 });
		await expect(billing.recordEvent({ event: { id: 'evt_c2', type: 'checkout.session.completed', objectId: 'cs_credits_1', userId: 'u_pay', result: 'applied' }, purchase: { ...purchase, id: 'cp_2' }, now: at('2026-10-19T00:00:00Z') })).rejects.toThrow();
	});

	it('claims a notice once', async () => {
		const billing = new BillingService(envWith(db));
		expect(await billing.claimNotice('u_two', 'credits_20:acct:1790812800', 'credits_20', at('2026-10-10T00:00:00Z'))).toBe(true);
		expect(await billing.claimNotice('u_two', 'credits_20:acct:1790812800', 'credits_20', at('2026-10-11T00:00:00Z'))).toBe(false);
	});

	it('lists subscriptions to re-read: past due for over a day, or set to end and past their end', async () => {
		await insertSubscription(db, { userId: 'u_due', stripeSubscriptionId: 'sub_due', status: 'past_due', currentPeriodStart: at('2026-10-10T00:00:00Z'), currentPeriodEnd: at('2026-11-10T00:00:00Z') });
		await insertSubscription(db, { userId: 'u_fresh', stripeSubscriptionId: 'sub_fresh', status: 'past_due', currentPeriodStart: at('2026-10-11T12:00:00Z'), currentPeriodEnd: at('2026-11-11T12:00:00Z') });
		await insertSubscription(db, { userId: 'u_ending', stripeSubscriptionId: 'sub_ending', status: 'active', cancelAtPeriodEnd: true, currentPeriodStart: at('2026-09-11T00:00:00Z'), currentPeriodEnd: at('2026-10-11T00:00:00Z') });
		const due = await new BillingService(envWith(db)).subscriptionsToRepair(Date.parse('2026-10-11T18:00:00Z'));
		expect(due.map((entry) => entry.stripeSubscriptionId).sort()).toEqual(['sub_due', 'sub_ending']);
	});
});

describe("Basic's lifetime stores", () => {
	it('reserves a place only under the cap, even when several starts race, and always counts without a cap', async () => {
		const billing = new BillingService(envWith(db));
		const now = at('2026-10-19T00:00:00Z');
		const results = await Promise.all([1, 2, 3, 4, 5].map(() => billing.reserveStore('u_stores', 3, now)));
		expect(results.filter((result) => result.reserved)).toHaveLength(3);
		expect(await billing.reserveStore('u_stores', 3, now)).toEqual({ reserved: false, started: 3 });
		expect(await billing.reserveStore('u_stores', null, now)).toEqual({ reserved: true, started: 4 });
	});

	it("backfills the counter from each account's stores when the migration runs", async () => {
		const backfill = Object.values(migrationSql)[0]?.split('--> statement-breakpoint').map((part) => part.trim()).find((part) => part.startsWith('INSERT INTO `account_store_counts`'));
		expect(backfill).toBeDefined();
		for (const id of ['app_old_1', 'app_old_2']) await insertApp(db, { id, userId: 'u_old' });
		await db.prepare("DELETE FROM account_store_counts WHERE user_id = 'u_old'").run();
		await db.prepare(backfill ?? '').run();
		expect(await db.prepare("SELECT stores_started FROM account_store_counts WHERE user_id = 'u_old'").first()).toEqual({ stores_started: 2 });
	});
});

describe('plan overrides', () => {
	it('reads the latest override, and writes each one with an audit entry naming the admin', async () => {
		const admin = new PlanAdminService(envWith(db));
		await admin.addOverride({ userId: 'u_pay', plan: 'enterprise', limits: { aiCredits: 500_000 }, until: null, adminUserId: 'u_admin', reason: 'Signed Enterprise contract', now: at('2026-10-19T00:00:00Z') });
		await admin.addOverride({ userId: 'u_pay', plan: null, limits: {}, until: null, adminUserId: 'u_admin', reason: 'Contract ended', now: at('2026-10-20T00:00:00Z') });
		expect(await admin.latestOverride('u_pay')).toMatchObject({ plan: null, reason: 'Contract ended' });
		const audits = await db.prepare("SELECT user_id, entity_type, action FROM audit_logs WHERE entity_id = 'u_pay' ORDER BY created_at").all();
		expect(audits.results).toEqual([
			{ user_id: 'u_admin', entity_type: 'billing_plan', action: 'plan_override' },
			{ user_id: 'u_admin', entity_type: 'billing_plan', action: 'plan_override' },
		]);
	});
});
```

The backfill test runs the backfill on `u_old`, whose two apps the test inserts; the other accounts' counts come from the backfill too, which the test doesn't read.

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy bun run test -- worker/database/services/billing.sql.test.ts`
Expected: FAIL, "Failed to resolve import ./BillingService".

- [ ] **Step 3: `shared/types/billing.ts`.** The constants and types from Interfaces, and:

```ts
/** Shown above the pay button of a subscription checkout; the Terms say the same. */
export function renewalDisclosure(plan: PaidPlanId): string {
	return `${planName(plan)} renews every month at ${formatUsd(PLAN_PRICES_CENTS[plan])} until you cancel. Cancel any time in Estori; it ends at the end of the period.`;
}

/** Shown above the pay button of an extra-credits checkout. */
export const EXTRA_CREDITS_DISCLOSURE = 'Extra credits are used after your monthly credits and expire 12 months after purchase.';
```

- [ ] **Step 4: The tables in `worker/database/schema.ts`,** after `shopperEmails`. Timestamps use `mode: 'timestamp'`. Enums come from `shared/types/billing` and `shared/types/plans`.

| Table | Columns | Keys and indexes |
| --- | --- | --- |
| `billing_customers` | `user_id` → users (cascade), `stripe_customer_id`, `created_at` | PK `user_id`; `stripe_customer_id` unique |
| `subscriptions` | `user_id` → users (cascade), `stripe_subscription_id`, `status` (enum), `plan` (`pro`/`premium`), `current_period_start`, `current_period_end`, `cancel_at_period_end` (bool, default false), `pending_plan` (nullable enum), `pending_plan_at`, `stripe_schedule_id`, `stripe_created_at`, `updated_at` | PK `user_id`; `stripe_subscription_id` unique; index `status` |
| `billing_events` | `stripe_event_id`, `type`, `object_id`, `user_id`, `result` (enum), `received_at` | PK `stripe_event_id` |
| `billing_notices` | `user_id` → users (cascade), `notice_key`, `kind` (enum), `sent_at` | PK (`user_id`, `notice_key`) |
| `plan_overrides` | `id`, `user_id` → users (cascade), `plan` (nullable enum; null ends the override), `limits` (JSON text, default `'{}'`), `until`, `admin_user_id`, `reason`, `created_at` | PK `id`; index (`user_id`, `created_at`) |
| `credit_grants` | `id`, `user_id` → users (cascade), `credits`, `period_key`, `admin_user_id`, `reason`, `created_at` | PK `id`; index (`user_id`, `period_key`) |
| `account_store_counts` | `user_id` → users (cascade), `stores_started` (default 0), `updated_at` | PK `user_id` |
| `credit_periods` | `user_id` → users (cascade), `period_key`, `period_start`, `period_end`, `pool`, `granted` (default 0), `used` (default 0), `settled` (default 0), `forgiven` (default 0), `closed_at` | PK (`user_id`, `period_key`); index (`closed_at`, `period_end`) |
| `credit_uses` | `use_key`, `user_id`, `period_key`, `credits`, `source` (enum), `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` (nullable), `created_at` | PK `use_key`; index (`user_id`, `created_at`) |
| `credit_purchases` | `id`, `user_id` → users (cascade), `credits`, `amount_cents`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `purchased_at`, `expires_at`, `used` (default 0), `refunded_cents` (default 0), `removed_credits` (default 0), `expired_at` | PK `id`; `stripe_checkout_session_id` unique; indexes `stripe_payment_intent_id`, (`user_id`, `purchased_at`), (`expired_at`, `expires_at`) |

Give each table a one-line comment saying what a row is. For `credit_periods`, also say that `used` counts every charged credit and `settled` the overrun already taken from purchases.

- [ ] **Step 5: Generate the migration and add the backfill**

Run: `bun run db:generate -- --name billing`
Expected: a new `migrations/00NN_billing.sql` creating the ten tables and their indexes, with its snapshot and journal entry. It must alter no existing table.

Append to the generated SQL:

```sql
--> statement-breakpoint
INSERT INTO `account_store_counts` (`user_id`, `stores_started`, `updated_at`) SELECT `user_id`, COUNT(*), unixepoch() FROM `apps` WHERE `user_id` IS NOT NULL GROUP BY `user_id` ON CONFLICT (`user_id`) DO UPDATE SET `stores_started` = excluded.`stores_started`;
```

- [ ] **Step 6: Implement the services.**

**Unique violations:** move `isUniqueViolation` from `LiveStoreService.ts` into `unique-violation.ts`, exported, and import it back.

**`BillingService extends BaseService`:**
- **`saveCustomer`:** inserts with `onConflictDoNothing()`, then reads back the kept id. It throws if none was stored.
- **`recordEvent(input)`** builds one `this.database.batch([eventInsert, ...rest])`. Type `rest` as `BatchItem<'sqlite'>[]` from `drizzle-orm/batch`. The batch holds:
  - the `billing_events` insert;
  - `row`, when set: a `subscriptions` upsert on `userId` setting every other column;
  - `purchase`, when set: a plain `credit_purchases` insert;
  - `refund`, when set: `UPDATE credit_purchases SET refunded_cents = :cents, removed_credits = :removed WHERE id = :id AND refunded_cents < :cents`;
  - one plain `billing_notices` insert per notice, for the event's user.
  - It doesn't catch: a duplicate key anywhere rolls the batch back and throws, and the caller decides.

```ts
export interface BillingEventInput {
	event: { id: string; type: string; objectId: string | null; userId: string | null; result: BillingEventResult };
	row?: SubscriptionRecord | null;
	purchase?: typeof schema.creditPurchases.$inferInsert | null;
	refund?: { purchaseId: string; refundedCents: number; removedCredits: number } | null;
	notices?: ReadonlyArray<{ key: string; kind: BillingNoticeKind }>;
	now: Date;
}
```

**Notices and repair:**
- **`claimNotice`:** inserts with `onConflictDoNothing().returning({ key: billingNotices.noticeKey })`. It's true when a row came back.
- **`sentNoticeKeys`:** returns an empty set for no keys. Otherwise it selects with `inArray`.
- **`subscriptionsToRepair(nowMs)`** selects:
  - `status = 'past_due'` with `current_period_start <= now - 1 day`;
  - or `cancel_at_period_end = 1` with `current_period_end <= now` and a live status.

**`reserveStore(userId, cap, now)`** is one batch:
1. `INSERT INTO account_store_counts (user_id, stores_started, updated_at) VALUES (?, 0, ?) ON CONFLICT DO NOTHING`;
2. `UPDATE account_store_counts SET stores_started = stores_started + 1, updated_at = ? WHERE user_id = ? AND (? IS NULL OR stores_started < ?) RETURNING stores_started`;
3. `SELECT stores_started FROM account_store_counts WHERE user_id = ?`.

It answers `{ reserved: the UPDATE returned a row, started: the SELECT's value }`.

**`PlanAdminService.addOverride`** batches two rows:
- the override, with `id: generateId()` and `limits: JSON.stringify(input.limits)`;
- an `audit_logs` row with `{ id: generateId(), userId: adminUserId, entityType: 'billing_plan', entityId: input.userId, action: 'plan_override', newValues: { plan, limits, until, reason }, createdAt: now }`.

`latestOverride` orders by `createdAt` descending, limit 1. Export both services from `worker/database/index.ts`.

**Test helpers** in `real-d1.ts`:
- `insertUser` gains `options?: { createdAt?: Date; emailVerified?: boolean }`, written as seconds and 0/1;
- `insertSubscription(db, { userId, stripeSubscriptionId, status, plan?, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd? })` writes seconds, `plan ?? 'pro'`, and `stripe_created_at = updated_at = currentPeriodStart`;
- `insertBillingCustomer(db, userId, stripeCustomerId)`;
- `insertPurchase(db, { id, userId, credits, amountCents?, purchasedAt, expiresAt, used?, sessionId?, paymentIntentId? })`, with `amountCents` defaulting to `credits / 1000 * 150`.

- [ ] **Step 7: Run the tests**

Run: `rtk proxy bun run test -- worker/database/services/billing.sql.test.ts worker/database/services/live-stores.sql.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add shared/types/billing.ts worker/database/schema.ts worker/database/index.ts worker/database/services/BillingService.ts worker/database/services/PlanAdminService.ts worker/database/services/unique-violation.ts worker/database/services/LiveStoreService.ts worker/database/services/billing.sql.test.ts worker/database/test-support/real-d1.ts migrations/
git commit -m "feat(billing): tables for customers, subscriptions, events, notices, overrides, store counts and the credit ledger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The credit ledger

**Files:**
- Create:
  - `worker/services/billing/credit-ledger.ts` (pure);
  - `worker/database/services/CreditLedgerService.ts`.
- Modify `worker/database/index.ts`.
- Test:
  - `worker/services/billing/credit-ledger.test.ts`;
  - `worker/database/services/credit-ledger.sql.test.ts`.

**Why D1 and not a Durable Object.** The ledger must be exact to the credit, take each step once however often it's retried, hold purchases for a year, and survive restarts.
- `DORateLimitStore` rewrites its whole bucket map on every increment, has no per-step key, and drops buckets after its window.
- A new SQLite Durable Object would need a class migration in every Wrangler config, `wrangler.jsonc` included, which this branch can't commit.
- D1 already holds billing's other tables, and a batch is one transaction.

**How it stays exact:**
- a step's credits are added only if its key isn't in `credit_uses`, in the same batch that inserts the key;
- settling compares and sets every row it changes, from one consistent read;
- refunds and expiries settle first, so a purchase pays for what was used before it went.

**Interfaces:**
- **Consumes:** the tables from Task 3; `StepUsage` (Task 2).
- **Produces:**
  - `credit-ledger.ts`:
    - `LedgerPeriod { key: string; startMs: number; endMs: number }`;
    - `PeriodState { key: string; startMs: number; endMs: number; pool: number; granted: number; used: number; settled: number; closed: boolean }`;
    - `PurchaseState { id: string; credits: number; used: number; removed: number; purchasedAtMs: number; expiresAtMs: number }`;
    - `purchaseLeft(purchase: PurchaseState): number`, `unsettledOverrun(period: PeriodState): number`;
    - `CreditBalance { pool: number; granted: number; used: number; poolLeft: number; purchasedLeft: number; left: number; available: number }`;
    - `creditBalance(input: { current: PeriodState; open: readonly PeriodState[]; purchases: readonly PurchaseState[] }): CreditBalance`;
    - `Settlement { periods: Array<{ key: string; settledBefore: number; settledAfter: number; close: boolean; forgiven: number }>; purchases: Array<{ id: string; usedBefore: number; usedAfter: number }> }`;
    - `planSettlement(input: { periods: readonly PeriodState[]; purchases: readonly PurchaseState[]; nowMs: number }): Settlement`;
    - `CreditAlert = 'credits_20' | 'credits_5'`, `creditAlertDue(balance: CreditBalance): CreditAlert | null`;
    - `alertsMayBeDue(period: PeriodState): boolean`;
    - `creditAlertKey(alert: CreditAlert, periodKey: string): string`.
  - `CreditLedgerService extends BaseService`:
    - `RecordUseInput { userId: string; period: LedgerPeriod; pool: number; useKey: string; credits: number; source: 'think' | 'infer'; model: string; usage: StepUsage | null; now: Date }`;
    - `recordUse(input): Promise<PeriodState>`;
    - `readBalance(userId, period: LedgerPeriod, pool: number): Promise<CreditBalance>`;
    - `settle(userId: string, nowMs: number): Promise<'settled' | 'nothing' | 'raced'>`;
    - `addGrant(input: { userId; period: LedgerPeriod; pool: number; credits: number; adminUserId: string; reason: string; now: Date }): Promise<void>`;
    - `grantsOf(userId, periodKey): Promise<CreditGrantRecord[]>`;
    - `purchasesOf(userId): Promise<CreditPurchaseRecord[]>` (not expired, oldest first);
    - `purchaseByPaymentIntent(paymentIntentId): Promise<CreditPurchaseRecord | null>`;
    - `usersToSettle(nowMs: number, limit: number): Promise<string[]>`;
    - `expirePurchases(userId: string, nowMs: number): Promise<number>`;
    - `pruneUses(beforeMs: number): Promise<void>`.

- [ ] **Step 1: Write the failing pure test** `worker/services/billing/credit-ledger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { alertsMayBeDue, creditAlertDue, creditBalance, planSettlement, type PeriodState, type PurchaseState } from './credit-ledger';

const DAY = 86_400_000;

function period(overrides: Partial<PeriodState> = {}): PeriodState {
	return { key: 'acct:1', startMs: 0, endMs: 30 * DAY, pool: 5_000, granted: 1_000, used: 0, settled: 0, closed: false, ...overrides };
}

function purchase(id: string, credits: number, purchasedAtMs: number, overrides: Partial<PurchaseState> = {}): PurchaseState {
	return { id, credits, used: 0, removed: 0, purchasedAtMs, expiresAtMs: purchasedAtMs + 365 * DAY, ...overrides };
}

describe('creditBalance', () => {
	it('spends the pool and grants first, then purchases', () => {
		expect(creditBalance({ current: period({ used: 2_000 }), open: [], purchases: [purchase('a', 5_000, 1)] })).toEqual({ pool: 5_000, granted: 1_000, used: 2_000, poolLeft: 4_000, purchasedLeft: 5_000, left: 9_000, available: 11_000 });
		expect(creditBalance({ current: period({ used: 8_000 }), open: [], purchases: [purchase('a', 5_000, 1)] })).toMatchObject({ poolLeft: 0, purchasedLeft: 3_000, left: 3_000 });
	});

	it('counts an older unclosed overrun against purchases, and never goes below nothing left', () => {
		const older = period({ key: 'acct:0', used: 9_000, settled: 1_000 });
		expect(creditBalance({ current: period({ key: 'acct:1', used: 1_000 }), open: [older], purchases: [purchase('a', 5_000, 1, { used: 1_000 })] })).toMatchObject({ poolLeft: 5_000, purchasedLeft: 2_000, left: 7_000 });
		expect(creditBalance({ current: period({ used: 20_000 }), open: [], purchases: [purchase('a', 5_000, 1)] })).toMatchObject({ purchasedLeft: -9_000, left: 0 });
	});

	it("leaves out a refund's removed credits", () => {
		expect(creditBalance({ current: period(), open: [], purchases: [purchase('a', 5_000, 1, { used: 1_000, removed: 4_000 })] }).purchasedLeft).toBe(0);
	});
});

describe('planSettlement', () => {
	it('takes each overrun from the oldest purchase first, and only what is new', () => {
		const plan = planSettlement({
			periods: [period({ used: 9_000, settled: 1_000 })],
			purchases: [purchase('new', 5_000, 20), purchase('old', 2_000, 10, { used: 1_000 })],
			nowMs: 5 * DAY,
		});
		expect(plan).toEqual({
			periods: [{ key: 'acct:1', settledBefore: 1_000, settledAfter: 3_000, close: false, forgiven: 0 }],
			purchases: [
				{ id: 'old', usedBefore: 1_000, usedAfter: 2_000 },
				{ id: 'new', usedBefore: 0, usedAfter: 1_000 },
			],
		});
		expect(planSettlement({ periods: [period({ used: 9_000, settled: 3_000 })], purchases: [], nowMs: 5 * DAY })).toEqual({ periods: [], purchases: [] });
	});

	it('closes an ended period and forgives what no purchase covers', () => {
		const plan = planSettlement({ periods: [period({ used: 13_000 })], purchases: [purchase('a', 5_000, 1)], nowMs: 31 * DAY });
		expect(plan.periods).toEqual([{ key: 'acct:1', settledBefore: 0, settledAfter: 5_000, close: true, forgiven: 2_000 }]);
		expect(planSettlement({ periods: [period({ used: 100 })], purchases: [], nowMs: 31 * DAY }).periods).toEqual([{ key: 'acct:1', settledBefore: 0, settledAfter: 0, close: true, forgiven: 0 }]);
	});
});

describe('credit alerts', () => {
	it('fall due at 20% and 5% of everything available this period, the deeper one first', () => {
		const at = (used: number) => creditAlertDue(creditBalance({ current: period({ pool: 10_000, granted: 0, used }), open: [], purchases: [] }));
		expect(at(7_999)).toBeNull();
		expect(at(8_000)).toBe('credits_20');
		expect(at(9_500)).toBe('credits_5');
		expect(at(10_000)).toBe('credits_5');
		expect(alertsMayBeDue(period({ pool: 10_000, granted: 0, used: 7_000 }))).toBe(false);
		expect(alertsMayBeDue(period({ pool: 10_000, granted: 0, used: 8_000 }))).toBe(true);
	});
});
```

- [ ] **Step 2: Write the failing real-D1 test** `worker/database/services/credit-ledger.sql.test.ts`:

```ts
/** The credit ledger on real SQL: each step charged once, concurrent steps all counted, overruns settled once, expiries and closes in order. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertPurchase, insertUser, migratedD1 } from '../test-support/real-d1';
import { CreditLedgerService, type RecordUseInput } from './CreditLedgerService';

let db: D1Database;
const DAY = 86_400_000;
const START = Date.parse('2026-10-05T00:00:00Z');
const PERIOD = { key: `acct:${START / 1000}`, startMs: START, endMs: START + 31 * DAY };

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_once', 'u_race', 'u_buy', 'u_settle', 'u_expire', 'u_close', 'u_late']) await insertUser(db, id);
});

function use(userId: string, useKey: string, credits: number, overrides: Partial<RecordUseInput> = {}): RecordUseInput {
	return { userId, period: PERIOD, pool: 5_000, useKey, credits, source: 'think', model: 'anthropic/claude-sonnet-5-5', usage: { inputTokens: 40_000, outputTokens: 3_000 }, now: new Date(START + DAY), ...overrides };
}

async function purchaseUsed(id: string): Promise<unknown> {
	return (await db.prepare('SELECT used FROM credit_purchases WHERE id = ?').bind(id).first())?.used;
}

describe('the credit ledger', () => {
	it('charges a step once however often it is recorded', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await ledger.recordUse(use('u_once', 'agent:turn:1', 165));
		const again = await ledger.recordUse(use('u_once', 'agent:turn:1', 165));
		expect(again.used).toBe(165);
		expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_uses WHERE user_id = 'u_once'").first()).toEqual({ n: 1 });
	});

	it('counts every step when two stores build at once', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await Promise.all(Array.from({ length: 10 }, (_, index) => ledger.recordUse(use('u_race', `store-${index % 2}:turn:${index}`, 100))));
		expect((await ledger.readBalance('u_race', PERIOD, 5_000)).used).toBe(1_000);
	});

	it('spends the pool and grants first, then purchases, and reads it back exactly', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await ledger.addGrant({ userId: 'u_buy', period: PERIOD, pool: 5_000, credits: 1_000, adminUserId: 'u_once', reason: 'Partner', now: new Date(START) });
		await insertPurchase(db, { id: 'cp_buy_old', userId: 'u_buy', credits: 5_000, purchasedAt: new Date(START - 10 * DAY), expiresAt: new Date(START + 355 * DAY) });
		await ledger.recordUse(use('u_buy', 'k1', 8_000));
		expect(await ledger.readBalance('u_buy', PERIOD, 5_000)).toEqual({ pool: 5_000, granted: 1_000, used: 8_000, poolLeft: 0, purchasedLeft: 3_000, left: 3_000, available: 11_000 });
	});

	it('settles an overrun once, oldest purchase first, even when two runs race', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await insertPurchase(db, { id: 'cp_s_new', userId: 'u_settle', credits: 5_000, purchasedAt: new Date(START - DAY), expiresAt: new Date(START + 364 * DAY) });
		await insertPurchase(db, { id: 'cp_s_old', userId: 'u_settle', credits: 2_000, purchasedAt: new Date(START - 5 * DAY), expiresAt: new Date(START + 360 * DAY) });
		await ledger.recordUse(use('u_settle', 'k1', 8_000));
		const results = await Promise.all([ledger.settle('u_settle', START + 2 * DAY), ledger.settle('u_settle', START + 2 * DAY)]);
		// The second run either lost the race or came after; either way it took nothing.
		expect(results.filter((result) => result === 'settled')).toHaveLength(1);
		expect([await purchaseUsed('cp_s_old'), await purchaseUsed('cp_s_new')]).toEqual([2_000, 1_000]);
		expect(await ledger.settle('u_settle', START + 2 * DAY)).toBe('nothing');
		expect((await ledger.readBalance('u_settle', PERIOD, 5_000)).purchasedLeft).toBe(4_000);
	});

	it('takes usage from a purchase before it expires, then drops what is left of it', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await insertPurchase(db, { id: 'cp_e_old', userId: 'u_expire', credits: 5_000, purchasedAt: new Date(START - 360 * DAY), expiresAt: new Date(START + 5 * DAY) });
		await insertPurchase(db, { id: 'cp_e_new', userId: 'u_expire', credits: 5_000, purchasedAt: new Date(START - DAY), expiresAt: new Date(START + 364 * DAY) });
		await ledger.recordUse(use('u_expire', 'k1', 8_000));
		expect(await ledger.usersToSettle(START + 6 * DAY, 100)).toContain('u_expire');
		await ledger.settle('u_expire', START + 6 * DAY);
		expect(await ledger.expirePurchases('u_expire', START + 6 * DAY)).toBe(1);
		expect([await purchaseUsed('cp_e_old'), await purchaseUsed('cp_e_new')]).toEqual([3_000, 0]);
		expect((await ledger.readBalance('u_expire', PERIOD, 5_000)).purchasedLeft).toBe(5_000);
	});

	it('closes an ended period, forgiving what no purchase covers, so the next period starts clean', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await insertPurchase(db, { id: 'cp_c', userId: 'u_close', credits: 5_000, purchasedAt: new Date(START - DAY), expiresAt: new Date(START + 364 * DAY) });
		await ledger.recordUse(use('u_close', 'k1', 12_000));
		await ledger.settle('u_close', PERIOD.endMs + 1);
		expect(await db.prepare("SELECT settled, forgiven, closed_at IS NOT NULL AS closed FROM credit_periods WHERE user_id = 'u_close'").first()).toEqual({ settled: 5_000, forgiven: 2_000, closed: 1 });
		const next = { key: `acct:${PERIOD.endMs / 1000}`, startMs: PERIOD.endMs, endMs: PERIOD.endMs + 30 * DAY };
		expect(await ledger.readBalance('u_close', next, 5_000)).toMatchObject({ used: 0, poolLeft: 5_000, purchasedLeft: 0, left: 5_000 });
	});

	it('logs a step that arrives after its period closed without charging it', async () => {
		const ledger = new CreditLedgerService(envWith(db));
		await ledger.recordUse(use('u_late', 'k1', 100));
		await ledger.settle('u_late', PERIOD.endMs + 1);
		expect((await ledger.recordUse(use('u_late', 'k2', 100))).used).toBe(100);
		expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_uses WHERE user_id = 'u_late'").first()).toEqual({ n: 2 });
	});
});
```

In the race test, the second run either reads before the first writes, and its guarded batch changes nothing (`'raced'`), or reads after and finds nothing to take (`'nothing'`). Either way the purchases are charged once.

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/credit-ledger.test.ts worker/database/services/credit-ledger.sql.test.ts`
Expected: FAIL, failed imports.

- [ ] **Step 4: Implement `credit-ledger.ts`**

```ts
/** The credit ledger's arithmetic, pure: what's left, what an overrun takes from purchases, and when alerts fall due. */

export function purchaseLeft(purchase: PurchaseState): number {
	return Math.max(0, purchase.credits - purchase.used - purchase.removed);
}

/** Credits used past the pool and grants that no purchase has paid for yet. */
export function unsettledOverrun(period: PeriodState): number {
	return Math.max(0, Math.max(0, period.used - period.pool - period.granted) - period.settled);
}

export function creditBalance(input: { current: PeriodState; open: readonly PeriodState[]; purchases: readonly PurchaseState[] }): CreditBalance {
	const { current } = input;
	const poolLeft = Math.max(0, current.pool + current.granted - current.used);
	const owed = [current, ...input.open].reduce((sum, period) => sum + unsettledOverrun(period), 0);
	const purchasedLeft = input.purchases.reduce((sum, purchase) => sum + purchaseLeft(purchase), 0) - owed;
	const left = poolLeft + Math.max(0, purchasedLeft);
	return { pool: current.pool, granted: current.granted, used: current.used, poolLeft, purchasedLeft, left, available: current.used + left };
}

export function planSettlement(input: { periods: readonly PeriodState[]; purchases: readonly PurchaseState[]; nowMs: number }): Settlement {
	const lots = [...input.purchases].sort((a, b) => a.purchasedAtMs - b.purchasedAtMs || a.id.localeCompare(b.id)).map((lot) => ({ lot, used: lot.used }));
	const periods: Settlement['periods'] = [];
	for (const period of [...input.periods].sort((a, b) => a.startMs - b.startMs)) {
		let want = unsettledOverrun(period);
		let taken = 0;
		for (const entry of lots) {
			if (want === 0) break;
			const take = Math.min(want, purchaseLeft({ ...entry.lot, used: entry.used }));
			entry.used += take;
			taken += take;
			want -= take;
		}
		const close = period.endMs <= input.nowMs;
		if (taken > 0 || close) periods.push({ key: period.key, settledBefore: period.settled, settledAfter: period.settled + taken, close, forgiven: close ? want : 0 });
	}
	const purchases = lots.filter((entry) => entry.used !== entry.lot.used).map((entry) => ({ id: entry.lot.id, usedBefore: entry.lot.used, usedAfter: entry.used }));
	return { periods, purchases };
}
```

**Alerts:**
- `creditAlertDue` answers null when `available <= 0`, `'credits_5'` when `left * 100 <= 5 * available`, `'credits_20'` when `left * 100 <= 20 * available`, else null.
- `alertsMayBeDue(period)` is true when `pool + granted <= 0` or `(pool + granted - used) * 100 <= 20 * (pool + granted)`. Credits left over credits available can't be lower than the pool's own share, so a pool above 20% needs no purchase read.
- `creditAlertKey(alert, periodKey)` is `${alert}:${periodKey}`.

- [ ] **Step 5: Implement `CreditLedgerService`.**

**`recordUse(input)`** is one batch:
1. `INSERT INTO credit_periods (user_id, period_key, period_start, period_end, pool) VALUES (…) ON CONFLICT DO NOTHING`;
2. `UPDATE credit_periods SET used = used + :credits, pool = :pool WHERE user_id = :user AND period_key = :key AND closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM credit_uses WHERE use_key = :useKey)`, written with drizzle's `update` and a ``sql`NOT EXISTS (…)` `` condition;
3. `INSERT INTO credit_uses (…) VALUES (…) ON CONFLICT (use_key) DO NOTHING`, carrying the token counts from `usage`;
4. `SELECT` the period row.

It answers the row as a `PeriodState`.

**`readBalance(userId, period, pool)`:**
- one batch reads the period row, the user's other unclosed rows, and their purchases with `expired_at IS NULL`;
- answers `creditBalance` with `current` being the row, or `{ …period, pool, granted: 0, used: 0, settled: 0, closed: false }`, and the passed `pool` either way.

**`settle(userId, nowMs)`:**
1. One batch reads the unclosed periods and the valid purchases.
2. `planSettlement`. An empty plan answers `'nothing'`.
3. One batch writes the plan with compare-and-set guards:
   - each purchase: `UPDATE credit_purchases SET used = :after WHERE id = :id AND used = :before`;
   - each period: `UPDATE credit_periods SET settled = :after, forgiven = forgiven + :forgiven, closed_at = :closedAt WHERE user_id = ? AND period_key = ? AND settled = :before AND closed_at IS NULL`, where `closedAt` is now when `close`, else unchanged.
4. Answer `'settled'` when every statement changed one row (`meta.changes`), `'raced'` when none did.

A mix can't happen: both reads saw one snapshot, so either the other run wrote first and every guard fails, or it didn't and every guard holds. Log an error if it ever does.

**Grants, purchases and housekeeping:**
- **`addGrant`** is one batch:
  - the `credit_grants` row (`period_key` = `period.key`);
  - the period row insert-if-missing;
  - `UPDATE credit_periods SET granted = granted + :credits`;
  - an `audit_logs` row `{ entityType: 'credit_grant', entityId: userId, action: 'credit_grant', userId: adminUserId, newValues: { credits, periodKey, reason } }`.
- **`usersToSettle(nowMs, limit)`:** distinct user ids with a period `closed_at IS NULL AND period_end <= now`, or a purchase `expired_at IS NULL AND expires_at <= now`.
- **`expirePurchases(userId, nowMs)`:** sets `expired_at = now` on the user's purchases with `expires_at <= now AND expired_at IS NULL`, and answers the count.
- **`pruneUses(beforeMs)`:** deletes `credit_uses` older than that.
- **`purchasesOf`, `purchaseByPaymentIntent` and `grantsOf`** are plain selects.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/credit-ledger.test.ts worker/database/services/credit-ledger.sql.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add worker/services/billing/credit-ledger.ts worker/services/billing/credit-ledger.test.ts worker/database/services/CreditLedgerService.ts worker/database/services/credit-ledger.sql.test.ts worker/database/index.ts
git commit -m "feat(billing): a d1 credit ledger that charges each step once and settles overruns against purchases exactly

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The account's plan, its period, and the flag

**Files:**
- Create:
  - `worker/services/billing/flag.ts`;
  - `worker/services/billing/periods.ts`;
  - `worker/services/billing/account.ts`.
- Modify:
  - `worker/types/env.d.ts`;
  - `shared/types/billing.ts` (`BillingSource`).
- Test:
  - `worker/services/billing/periods.test.ts`;
  - `worker/services/billing/account.test.ts`;
  - `worker/services/billing/account.sql.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 1: `limitsFor`, `PlanAccount`, `planLimitOverridesFrom`, `GRACE_PERIOD_DAYS`, `isPaidPlanId`;
  - from Task 3: `BillingService.subscriptionOf`, `PlanAdminService.latestOverride`, `SubscriptionRecord`, `PlanOverrideRecord`;
  - from Task 4: `CreditLedgerService.readBalance`, `LedgerPeriod`, `CreditBalance`;
  - existing: `UserService.findUser`.
- **Produces:**
  - `isBillingOn(env: { BILLING?: string; BILLING_USER_IDS?: string }, userId: string | null): boolean`;
  - `BillingSource = 'free' | 'subscription' | 'override'`;
  - `periods.ts`:
    - `DAY_MS`;
    - `anniversaryPeriod(signupMs: number | null, nowMs: number): { startMs: number; endMs: number }`;
    - `accountPeriod(signupMs: number | null, nowMs: number): LedgerPeriod` (key `acct:{startSeconds}`);
    - `subscriptionPeriod(subscription: Pick<SubscriptionRecord, 'stripeSubscriptionId' | 'currentPeriodStart' | 'currentPeriodEnd'>): LedgerPeriod` (key `sub:{id}:{startSeconds}`).
  - `account.ts`:
    - `graceEndsAt(subscription): number | null`;
    - `ResolvedPlan { plan: PlanId; source: BillingSource; period: LedgerPeriod; graceEndsAtMs: number | null; overrideLimits: PlanLimitOverrides | null }`;
    - `resolvePlan(input: { subscription: SubscriptionRecord | null; override: PlanOverrideRecord | null; signupMs: number | null; nowMs: number }): ResolvedPlan`;
    - `BillingAccount extends PlanAccount { userId: string; source: BillingSource; period: LedgerPeriod; graceEndsAtMs: number | null; subscription: SubscriptionRecord | null }`;
    - `loadAccount(env: Env, userId: string, nowMs?: number): Promise<BillingAccount>`;
    - `loadCredits(env: Env, account: BillingAccount): Promise<CreditBalance>`.
  - Env: `BILLING?`, `BILLING_USER_IDS?`, `STRIPE_PRICE_IDS?`.

- [ ] **Step 1: Write the failing tests.** `worker/services/billing/periods.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { accountPeriod, anniversaryPeriod, subscriptionPeriod } from './periods';

const utc = (iso: string) => Date.parse(iso);

describe('periods', () => {
	it("renews Basic monthly from the sign-up date, clamping the day to a short month's last day", () => {
		const signup = utc('2026-01-31T10:00:00Z');
		expect(anniversaryPeriod(signup, utc('2026-02-15T00:00:00Z'))).toEqual({ startMs: utc('2026-01-31T00:00:00Z'), endMs: utc('2026-02-28T00:00:00Z') });
		expect(anniversaryPeriod(signup, utc('2026-02-28T12:00:00Z'))).toEqual({ startMs: utc('2026-02-28T00:00:00Z'), endMs: utc('2026-03-31T00:00:00Z') });
		expect(anniversaryPeriod(signup, utc('2026-04-01T00:00:00Z'))).toEqual({ startMs: utc('2026-03-31T00:00:00Z'), endMs: utc('2026-04-30T00:00:00Z') });
		expect(anniversaryPeriod(utc('2028-01-29T00:00:00Z'), utc('2028-03-01T00:00:00Z'))).toEqual({ startMs: utc('2028-02-29T00:00:00Z'), endMs: utc('2028-03-29T00:00:00Z') });
		expect(anniversaryPeriod(utc('2026-03-15T08:00:00Z'), utc('2026-03-20T00:00:00Z'))).toEqual({ startMs: utc('2026-03-15T00:00:00Z'), endMs: utc('2026-04-15T00:00:00Z') });
	});

	it('renews on the 1st without a readable sign-up date', () => {
		expect(anniversaryPeriod(null, utc('2026-10-19T15:00:00Z'))).toEqual({ startMs: utc('2026-10-01T00:00:00Z'), endMs: utc('2026-11-01T00:00:00Z') });
		expect(anniversaryPeriod(Number.NaN, utc('2026-10-19T15:00:00Z')).startMs).toBe(utc('2026-10-01T00:00:00Z'));
	});

	it('keys a Basic month and a Stripe period apart, even when they start on the same second', () => {
		const start = utc('2026-10-05T00:00:00Z');
		expect(accountPeriod(start, start + 1).key).toBe(`acct:${start / 1000}`);
		expect(subscriptionPeriod({ stripeSubscriptionId: 'sub_1', currentPeriodStart: new Date(start), currentPeriodEnd: new Date(utc('2026-11-05T00:00:00Z')) })).toEqual({ key: `sub:sub_1:${start / 1000}`, startMs: start, endMs: utc('2026-11-05T00:00:00Z') });
	});
});
```

`worker/services/billing/account.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { graceEndsAt, resolvePlan } from './account';
import { isBillingOn } from './flag';
import type { PlanOverrideRecord, SubscriptionRecord } from '../../database/schema';

const NOW = Date.parse('2026-10-19T15:00:00Z');
const SIGNUP = Date.parse('2026-03-12T09:00:00Z');

function sub(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: 'u1',
		stripeSubscriptionId: 'sub_1',
		status: 'active',
		plan: 'pro',
		currentPeriodStart: new Date('2026-10-05T10:00:00Z'),
		currentPeriodEnd: new Date('2026-11-05T10:00:00Z'),
		cancelAtPeriodEnd: false,
		pendingPlan: null,
		pendingPlanAt: null,
		stripeScheduleId: null,
		stripeCreatedAt: new Date('2026-09-05T10:00:00Z'),
		updatedAt: new Date('2026-10-05T10:00:00Z'),
		...overrides,
	};
}

function override(overrides: Partial<PlanOverrideRecord> = {}): PlanOverrideRecord {
	return { id: 'po_1', userId: 'u1', plan: 'enterprise', limits: '{"aiCredits":500000}', until: null, adminUserId: 'u_admin', reason: 'Contract', createdAt: new Date('2026-10-01T00:00:00Z'), ...overrides };
}

const SUB_PERIOD = { key: `sub:sub_1:${Date.parse('2026-10-05T10:00:00Z') / 1000}`, startMs: Date.parse('2026-10-05T10:00:00Z'), endMs: Date.parse('2026-11-05T10:00:00Z') };
const BASIC_PERIOD = { key: `acct:${Date.parse('2026-10-12T00:00:00Z') / 1000}`, startMs: Date.parse('2026-10-12T00:00:00Z'), endMs: Date.parse('2026-11-12T00:00:00Z') };

describe('resolvePlan', () => {
	it('is Basic on its sign-up month without a subscription', () => {
		expect(resolvePlan({ subscription: null, override: null, signupMs: SIGNUP, nowMs: NOW })).toEqual({ plan: 'basic', source: 'free', period: BASIC_PERIOD, graceEndsAtMs: null, overrideLimits: null });
	});

	it("is the subscription's plan over the Stripe period while active or trialing", () => {
		for (const status of ['active', 'trialing'] as const) {
			expect(resolvePlan({ subscription: sub({ status, plan: 'premium' }), override: null, signupMs: SIGNUP, nowMs: NOW })).toMatchObject({ plan: 'premium', source: 'subscription', period: SUB_PERIOD });
		}
	});

	it('keeps the plan for 7 days of a failed renewal, then Basic on its sign-up month', () => {
		const pastDue = sub({ status: 'past_due', currentPeriodStart: new Date('2026-10-12T15:00:00Z') });
		expect(graceEndsAt(pastDue)).toBe(Date.parse('2026-10-19T15:00:00Z'));
		expect(resolvePlan({ subscription: pastDue, override: null, signupMs: SIGNUP, nowMs: NOW - 1 })).toMatchObject({ plan: 'pro', graceEndsAtMs: NOW });
		expect(resolvePlan({ subscription: pastDue, override: null, signupMs: SIGNUP, nowMs: NOW })).toMatchObject({ plan: 'basic', source: 'free', period: BASIC_PERIOD });
		for (const status of ['unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'] as const) {
			expect(resolvePlan({ subscription: sub({ status }), override: null, signupMs: SIGNUP, nowMs: NOW }).plan).toBe('basic');
		}
	});

	it('lets an admin override win until it ends or is cleared, on the Stripe period when there is one', () => {
		expect(resolvePlan({ subscription: sub(), override: override(), signupMs: SIGNUP, nowMs: NOW })).toMatchObject({ plan: 'enterprise', source: 'override', overrideLimits: { aiCredits: 500_000 }, period: SUB_PERIOD });
		expect(resolvePlan({ subscription: null, override: override({ plan: 'premium' }), signupMs: SIGNUP, nowMs: NOW })).toMatchObject({ plan: 'premium', period: BASIC_PERIOD });
		expect(resolvePlan({ subscription: sub(), override: override({ until: new Date(NOW - 1) }), signupMs: SIGNUP, nowMs: NOW }).source).toBe('subscription');
		expect(resolvePlan({ subscription: null, override: override({ plan: null }), signupMs: SIGNUP, nowMs: NOW }).plan).toBe('basic');
	});
});

describe('the billing flag', () => {
	it('is on for everyone with BILLING=on, or only for the listed accounts', () => {
		expect(isBillingOn({ BILLING: 'on' }, null)).toBe(true);
		expect(isBillingOn({ BILLING: ' ON ' }, 'u1')).toBe(true);
		expect(isBillingOn({ BILLING: 'off', BILLING_USER_IDS: 'u1, u2 ,,' }, 'u2')).toBe(true);
		expect(isBillingOn({ BILLING_USER_IDS: 'u1,u2' }, 'u3')).toBe(false);
		expect(isBillingOn({ BILLING_USER_IDS: 'u1' }, null)).toBe(false);
		expect(isBillingOn({ BILLING_USER_IDS: '' }, '')).toBe(false);
		expect(isBillingOn({}, 'u1')).toBe(false);
	});
});
```

`worker/services/billing/account.sql.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertSubscription, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { loadAccount, loadCredits } from './account';

const NOW = Date.parse('2026-10-19T15:00:00Z');
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'u_sub', { createdAt: new Date('2026-03-12T09:00:00Z') });
	await insertUser(db, 'u_basic', { createdAt: new Date('2026-03-12T09:00:00Z') });
	await insertSubscription(db, { userId: 'u_sub', stripeSubscriptionId: 'sub_1', status: 'active', plan: 'premium', currentPeriodStart: new Date('2026-10-05T10:00:00Z'), currentPeriodEnd: new Date('2026-11-05T10:00:00Z') });
});

describe('loadAccount', () => {
	it("resolves a subscriber's plan, limits and Stripe period", async () => {
		const account = await loadAccount(envWith(db, { BILLING: 'on' }), 'u_sub', NOW);
		expect(account).toMatchObject({ billing: true, plan: 'premium', source: 'subscription', creditsResetAt: Date.parse('2026-11-05T10:00:00Z'), limits: { aiCredits: 100_000, liveStores: 10, extraCredits: true } });
		expect(account.period.key).toBe(`sub:sub_1:${Date.parse('2026-10-05T10:00:00Z') / 1000}`);
	});

	it("gives Basic its month from the sign-up date and reads its credits from the ledger", async () => {
		const env = envWith(db, { BILLING: 'on' });
		const account = await loadAccount(env, 'u_basic', NOW);
		expect(account).toMatchObject({ plan: 'basic', limits: { aiCredits: 5_000, storesLifetime: 3 }, period: { startMs: Date.parse('2026-10-12T00:00:00Z'), endMs: Date.parse('2026-11-12T00:00:00Z') } });
		await new CreditLedgerService(env).recordUse({ userId: 'u_basic', period: account.period, pool: 5_000, useKey: 'k1', credits: 1_200, source: 'think', model: 'm', usage: null, now: new Date(NOW) });
		expect(await loadCredits(env, account)).toMatchObject({ used: 1_200, left: 3_800 });
	});

	it("treats everyone as today's Basic while billing is off, without reading the billing tables, and honors the user list", async () => {
		expect(await loadAccount(envWith(db), 'u_sub', NOW)).toMatchObject({ billing: false, plan: 'basic', source: 'free', subscription: null, limits: { liveStores: null, supplierCatalog: true } });
		expect((await loadAccount(envWith(db, { BILLING_USER_IDS: 'someone-else, u_sub' }), 'u_sub', NOW)).plan).toBe('premium');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/periods.test.ts worker/services/billing/account.test.ts worker/services/billing/account.sql.test.ts`
Expected: FAIL, failed imports.

- [ ] **Step 3: Declare the environment.** In `worker/types/env.d.ts`, after `STRIPE_CONNECT_WEBHOOK_SECRET`:

```ts
		// "on" turns plans, billing and plan limits on for everyone.
		BILLING?: string;
		// Comma-separated user ids that get billing while BILLING isn't "on": the owner-only phase.
		BILLING_USER_IDS?: string;
		// JSON {"pro":"price_...","premium":"price_...","credits":"price_..."}, in the Stripe key's mode.
		STRIPE_PRICE_IDS?: string;
```

- [ ] **Step 4: Implement `flag.ts` and `periods.ts`.**

**`isBillingOn`:**
- `BILLING`, trimmed and lowercased, equals `'on'`;
- or `BILLING_USER_IDS` lists the user: it's split on commas, trimmed, with empty entries dropped;
- a null or empty user id is never listed.

**`anniversaryPeriod(signupMs, nowMs)`:**
- `day` is the sign-up's UTC day of the month, or 1 when `signupMs` is null or not finite;
- a month's start is `Date.UTC(year, month, Math.min(day, daysIn(year, month)))`;
- the period is the latest start at or before now, ending at the next month's start.

```ts
const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

export function anniversaryPeriod(signupMs: number | null, nowMs: number): { startMs: number; endMs: number } {
	const day = signupMs !== null && Number.isFinite(signupMs) ? new Date(signupMs).getUTCDate() : 1;
	const startOf = (year: number, month: number): number => Date.UTC(year, month, Math.min(day, daysIn(year, month)));
	const now = new Date(nowMs);
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth();
	const thisMonth = startOf(year, month);
	return thisMonth <= nowMs ? { startMs: thisMonth, endMs: startOf(year, month + 1) } : { startMs: startOf(year, month - 1), endMs: thisMonth };
}
```

`Date.UTC` rolls month -1 and 12 into the neighbouring years, and `daysIn` gets the same rolled month.

**Keys:** `accountPeriod` and `subscriptionPeriod` add the keys from Interfaces.

- [ ] **Step 5: Implement `account.ts`.**

**`graceEndsAt(subscription)`:** `currentPeriodStart + GRACE_PERIOD_DAYS` days when `past_due`, else null.

**A subscription pays for its plan** when `isPaidPlanId(plan)` and the status is `active` or `trialing`, or `past_due` before its grace ends.

**An override is active** when its plan isn't null and `until` is null or later than now. Its limits come from `planLimitOverridesFrom(JSON.parse(limits))`, with a JSON error reading as null.

**`resolvePlan`:**
- **With an active override:** the override's plan, `source: 'override'`, and the paying subscription's period, or else the anniversary period.
- **Else with a paying subscription:** its plan, `source: 'subscription'`, its period and its grace end.
- **Else:** Basic, `source: 'free'`, the anniversary period.

**`loadAccount(env, userId, nowMs = Date.now())`:**
1. **Billing off** (`!isBillingOn(env, userId)`): answer Basic with `limitsFor({ billing: false, … })`, `source: 'free'` and `subscription: null`, without reading any billing table. The period is `accountPeriod(null, nowMs)`; it's unused.
2. **Billing on:** read `new BillingService(env).subscriptionOf(userId)`, `new PlanAdminService(env).latestOverride(userId)` and `new UserService(env).findUser({ id: userId })` together. The sign-up time is `user.createdAt?.getTime() ?? null`.
3. `resolvePlan`, then `limitsFor({ billing: true, plan, adminLimits: overrideLimits })`.
4. Answer `{ billing, userId, plan, limits, creditsResetAt: period.endMs, source, period, graceEndsAtMs, subscription }`.

**`loadCredits(env, account)`:** `new CreditLedgerService(env).readBalance(account.userId, account.period, account.limits.aiCredits)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/periods.test.ts worker/services/billing/account.test.ts worker/services/billing/account.sql.test.ts`
Expected: PASS (11 tests).

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add worker/services/billing/flag.ts worker/services/billing/periods.ts worker/services/billing/periods.test.ts worker/services/billing/account.ts worker/services/billing/account.test.ts worker/services/billing/account.sql.test.ts worker/types/env.d.ts shared/types/billing.ts
git commit -m "feat(billing): resolve an account's plan and period from its subscription, grace and overrides, behind the billing flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Stripe billing calls and the setup script

**Files:**
- Create:
  - `worker/services/billing/prices.ts`;
  - `scripts/stripe-billing-setup.ts`.
- Modify `worker/services/payments/stripe-client.ts`.
- Test:
  - `worker/services/payments/stripe-billing-client.test.ts`;
  - `worker/services/billing/prices.test.ts`;
  - `scripts/stripe-billing-setup.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 1: `PaidPlanId`, `isPaidPlanId`, `PLAN_PRICES_CENTS`, `EXTRA_CREDITS`;
  - from Task 3: `renewalDisclosure`, `EXTRA_CREDITS_DISCLOSURE`, `CHECKOUT_KIND_CREDITS`, `SubscriptionStatus`;
  - existing: `encodeForm`, `STRIPE_API_VERSION`, `StripeApiError`.
- **Produces**, in `stripe-client.ts`:
  - exported constant: `IDEMPOTENCY_BUCKET_MS` (now exported, value unchanged);
  - types:
    - `StripeCustomer { id; email: string | null; metadata: Record<string, string> | null }`;
    - `StripePrice { id; metadata?: Record<string, string> | null; unit_amount?: number | null; lookup_key?: string | null }`;
    - `StripeSubscriptionItem { id; price: StripePrice; current_period_start: number; current_period_end: number }`;
    - `StripeDiscountRef { coupon: string | null; discount: string | null; promotion_code: string | null }`;
    - `StripeSchedulePhase { start_date: number; end_date: number | null; items: Array<{ price: string | StripePrice; quantity?: number }>; discounts?: StripeDiscountRef[] }`;
    - `StripeSubscriptionSchedule { id; status: string; subscription: string | null; released_subscription?: string | null; current_phase: { start_date: number; end_date: number } | null; phases: StripeSchedulePhase[] }`;
    - `StripeSubscription { id; customer: string; status: SubscriptionStatus; created: number; cancel_at_period_end: boolean; cancel_at: number | null; metadata: Record<string, string> | null; items: { data: StripeSubscriptionItem[] }; schedule: string | StripeSubscriptionSchedule | null }`;
    - `StripeInvoice { id; customer: string | null; amount_paid: number; currency: string; hosted_invoice_url: string | null; number: string | null; billing_reason: string | null; attempt_count?: number; parent: { type: string; subscription_details?: { subscription: string } | null } | null }`;
    - `StripeCharge { id; payment_intent: string | null; amount: number; amount_refunded: number }`;
  - `StripeCheckoutSession` gains `mode?: 'payment' | 'subscription' | 'setup'`, `subscription?: string | null` and `customer?: string | null`;
  - new `StripeClient` methods:
    - `createCustomer(input: { userId: string; email: string }): Promise<StripeCustomer>`;
    - `createSubscriptionCheckoutSession(input: { customerId; priceId; userId; plan: PaidPlanId; successUrl; cancelUrl; nowMs }): Promise<StripeCheckoutSession>`;
    - `createCreditsCheckoutSession(input: { customerId; priceId; userId; credits: number; successUrl; cancelUrl; nowMs }): Promise<StripeCheckoutSession>`;
    - `retrieveSubscription(subscriptionId: string): Promise<StripeSubscription>` (the schedule expanded);
    - `changeSubscriptionPrice(input: { subscription: StripeSubscription; priceId: string; idempotencyKey: string }): Promise<StripeSubscription>`;
    - `scheduleSubscriptionPrice(input: { subscription: StripeSubscription; priceId: string; idempotencyKey: string }): Promise<StripeSubscriptionSchedule>`;
    - `releaseSubscriptionSchedule(scheduleId: string): Promise<void>`;
    - `cancelAtPeriodEnd(subscriptionId: string, idempotencyKey: string): Promise<StripeSubscription>`;
    - `resumeSubscription(subscription: StripeSubscription, idempotencyKey: string): Promise<StripeSubscription>`;
    - `createBillingPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>`.
  - `prices.ts`:
    - `StripePriceIds { pro: string; premium: string; credits: string }`;
    - `stripePriceIds(value: string | undefined): StripePriceIds | null`;
    - `planOfPrice(price: Pick<StripePrice, 'id' | 'metadata'>, ids: StripePriceIds | null): PaidPlanId | null`.
  - `scripts/stripe-billing-setup.ts`:
    - `BILLING_PRODUCTS` (ids `estori_pro`, `estori_premium`, `estori_credits`);
    - `BILLING_LOOKUP_KEYS = { pro: 'estori_pro_monthly', premium: 'estori_premium_monthly', credits: 'estori_credits_1000' }`;
    - `setUpBilling(input: { secretKey: string; mode: 'test' | 'live'; fetchImpl: typeof fetch }): Promise<{ mode: 'test' | 'live'; priceIds: StripePriceIds; portalProblems: string[] }>`.

- [ ] **Step 1: Write the failing client test** `worker/services/payments/stripe-billing-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createStripeClient, type StripeSubscription } from './stripe-client';

/** A fetch that answers every call with `body` (or `status`) and remembers what it was sent. */
function recordingFetch(body: unknown, status = 200) {
	const calls: Array<{ url: string; method: string; params: string[]; key: string | null }> = [];
	const fakeFetch: typeof fetch = async (input, init) => {
		const headers = new Headers(init?.headers);
		calls.push({ url: String(input), method: init?.method ?? 'GET', params: decodeURIComponent(String(init?.body ?? '')).split('&').filter(Boolean), key: headers.get('Idempotency-Key') });
		return new Response(JSON.stringify(body), { status });
	};
	return { calls, client: createStripeClient('sk_test_fake', fakeFetch) };
}

const NOW = 1_800_000_000_000;
const BUCKET = Math.floor(NOW / 600_000);

const SUBSCRIPTION: StripeSubscription = {
	id: 'sub_1',
	customer: 'cus_1',
	status: 'active',
	created: 1,
	cancel_at_period_end: false,
	cancel_at: null,
	metadata: { estori_user_id: 'u1' },
	items: { data: [{ id: 'si_1', price: { id: 'price_premium', metadata: { estori_plan: 'premium' } }, current_period_start: 100, current_period_end: 200 }] },
	schedule: null,
};

const SCHEDULE = {
	id: 'sub_sched_1',
	status: 'active',
	subscription: 'sub_1',
	current_phase: { start_date: 100, end_date: 200 },
	phases: [{ start_date: 100, end_date: 200, items: [{ price: 'price_premium', quantity: 1 }], discounts: [{ coupon: null, discount: 'di_1', promotion_code: 'promo_1' }] }],
};

describe('Stripe billing calls', () => {
	it('creates one customer per account, carrying the account id', async () => {
		const { calls, client } = recordingFetch({ id: 'cus_1', email: 'ana@example.test', metadata: { estori_user_id: 'u1' } });
		await client.createCustomer({ userId: 'u1', email: 'ana@example.test' });
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/customers', method: 'POST', key: 'billing-customer-u1' });
		expect(calls[0].params).toEqual(['email=ana@example.test', 'metadata[estori_user_id]=u1']);
	});

	it("opens a card-only subscription checkout for the plan's price, with codes, the terms agreement and the renewal disclosure", async () => {
		const { calls, client } = recordingFetch({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
		await client.createSubscriptionCheckoutSession({ customerId: 'cus_1', priceId: 'price_premium', userId: 'u1', plan: 'premium', successUrl: 'https://estori.app/settings/billing?checkout=success', cancelUrl: 'https://estori.app/settings/billing?checkout=cancelled', nowMs: NOW });
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/checkout/sessions', key: `billing-checkout-u1-premium-${BUCKET}` });
		expect(calls[0].params).toEqual(
			expect.arrayContaining([
				'mode=subscription',
				'customer=cus_1',
				'client_reference_id=u1',
				'line_items[0][price]=price_premium',
				'line_items[0][quantity]=1',
				'payment_method_types[0]=card',
				'allow_promotion_codes=true',
				'subscription_data[metadata][estori_user_id]=u1',
				'metadata[estori_user_id]=u1',
				'metadata[plan]=premium',
				'consent_collection[terms_of_service]=required',
				'custom_text[submit][message]=Premium renews every month at $199 until you cancel. Cancel any time in Estori; it ends at the end of the period.',
				'success_url=https://estori.app/settings/billing?checkout=success',
			]),
		);
	});

	it('opens a one-time checkout for extra credits, a line per 1,000 credits, tagged on the session and the payment', async () => {
		const { calls, client } = recordingFetch({ id: 'cs_c', url: 'https://checkout.stripe.com/c/cs_c' });
		await client.createCreditsCheckoutSession({ customerId: 'cus_1', priceId: 'price_credits', userId: 'u1', credits: 12_000, successUrl: 'https://estori.app/settings/billing?credits=success', cancelUrl: 'https://estori.app/settings/billing', nowMs: NOW });
		expect(calls[0].key).toBe(`billing-credits-u1-12000-${BUCKET}`);
		expect(calls[0].params).toEqual(
			expect.arrayContaining([
				'mode=payment',
				'customer=cus_1',
				'client_reference_id=u1',
				'line_items[0][price]=price_credits',
				'line_items[0][quantity]=12',
				'payment_method_types[0]=card',
				'metadata[kind]=credits',
				'metadata[estori_user_id]=u1',
				'metadata[credits]=12000',
				'payment_intent_data[metadata][kind]=credits',
				'payment_intent_data[metadata][estori_user_id]=u1',
				'custom_text[submit][message]=Extra credits are used after your monthly credits and expire 12 months after purchase.',
			]),
		);
		expect(calls[0].params.some((param) => param.startsWith('allow_promotion_codes'))).toBe(false);
	});

	it('reads a subscription with its schedule', async () => {
		const { calls, client } = recordingFetch(SUBSCRIPTION);
		await client.retrieveSubscription('sub_1');
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscriptions/sub_1?expand%5B0%5D=schedule', method: 'GET' });
	});

	it('moves to Premium now, prorated and charged, and refuses rather than leave an unpaid change', async () => {
		const { calls, client } = recordingFetch(SUBSCRIPTION);
		await client.changeSubscriptionPrice({ subscription: SUBSCRIPTION, priceId: 'price_premium', idempotencyKey: 'billing-plan-u1-premium-1' });
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscriptions/sub_1', key: 'billing-plan-u1-premium-1' });
		expect(calls[0].params).toEqual(['items[0][id]=si_1', 'items[0][price]=price_premium', 'proration_behavior=always_invoice', 'payment_behavior=error_if_incomplete', 'expand[0]=schedule']);
	});

	it('schedules the move to Pro for the renewal, keeping the discount and charging no proration', async () => {
		const { calls, client } = recordingFetch(SCHEDULE);
		await client.scheduleSubscriptionPrice({ subscription: SUBSCRIPTION, priceId: 'price_pro', idempotencyKey: 'billing-plan-u1-pro-1' });
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscription_schedules', key: 'billing-plan-u1-pro-1-create' });
		expect(calls[0].params).toEqual(['from_subscription=sub_1']);
		expect(calls[1]).toMatchObject({ url: 'https://api.stripe.com/v1/subscription_schedules/sub_sched_1', key: 'billing-plan-u1-pro-1-phases' });
		expect(calls[1].params).toEqual([
			'end_behavior=release',
			'proration_behavior=none',
			'phases[0][items][0][price]=price_premium',
			'phases[0][items][0][quantity]=1',
			'phases[0][start_date]=100',
			'phases[0][end_date]=200',
			'phases[0][discounts][0][discount]=di_1',
			'phases[1][items][0][price]=price_pro',
			'phases[1][items][0][quantity]=1',
			'phases[1][duration][interval]=month',
			'phases[1][duration][interval_count]=1',
			'phases[1][proration_behavior]=none',
			'phases[1][discounts][0][discount]=di_1',
		]);
	});

	it('reuses a schedule already on the subscription', async () => {
		const { calls, client } = recordingFetch(SCHEDULE);
		await client.scheduleSubscriptionPrice({ subscription: { ...SUBSCRIPTION, schedule: 'sub_sched_1' }, priceId: 'price_pro', idempotencyKey: 'k' });
		expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET https://api.stripe.com/v1/subscription_schedules/sub_sched_1', 'POST https://api.stripe.com/v1/subscription_schedules/sub_sched_1']);
	});

	it('cancels at the period end, and resumes by clearing whichever end is set', async () => {
		const { calls, client } = recordingFetch(SUBSCRIPTION);
		await client.cancelAtPeriodEnd('sub_1', 'billing-cancel-u1-1');
		await client.resumeSubscription({ ...SUBSCRIPTION, cancel_at_period_end: true }, 'billing-resume-u1-1');
		await client.resumeSubscription({ ...SUBSCRIPTION, cancel_at: 200 }, 'billing-resume-u1-2');
		expect(calls.map((call) => call.params)).toEqual([['cancel_at_period_end=true'], ['cancel_at_period_end=false'], ['cancel_at=']]);
	});

	it("releases a schedule, treats one already released as done, and opens Stripe's portal", async () => {
		const released = recordingFetch(SCHEDULE);
		await released.client.releaseSubscriptionSchedule('sub_sched_1');
		expect(released.calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscription_schedules/sub_sched_1/release', method: 'POST' });
		const gone = recordingFetch({ error: { message: 'already released', type: 'invalid_request_error' } }, 400);
		await expect(gone.client.releaseSubscriptionSchedule('sub_sched_1')).resolves.toBeUndefined();
		const portal = recordingFetch({ url: 'https://billing.stripe.com/p/session/1' });
		expect(await portal.client.createBillingPortalSession({ customerId: 'cus_1', returnUrl: 'https://estori.app/settings/billing' })).toEqual({ url: 'https://billing.stripe.com/p/session/1' });
		expect(portal.calls[0].params).toEqual(['customer=cus_1', 'return_url=https://estori.app/settings/billing']);
	});
});
```

`worker/services/billing/prices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planOfPrice, stripePriceIds } from './prices';

const IDS_JSON = '{"pro":"price_p","premium":"price_m","credits":"price_c"}';

describe('Stripe prices', () => {
	it('reads the three price ids, and nothing from an incomplete or malformed value', () => {
		expect(stripePriceIds(IDS_JSON)).toEqual({ pro: 'price_p', premium: 'price_m', credits: 'price_c' });
		for (const bad of [undefined, '', 'nope', '{"pro":"price_p"}', '{"pro":"price_p","premium":"price_m","credits":"prod_c"}', '[]']) expect(stripePriceIds(bad)).toBeNull();
	});

	it("finds a price's plan from the configured ids, then from its metadata", () => {
		const ids = stripePriceIds(IDS_JSON);
		expect(planOfPrice({ id: 'price_m', metadata: null }, ids)).toBe('premium');
		expect(planOfPrice({ id: 'price_old', metadata: { estori_plan: 'pro' } }, ids)).toBe('pro');
		expect(planOfPrice({ id: 'price_c', metadata: null }, ids)).toBeNull();
		expect(planOfPrice({ id: 'price_x', metadata: { estori_plan: 'gold' } }, ids)).toBeNull();
	});
});
```

- [ ] **Step 2: Write the failing script test** `scripts/stripe-billing-setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BILLING_LOOKUP_KEYS, setUpBilling } from './stripe-billing-setup';

type Route = (body: URLSearchParams) => Response;

function stripe(routes: Record<string, Route>) {
	const seen: string[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		const key = `${init?.method ?? 'GET'} ${url.pathname}`;
		seen.push(key);
		const route = routes[key] ?? routes[`${init?.method ?? 'GET'} ${url.pathname.replace(/\/[^/]+$/, '/:id')}`];
		if (!route) throw new Error(`unexpected ${key}`);
		return route(new URLSearchParams(String(init?.body ?? '')));
	};
	return { fetchImpl, seen };
}

const PORTAL_OK = () => Response.json({ data: [{ id: 'bpc_1', features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end' }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } } }] });

describe('setUpBilling', () => {
	it('creates the three products and their prices, tagged, on a first run', async () => {
		const created: Array<Record<string, string | null>> = [];
		const { fetchImpl } = stripe({
			'GET /v1/products/:id': () => Response.json({ error: { code: 'resource_missing', message: 'No such product' } }, { status: 404 }),
			'POST /v1/products': (body) => Response.json({ id: body.get('id') }),
			'GET /v1/prices': () => Response.json({ data: [] }),
			'POST /v1/prices': (body) => {
				created.push({ lookup: body.get('lookup_key'), amount: body.get('unit_amount'), interval: body.get('recurring[interval]'), plan: body.get('metadata[estori_plan]'), kind: body.get('metadata[estori_kind]'), product: body.get('product') });
				return Response.json({ id: `price_${created.length}` });
			},
			'GET /v1/billing_portal/configurations': PORTAL_OK,
		});
		const result = await setUpBilling({ secretKey: 'sk_test_fake', mode: 'test', fetchImpl });
		expect(result).toEqual({ mode: 'test', priceIds: { pro: 'price_1', premium: 'price_2', credits: 'price_3' }, portalProblems: [] });
		expect(created).toEqual([
			{ lookup: BILLING_LOOKUP_KEYS.pro, amount: '4900', interval: 'month', plan: 'pro', kind: null, product: 'estori_pro' },
			{ lookup: BILLING_LOOKUP_KEYS.premium, amount: '19900', interval: 'month', plan: 'premium', kind: null, product: 'estori_premium' },
			{ lookup: BILLING_LOOKUP_KEYS.credits, amount: '150', interval: null, plan: null, kind: 'credits', product: 'estori_credits' },
		]);
	});

	it('reuses prices that already match, and reports a portal that lets sellers switch plans', async () => {
		const existing = [
			{ id: 'price_old_pro', lookup_key: BILLING_LOOKUP_KEYS.pro, unit_amount: 4_900, active: true },
			{ id: 'price_old_premium', lookup_key: BILLING_LOOKUP_KEYS.premium, unit_amount: 19_900, active: true },
			{ id: 'price_old_credits', lookup_key: BILLING_LOOKUP_KEYS.credits, unit_amount: 150, active: true },
		];
		const { fetchImpl, seen } = stripe({
			'GET /v1/products/:id': () => Response.json({ id: 'estori_pro' }),
			'GET /v1/prices': () => Response.json({ data: existing }),
			'GET /v1/billing_portal/configurations': () => Response.json({ data: [{ id: 'bpc_1', features: { subscription_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'immediately' }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } } }] }),
		});
		const result = await setUpBilling({ secretKey: 'sk_test_fake', mode: 'test', fetchImpl });
		expect(result.priceIds).toEqual({ pro: 'price_old_pro', premium: 'price_old_premium', credits: 'price_old_credits' });
		expect(seen.some((call) => call.startsWith('POST'))).toBe(false);
		expect(result.portalProblems).toEqual(['Turn off plan switching in the customer portal.', 'Set cancellations to happen at the end of the billing period.']);
	});

	it("refuses a key whose mode isn't the one asked for", async () => {
		const { fetchImpl } = stripe({});
		await expect(setUpBilling({ secretKey: 'sk_live_fake', mode: 'test', fetchImpl })).rejects.toThrow('The key is a live key, but --mode test was asked for.');
		await expect(setUpBilling({ secretKey: 'rk_test_fake', mode: 'live', fetchImpl })).rejects.toThrow('The key is a test key, but --mode live was asked for.');
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/payments/stripe-billing-client.test.ts worker/services/billing/prices.test.ts scripts/stripe-billing-setup.test.ts`
Expected: FAIL, "client.createCustomer is not a function" and failed imports.

- [ ] **Step 4: Add the client methods.** Add the types first, and export `IDEMPOTENCY_BUCKET_MS`. The tests pin each method's parameters and their key order; build the objects in that order.

- **`createCustomer`:** key `billing-customer-{userId}`. An empty email is left out.
- **`createSubscriptionCheckoutSession`:**
  - key `billing-checkout-{userId}-{plan}-{bucket}`;
  - `mode`, `customer`, `client_reference_id`, `line_items: [{ price, quantity: 1 }]`, `payment_method_types: ['card']`, `allow_promotion_codes: true`;
  - `subscription_data: { metadata: { estori_user_id } }`, `metadata: { estori_user_id, plan }`;
  - `consent_collection: { terms_of_service: 'required' }`, `custom_text: { submit: { message: renewalDisclosure(plan) } }`;
  - the URLs, and `expires_at` = now plus `CHECKOUT_SESSION_TTL_SECONDS`;
  - card only, because renewals and Smart Retries charge the card on file and bank methods would settle days later.
- **`createCreditsCheckoutSession`:**
  - key `billing-credits-{userId}-{credits}-{bucket}`;
  - `mode: 'payment'`, `customer`, `client_reference_id`, `line_items: [{ price, quantity: credits / EXTRA_CREDITS.creditsPerUnit }]`, `payment_method_types: ['card']`;
  - the same `metadata` on the session and on `payment_intent_data`: `{ kind: CHECKOUT_KIND_CREDITS, estori_user_id, credits: String(credits) }`;
  - `custom_text.submit.message = EXTRA_CREDITS_DISCLOSURE`, the URLs and `expires_at`;
  - no promotion codes.
- **`retrieveSubscription`:** `GET /subscriptions/{id}?{encodeForm({ expand: ['schedule'] })}`.
- **`changeSubscriptionPrice`:**
  - `items: [{ id: firstItem.id, price }]`, `proration_behavior: 'always_invoice'`, `payment_behavior: 'error_if_incomplete'`, `expand: ['schedule']`;
  - throws `Error('Subscription {id} has no items')` without an item.
- **`scheduleSubscriptionPrice`:**
  1. Use the attached schedule (a string id, or the expanded object's id) through `GET /subscription_schedules/{id}`. Without one, `POST /subscription_schedules { from_subscription }` with key `{key}-create`.
  2. Then `POST /subscription_schedules/{id}` with key `{key}-phases`. The body:
     - `end_behavior: 'release'` and `proration_behavior: 'none'`;
     - phase 0: the current price, quantity 1, from `current_phase.start_date` to `current_phase.end_date`;
     - phase 1: the new price, quantity 1, `duration: { interval: 'month', interval_count: 1 }`, `proration_behavior: 'none'`;
     - both carry the current phase's `discounts`, mapped to `{ discount }` when a discount id is present, otherwise `{ coupon }`, and left out when there are none.
  3. The current phase is the one whose `start_date` equals `current_phase.start_date`.
- **`releaseSubscriptionSchedule`:** POSTs `/subscription_schedules/{id}/release`. A `StripeApiError` with status 400 counts as done, as `expireCheckoutSession` does.
- **`cancelAtPeriodEnd`:** `{ cancel_at_period_end: true }`.
- **`resumeSubscription`:** `{ cancel_at: '' }` when `cancel_at !== null && !cancel_at_period_end`, otherwise `{ cancel_at_period_end: false }`.
- **`createBillingPortalSession`:** `{ customer, return_url }`.

- [ ] **Step 5: `prices.ts`.**
- **`stripePriceIds`:** parses a JSON object whose `pro`, `premium` and `credits` are each a string starting `price_`, and answers null otherwise.
- **`planOfPrice`:** matches `ids.pro` and `ids.premium`, then `metadata.estori_plan` through `isPaidPlanId`, else null.

- [ ] **Step 6: `scripts/stripe-billing-setup.ts`.**

```ts
/**
 * Creates Estori's billing products in Stripe: Pro and Premium with a monthly price each, and AI credits with a
 * one-time price per 1,000. Rerunning reuses what exists. Prints the STRIPE_PRICE_IDS value for the environment.
 * Usage: STRIPE_SECRET_KEY=sk_test_... bun scripts/stripe-billing-setup.ts --mode test
 */
```

**The mode check** comes first. Keys starting `sk_test_` or `rk_test_` are test keys; any other is live. A mismatch throws `The key is a {test|live} key, but --mode {mode} was asked for.`

**Requests** send `Authorization: Bearer`, `Stripe-Version: STRIPE_API_VERSION` and `encodeForm` bodies, imported from `worker/services/payments/stripe-client.ts`.

**The products,** in order:
- `estori_pro` "Estori Pro";
- `estori_premium` "Estori Premium";
- `estori_credits` "Estori AI credits".

Each is `GET /v1/products/{id}`, and on 404 `POST /v1/products { id, name }`.

**The prices:**
1. `GET /v1/prices?lookup_keys[0..2]=...&active=true`, then keep an active price with the lookup key and the same `unit_amount`.
2. Otherwise `POST /v1/prices` with `{ product, currency: 'usd', unit_amount, lookup_key, transfer_lookup_key: true }` and:
   - Pro: `recurring: { interval: 'month' }`, `metadata: { estori_plan: 'pro' }`, 4,900;
   - Premium: the same with `premium`, 19,900;
   - credits: no `recurring`, `metadata: { estori_kind: 'credits' }`, `EXTRA_CREDITS.unitPriceCents`, nickname "1,000 AI credits".

**The portal** is read from `GET /v1/billing_portal/configurations?is_default=true`, which reports these problems in order:
- "Turn off plan switching in the customer portal." when `subscription_update.enabled`;
- "Set cancellations to happen at the end of the billing period." when cancel is enabled but `mode !== 'at_period_end'`;
- "Turn on cancelling in the customer portal." when cancel is off;
- "Turn on card updates in the customer portal." when `payment_method_update` is off;
- "Turn on invoice history in the customer portal." when `invoice_history` is off;
- "Create the customer portal's default configuration in the Stripe Dashboard." when there's none.

**`main()`:**
- reads `--mode` and `STRIPE_SECRET_KEY`;
- prints the mode, `STRIPE_PRICE_IDS=<json>`, each portal problem, and "Also set a Terms of Service URL under Settings, Public details: Checkout requires it for the terms agreement.";
- exits 1 on an error;
- runs only when `import.meta.main`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/payments/stripe-billing-client.test.ts worker/services/billing/prices.test.ts scripts/stripe-billing-setup.test.ts worker/services/payments/stripe-client.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add worker/services/payments/stripe-client.ts worker/services/payments/stripe-billing-client.test.ts worker/services/billing/prices.ts worker/services/billing/prices.test.ts scripts/stripe-billing-setup.ts scripts/stripe-billing-setup.test.ts
git commit -m "feat(billing): stripe calls for plan and credit checkouts, plan changes, cancelling and the portal, and the setup script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Billing emails from Estori

**Files:**
- Create:
  - `worker/services/email/billing-templates.ts`;
  - `worker/services/billing/notices.ts`.
- Modify `worker/services/email/templates.ts` (export `renderEmail` and `EmailContent`).
- Test:
  - `worker/services/email/billing-templates.test.ts`;
  - `worker/services/billing/notices.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 1: `PLAN_LIMITS`, `PLAN_PRICES_CENTS`, `planName`, `formatBillingDate`, `formatUsd`, `formatCredits`, `PaidPlanId`, `PlanId`;
  - from Task 3: `BILLING_PATH`, `BillingNoticeKind`;
  - existing: `renderEmail`, `createEmailSender`, `configuredBaseUrl`, `UserService.findUser`, `LEGAL_ENTITY`, `legalAddressLine`, `LEGAL_CONTACT`.
- **Produces:**
  - `notices.ts`:
    - `BillingEmail`, a union discriminated by `kind`, one member per `BillingNoticeKind`:
      - `{ kind: 'plan_started'; plan: PaidPlanId; renewsAt: number }`;
      - `{ kind: 'receipt'; plan: PaidPlanId; amountCents: number; currency: string; periodStart: number; periodEnd: number; invoiceNumber: string | null; invoiceUrl: string | null }`;
      - `{ kind: 'plan_upgraded'; plan: PaidPlanId }`;
      - `{ kind: 'downgrade_scheduled'; plan: PaidPlanId; at: number }`;
      - `{ kind: 'payment_failed'; plan: PaidPlanId; graceEndsAt: number }`;
      - `{ kind: 'plan_ending'; plan: PaidPlanId; endsAt: number }`;
      - `{ kind: 'plan_ended'; plan: PaidPlanId; reason: 'cancelled' | 'payment-failed' }`;
      - `{ kind: 'credits_renewed'; credits: number; renewsAt: number }`;
      - `{ kind: 'credits_20' | 'credits_5'; plan: PlanId; left: number; renewsAt: number }`;
      - `{ kind: 'credits_receipt'; credits: number; amountCents: number; expiresAt: number; receiptNumber: string }`;
      - `{ kind: 'credits_refunded'; credits: number; amountCents: number }`;
      - `{ kind: 'enforcement_notice'; startsOn: number; overLimits: boolean }`.
    - `PlannedNotice { key: string; email: BillingEmail }`;
    - `BillingMailDeps { sender: EmailSender | null; userEmail(userId: string): Promise<string | null>; baseUrl: string | null }`;
    - `billingEmail(to: string, email: BillingEmail, baseUrl: string | null): OutgoingEmail`;
    - `sendBillingEmails(deps, userId, notices: readonly PlannedNotice[]): Promise<number>` (never throws; answers how many were sent);
    - `ClaimingMailDeps = BillingMailDeps & { claim(userId: string, key: string, kind: BillingNoticeKind): Promise<boolean> }`;
    - `claimAndSendNotice(deps: ClaimingMailDeps, userId, notice): Promise<'sent' | 'already-sent' | 'not-sent'>` (never throws);
    - `billingMailFromEnv(env): BillingMailDeps`, `claimingMailFromEnv(env): ClaimingMailDeps`.
  - `billing-templates.ts`: one function per kind, as Step 4's table names them.

- [ ] **Step 1: Write the failing template test** `worker/services/email/billing-templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../../../src/routes/copy-rules';
import { billingEmail, type BillingEmail } from '../billing/notices';

const TO = 'ana@example.test';
const BASE = 'https://estori.app';
const NOV_5 = Date.UTC(2026, 10, 5, 10);

const text = (email: BillingEmail) => billingEmail(TO, email, BASE);

describe('billing emails', () => {
	it('welcomes a new plan with its credits, renewal date and price', () => {
		const started = text({ kind: 'plan_started', plan: 'pro', renewsAt: NOV_5 });
		expect(started.subject).toBe('Welcome to Estori Pro');
		expect(started.text).toContain('Your account now has 20,000 AI credits a month, up to 3 live stores, your own domains and the supplier catalog. Pro renews on November 5 at $49 a month until you cancel.');
		expect(started.text).toContain('Manage billing: https://estori.app/settings/billing');
	});

	it('sends receipts with the amount, the period, the invoice and the seller of record', () => {
		const receipt = text({ kind: 'receipt', plan: 'premium', amountCents: 15_000, currency: 'usd', periodStart: Date.UTC(2026, 9, 5), periodEnd: NOV_5, invoiceNumber: 'EST-0002', invoiceUrl: 'https://invoice.stripe.com/i/in_1' });
		expect(receipt.subject).toBe('Your Estori receipt: $150.00');
		expect(receipt.text).toContain('We received $150.00 for Estori Premium, October 5 to November 5.');
		expect(receipt.text).toContain('View invoice: https://invoice.stripe.com/i/in_1');
		expect(receipt.text).toContain('Sold by Globalink Commerce Technologies LLC');
		const credits = text({ kind: 'credits_receipt', credits: 12_000, amountCents: 1_800, expiresAt: Date.UTC(2027, 9, 19), receiptNumber: 'pi_1' });
		expect(credits.subject).toBe('Your Estori receipt: 12,000 AI credits');
		expect(credits.text).toContain("We received $18.00 for 12,000 extra AI credits. They're used after your monthly credits and expire on October 19, 2027.");
	});

	it('explains each plan change in plain words', () => {
		expect(text({ kind: 'plan_upgraded', plan: 'premium' })).toMatchObject({ subject: "You're on Premium now" });
		expect(text({ kind: 'plan_upgraded', plan: 'premium' }).text).toContain("You now have 100,000 AI credits a month, and the credits you've used this month count against them. We charged the difference for the rest of this month; your receipt follows.");
		expect(text({ kind: 'downgrade_scheduled', plan: 'pro', at: NOV_5 }).text).toContain('On November 5 your plan moves to Pro, with 20,000 AI credits a month at $49. Until then you keep Premium. Extra credits you bought stay yours.');
		expect(text({ kind: 'payment_failed', plan: 'pro', graceEndsAt: NOV_5 })).toMatchObject({ subject: "Your Pro payment didn't go through" });
		expect(text({ kind: 'payment_failed', plan: 'pro', graceEndsAt: NOV_5 }).text).toContain("We couldn't charge your card for Estori Pro. Pro continues until November 5 while we retry. Update your card to keep it.");
		expect(text({ kind: 'plan_ending', plan: 'premium', endsAt: NOV_5 })).toMatchObject({ subject: 'Premium ends on November 5' });
		expect(text({ kind: 'plan_ended', plan: 'premium', reason: 'payment-failed' }).text).toContain("We couldn't collect the payment for Premium, so it has ended. Your live stores and their domains keep working.");
	});

	it('tells every plan its credits renewed, and warns at 20% and 5% left with the next step for the plan', () => {
		expect(text({ kind: 'credits_renewed', credits: 5_000, renewsAt: NOV_5 })).toMatchObject({ subject: 'Your AI credits are renewed' });
		expect(text({ kind: 'credits_renewed', credits: 5_000, renewsAt: NOV_5 }).text).toContain('You have 5,000 AI credits for this month. They last until November 5.');
		expect(text({ kind: 'credits_20', plan: 'basic', left: 1_000, renewsAt: NOV_5 })).toMatchObject({ subject: 'You have 20% of your AI credits left' });
		expect(text({ kind: 'credits_20', plan: 'basic', left: 1_000, renewsAt: NOV_5 }).text).toContain('You have 1,000 AI credits left until November 5. Get Pro for 20,000 a month.');
		expect(text({ kind: 'credits_5', plan: 'premium', left: 5_000, renewsAt: NOV_5 }).text).toContain('You have 5,000 AI credits left until November 5. Buy extra credits any time.');
		expect(text({ kind: 'credits_refunded', credits: 3_000, amountCents: 750 }).text).toContain('We refunded $7.50 for extra AI credits, and removed 3,000 unused credits from your account.');
	});

	it('gives every seller a week of notice of the new plans, and tells those over them that their stores stay live', () => {
		const notice = text({ kind: 'enforcement_notice', startsOn: Date.UTC(2026, 10, 1), overLimits: true });
		expect(notice.subject).toBe('Plans and limits on Estori from November 1');
		expect(notice.text).toContain('From November 1, Basic includes 5,000 AI credits a month, 3 stores and 1 live store, without the supplier catalog.');
		expect(notice.text).toContain('Your stores stay live; to publish more, get Pro or Premium.');
		expect(text({ kind: 'enforcement_notice', startsOn: Date.UTC(2026, 10, 1), overLimits: false }).text).not.toContain('to publish more');
	});

	it('names no supplier and no AI assistant', () => {
		const all: BillingEmail[] = [
			{ kind: 'plan_started', plan: 'premium', renewsAt: NOV_5 },
			{ kind: 'credits_5', plan: 'pro', left: 10, renewsAt: NOV_5 },
			{ kind: 'enforcement_notice', startsOn: NOV_5, overLimits: true },
		];
		for (const email of all.map(text)) {
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(`${email.subject} ${email.text}`.toLowerCase(), name).not.toContain(name);
		}
	});
});
```

- [ ] **Step 2: Write the failing notices test** `worker/services/billing/notices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEmailSender } from '../email/sender';
import type { OutgoingEmail } from '../email/types';
import { claimAndSendNotice, sendBillingEmails, type BillingMailDeps, type PlannedNotice } from './notices';

const STARTED: PlannedNotice = { key: 'plan_started:sub_1', email: { kind: 'plan_started', plan: 'pro', renewsAt: Date.UTC(2026, 10, 5) } };
const ENDING: PlannedNotice = { key: 'plan_ending:sub_1:1793872800', email: { kind: 'plan_ending', plan: 'pro', endsAt: Date.UTC(2026, 10, 5) } };

function mail(overrides: Partial<BillingMailDeps> = {}): { deps: BillingMailDeps; sent: OutgoingEmail[] } {
	const sent: OutgoingEmail[] = [];
	return { sent, deps: { sender: { send: async (email) => void sent.push(email) }, userEmail: async () => 'ana@example.test', baseUrl: 'https://estori.app', ...overrides } };
}

describe('sending billing emails', () => {
	it("sends each planned notice to the account's email", async () => {
		const { deps, sent } = mail();
		expect(await sendBillingEmails(deps, 'u1', [STARTED, ENDING])).toBe(2);
		expect(sent.map((email) => email.subject)).toEqual(['Welcome to Estori Pro', 'Pro ends on November 5']);
	});

	it('sends nothing without a sender or an address, and never throws', async () => {
		expect(await sendBillingEmails(mail({ sender: null }).deps, 'u1', [STARTED])).toBe(0);
		expect(await sendBillingEmails(mail({ userEmail: async () => null }).deps, 'u1', [STARTED])).toBe(0);
		const failing = mail({ sender: { send: async () => { throw new Error('Email Service unavailable'); } } });
		await expect(sendBillingEmails(failing.deps, 'u1', [STARTED, ENDING])).resolves.toBe(0);
	});

	it("marks staging's subjects and sends only to the allowlist there", async () => {
		const delivered: Array<{ to: string; subject: string }> = [];
		const env = { ENVIRONMENT: 'staging', EMAIL_RECIPIENT_ALLOWLIST: '@pluriza.com', EMAIL: { send: async (message: { to: string; subject: string }) => { delivered.push({ to: message.to, subject: message.subject }); return { messageId: 'm1' }; } } } as unknown as Env;
		const sender = createEmailSender(env);
		expect(await sendBillingEmails({ sender, userEmail: async () => 'team@pluriza.com', baseUrl: null }, 'u1', [STARTED])).toBe(1);
		expect(await sendBillingEmails({ sender, userEmail: async () => 'ana@example.test', baseUrl: null }, 'u2', [STARTED])).toBe(0);
		expect(delivered).toEqual([{ to: 'team@pluriza.com', subject: '[Staging] Welcome to Estori Pro' }]);
	});

	it('claims a notice before sending it, so it goes once', async () => {
		const claimed = new Set<string>();
		const { deps, sent } = mail();
		const claiming = {
			...deps,
			claim: async (userId: string, key: string) => {
				if (claimed.has(`${userId}:${key}`)) return false;
				claimed.add(`${userId}:${key}`);
				return true;
			},
		};
		expect(await claimAndSendNotice(claiming, 'u1', ENDING)).toBe('sent');
		expect(await claimAndSendNotice(claiming, 'u1', ENDING)).toBe('already-sent');
		expect(sent).toHaveLength(1);
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/email/billing-templates.test.ts worker/services/billing/notices.test.ts`
Expected: FAIL, failed imports.

- [ ] **Step 4: Implement `billing-templates.ts`.** First export `renderEmail` and `EmailContent` from `templates.ts`, unchanged. Then each template calls `renderEmail`, using:
- `formatBillingDate` for dates; the credits receipt's expiry adds the year ("October 19, 2027");
- `formatCredits` for credits, and `formatUsd` for plan prices;
- `new Intl.NumberFormat('en-US', { style: 'currency', currency })` for amounts paid.

Plan names come from `planName`, and numbers from `PLAN_LIMITS` and `PLAN_PRICES_CENTS`. A null link drops the action. The links are `{base}/settings/billing` ("billing") and `{base}/pricing` ("pricing").

| Function | Subject | Body | Action | Details, footer |
| --- | --- | --- | --- | --- |
| `planStartedEmail` | Welcome to Estori {Plan} | "Your account now has {credits} AI credits a month, up to {live} live stores, your own domains and the supplier catalog. {Plan} renews on {date} at {price} a month until you cancel." Premium adds " When you need more, you can buy extra credits." | Manage billing (billing) | footer "Cancel any time in Estori; {Plan} then runs to the end of the month you paid for." |
| `planReceiptEmail` | Your Estori receipt: {amount} | "We received {amount} for Estori {Plan}, {start} to {end}." | View invoice (`invoiceUrl`) | details Amount, Period, Invoice number when known; footer "Sold by {LEGAL_ENTITY.name}, {legalAddressLine()}. For help, email {LEGAL_CONTACT.support}." |
| `planUpgradedEmail` | You're on Premium now | "You now have 100,000 AI credits a month, and the credits you've used this month count against them. We charged the difference for the rest of this month; your receipt follows." | Manage billing | footer "Your stores stay live whatever plan you're on." |
| `downgradeScheduledEmail` | Your plan moves to Pro at renewal | "On {date} your plan moves to Pro, with 20,000 AI credits a month at $49. Until then you keep Premium. Extra credits you bought stay yours." | Manage billing | same footer |
| `paymentFailedEmail` | Your {Plan} payment didn't go through | "We couldn't charge your card for Estori {Plan}. {Plan} continues until {date} while we retry. Update your card to keep it." | Update your card (billing) | same footer |
| `planEndingEmail` | {Plan} ends on {date} | "You cancelled {Plan}. It stays on until {date}, then your account moves to Basic. Your stores stay live." | Keep {Plan} (billing) | footer "Changed your mind? Keep {Plan} from your billing page before {date}." |
| `planEndedEmail` | Your account is on Basic now | cancelled: "{Plan} has ended. Your live stores and their domains keep working." payment-failed: "We couldn't collect the payment for {Plan}, so it has ended. Your live stores and their domains keep working." Both add " To publish more stores or add catalog products, get Pro or Premium again." | See plans (pricing) | same footer |
| `creditsRenewedEmail` | Your AI credits are renewed | "You have {credits} AI credits for this month. They last until {date}." | See your credits (billing) | footer "We send this when your credits renew." |
| `creditsLowEmail` (20 and 5) | You have {20 or 5}% of your AI credits left | "You have {left} AI credits left until {date}." then by plan: Basic " Get Pro for 20,000 a month."; Pro " Move to Premium for 100,000 a month."; Premium " Buy extra credits any time."; Enterprise " Talk to us if you need more." | See your credits (billing) | footer "We send each of these once a month." |
| `creditsReceiptEmail` | Your Estori receipt: {credits} AI credits | "We received {amount} for {credits} extra AI credits. They're used after your monthly credits and expire on {date with year}." | See your credits (billing) | details Amount, Credits, Expires, Receipt number; footer: the receipt footer above |
| `creditsRefundedEmail` | We refunded your extra credits | "We refunded {amount} for extra AI credits, and removed {credits} unused credits from your account." | See your credits (billing) | footer "Your bank may take 5 to 10 business days to show the refund." |
| `enforcementNoticeEmail` | Plans and limits on Estori from {date} | "From {date}, Basic includes 5,000 AI credits a month, 3 stores and 1 live store, without the supplier catalog. Pro, at $49 a month, adds 20,000 credits, 3 live stores, your own domains and the catalog. Premium, at $199 a month, adds 100,000 credits, 10 live stores and extra credits." Then " Your stores stay live; to publish more, get Pro or Premium." when `overLimits`, else " Your stores stay live." | See plans (pricing) | footer "Building on Estori stays free." |

- [ ] **Step 5: Implement `notices.ts`.**
- **`billingEmail`:** switches on `email.kind` and calls the matching template with the links built from `baseUrl`.
- **`sendBillingEmails`:**
  - returns 0 without a sender;
  - looks the address up once;
  - sends each notice, catching and logging each failure (an allowlist block included) so the rest still go;
  - answers the count sent.
- **`claimAndSendNotice`:**
  - claims first;
  - answers `'already-sent'` when the claim fails;
  - otherwise sends through `sendBillingEmails` and answers `'sent'` or `'not-sent'`;
  - catches and logs everything else.
- **`billingMailFromEnv`:**
  - `sender: createEmailSender(env)`;
  - `userEmail: async (id) => (await new UserService(env).findUser({ id }))?.email ?? null`;
  - `baseUrl: configuredBaseUrl(env)`.
- **`claimingMailFromEnv`:** adds `claim: (userId, key, kind) => new BillingService(env).claimNotice(userId, key, kind, new Date())`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/email/billing-templates.test.ts worker/services/billing/notices.test.ts worker/services/email/templates.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/services/email/templates.ts worker/services/email/billing-templates.ts worker/services/email/billing-templates.test.ts worker/services/billing/notices.ts worker/services/billing/notices.test.ts
git commit -m "feat(billing): estori's own emails for plans, payments, renewed and low credits, and extra-credit receipts and refunds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The billing API

**Files:**
- Create:
  - `worker/services/billing/actions.ts`;
  - `worker/services/billing/view.ts`;
  - `worker/api/controllers/billing/controller.ts`;
  - `worker/api/routes/billingRoutes.ts`.
- Modify:
  - `shared/types/billing.ts` (the view and request types);
  - `worker/api/responses.ts`, `worker/api/controllers/baseController.ts`;
  - `worker/api/routes/index.ts`;
  - `src/api-types.ts`, `src/lib/api-client.ts`, `src/lib/query-keys.ts`.
- Test:
  - `worker/services/billing/actions.test.ts`;
  - `worker/api/controllers/billing/controller.sql.test.ts`;
  - `worker/api/controllers/billing/billing-routes-wiring.test.ts`;
  - `worker/api/responses-plan-limit.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 5: `loadAccount`, `loadCredits`, `isBillingOn`, `BillingAccount`;
  - from Task 6: the new Stripe methods, `stripePriceIds`, `IDEMPOTENCY_BUCKET_MS`, `StripeApiError`;
  - from Task 4: `CreditLedgerService.purchasesOf`, `CreditBalance`, `creditAlertDue`;
  - from Task 3: `BillingService`, `LIVE_SUBSCRIPTION_STATUSES`, `BILLING_PATH`;
  - from Task 1: `assertWithinLimit`, `isExtraCreditsAmount`, `isPaidPlanId`;
  - existing: `appBaseUrl`, `stripeFromEnv`, `STRIPE_REQUEST_FAILED_MESSAGE`.
- **Produces:**
  - `shared/types/billing.ts`:
    - `BillingCreditsView { pool: number; granted: number; used: number; left: number; purchasedLeft: number; available: number; renewsAt: number }`;
    - `PurchaseView { credits: number; left: number; purchasedAt: number; expiresAt: number }`;
    - `BillingView { enabled: boolean; plan: PlanId; source: BillingSource; status: SubscriptionStatus | null; periodStart: number; periodEnd: number; cancelAtPeriodEnd: boolean; pendingPlan: PaidPlanId | null; pendingPlanAt: number | null; graceEndsAt: number | null; paymentFailing: boolean; credits: BillingCreditsView | null; alert: 'credits_20' | 'credits_5' | null; purchases: PurchaseView[]; limits: PlanLimits; canManageBilling: boolean; canBuyCredits: boolean }`;
    - `CheckoutStarted { url: string; sessionId: string }`, `BillingRedirect { url: string }`, `BillingChangeRequested { requested: true }`;
    - `PlanRequest { plan: PaidPlanId }`, `CreditsRequest { credits: number }`;
    - `BILLING_NOT_OPEN_MESSAGE = "Plans aren't open for your account yet."`.
  - `view.ts`: `billingView(account: BillingAccount, credits: CreditBalance | null, purchases: readonly CreditPurchaseRecord[], hasCustomer: boolean): BillingView`.
  - `actions.ts`:
    - `BillingActionResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409 | 502 | 503; message: string } | { ok: false; status: 402; refusal: PlanLimitRefusal }`;
    - `BillingActionDeps`, `BILLING_MESSAGES`;
    - `startCheckout(deps, user: { id: string; email: string }, plan: unknown)`;
    - `changePlan(deps, userId, plan: unknown)`, `cancelPlan(deps, userId)`, `resumePlan(deps, userId)`, `openPortal(deps, userId)`;
    - `buyCredits(deps, user, account: BillingAccount, credits: unknown)`;
    - `billingActionDepsFromEnv(env, request): BillingActionDeps`.
  - `planLimitResponse(refusal): Response` (402), `BaseController.createPlanLimitResponse<T>(refusal)`. `BaseErrorResponse` gains `code?: string` and `planLimit?: PlanLimitRefusal`.
  - Routes, all `AuthConfig.authenticated`, acting only on `context.user`:
    - `GET /api/billing`;
    - `POST /api/billing/checkout`, `POST /api/billing/change-plan` (both `{ plan }`);
    - `POST /api/billing/cancel`, `POST /api/billing/resume`, `POST /api/billing/portal`;
    - `POST /api/billing/credits` (`{ credits }`).
  - `apiClient`:
    - `getBilling()`;
    - `startPlanCheckout(plan)`, `changePlan(plan)`;
    - `cancelPlan()`, `resumePlan()`, `openBillingPortal()`;
    - `buyCredits(credits)`.
  - `queryKeys.billing()`.

- [ ] **Step 1: Write the failing actions test** `worker/services/billing/actions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { StripeApiError, type StripeCheckoutSession, type StripeSubscription } from '../payments/stripe-client';
import { BILLING_MESSAGES, buyCredits, cancelPlan, changePlan, openPortal, resumePlan, startCheckout, type BillingActionDeps } from './actions';
import type { SubscriptionRecord } from '../../database/schema';
import type { BillingAccount } from './account';
import { PLAN_LIMITS } from '../../../shared/types/plans';

const USER = { id: 'u1', email: 'ana@example.test' };

function row(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: 'u1',
		stripeSubscriptionId: 'sub_1',
		status: 'active',
		plan: 'pro',
		currentPeriodStart: new Date('2026-10-05T10:00:00Z'),
		currentPeriodEnd: new Date('2026-11-05T10:00:00Z'),
		cancelAtPeriodEnd: false,
		pendingPlan: null,
		pendingPlanAt: null,
		stripeScheduleId: null,
		stripeCreatedAt: new Date('2026-10-05T10:00:00Z'),
		updatedAt: new Date('2026-10-05T10:00:00Z'),
		...overrides,
	};
}

function account(plan: 'basic' | 'pro' | 'premium'): BillingAccount {
	const period = { key: 'sub:sub_1:1', startMs: 0, endMs: 1 };
	return { billing: true, userId: 'u1', plan, limits: PLAN_LIMITS[plan], creditsResetAt: 1, source: 'subscription', period, graceEndsAtMs: null, subscription: null };
}

const SUBSCRIPTION: StripeSubscription = { id: 'sub_1', customer: 'cus_1', status: 'active', created: 1, cancel_at_period_end: true, cancel_at: null, metadata: { estori_user_id: 'u1' }, items: { data: [{ id: 'si_1', price: { id: 'price_pro' }, current_period_start: 1, current_period_end: 2 }] }, schedule: null };
const SESSION: StripeCheckoutSession = { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1', payment_status: 'unpaid', status: 'open', client_reference_id: 'u1', metadata: null, amount_total: null, currency: 'usd', payment_intent: null };

function fake(state: { row?: SubscriptionRecord | null; customer?: string | null; failWith?: Error } = {}) {
	const calls: string[] = [];
	const deps: BillingActionDeps = {
		stripe: {
			createCustomer: async ({ userId }) => {
				calls.push(`customer:${userId}`);
				return { id: 'cus_new', email: null, metadata: null };
			},
			createSubscriptionCheckoutSession: async (input) => {
				calls.push(`checkout:${input.customerId}:${input.priceId}`);
				return SESSION;
			},
			createCreditsCheckoutSession: async (input) => {
				calls.push(`credits:${input.customerId}:${input.credits}`);
				return SESSION;
			},
			retrieveSubscription: async (id) => {
				calls.push(`read:${id}`);
				return SUBSCRIPTION;
			},
			changeSubscriptionPrice: async ({ priceId }) => {
				if (state.failWith) throw state.failWith;
				calls.push(`now:${priceId}`);
				return SUBSCRIPTION;
			},
			scheduleSubscriptionPrice: async ({ priceId }) => {
				calls.push(`renewal:${priceId}`);
				return { id: 'sub_sched_1', status: 'active', subscription: 'sub_1', current_phase: null, phases: [] };
			},
			releaseSubscriptionSchedule: async (id) => void calls.push(`release:${id}`),
			cancelAtPeriodEnd: async (id) => {
				calls.push(`cancel:${id}`);
				return SUBSCRIPTION;
			},
			resumeSubscription: async (subscription) => {
				calls.push(`resume:${subscription.id}`);
				return subscription;
			},
			createBillingPortalSession: async ({ customerId }) => {
				calls.push(`portal:${customerId}`);
				return { url: 'https://billing.stripe.com/p/1' };
			},
		},
		store: {
			customerOf: async () => state.customer ?? null,
			saveCustomer: async (_userId, id) => {
				state.customer = id;
				calls.push(`saved:${id}`);
				return id;
			},
			subscriptionOf: async () => state.row ?? null,
		},
		priceIds: { pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' },
		baseUrl: 'https://estori.app',
		nowMs: Date.parse('2026-10-19T15:00:00Z'),
	};
	return { deps, calls };
}

describe('starting a plan', () => {
	it('makes the Stripe customer on the first checkout and reuses it after', async () => {
		const { deps, calls } = fake();
		expect(await startCheckout(deps, USER, 'pro')).toEqual({ ok: true, value: { url: 'https://checkout.stripe.com/c/cs_1', sessionId: 'cs_1' } });
		expect(await startCheckout(deps, USER, 'premium')).toMatchObject({ ok: true });
		expect(calls).toEqual(['customer:u1', 'saved:cus_new', 'checkout:cus_new:price_pro', 'checkout:cus_new:price_premium']);
	});

	it('refuses a second subscription, an unknown plan and a deployment without prices', async () => {
		for (const status of ['active', 'trialing', 'past_due'] as const) {
			expect(await startCheckout(fake({ row: row({ status }) }).deps, USER, 'premium')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.alreadyPaying });
		}
		expect(await startCheckout(fake({ row: row({ status: 'canceled' }) }).deps, USER, 'pro')).toMatchObject({ ok: true });
		for (const plan of ['basic', 'enterprise', 'gold', null]) expect(await startCheckout(fake().deps, USER, plan)).toMatchObject({ ok: false, status: 400 });
		expect(await startCheckout({ ...fake().deps, priceIds: null }, USER, 'pro')).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
	});
});

describe('moving between Pro and Premium', () => {
	it('moves up now and down at renewal', async () => {
		const up = fake({ row: row({ plan: 'pro' }) });
		expect(await changePlan(up.deps, 'u1', 'premium')).toEqual({ ok: true, value: { requested: true } });
		expect(up.calls).toEqual(['read:sub_1', 'now:price_premium']);
		const down = fake({ row: row({ plan: 'premium' }) });
		expect(await changePlan(down.deps, 'u1', 'pro')).toMatchObject({ ok: true });
		expect(down.calls).toEqual(['read:sub_1', 'renewal:price_pro']);
	});

	it('refuses the same plan, a failing payment, an ending plan, no plan, a second pending change and a declined card', async () => {
		expect(await changePlan(fake({ row: row() }).deps, 'u1', 'pro')).toEqual({ ok: false, status: 400, message: "You're already on Pro." });
		expect(await changePlan(fake({ row: row({ status: 'past_due' }) }).deps, 'u1', 'premium')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.paymentFailing });
		expect(await changePlan(fake({ row: row({ cancelAtPeriodEnd: true }) }).deps, 'u1', 'premium')).toEqual({ ok: false, status: 409, message: 'Pro ends on November 5. Keep Pro first.' });
		expect(await changePlan(fake().deps, 'u1', 'premium')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noPlan });
		const pending = row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' });
		expect(await changePlan(fake({ row: pending }).deps, 'u1', 'pro')).toEqual({ ok: false, status: 409, message: 'You have a change scheduled for November 5. Keep your current plan first.' });
		const declined = fake({ row: row(), failWith: new StripeApiError('Your card was declined.', 402, 'card_declined', 'card_error') });
		expect(await changePlan(declined.deps, 'u1', 'premium')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.declined });
	});

	it('cancels a pending move to Pro when the seller picks Premium again', async () => {
		const { deps, calls } = fake({ row: row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' }) });
		expect(await changePlan(deps, 'u1', 'premium')).toMatchObject({ ok: true });
		expect(calls).toEqual(['release:sub_sched_1']);
	});
});

describe('cancelling, keeping the plan, the portal and extra credits', () => {
	it('drops a pending change before cancelling at the period end, and refuses a second cancel', async () => {
		const { deps, calls } = fake({ row: row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' }) });
		expect(await cancelPlan(deps, 'u1')).toMatchObject({ ok: true });
		expect(calls).toEqual(['release:sub_sched_1', 'cancel:sub_1']);
		expect(await cancelPlan(fake({ row: row({ cancelAtPeriodEnd: true }) }).deps, 'u1')).toEqual({ ok: false, status: 409, message: 'Pro already ends on November 5.' });
	});

	it('keeps the plan only when it was set to end, and opens the portal once there are billing details', async () => {
		expect(await resumePlan(fake({ row: row() }).deps, 'u1')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.notEnding });
		const ending = fake({ row: row({ cancelAtPeriodEnd: true }) });
		expect(await resumePlan(ending.deps, 'u1')).toMatchObject({ ok: true });
		expect(ending.calls).toEqual(['read:sub_1', 'resume:sub_1']);
		expect(await openPortal(fake().deps, 'u1')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCustomer });
		expect(await openPortal(fake({ customer: 'cus_1' }).deps, 'u1')).toEqual({ ok: true, value: { url: 'https://billing.stripe.com/p/1' } });
	});

	it('sells extra credits to Premium only, in amounts from 5,000 in thousands', async () => {
		const premium = fake({ customer: 'cus_1' });
		expect(await buyCredits(premium.deps, USER, account('premium'), 12_000)).toEqual({ ok: true, value: { url: 'https://checkout.stripe.com/c/cs_1', sessionId: 'cs_1' } });
		expect(premium.calls).toEqual(['credits:cus_1:12000']);
		expect(await buyCredits(fake().deps, USER, account('pro'), 12_000)).toMatchObject({ ok: false, status: 402, refusal: { limit: 'extraCredits', upgradeTo: 'premium' } });
		for (const credits of [4_000, 5_500, 2_000_000, '5000']) expect(await buyCredits(fake().deps, USER, account('premium'), credits)).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.creditsAmount });
	});
});
```

- [ ] **Step 2: Write the failing endpoint tests.** `worker/api/controllers/billing/controller.sql.test.ts`:

```ts
/** The billing endpoints on real SQL, with Stripe stood in by fetch. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertPurchase, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { BillingController } from './controller';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
const PRICES = JSON.stringify({ pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' });
const NOW = Date.now();

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_basic', 'u_paying', 'u_off']) await insertUser(db, id, { createdAt: new Date(NOW - 40 * 86_400_000) });
	await insertSubscription(db, { userId: 'u_paying', stripeSubscriptionId: 'sub_paying', status: 'active', plan: 'premium', currentPeriodStart: new Date(NOW - 86_400_000), currentPeriodEnd: new Date(NOW + 29 * 86_400_000) });
	await insertPurchase(db, { id: 'cp_1', userId: 'u_paying', credits: 5_000, purchasedAt: new Date(NOW - 86_400_000), expiresAt: new Date(NOW + 364 * 86_400_000) });
});

afterEach(() => vi.restoreAllMocks());

function env(extra: Record<string, unknown> = {}): Env {
	return envWith(db, { BILLING: 'on', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PRICE_IDS: PRICES, CUSTOM_DOMAIN: 'estori.app', VibecoderStore: { get: async () => null }, ...extra });
}

function context(userId: string): RouteContext {
	return { user: { id: userId, email: `${userId}@example.test` }, sessionId: 's1', pathParams: {}, queryParams: new URLSearchParams() } as unknown as RouteContext;
}

const post = (path: string, body: unknown = {}) => new Request(`https://estori.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('the billing endpoints', () => {
	it("shows a Basic account its month's credits", async () => {
		const response = await BillingController.get(new Request('https://estori.app/api/billing'), env(), {} as ExecutionContext, context('u_basic'));
		expect((await response.json()).data).toMatchObject({ enabled: true, plan: 'basic', source: 'free', status: null, credits: { pool: 5_000, used: 0, left: 5_000 }, alert: null, purchases: [], limits: { liveStores: 1 }, canManageBilling: false, canBuyCredits: false });
	});

	it('shows Premium its pool and purchases, and lets it buy more', async () => {
		const response = await BillingController.get(new Request('https://estori.app/api/billing'), env(), {} as ExecutionContext, context('u_paying'));
		expect((await response.json()).data).toMatchObject({ plan: 'premium', credits: { pool: 100_000, left: 105_000, purchasedLeft: 5_000 }, purchases: [{ credits: 5_000, left: 5_000 }], canBuyCredits: true });
	});

	it('starts a checkout, keeping the Stripe customer it made, and refuses a second subscription', async () => {
		const stripe = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const path = new URL(String(input)).pathname;
			if (path === '/v1/customers') return Response.json({ id: 'cus_basic', email: null, metadata: null });
			if (path === '/v1/checkout/sessions') return Response.json({ id: 'cs_9', url: 'https://checkout.stripe.com/c/cs_9' });
			throw new Error(`unexpected ${path}`);
		});
		const response = await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env(), {} as ExecutionContext, context('u_basic'));
		expect((await response.json()).data).toEqual({ url: 'https://checkout.stripe.com/c/cs_9', sessionId: 'cs_9' });
		expect(stripe).toHaveBeenCalledTimes(2);
		expect(await db.prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = 'u_basic'").first()).toEqual({ stripe_customer_id: 'cus_basic' });
		expect((await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env(), {} as ExecutionContext, context('u_paying'))).status).toBe(409);
	});

	it('answers 402 plan_limit when Basic tries to buy credits, and 403 when billing is off for the account', async () => {
		const refused = await BillingController.credits(post('/api/billing/credits', { credits: 5_000 }), env(), {} as ExecutionContext, context('u_basic'));
		expect(refused.status).toBe(402);
		expect((await refused.json()).error.planLimit).toMatchObject({ limit: 'extraCredits', upgradeTo: 'premium' });
		const off = await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env({ BILLING: undefined, BILLING_USER_IDS: 'someone-else' }), {} as ExecutionContext, context('u_off'));
		expect(off.status).toBe(403);
		expect((await off.json()).error.message).toBe("Plans aren't open for your account yet.");
	});
});
```

`worker/api/controllers/billing/billing-routes-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/billingRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('billing routes', () => {
	it("are signed-in only, act on the caller's own account, and are registered", () => {
		const routes = source('/worker/api/routes/billingRoutes.ts');
		const sellerRoutes = routes.slice(0, routes.indexOf("'/api/admin/") === -1 ? routes.length : routes.indexOf("'/api/admin/"));
		for (const path of ["'/api/billing'", "'/api/billing/checkout'", "'/api/billing/change-plan'", "'/api/billing/cancel'", "'/api/billing/resume'", "'/api/billing/portal'", "'/api/billing/credits'"]) {
			const start = sellerRoutes.indexOf(path);
			expect(start, path).toBeGreaterThan(-1);
			expect(sellerRoutes.slice(start, start + 160), path).toContain('setAuthLevel(AuthConfig.authenticated)');
		}
		expect(sellerRoutes).not.toContain(':userId');
		expect(source('/worker/api/routes/index.ts')).toContain('setupBillingRoutes(app);');
	});
});
```

`worker/api/responses-plan-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planLimitResponse } from './responses';

describe('planLimitResponse', () => {
	it('answers 402 with the refusal under error, where the frontend looks for it', async () => {
		const refusal = { code: 'plan_limit' as const, limit: 'liveStores' as const, plan: 'basic' as const, upgradeTo: 'pro' as const, message: 'Basic includes 1 live store. Get Pro for up to 3, or Premium for up to 10.' };
		const response = planLimitResponse(refusal);
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({ success: false, error: { message: refusal.message, name: 'PlanLimit', code: 'plan_limit', planLimit: refusal }, message: refusal.message });
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/actions.test.ts worker/api/controllers/billing/controller.sql.test.ts worker/api/controllers/billing/billing-routes-wiring.test.ts worker/api/responses-plan-limit.test.ts`
Expected: FAIL, failed imports.

- [ ] **Step 4: Implement `actions.ts`.**

```ts
export const BILLING_MESSAGES = {
	notSetUp: "Plans aren't set up on this deployment yet.",
	pickPlan: 'Pick Pro or Premium.',
	alreadyPaying: 'You already have a plan. Change it on the billing page.',
	noPlan: "You don't have Pro or Premium.",
	paymentFailing: "Your last payment didn't go through. Update your card in Manage billing first.",
	declined: 'Your card was declined. Update it in Manage billing, then try again.',
	notEnding: "Your plan isn't set to end.",
	noCustomer: "You don't have billing details yet.",
	creditsAmount: 'Pick 5,000 to 1,000,000 credits, in thousands.',
} as const;
```

`BillingActionDeps` has `stripe` (a `Pick` of the methods the fake has, or null), `store` (`customerOf`, `saveCustomer`, `subscriptionOf`), `priceIds: StripePriceIds | null`, `baseUrl` and `nowMs`.

**Common rules:**
- Answer 503 `notSetUp` without Stripe or price ids.
- A "live" row has a status in `LIVE_SUBSCRIPTION_STATUSES`.
- Idempotency keys are `billing-{action}-{userId}-{plan or credits or nothing}-{Math.floor(nowMs / IDEMPOTENCY_BUCKET_MS)}`.
- A `StripeApiError` whose `type` is `card_error`, or whose status is 402, answers 409 `declined`. Any other `StripeApiError` answers 502 `STRIPE_REQUEST_FAILED_MESSAGE`. Other errors are rethrown.
- Dates use `formatBillingDate`, and plan names `planName`.
- The customer comes from `customerOf`, or else `createCustomer` then `saveCustomer`.

**`startCheckout`:**
1. `isPaidPlanId(plan)`, else 400 `pickPlan`.
2. Answer 409 `alreadyPaying` when the row is live.
3. The session uses `priceIds[plan]`; the URLs are `${baseUrl}${BILLING_PATH}?checkout=success` and `?checkout=cancelled`.
4. Answer `{ url, sessionId }`; a session without a url answers 502.

**`changePlan`,** in this order:
1. a plan that isn't paid answers 400 `pickPlan`;
2. no live row answers 404 `noPlan`;
3. `past_due` answers 409 `paymentFailing`;
4. cancelling answers 409 "{Plan} ends on {date}. Keep {Plan} first.";
5. a pending change: choosing the row's plan releases `stripeScheduleId` and answers ok; any other choice answers 409 "You have a change scheduled for {date}. Keep your current plan first.";
6. the row's own plan answers 400 "You're already on {Plan}.";
7. otherwise retrieve the subscription. Premium calls `changeSubscriptionPrice`; Pro calls `scheduleSubscriptionPrice`.

**`cancelPlan`:**
- no live row answers 404;
- already cancelling answers 409 "{Plan} already ends on {date}.";
- otherwise release `stripeScheduleId` when set, then `cancelAtPeriodEnd`.

**`resumePlan`:**
- no live row answers 404;
- not cancelling answers 409 `notEnding`;
- otherwise retrieve the subscription, then `resumeSubscription`.

**`openPortal`:**
- no customer answers 404 `noCustomer`;
- otherwise open the portal, returning to `${baseUrl}${BILLING_PATH}`.

**`buyCredits`:**
1. `assertWithinLimit(account, 'extraCredits')`, which answers `{ ok: false, status: 402, refusal }`.
2. `isExtraCreditsAmount(credits)`, else 400 `creditsAmount`.
3. The customer, then `createCreditsCheckoutSession` with `priceIds.credits`. The URLs are `?credits=success` and the plain billing path.

**`billingActionDepsFromEnv(env, request)`:** `{ stripe: stripeFromEnv(env), store: new BillingService(env), priceIds: stripePriceIds(env.STRIPE_PRICE_IDS), baseUrl: appBaseUrl(env, request), nowMs: Date.now() }`.

- [ ] **Step 5: Implement `view.ts`, the 402 response, the controller and the routes.**

**`billingView(account, credits, purchases, hasCustomer)`:**
- maps the subscription row: status, cancel flag, `pendingPlan` and its date when `isPaidPlanId`;
- `paymentFailing`: status `past_due` or `unpaid`;
- `credits`: the balance plus `renewsAt: account.creditsResetAt`, or null when billing is off;
- `alert`: `creditAlertDue(credits)` when there are credits, else null; the banner in Task 12 shows it;
- `purchases`: those with credits left, mapped to `PurchaseView` with `left = credits - used - removedCredits`;
- `canBuyCredits`: `assertWithinLimit(account, 'extraCredits') === null && account.billing`.

**`planLimitResponse(refusal)`:**
- returns status 402 with `{ success: false, error: { message: refusal.message, name: 'PlanLimit', code: PLAN_LIMIT_CODE, planLimit: refusal }, message: refusal.message }`;
- add `code?` and `planLimit?` to `BaseErrorResponse`;
- `BaseController.createPlanLimitResponse<T = never>(refusal)` casts it like `createErrorResponse`.

**`BillingController extends BaseController`:**
- **`get`:**
  1. `account = await loadAccount(env, user.id)`;
  2. when billing is on, `credits = await loadCredits(env, account)` and `purchases = await new CreditLedgerService(env).purchasesOf(user.id)`;
  3. read the customer, and answer `billingView`.
- **Every `POST`:**
  - answers 401 without `context.user`;
  - answers 403 `BILLING_NOT_OPEN_MESSAGE` when `!isBillingOn(env, user.id)`;
  - reads its body with `parseJsonBody`;
  - calls its action with `billingActionDepsFromEnv(env, request)`.
- **`credits`** loads the account first, for `buyCredits`.
- **Results:** ok is `createSuccessResponse(value)`, a refusal is `createPlanLimitResponse(refusal)`, otherwise `createErrorResponse(message, status)`.
- **`setupBillingRoutes(app)`** registers the seven routes. Call it from `setupRoutes` in `worker/api/routes/index.ts`, before `setupLimitsRoutes(app)`.

- [ ] **Step 6: The frontend client.**
- Re-export the new types, `BILLING_PATH` and `BILLING_NOT_OPEN_MESSAGE` from `src/api-types.ts`.
- Add `billing: () => ['billing'] as const` to `queryKeys`.
- `ApiClient` gains `getBilling`, `startPlanCheckout(plan)`, `changePlan(plan)`, `cancelPlan`, `resumePlan`, `openBillingPortal` and `buyCredits(credits)`. Each is a `this.request<…>` call: GET for the view, POST with its body otherwise.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/actions.test.ts worker/api/controllers/billing/controller.sql.test.ts worker/api/controllers/billing/billing-routes-wiring.test.ts worker/api/responses-plan-limit.test.ts`
Expected: PASS (14 tests).

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add shared/types/billing.ts worker/services/billing/actions.ts worker/services/billing/actions.test.ts worker/services/billing/view.ts worker/api/controllers/billing worker/api/routes/billingRoutes.ts worker/api/routes/index.ts worker/api/responses.ts worker/api/responses-plan-limit.test.ts worker/api/controllers/baseController.ts src/api-types.ts src/lib/api-client.ts src/lib/query-keys.ts
git commit -m "feat(billing): the billing api to start pro or premium, move between them, cancel, keep the plan, manage the card and buy credits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Webhooks, extra credits, refunds, and the daily and hourly runs

**Files:**
- Create:
  - `worker/services/billing/subscription-row.ts` (pure);
  - `worker/services/billing/events.ts`;
  - `worker/services/billing/jobs.ts`;
  - `worker/services/billing/wiring.ts`.
- Modify:
  - `worker/api/controllers/payments/webhook.ts`, `worker/index.ts`;
  - `worker/services/alerts/platform-alerts.ts` (three kinds);
  - `worker/services/billing/flag.ts` (`billingAudience`), `worker/services/billing/periods.ts` (`addMonths`, `renewalDaysOf`);
  - `worker/database/services/BillingService.ts` (`accountsRenewing`), `worker/database/services/CreditLedgerService.ts` (`purchaseBySession`).
- Test:
  - `worker/services/billing/subscription-row.test.ts`;
  - `worker/api/controllers/payments/webhook-billing.sql.test.ts`;
  - `worker/services/billing/jobs.sql.test.ts`;
  - `worker/services/billing/wiring.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 3: `BillingService.recordEvent`, `eventSeen`, `userOfCustomer`, `subscriptionOf`, `sentNoticeKeys`, `subscriptionsToRepair`, `LIVE_SUBSCRIPTION_STATUSES`, `CHECKOUT_KIND_CREDITS`;
  - from Task 4: `CreditLedgerService.settle`, `usersToSettle`, `expirePurchases`, `pruneUses`, `purchaseByPaymentIntent`;
  - from Task 5: `loadAccount`, `subscriptionPeriod`, `graceEndsAt`, `isBillingOn`;
  - from Task 6: `StripeSubscription`, `StripeInvoice`, `StripeCharge`, `StripeSubscriptionSchedule`, `planOfPrice`, `stripePriceIds`;
  - from Task 7: `PlannedNotice`, `sendBillingEmails`, `billingMailFromEnv`, `claimAndSendNotice`, `claimingMailFromEnv`;
  - from Task 1: `isExtraCreditsAmount`, `extraCreditsPriceCents`, `EXTRA_CREDITS`, `PLAN_LIMITS`;
  - existing: `isCheckoutSession`, `StripeEvent`, `platformAlertsFromEnv`, `CATALOG_HEALTH_CRON`, `CATALOG_SWEEP_CRON`, `generateId`.
- **Produces:**
  - `subscription-row.ts`:
    - `subscriptionRowFrom(subscription: StripeSubscription, userId: string, ids: StripePriceIds | null, nowMs: number): SubscriptionRecord | null` (null for a price that's neither plan);
    - `noticesFor(previous: SubscriptionRecord | null, next: SubscriptionRecord, context: { eventType: string; invoice: StripeInvoice | null }): PlannedNotice[]`.
  - `events.ts`:
    - `BillingEventOutcome = 'applied' | 'duplicate' | 'ignored' | 'refused'`;
    - `BillingEventDeps { stripe: Pick<StripeClient, 'retrieveSubscription' | 'retrieveCheckoutSession'>; store: Pick<BillingService, 'eventSeen' | 'userOfCustomer' | 'subscriptionOf' | 'sentNoticeKeys' | 'recordEvent'>; ledger: Pick<CreditLedgerService, 'purchaseBySession' | 'purchaseByPaymentIntent' | 'settle'>; priceIds: StripePriceIds | null; notify(userId: string, notices: readonly PlannedNotice[]): Promise<void>; alert(alert: PlatformAlert): Promise<void>; nowMs(): number }`;
    - `SubscriptionTarget { eventId: string; eventType: string; subscriptionId: string; expectedUserId: string | null; invoice: StripeInvoice | null }`;
    - `applySubscription(deps, input: SubscriptionTarget): Promise<BillingEventOutcome>`;
    - `applyCreditPurchase(deps, input: { eventId: string; eventType: string; sessionId: string }): Promise<BillingEventOutcome>`;
    - `applyCreditRefund(deps, input: { eventId: string; eventType: string; charge: StripeCharge }): Promise<BillingEventOutcome | null>`;
    - `handleBillingEvent(deps, event: StripeEvent): Promise<BillingEventOutcome | null>` (null when the event isn't billing's).
  - `jobs.ts`: `runDailyBilling(env: Env, nowMs: number): Promise<void>`, `runHourlyBilling(env: Env, nowMs: number): Promise<void>`.
  - `wiring.ts`: `billingEventDepsFromEnv(env): BillingEventDeps`, `runBillingSchedule(cron: string, env: Env): Promise<void>` (never throws).
  - `flag.ts`: `billingAudience(env): 'everyone' | readonly string[]`.
  - `periods.ts`:
    - `addMonths(ms: number, months: number): number` (the day clamped to the month's end);
    - `renewalDaysOf(nowMs: number): number[]` (the sign-up days whose period starts today).
  - `BillingService.accountsRenewing(input: { dayStartMs: number; days: readonly number[]; userIds: readonly string[] | null; limit: number }): Promise<string[]>`.
  - `CreditLedgerService.purchaseBySession(sessionId): Promise<CreditPurchaseRecord | null>`.
  - Platform alert kinds `billing-mismatch`, `billing-second-subscription`, `billing-unknown-price`.

- [ ] **Step 1: Write the failing pure test** `worker/services/billing/subscription-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { noticesFor, subscriptionRowFrom } from './subscription-row';
import type { StripeInvoice, StripeSubscription, StripeSubscriptionSchedule } from '../payments/stripe-client';
import type { SubscriptionRecord } from '../../database/schema';
import type { PlannedNotice } from './notices';

const IDS = { pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' };
const DAY = 86_400_000;
const START = Date.parse('2026-10-05T10:00:00Z') / 1000;
const END = Date.parse('2026-11-05T10:00:00Z') / 1000;
const NEXT_END = Date.parse('2026-12-05T10:00:00Z') / 1000;
const NOW = Date.parse('2026-10-19T15:00:00Z');

function stripeSub(overrides: Partial<StripeSubscription> = {}, price = 'price_pro'): StripeSubscription {
	return {
		id: 'sub_1',
		customer: 'cus_1',
		status: 'active',
		created: START,
		cancel_at_period_end: false,
		cancel_at: null,
		metadata: { estori_user_id: 'u1' },
		items: { data: [{ id: 'si_1', price: { id: price, metadata: null }, current_period_start: START, current_period_end: END }] },
		schedule: null,
		...overrides,
	};
}

function row(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: 'u1',
		stripeSubscriptionId: 'sub_1',
		status: 'active',
		plan: 'pro',
		currentPeriodStart: new Date(START * 1000),
		currentPeriodEnd: new Date(END * 1000),
		cancelAtPeriodEnd: false,
		pendingPlan: null,
		pendingPlanAt: null,
		stripeScheduleId: null,
		stripeCreatedAt: new Date(START * 1000),
		updatedAt: new Date(NOW),
		...overrides,
	};
}

function invoice(reason: string, amountPaid = 4_900): StripeInvoice {
	return { id: 'in_1', customer: 'cus_1', amount_paid: amountPaid, currency: 'usd', hosted_invoice_url: 'https://invoice.stripe.com/i/in_1', number: 'EST-0001', billing_reason: reason, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } } };
}

const UPDATED = { eventType: 'customer.subscription.updated', invoice: null };
const keys = (notices: PlannedNotice[]) => notices.map((notice) => notice.key);

describe('subscriptionRowFrom', () => {
	it("rebuilds the row from Stripe's subscription: the plan from its price, the period from its item", () => {
		expect(subscriptionRowFrom(stripeSub(), 'u1', IDS, NOW)).toEqual(row());
		expect(subscriptionRowFrom(stripeSub({ cancel_at: END }), 'u1', IDS, NOW)?.cancelAtPeriodEnd).toBe(true);
		expect(subscriptionRowFrom(stripeSub({}, 'price_unknown'), 'u1', IDS, NOW)).toBeNull();
	});

	it("shows a scheduled move to Pro from the schedule's next phase, and nothing once it's released", () => {
		const schedule: StripeSubscriptionSchedule = {
			id: 'sub_sched_1',
			status: 'active',
			subscription: 'sub_1',
			current_phase: { start_date: START, end_date: END },
			phases: [
				{ start_date: START, end_date: END, items: [{ price: 'price_premium', quantity: 1 }] },
				{ start_date: END, end_date: NEXT_END, items: [{ price: 'price_pro', quantity: 1 }] },
			],
		};
		expect(subscriptionRowFrom(stripeSub({ schedule }, 'price_premium'), 'u1', IDS, NOW)).toMatchObject({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date(END * 1000), stripeScheduleId: 'sub_sched_1' });
		expect(subscriptionRowFrom(stripeSub({ schedule: { ...schedule, status: 'released' } }, 'price_premium'), 'u1', IDS, NOW)).toMatchObject({ pendingPlan: null, pendingPlanAt: null, stripeScheduleId: null });
	});
});

describe('noticesFor', () => {
	it('welcomes a plan once, and sends a receipt for each paid invoice', () => {
		expect(noticesFor(null, row(), { eventType: 'customer.subscription.created', invoice: null })).toEqual([{ key: 'plan_started:sub_1', email: { kind: 'plan_started', plan: 'pro', renewsAt: END * 1000 } }]);
		expect(noticesFor(row(), row(), UPDATED)).toEqual([]);
		expect(keys(noticesFor(row(), row(), { eventType: 'invoice.paid', invoice: invoice('subscription_create') }))).toEqual(['receipt:in_1']);
		expect(keys(noticesFor(row(), row(), { eventType: 'invoice.paid', invoice: invoice('subscription_create', 0) }))).toEqual([]);
	});

	it('says the credits renewed when a renewal invoice is paid', () => {
		const renewed = row({ currentPeriodStart: new Date(END * 1000), currentPeriodEnd: new Date(NEXT_END * 1000) });
		const notices = noticesFor(row(), renewed, { eventType: 'invoice.paid', invoice: invoice('subscription_cycle') });
		expect(keys(notices)).toEqual(['receipt:in_1', `credits_renewed:sub:sub_1:${END}`]);
		expect(notices[1].email).toEqual({ kind: 'credits_renewed', credits: 20_000, renewsAt: NEXT_END * 1000 });
	});

	it('tells the seller about a move up, a move down at renewal, a cancel and the end', () => {
		expect(keys(noticesFor(row(), row({ plan: 'premium' }), UPDATED))).toEqual([`plan_upgraded:sub_1:${START}`]);
		const pending = row({ plan: 'premium', pendingPlan: 'pro', pendingPlanAt: new Date(END * 1000), stripeScheduleId: 'sub_sched_1' });
		expect(noticesFor(row({ plan: 'premium' }), pending, UPDATED)).toEqual([{ key: 'downgrade_scheduled:sub_sched_1', email: { kind: 'downgrade_scheduled', plan: 'pro', at: END * 1000 } }]);
		expect(keys(noticesFor(row(), row({ cancelAtPeriodEnd: true }), UPDATED))).toEqual([`plan_ending:sub_1:${END}`]);
		expect(noticesFor(row({ cancelAtPeriodEnd: true }), row(), UPDATED)).toEqual([]);
		expect(noticesFor(row({ status: 'past_due' }), row({ status: 'canceled' }), UPDATED)).toEqual([{ key: 'plan_ended:sub_1', email: { kind: 'plan_ended', plan: 'pro', reason: 'payment-failed' } }]);
		expect(noticesFor(row({ cancelAtPeriodEnd: true }), row({ status: 'canceled' }), UPDATED)[0].email).toEqual({ kind: 'plan_ended', plan: 'pro', reason: 'cancelled' });
	});

	it('warns once per failed invoice, naming the end of the grace period', () => {
		expect(noticesFor(row(), row({ status: 'past_due' }), { eventType: 'invoice.payment_failed', invoice: invoice('subscription_cycle', 0) })).toEqual([
			{ key: 'payment_failed:in_1', email: { kind: 'payment_failed', plan: 'pro', graceEndsAt: START * 1000 + 7 * DAY } },
		]);
	});
});
```

- [ ] **Step 2: Write the failing webhook test** `worker/api/controllers/payments/webhook-billing.sql.test.ts`:

```ts
/**
 * Billing webhooks on real SQL: signed deliveries, Stripe's API stood in by fetch serving each object's latest copy,
 * and Estori's emails captured. Each test's writes roll back after it.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertBillingCustomer, insertPurchase, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { CreditLedgerService } from '../../../database/services/CreditLedgerService';
import { PLATFORM_ALERT_EMAILS } from '../../../services/alerts/platform-alerts';
import type { StripeSubscription } from '../../../services/payments/stripe-client';
import { handleStripeWebhook } from './webhook';

const SECRET = 'whsec_billing_test';
const PRICES = { pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' };
const DAY = 86_400;
const START = Date.parse('2026-10-05T10:00:00Z') / 1000;
const END = Date.parse('2026-11-05T10:00:00Z') / 1000;

let db: D1Database;
const sent: Array<{ to: string; subject: string }> = [];

beforeAll(async () => {
	db = await migratedD1();
});

afterEach(() => {
	vi.restoreAllMocks();
	sent.length = 0;
});

async function signatureFor(payload: string): Promise<string> {
	const timestamp = Math.floor(Date.now() / 1000);
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
	return `t=${timestamp},v1=${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function env(): Env {
	return envWith(db, {
		STRIPE_WEBHOOK_SECRET: SECRET,
		STRIPE_SECRET_KEY: 'sk_test_fake',
		STRIPE_PRICE_IDS: JSON.stringify(PRICES),
		CUSTOM_DOMAIN: 'estori.app',
		ENVIRONMENT: 'prod',
		EMAIL: {
			send: async (message: { to: string; subject: string }) => {
				sent.push({ to: message.to, subject: message.subject });
				return { messageId: 'm1' };
			},
		},
		VibecoderStore: { get: async () => null, put: async () => undefined },
	});
}

/** Stripe's API: the latest copy of each object by id. Tests change the map to move Stripe's state on. */
function stripeServes(objects: Record<string, unknown>): Record<string, unknown> {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const id = new URL(String(input)).pathname.split('/').pop() ?? '';
		const object = objects[id];
		return object ? Response.json(object) : Response.json({ error: { message: `No such object: ${id}` } }, { status: 404 });
	});
	return objects;
}

async function deliver(id: string, type: string, object: unknown): Promise<number> {
	const payload = JSON.stringify({ id, type, data: { object } });
	const request = new Request('https://estori.app/api/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': await signatureFor(payload) }, body: payload });
	return (await handleStripeWebhook(request, env())).status;
}

function subscription(userId: string, customer: string, overrides: Partial<StripeSubscription> = {}, price = 'price_pro'): StripeSubscription {
	return {
		id: `sub_${userId}`,
		customer,
		status: 'active',
		created: START,
		cancel_at_period_end: false,
		cancel_at: null,
		metadata: { estori_user_id: userId },
		items: { data: [{ id: 'si_1', price: { id: price, metadata: null }, current_period_start: START, current_period_end: END }] },
		schedule: null,
		...overrides,
	};
}

async function seller(userId: string): Promise<string> {
	await insertUser(db, userId);
	await insertBillingCustomer(db, userId, `cus_${userId}`);
	return `cus_${userId}`;
}

const rowOf = (userId: string) =>
	db.prepare('SELECT stripe_subscription_id AS id, status, plan, cancel_at_period_end AS ending, pending_plan AS pending FROM subscriptions WHERE user_id = ?').bind(userId).first();
const resultOf = (eventId: string) => db.prepare('SELECT result FROM billing_events WHERE stripe_event_id = ?').bind(eventId).first('result');
const subjects = () => sent.filter((email) => !PLATFORM_ALERT_EMAILS.includes(email.to)).map((email) => email.subject);
const alerted = () => sent.some((email) => PLATFORM_ALERT_EMAILS.includes(email.to));

describe('subscription webhooks', () => {
	it('records a checkout and its subscription once, welcoming the seller once', async () => {
		const customer = await seller('u_new');
		stripeServes({ sub_u_new: subscription('u_new', customer) });
		const session = { id: 'cs_new', mode: 'subscription', subscription: 'sub_u_new', customer, client_reference_id: 'u_new', payment_status: 'paid', status: 'complete', metadata: { estori_user_id: 'u_new', plan: 'pro' } };
		expect(await deliver('evt_1', 'checkout.session.completed', session)).toBe(200);
		expect(await deliver('evt_2', 'customer.subscription.created', { id: 'sub_u_new' })).toBe(200);
		expect(await deliver('evt_2', 'customer.subscription.created', { id: 'sub_u_new' })).toBe(200);
		expect(await rowOf('u_new')).toEqual({ id: 'sub_u_new', status: 'active', plan: 'pro', ending: 0, pending: null });
		expect(subjects()).toEqual(['Welcome to Estori Pro']);
		expect(await db.prepare("SELECT COUNT(*) AS n FROM billing_events WHERE object_id = 'sub_u_new'").first()).toEqual({ n: 2 });
	});

	it("ends at Stripe's latest state when updated arrives before created", async () => {
		const customer = await seller('u_order');
		stripeServes({ sub_u_order: subscription('u_order', customer, {}, 'price_premium') });
		await deliver('evt_u', 'customer.subscription.updated', { id: 'sub_u_order' });
		await deliver('evt_c', 'customer.subscription.created', { id: 'sub_u_order' });
		expect(await rowOf('u_order')).toMatchObject({ plan: 'premium', status: 'active' });
		expect(subjects()).toEqual(['Welcome to Estori Premium']);
	});

	it('moves Pro to Premium with its invoice, and shows a scheduled move back to Pro until the renewal', async () => {
		const customer = await seller('u_up');
		await insertSubscription(db, { userId: 'u_up', stripeSubscriptionId: 'sub_u_up', status: 'active', currentPeriodStart: new Date(START * 1000), currentPeriodEnd: new Date(END * 1000) });
		const stripe = stripeServes({ sub_u_up: subscription('u_up', customer, {}, 'price_premium') });
		await deliver('evt_up', 'customer.subscription.updated', { id: 'sub_u_up' });
		const prorated = { id: 'in_up', customer, amount_paid: 7_500, currency: 'usd', hosted_invoice_url: null, number: 'EST-0002', billing_reason: 'subscription_update', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_up' } } };
		await deliver('evt_inv', 'invoice.paid', prorated);
		expect(await rowOf('u_up')).toMatchObject({ plan: 'premium' });
		const schedule = { id: 'sub_sched_up', status: 'active', subscription: 'sub_u_up', current_phase: { start_date: START, end_date: END }, phases: [{ start_date: START, end_date: END, items: [{ price: 'price_premium', quantity: 1 }] }, { start_date: END, end_date: END + 30 * DAY, items: [{ price: 'price_pro', quantity: 1 }] }] };
		stripe.sub_u_up = subscription('u_up', customer, { schedule }, 'price_premium');
		await deliver('evt_sched', 'subscription_schedule.created', schedule);
		expect(await rowOf('u_up')).toMatchObject({ plan: 'premium', pending: 'pro' });
		const renewed = { id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: END, current_period_end: END + 30 * DAY };
		stripe.sub_u_up = subscription('u_up', customer, { items: { data: [renewed] } });
		await deliver('evt_renew', 'customer.subscription.updated', { id: 'sub_u_up' });
		expect(await rowOf('u_up')).toMatchObject({ plan: 'pro', pending: null });
		expect(subjects()).toEqual(["You're on Premium now", 'Your Estori receipt: $75.00', 'Your plan moves to Pro at renewal']);
	});

	it('warns once when a renewal fails, keeps the plan through the grace period, and restores it when paid', async () => {
		const customer = await seller('u_due');
		await insertSubscription(db, { userId: 'u_due', stripeSubscriptionId: 'sub_u_due', status: 'active', currentPeriodStart: new Date((START - 31 * DAY) * 1000), currentPeriodEnd: new Date(START * 1000) });
		const stripe = stripeServes({ sub_u_due: subscription('u_due', customer, { status: 'past_due' }) });
		const failed = { id: 'in_due', customer, amount_paid: 0, currency: 'usd', hosted_invoice_url: null, number: 'EST-0003', billing_reason: 'subscription_cycle', attempt_count: 1, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_due' } } };
		await deliver('evt_f1', 'invoice.payment_failed', failed);
		await deliver('evt_f2', 'invoice.payment_failed', { ...failed, attempt_count: 2 });
		expect(await rowOf('u_due')).toMatchObject({ status: 'past_due', plan: 'pro' });
		stripe.sub_u_due = subscription('u_due', customer);
		await deliver('evt_paid', 'invoice.paid', { ...failed, amount_paid: 4_900 });
		expect(await rowOf('u_due')).toMatchObject({ status: 'active' });
		expect(subjects()).toEqual(["Your Pro payment didn't go through", 'Your Estori receipt: $49.00', 'Your AI credits are renewed']);
	});

	it('says when a cancelled plan ends, keeps it when the seller changes their mind, and says when it has ended', async () => {
		const customer = await seller('u_end');
		await insertSubscription(db, { userId: 'u_end', stripeSubscriptionId: 'sub_u_end', status: 'active', currentPeriodStart: new Date(START * 1000), currentPeriodEnd: new Date(END * 1000) });
		const stripe = stripeServes({ sub_u_end: subscription('u_end', customer, { cancel_at_period_end: true }) });
		await deliver('evt_e1', 'customer.subscription.updated', { id: 'sub_u_end' });
		expect(await rowOf('u_end')).toMatchObject({ ending: 1 });
		stripe.sub_u_end = subscription('u_end', customer);
		await deliver('evt_e2', 'customer.subscription.updated', { id: 'sub_u_end' });
		expect(await rowOf('u_end')).toMatchObject({ ending: 0 });
		stripe.sub_u_end = subscription('u_end', customer, { status: 'canceled' });
		await deliver('evt_e3', 'customer.subscription.deleted', { id: 'sub_u_end' });
		expect(await rowOf('u_end')).toMatchObject({ status: 'canceled' });
		expect(subjects()).toEqual(['Pro ends on November 5', 'Your account is on Basic now']);
	});

	it("refuses a subscription whose account doesn't match its customer, and alerts", async () => {
		const customer = await seller('u_a');
		await insertUser(db, 'u_b');
		stripeServes({ sub_x: subscription('u_b', customer, { id: 'sub_x' }) });
		expect(await deliver('evt_x', 'customer.subscription.created', { id: 'sub_x' })).toBe(200);
		expect(await rowOf('u_a')).toBeNull();
		expect(await rowOf('u_b')).toBeNull();
		expect(await resultOf('evt_x')).toBe('refused');
		expect(alerted()).toBe(true);
	});

	it('keeps the first subscription when a second starts from another tab, and ignores a late event from an ended one', async () => {
		const customer = await seller('u_two');
		await insertSubscription(db, { userId: 'u_two', stripeSubscriptionId: 'sub_first', status: 'active', currentPeriodStart: new Date(START * 1000), currentPeriodEnd: new Date(END * 1000) });
		stripeServes({
			sub_second: subscription('u_two', customer, { id: 'sub_second', created: START + 60 }, 'price_premium'),
			sub_old: subscription('u_two', customer, { id: 'sub_old', status: 'canceled', created: START - 60 * DAY }),
		});
		await deliver('evt_s2', 'customer.subscription.created', { id: 'sub_second' });
		expect(await resultOf('evt_s2')).toBe('refused');
		expect(alerted()).toBe(true);
		await deliver('evt_old', 'customer.subscription.deleted', { id: 'sub_old' });
		expect(await resultOf('evt_old')).toBe('ignored');
		expect(await rowOf('u_two')).toMatchObject({ id: 'sub_first', status: 'active', plan: 'pro' });
	});
});

describe('extra credit webhooks', () => {
	const session = (userId: string, customer: string, overrides: Record<string, unknown> = {}) => ({
		id: `cs_${userId}`,
		mode: 'payment',
		customer,
		client_reference_id: userId,
		payment_status: 'paid',
		status: 'complete',
		amount_total: 1_800,
		currency: 'usd',
		payment_intent: `pi_${userId}`,
		metadata: { kind: 'credits', estori_user_id: userId, credits: '12000' },
		...overrides,
	});

	it('records a paid purchase once, even when its session is delivered twice, with one receipt', async () => {
		const customer = await seller('u_buy');
		stripeServes({ cs_u_buy: session('u_buy', customer) });
		const event = { id: 'cs_u_buy', payment_status: 'paid', metadata: { kind: 'credits' } };
		await deliver('evt_b1', 'checkout.session.completed', event);
		await deliver('evt_b2', 'checkout.session.completed', event);
		const purchases = await db.prepare("SELECT credits, amount_cents, stripe_payment_intent_id AS pi, expires_at - purchased_at AS valid FROM credit_purchases WHERE user_id = 'u_buy'").all();
		expect(purchases.results).toEqual([{ credits: 12_000, amount_cents: 1_800, pi: 'pi_u_buy', valid: expect.any(Number) }]);
		expect(Number(purchases.results[0].valid)).toBeGreaterThanOrEqual(365 * DAY);
		expect(subjects()).toEqual(['Your Estori receipt: 12,000 AI credits']);
	});

	it("refuses a purchase whose amount doesn't match the credits, and alerts", async () => {
		const customer = await seller('u_cheap');
		stripeServes({ cs_u_cheap: session('u_cheap', customer, { amount_total: 100 }) });
		await deliver('evt_cheap', 'checkout.session.completed', { id: 'cs_u_cheap', payment_status: 'paid', metadata: { kind: 'credits' } });
		expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_purchases WHERE user_id = 'u_cheap'").first()).toEqual({ n: 0 });
		expect(await resultOf('evt_cheap')).toBe('refused');
		expect(alerted()).toBe(true);
	});

	it('removes the refunded share of the unused credits, after taking the usage so far', async () => {
		await seller('u_ref');
		stripeServes({});
		const now = Date.now();
		await insertPurchase(db, { id: 'cp_ref', userId: 'u_ref', credits: 5_000, amountCents: 750, purchasedAt: new Date(now - DAY * 1000), expiresAt: new Date(now + 300 * DAY * 1000), paymentIntentId: 'pi_ref' });
		const period = { key: 'acct:1', startMs: now - DAY * 1000, endMs: now + 29 * DAY * 1000 };
		await new CreditLedgerService(env()).recordUse({ userId: 'u_ref', period, pool: 5_000, useKey: 'k_ref', credits: 6_000, source: 'think', model: 'm', usage: null, now: new Date(now) });
		await deliver('evt_r1', 'charge.refunded', { id: 'ch_ref', object: 'charge', payment_intent: 'pi_ref', amount: 750, amount_refunded: 375 });
		const purchase = () => db.prepare("SELECT used, refunded_cents AS refunded, removed_credits AS removed FROM credit_purchases WHERE id = 'cp_ref'").first();
		// 1,000 credits of overrun were used first; half of the 4,000 left is removed.
		expect(await purchase()).toEqual({ used: 1_000, refunded: 375, removed: 2_000 });
		await deliver('evt_r2', 'charge.refunded', { id: 'ch_ref', object: 'charge', payment_intent: 'pi_ref', amount: 750, amount_refunded: 750 });
		expect(await purchase()).toEqual({ used: 1_000, refunded: 750, removed: 4_000 });
		expect(subjects()).toEqual(['We refunded your extra credits', 'We refunded your extra credits']);
		expect(await deliver('evt_r3', 'charge.refunded', { id: 'ch_store', object: 'charge', payment_intent: 'pi_store_sale', amount: 4_600, amount_refunded: 4_600 })).toBe(200);
		expect(await resultOf('evt_r3')).toBeNull();
	});
});
```

- [ ] **Step 3: Write the failing jobs tests.** `worker/services/billing/jobs.sql.test.ts`:

```ts
/** The daily and hourly billing runs on real SQL, with Stripe stood in by fetch. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertBillingCustomer, insertPurchase, insertSubscription, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { runDailyBilling, runHourlyBilling } from './jobs';

let db: D1Database;
const DAY = 86_400_000;
const sent: string[] = [];

beforeAll(async () => {
	db = await migratedD1();
});

afterEach(() => {
	vi.restoreAllMocks();
	sent.length = 0;
});

function env(extra: Record<string, unknown> = {}): Env {
	return envWith(db, {
		BILLING: 'on',
		STRIPE_SECRET_KEY: 'sk_test_fake',
		STRIPE_PRICE_IDS: JSON.stringify({ pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' }),
		CUSTOM_DOMAIN: 'estori.app',
		ENVIRONMENT: 'prod',
		EMAIL: {
			send: async (message: { to: string }) => {
				sent.push(message.to);
				return { messageId: 'm1' };
			},
		},
		VibecoderStore: { get: async () => null, put: async () => undefined },
		...extra,
	});
}

describe('the daily billing run', () => {
	it('re-reads a subscription a webhook may have missed', async () => {
		const now = Date.parse('2026-10-19T06:35:00Z');
		await insertUser(db, 'u_rep');
		await insertBillingCustomer(db, 'u_rep', 'cus_rep');
		await insertSubscription(db, { userId: 'u_rep', stripeSubscriptionId: 'sub_rep', status: 'past_due', currentPeriodStart: new Date(now - 3 * DAY), currentPeriodEnd: new Date(now + 27 * DAY) });
		const paid = { id: 'sub_rep', customer: 'cus_rep', status: 'active', created: 1, cancel_at_period_end: false, cancel_at: null, metadata: { estori_user_id: 'u_rep' }, schedule: null, items: { data: [{ id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: (now - 3 * DAY) / 1000, current_period_end: (now + 27 * DAY) / 1000 }] } };
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(paid));
		await runDailyBilling(env(), now);
		expect(await db.prepare("SELECT status FROM subscriptions WHERE user_id = 'u_rep'").first()).toEqual({ status: 'active' });
		expect(await db.prepare("SELECT result FROM billing_events WHERE stripe_event_id = 'repair:sub_rep:2026-10-19'").first()).toEqual({ result: 'applied' });
	});

	it('settles overruns, closes ended periods, expires purchases and forgets old usage', async () => {
		const now = Date.parse('2026-10-19T06:35:00Z');
		await insertUser(db, 'u_day');
		await insertPurchase(db, { id: 'cp_day', userId: 'u_day', credits: 5_000, purchasedAt: new Date(now - 366 * DAY), expiresAt: new Date(now - DAY) });
		const ledger = new CreditLedgerService(env());
		const ended = { key: 'acct:ended', startMs: now - 40 * DAY, endMs: now - 10 * DAY };
		await ledger.recordUse({ userId: 'u_day', period: ended, pool: 5_000, useKey: 'k_old', credits: 6_000, source: 'think', model: 'm', usage: null, now: new Date(now - 100 * DAY) });
		await runDailyBilling(env(), now);
		expect(await db.prepare("SELECT settled, forgiven, closed_at IS NOT NULL AS closed FROM credit_periods WHERE user_id = 'u_day'").first()).toEqual({ settled: 1_000, forgiven: 0, closed: 1 });
		expect(await db.prepare("SELECT used, expired_at IS NOT NULL AS expired FROM credit_purchases WHERE id = 'cp_day'").first()).toEqual({ used: 1_000, expired: 1 });
		expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_uses WHERE user_id = 'u_day'").first()).toEqual({ n: 0 });
	});
});

describe('the hourly billing run', () => {
	it('tells Basic accounts with a verified email that their credits renewed, once, on their day', async () => {
		const now = Date.parse('2026-10-19T10:05:00Z');
		const signedUp = new Date('2026-09-19T08:00:00Z');
		await insertUser(db, 'u_today', { createdAt: signedUp, emailVerified: true });
		await insertUser(db, 'u_unverified', { createdAt: signedUp, emailVerified: false });
		await insertUser(db, 'u_other_day', { createdAt: new Date('2026-09-18T08:00:00Z'), emailVerified: true });
		await insertUser(db, 'u_paying', { createdAt: signedUp, emailVerified: true });
		await insertUser(db, 'u_new', { createdAt: new Date('2026-10-19T09:00:00Z'), emailVerified: true });
		await insertSubscription(db, { userId: 'u_paying', stripeSubscriptionId: 'sub_paying', status: 'active', currentPeriodStart: new Date(now - DAY), currentPeriodEnd: new Date(now + 29 * DAY) });
		await runHourlyBilling(env(), now);
		await runHourlyBilling(env(), now + 3_600_000);
		expect(sent).toHaveLength(1);
		expect(await db.prepare("SELECT user_id FROM billing_notices WHERE kind = 'credits_renewed'").all()).toMatchObject({ results: [{ user_id: 'u_today' }] });
	});

	it("renews an account made on the 31st on a short month's last day, and only for listed accounts while billing is limited", async () => {
		await insertUser(db, 'u_31', { createdAt: new Date('2026-08-31T08:00:00Z'), emailVerified: true });
		await runHourlyBilling(env({ BILLING: undefined, BILLING_USER_IDS: 'someone-else' }), Date.parse('2026-09-30T10:05:00Z'));
		expect(sent).toHaveLength(0);
		await runHourlyBilling(env(), Date.parse('2026-09-30T10:05:00Z'));
		expect(sent).toHaveLength(1);
	});
});
```

`worker/services/billing/wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { CATALOG_HEALTH_CRON } from '../catalog/health';
import { CATALOG_REFRESH_CRON, CATALOG_SWEEP_CRON } from '../catalog/scheduler';
import { runBillingSchedule } from './wiring';

const sources = import.meta.glob<string>(['/worker/index.ts', '/worker/api/controllers/payments/webhook.ts'], { query: '?raw', import: 'default', eager: true });

describe('billing schedule wiring', () => {
	it('runs the daily jobs on the daily schedule and the renewal emails hourly, and nothing on the others', async () => {
		const { d1, statements } = recordingD1();
		const env = { DB: d1, BILLING: 'on', ENVIRONMENT: 'dev' } as unknown as Env;
		await runBillingSchedule(CATALOG_REFRESH_CRON, env);
		expect(statements).toEqual([]);
		await runBillingSchedule(CATALOG_HEALTH_CRON, env);
		expect(statements.some((entry) => entry.sql.includes('"subscriptions"'))).toBe(true);
		expect(statements.some((entry) => entry.sql.includes('"credit_periods"'))).toBe(true);
		statements.length = 0;
		await runBillingSchedule(CATALOG_SWEEP_CRON, env);
		expect(statements.some((entry) => entry.sql.includes('users') && entry.sql.includes('billing_notices'))).toBe(true);
	});

	it('is called from the scheduled handler, and the webhook offers billing each platform event first', () => {
		expect(sources['/worker/index.ts']).toContain('ctx.waitUntil(runBillingSchedule(controller.cron, env));');
		const webhook = sources['/worker/api/controllers/payments/webhook.ts'] ?? '';
		const dispatch = webhook.slice(webhook.indexOf('async function dispatchStripeEvent('));
		expect(dispatch.indexOf('handleBillingEvent(')).toBeGreaterThan(dispatch.indexOf('CONNECT_EVENT_TYPES.includes(event.type)'));
		expect(dispatch.indexOf('handleBillingEvent(')).toBeLessThan(dispatch.indexOf('fulfillCheckoutSession('));
	});
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/subscription-row.test.ts worker/api/controllers/payments/webhook-billing.sql.test.ts`
Expected: FAIL, failed imports, and every billing delivery leaves no row.

Run: `rtk proxy bun run test -- worker/services/billing/jobs.sql.test.ts worker/services/billing/wiring.test.ts`
Expected: FAIL, failed imports.

- [ ] **Step 5: Implement `subscription-row.ts`.**

**`subscriptionRowFrom`:**
- The plan is `planOfPrice(items.data[0].price, ids)`; null when there's no item or no plan.
- The period is the first item's `current_period_start` and `current_period_end`, in milliseconds.
- `cancelAtPeriodEnd` is `cancel_at_period_end || cancel_at !== null`.
- The pending plan comes from an expanded schedule whose status is `active` or `not_started`:
  - its next phase is the first with `start_date > current_phase.start_date`;
  - that phase's first item's price (a string, or a price object's id) maps through `planOfPrice`;
  - a plan other than the current one sets `pendingPlan`, `pendingPlanAt = start_date * 1000` and `stripeScheduleId`.
  - Otherwise all three are null. A schedule that is only an id reads as no pending change; the webhook's re-read always expands it.
- `stripeCreatedAt` is `created * 1000`, and `updatedAt` is `nowMs`.

**`noticesFor(previous, next, { eventType, invoice })`** answers, in this order:
1. **`plan_started:{subId}`** when `next` is `active` or `trialing`, and `previous` is null, another subscription, or not `active`, `trialing` or `past_due`. Email `{ kind: 'plan_started', plan, renewsAt: periodEnd }`.
2. **`receipt:{invoiceId}`** for `invoice.paid` with `amount_paid > 0`. Email `{ kind: 'receipt', plan, amountCents, currency, periodStart, periodEnd, invoiceNumber, invoiceUrl }`, the period from `next`.
3. **`credits_renewed:{subscriptionPeriod(next).key}`** for `invoice.paid` with `billing_reason === 'subscription_cycle'`. Email `{ kind: 'credits_renewed', credits: PLAN_LIMITS[next.plan].aiCredits, renewsAt: periodEnd }`.
4. **`plan_upgraded:{subId}:{periodStartSeconds}`** when the same subscription goes from Pro to Premium.
5. **`downgrade_scheduled:{scheduleId}`** when `next.pendingPlan` is set and differs from `previous?.pendingPlan`. Email `{ kind: 'downgrade_scheduled', plan: pendingPlan, at: pendingPlanAt }`.
6. **`payment_failed:{invoiceId}`** for `invoice.payment_failed` when `next.status` is `past_due`. Email `{ kind: 'payment_failed', plan, graceEndsAt: graceEndsAt(next) }`.
7. **`plan_ending:{subId}:{periodEndSeconds}`** when `next.cancelAtPeriodEnd` and not `previous?.cancelAtPeriodEnd`, with `next` still live. Email `{ kind: 'plan_ending', plan, endsAt: periodEnd }`.
8. **`plan_ended:{subId}`** when `next.status` is `canceled`, `unpaid` or `incomplete_expired`, and `previous` was the same subscription in a live status. The reason is `'payment-failed'` when `previous.status` was `past_due`, else `'cancelled'`.

Steps 2 to 8 apply only when `previous` is the same subscription or null.

- [ ] **Step 6: Implement `events.ts`.**

```ts
/**
 * Billing's Stripe events. Each is recorded once in billing_events, in the same batch as what it changes. Rows are
 * rebuilt from Stripe's API at that moment, so retries and out-of-order deliveries converge on Stripe's latest state.
 * Emails go out only after the batch commits.
 */

const isLive = (status: string): boolean => (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

/** The account named by Stripe's metadata, when the stored customer and the checkout agree; otherwise null. */
async function accountOf(deps: BillingEventDeps, metadataUserId: string | null, customerId: string | null, expectedUserId: string | null): Promise<string | null> {
	if (!metadataUserId) return null;
	if (expectedUserId !== null && expectedUserId !== metadataUserId) return null;
	const customerUserId = customerId ? await deps.store.userOfCustomer(customerId) : null;
	return customerUserId === metadataUserId ? metadataUserId : null;
}

export async function applySubscription(deps: BillingEventDeps, input: SubscriptionTarget): Promise<BillingEventOutcome> {
	if (await deps.store.eventSeen(input.eventId)) return 'duplicate';
	const subscription = await deps.stripe.retrieveSubscription(input.subscriptionId);
	const now = new Date(deps.nowMs());
	const record = (userId: string | null, result: BillingEventResult, extra: Pick<BillingEventInput, 'row' | 'notices'> = {}) =>
		deps.store.recordEvent({ event: { id: input.eventId, type: input.eventType, objectId: subscription.id, userId, result }, now, ...extra });

	const userId = await accountOf(deps, subscription.metadata?.estori_user_id ?? null, subscription.customer, input.expectedUserId);
	if (!userId) {
		await deps.alert({ kind: 'billing-mismatch', subject: subscription.id, message: "The subscription's account doesn't match its Stripe customer, so nothing changed." });
		await record(null, 'refused');
		return 'refused';
	}
	const next = subscriptionRowFrom(subscription, userId, deps.priceIds, now.getTime());
	if (!next) {
		await deps.alert({ kind: 'billing-unknown-price', subject: subscription.id, message: 'The subscription has a price that is neither Pro nor Premium, so nothing changed.' });
		await record(userId, 'refused');
		return 'refused';
	}
	const previous = await deps.store.subscriptionOf(userId);
	const replacing = previous !== null && previous.stripeSubscriptionId !== next.stripeSubscriptionId && isLive(previous.status);
	if (previous && replacing) {
		if (!isLive(next.status)) {
			await record(userId, 'ignored');
			return 'ignored';
		}
		// Two live subscriptions: the one Stripe created first is kept.
		const keepPrevious = previous.stripeCreatedAt.getTime() <= next.stripeCreatedAt.getTime();
		const [kept, extra] = keepPrevious ? [previous, next] : [next, previous];
		await deps.alert({ kind: 'billing-second-subscription', subject: extra.stripeSubscriptionId, message: `The account pays through two subscriptions. Estori keeps ${kept.stripeSubscriptionId}; cancel and refund ${extra.stripeSubscriptionId} in Stripe.` });
		if (keepPrevious) {
			await record(userId, 'refused');
			return 'refused';
		}
	}
	const planned = replacing ? [] : noticesFor(previous, next, { eventType: input.eventType, invoice: input.invoice });
	const alreadySent = await deps.store.sentNoticeKeys(userId, planned.map((notice) => notice.key));
	const notices = planned.filter((notice) => !alreadySent.has(notice.key));
	try {
		await record(userId, 'applied', { row: next, notices: notices.map((notice) => ({ key: notice.key, kind: notice.email.kind })) });
	} catch (error) {
		// A concurrent delivery of the same event won; anything else is retried by Stripe.
		if (await deps.store.eventSeen(input.eventId)) return 'duplicate';
		throw error;
	}
	await deps.notify(userId, notices);
	return 'applied';
}
```

**`applyCreditPurchase(deps, { eventId, eventType, sessionId })`:**
1. `eventSeen` answers `'duplicate'`.
2. Re-read the session with `retrieveCheckoutSession`. Not `paid`: record `'ignored'`.
3. The account is `accountOf(metadata.estori_user_id, session.customer, client_reference_id)`.
4. `credits = Number(metadata.credits)` must pass `isExtraCreditsAmount`, and `amount_total` must equal `extraCreditsPriceCents(credits)`. Promotion codes are off for credits, so the amounts match exactly.
5. Any check failing: alert `billing-mismatch` and record `'refused'`.
6. `purchaseBySession(sessionId)` already there: record `'ignored'` and answer `'duplicate'`.
7. Otherwise record `'applied'` with:
   - `purchase: { id: generateId(), userId, credits, amountCents, stripeCheckoutSessionId, stripePaymentIntentId: session.payment_intent, purchasedAt: now, expiresAt: new Date(addMonths(now, EXTRA_CREDITS.monthsValid)) }`;
   - the notice `credits_receipt:{sessionId}`, email `{ kind: 'credits_receipt', credits, amountCents, expiresAt, receiptNumber: payment_intent ?? sessionId }`.
8. A unique violation is retried by Stripe and then lands on step 1 or 6. Notify after the batch.

**`applyCreditRefund(deps, { eventId, eventType, charge })`:**
1. `purchaseByPaymentIntent(charge.payment_intent)`; none answers null, so other refunds aren't billing's.
2. `eventSeen` answers `'duplicate'`.
3. `ledger.settle(purchase.userId, nowMs)`, so usage up to now is taken first. Then read the purchase again.
4. Work out the removal:
   - `unusedBase = credits - used`;
   - `removed = Math.max(purchase.removedCredits, Math.floor((unusedBase * charge.amount_refunded) / purchase.amountCents))`, capped at `unusedBase`;
   - `removed` equal to `removedCredits` with the same refunded cents: record `'ignored'`.
5. Record `'applied'` with:
   - `refund: { purchaseId, refundedCents: charge.amount_refunded, removedCredits: removed }`;
   - the notice `credits_refunded:{charge.id}:{amount_refunded}`, email `{ kind: 'credits_refunded', credits: removed - before, amountCents: amount_refunded - refundedBefore }`.

**`handleBillingEvent(deps, event)`:**

| Event | Handled as |
| --- | --- |
| `checkout.session.completed` with `metadata.kind === CHECKOUT_KIND_CREDITS` | `applyCreditPurchase` |
| `checkout.session.completed` with `mode === 'subscription'` and a `subscription` id | `applySubscription`, `expectedUserId: client_reference_id` |
| `customer.subscription.created`, `.updated`, `.deleted` | `applySubscription` for `object.id` |
| `invoice.paid`, `invoice.payment_failed` with `parent.subscription_details.subscription` | `applySubscription` with the invoice |
| `subscription_schedule.created`, `.updated`, `.released`, `.canceled` | `applySubscription` for `subscription ?? released_subscription` |
| `charge.refunded` | `applyCreditRefund` |
| anything else | null |

Type guards (`isStripeInvoice`, `isStripeSchedule`, `isStripeCharge`, `hasStringId`) live in `events.ts`. They check only the fields read.

- [ ] **Step 7: The jobs, the wiring and the webhook.**

**`periods.ts` gains:**
- `addMonths(ms, months)`: the same UTC day and time `months` later, the day clamped to the month's last day.
- `renewalDaysOf(nowMs)`: `[today's day]`, or every day from today's to 31 when today is the month's last day.

**`flag.ts` gains `billingAudience(env)`:** `'everyone'` when `BILLING` is on, else the parsed `BILLING_USER_IDS`. `isBillingOn` uses it.

**`BillingService.accountsRenewing({ dayStartMs, days, userIds, limit })`** selects user ids:

```sql
SELECT u.id FROM users u
WHERE u.email_verified = 1 AND u.deleted_at IS NULL
  AND (CASE WHEN typeof(u.created_at) = 'integer' THEN CAST(strftime('%d', u.created_at, 'unixepoch') AS INTEGER) ELSE 1 END) IN (:days)
  AND (typeof(u.created_at) <> 'integer' OR u.created_at < :dayStartSeconds)
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active', 'trialing', 'past_due'))
  AND NOT EXISTS (SELECT 1 FROM billing_notices n WHERE n.user_id = u.id AND n.notice_key = :key)
  [AND u.id IN (:userIds)]
LIMIT :limit
```

- `:key` is `credits_renewed:acct:{dayStartSeconds}`.
- Old rows whose `created_at` holds the text default renew on the 1st, as `anniversaryPeriod` treats them.
- Write it with drizzle's `sql` template and `inArray`.

**`CreditLedgerService.purchaseBySession(sessionId)`:** a plain select.

**`jobs.ts`:**

```ts
const SETTLE_PER_RUN = 500;
const RENEWALS_PER_RUN = 100;
const KEEP_USES_MS = 90 * DAY_MS;

/** Daily: re-read suspicious subscriptions, settle and close credit periods, expire purchases, forget old usage. */
export async function runDailyBilling(env: Env, nowMs: number): Promise<void> {
	const deps = billingEventDepsFromEnv(env);
	const day = new Date(nowMs).toISOString().slice(0, 10);
	for (const row of await new BillingService(env).subscriptionsToRepair(nowMs)) {
		try {
			await applySubscription(deps, { eventId: `repair:${row.stripeSubscriptionId}:${day}`, eventType: 'repair', subscriptionId: row.stripeSubscriptionId, expectedUserId: row.userId, invoice: null });
		} catch (error) {
			logger.error('Could not repair a subscription', { subscriptionId: row.stripeSubscriptionId, error });
		}
	}
	const ledger = new CreditLedgerService(env);
	for (const userId of await ledger.usersToSettle(nowMs, SETTLE_PER_RUN)) {
		try {
			// A purchase pays for usage up to its expiry before it goes; a raced settle waits for tomorrow's run.
			if ((await ledger.settle(userId, nowMs)) !== 'raced') await ledger.expirePurchases(userId, nowMs);
		} catch (error) {
			logger.error('Could not settle credits', { userId, error });
		}
	}
	await ledger.pruneUses(nowMs - KEEP_USES_MS);
}
```

**`runHourlyBilling(env, nowMs)`** sends the renewal emails for accounts without a subscription:
1. Answer at once when the audience is an empty list.
2. `dayStartMs` is today's UTC midnight. Read `accountsRenewing` with `renewalDaysOf(nowMs)`, the audience, and `RENEWALS_PER_RUN`.
3. For each account:
   - `loadAccount(env, userId, nowMs)`;
   - skip it when `source === 'subscription'` or `period.startMs !== dayStartMs`;
   - otherwise `claimAndSendNotice(claimingMailFromEnv(env), userId, { key: `credits_renewed:${period.key}`, email: { kind: 'credits_renewed', credits: limits.aiCredits, renewsAt: period.endMs } })`.
   - Each account is caught and logged on its own.

**`wiring.ts`:**
- **`billingEventDepsFromEnv(env)`:**
  - `stripe`: `stripeFromEnv(env)`, or one whose calls throw "Stripe is not configured";
  - `store`: `new BillingService(env)`, and `ledger`: `new CreditLedgerService(env)`;
  - `priceIds`: `stripePriceIds(env.STRIPE_PRICE_IDS)`;
  - `notify`: `sendBillingEmails(billingMailFromEnv(env), …)`;
  - `alert`: `platformAlertsFromEnv(env)`;
  - `nowMs`: `Date.now`.
- **`runBillingSchedule(cron, env)`:** `runDailyBilling` on `CATALOG_HEALTH_CRON`, `runHourlyBilling` on `CATALOG_SWEEP_CRON`, nothing otherwise. It catches and logs, like `runShopperEmailSchedule`.

**Platform alerts:** add `billing-mismatch` ("A billing event didn't match its account"), `billing-second-subscription` ("An account pays through two subscriptions") and `billing-unknown-price` ("A subscription has an unknown price") to `PLATFORM_ALERT_KINDS` and `ALERT_LABELS`. Update any test that lists the kinds.

**`webhook.ts`:** in `dispatchStripeEvent`, right after the Connect filter:

```ts
    const billing = await handleBillingEvent(billingEventDepsFromEnv(env), event);
    if (billing !== null) {
        logger.info('Billing event handled', { id: event.id, type: event.type, result: billing });
        return;
    }
```

Update the header comment to say it also records plans and extra credits.

**`worker/index.ts`:** add `ctx.waitUntil(runBillingSchedule(controller.cron, env));` after the shopper email line.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/subscription-row.test.ts worker/api/controllers/payments/webhook-billing.sql.test.ts worker/api/controllers/payments/webhook-store.test.ts worker/api/controllers/payments/webhook.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- worker/services/billing/jobs.sql.test.ts worker/services/billing/wiring.test.ts worker/services/alerts/platform-alerts.test.ts worker/services/billing/periods.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add worker/services/billing worker/api/controllers/payments/webhook.ts worker/api/controllers/payments/webhook-billing.sql.test.ts worker/index.ts worker/services/alerts/platform-alerts.ts worker/services/alerts/platform-alerts.test.ts worker/database/services/BillingService.ts worker/database/services/CreditLedgerService.ts
git commit -m "feat(billing): record plans, extra credits and refunds from stripe's webhooks, and run the daily repair, settling and renewal emails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Charging credits, the check before a turn, and the Upgrade dialog

**Files:**
- Create:
  - worker: `worker/services/billing/credit-notices.ts`, `worker/services/billing/metering.ts`, `worker/services/billing/usage-summary.ts`;
  - frontend: `src/lib/plan-limit-events.ts`, `src/components/billing/upgrade-action.ts`, `src/components/billing/UpgradeDialog.tsx`.
- Modify:
  - Think: `worker/agents/think/ThinkAgent.ts`, `worker/agents/think/model-wiring.test.ts`;
  - prompts: `worker/agents/core/websocket.ts`, `worker/api/websocketTypes.ts`, `worker/api/controllers/agent/controller.ts`;
  - older calls: `worker/agents/inferutils/core.ts`;
  - usage: `worker/api/controllers/limits/controller.ts`;
  - frontend: `src/hooks/use-limits.ts`, `src/components/usage-limits-badge.tsx`, `src/utils/usage-limit-checker.tsx`, `src/lib/api-client.ts`, `src/routes/chat/utils/handle-websocket-message.ts`, `src/App.tsx`.
- Test:
  - `worker/services/billing/credit-notices.test.ts`;
  - `worker/services/billing/metering.sql.test.ts`;
  - `worker/agents/core/websocket.test.ts`;
  - `worker/agents/think/model-wiring.test.ts`;
  - `src/components/billing/upgrade-action.test.ts`;
  - `src/components/billing/billing-ui-guard.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 1: `assertWithinLimit`, `isPlanLimitRefusal`, `PlanLimitRefusal`, `PlanLimitKey`, `planName`;
  - from Task 2: `stepCredits`, `stepUsageFrom`, `legacyCallCredits`, `TokenPrices`, `ThinkModel.prices`, `creditsPerStep`;
  - from Task 3: `PLAN_LIMIT_ERROR_CODE`, `BILLING_PATH`;
  - from Task 4: `CreditLedgerService.recordUse`, `readBalance`, `alertsMayBeDue`, `creditAlertDue`, `creditAlertKey`, `PeriodState`, `LedgerPeriod`;
  - from Task 5: `isBillingOn`, `loadAccount`, `loadCredits`;
  - from Task 7: `claimAndSendNotice`, `claimingMailFromEnv`, `ClaimingMailDeps`;
  - from Task 8: `planLimitResponse`, `createPlanLimitResponse`, `apiClient.startPlanCheckout`.
- **Produces:**
  - `credit-notices.ts`:
    - `CreditUse { userId: string; plan: PlanId; period: LedgerPeriod; pool: number; state: PeriodState }`;
    - `CreditNoticeDeps { readBalance(userId: string, period: LedgerPeriod, pool: number): Promise<CreditBalance>; mail: ClaimingMailDeps }`;
    - `noticeCreditUse(deps, use): Promise<CreditAlert | null>` (the alert sent, if any; never throws);
    - `creditNoticeDepsFromEnv(env)`.
  - `metering.ts`:
    - `CreditCheck = { billing: false } | { billing: true; refusal: PlanLimitRefusal | null }`;
    - `creditRefusal(account: PlanAccount, balance: CreditBalance): PlanLimitRefusal | null`;
    - `checkCreditsBeforeTurn(env: Env, userId: string, nowMs?: number): Promise<CreditCheck>`;
    - `StepCharge { userId; period: LedgerPeriod; pool: number; plan: PlanId; useKey: string; credits: number; source: 'think' | 'infer'; model: string; usage: StepUsage | null }`;
    - `MeteringDeps { ledger: Pick<CreditLedgerService, 'recordUse'>; notices: CreditNoticeDeps; now(): Date }`;
    - `chargeStep(deps, charge): Promise<PeriodState | null>` (up to 3 tries; never throws);
    - `meteringDepsFromEnv(env)`;
    - `chargeLegacyCall(env, input: { userId: string; model: string; creditCost: number }): Promise<boolean>` (true when billing took the charge).
  - `usage-summary.ts`: `billingUsage(account: BillingAccount, balance: CreditBalance)`, the limit, usage and check fields of `GET /api/limits/usage`.
  - `ThinkAgent.turnCreditsUsed(): number`.
  - `ErrorMessage` (WebSocket) gains `planLimit?: PlanLimitRefusal`.
  - Frontend:
    - `announcePlanLimit(refusal)`, `onPlanLimit(listener): () => void`;
    - `UpgradeAction`, `upgradeActionFor(refusal)`, `UPGRADE_TITLES: Record<PlanLimitKey, string>`;
    - `UpgradeDialog`, `UpgradeDialogHost`;
    - `ApiError.planLimit: PlanLimitRefusal | null`;
    - `UsageSummary.billing?: { plan: PlanId; renewsAt: number } | null`.

- [ ] **Step 1: Write the failing notice test** `worker/services/billing/credit-notices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { creditBalance, type PeriodState } from './credit-ledger';
import { noticeCreditUse, type CreditNoticeDeps } from './credit-notices';
import type { OutgoingEmail } from '../email/types';

const PERIOD = { key: 'acct:1790812800', startMs: 1_790_812_800_000, endMs: 1_793_404_800_000 };

function state(used: number): PeriodState {
	return { key: PERIOD.key, startMs: PERIOD.startMs, endMs: PERIOD.endMs, pool: 5_000, granted: 0, used, settled: 0, closed: false };
}

function deps(purchased = 0) {
	const sent: OutgoingEmail[] = [];
	const claimed = new Set<string>();
	let reads = 0;
	let current = state(0);
	const fake: CreditNoticeDeps = {
		readBalance: async () => {
			reads += 1;
			return creditBalance({ current, open: [], purchases: purchased > 0 ? [{ id: 'cp', credits: purchased, used: 0, removed: 0, purchasedAtMs: 0, expiresAtMs: Number.MAX_SAFE_INTEGER }] : [] });
		},
		mail: {
			sender: { send: async (email) => void sent.push(email) },
			userEmail: async () => 'ana@example.test',
			baseUrl: 'https://estori.app',
			claim: async (_userId, key) => {
				if (claimed.has(key)) return false;
				claimed.add(key);
				return true;
			},
		},
	};
	return { fake, sent, reads: () => reads, at: (used: number) => (current = state(used)) };
}

describe('noticeCreditUse', () => {
	it('warns at 20% and 5% of the credits left, each once a period, and skips the read while the pool is above 20%', async () => {
		const { fake, sent, reads, at } = deps();
		const use = (used: number) => noticeCreditUse(fake, { userId: 'u1', plan: 'basic', period: PERIOD, pool: 5_000, state: at(used) });
		expect(await use(3_000)).toBeNull();
		expect(reads()).toBe(0);
		expect(await use(4_000)).toBe('credits_20');
		expect(await use(4_100)).toBeNull();
		expect(await use(4_800)).toBe('credits_5');
		expect(await use(5_200)).toBeNull();
		expect(sent.map((email) => email.subject)).toEqual(['You have 20% of your AI credits left', 'You have 5% of your AI credits left']);
	});

	it('counts purchased credits in what is left', async () => {
		const { fake, sent, at } = deps(5_000);
		expect(await noticeCreditUse(fake, { userId: 'u1', plan: 'premium', period: PERIOD, pool: 5_000, state: at(4_500) })).toBeNull();
		expect(sent).toEqual([]);
	});
});
```

- [ ] **Step 2: Write the failing metering test** `worker/services/billing/metering.sql.test.ts`:

```ts
/** The credit check before a turn, and charging steps, on real SQL. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertPurchase, insertSubscription, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { loadAccount } from './account';
import { chargeLegacyCall, chargeStep, checkCreditsBeforeTurn, type MeteringDeps } from './metering';

let db: D1Database;
const NOW = Date.parse('2026-10-19T15:00:00Z');
const DAY = 86_400_000;

beforeAll(async () => {
	db = await migratedD1();
});

const on = () => envWith(db, { BILLING: 'on' });

async function use(userId: string, credits: number, key = `k_${userId}_${credits}`): Promise<void> {
	const account = await loadAccount(on(), userId, NOW);
	await new CreditLedgerService(on()).recordUse({ userId, period: account.period, pool: account.limits.aiCredits, useKey: key, credits, source: 'think', model: 'm', usage: null, now: new Date(NOW) });
}

describe('checkCreditsBeforeTurn', () => {
	it('checks nothing new while billing is off', async () => {
		await insertUser(db, 'u_off');
		expect(await checkCreditsBeforeTurn(envWith(db), 'u_off', NOW)).toEqual({ billing: false });
	});

	it("starts a turn with any credit left, and refuses with the plan's message once none is", async () => {
		await insertUser(db, 'u_basic', { createdAt: new Date('2026-03-12T09:00:00Z') });
		await use('u_basic', 4_999);
		expect(await checkCreditsBeforeTurn(on(), 'u_basic', NOW)).toEqual({ billing: true, refusal: null });
		await use('u_basic', 1);
		expect(await checkCreditsBeforeTurn(on(), 'u_basic', NOW)).toEqual({
			billing: true,
			refusal: { code: 'plan_limit', limit: 'aiCredits', plan: 'basic', upgradeTo: 'pro', message: "You've used this month's free AI credits. They refill on November 12, or get Pro for 20,000 a month." },
		});
	});

	it('counts extra credits as left, and points Premium at buying more once they are gone', async () => {
		await insertUser(db, 'u_prem');
		await insertSubscription(db, { userId: 'u_prem', stripeSubscriptionId: 'sub_prem', status: 'active', plan: 'premium', currentPeriodStart: new Date(NOW - DAY), currentPeriodEnd: new Date(NOW + 29 * DAY) });
		await insertPurchase(db, { id: 'cp_prem', userId: 'u_prem', credits: 5_000, purchasedAt: new Date(NOW - 2 * DAY), expiresAt: new Date(NOW + 300 * DAY) });
		await use('u_prem', 100_000);
		expect(await checkCreditsBeforeTurn(on(), 'u_prem', NOW)).toEqual({ billing: true, refusal: null });
		await use('u_prem', 5_000);
		expect(await checkCreditsBeforeTurn(on(), 'u_prem', NOW)).toMatchObject({ refusal: { plan: 'premium', upgradeTo: 'credits' } });
	});
});

describe('chargeStep', () => {
	it('records a step after a passing failure, once, with the same key', async () => {
		await insertUser(db, 'u_retry', { createdAt: new Date('2026-03-12T09:00:00Z') });
		const account = await loadAccount(on(), 'u_retry', NOW);
		const ledger = new CreditLedgerService(on());
		let failures = 1;
		const deps: MeteringDeps = {
			ledger: {
				recordUse: async (input) => {
					if (failures-- > 0) throw new Error('D1_ERROR: network connection lost');
					return ledger.recordUse(input);
				},
			},
			notices: { readBalance: (userId, period, pool) => ledger.readBalance(userId, period, pool), mail: { sender: null, userEmail: async () => null, baseUrl: null, claim: async () => true } },
			now: () => new Date(NOW),
		};
		const charge = { userId: 'u_retry', period: account.period, pool: 5_000, plan: 'basic' as const, useKey: 'agent:turn:1', credits: 165, source: 'think' as const, model: 'anthropic/claude-sonnet-5-5', usage: { inputTokens: 40_000, outputTokens: 3_000 } };
		expect((await chargeStep(deps, charge))?.used).toBe(165);
		expect((await chargeStep(deps, charge))?.used).toBe(165);
		expect(await db.prepare("SELECT credits, input_tokens, output_tokens FROM credit_uses WHERE use_key = 'agent:turn:1'").first()).toEqual({ credits: 165, input_tokens: 40_000, output_tokens: 3_000 });
	});
});

describe('chargeLegacyCall', () => {
	it("charges an older AI call its old flat cost in the new unit, and leaves it to today's counter while billing is off", async () => {
		await insertUser(db, 'u_infer', { createdAt: new Date('2026-03-12T09:00:00Z') });
		expect(await chargeLegacyCall(envWith(db), { userId: 'u_infer', model: 'anthropic/claude-sonnet-5-5', creditCost: 8 })).toBe(false);
		expect(await chargeLegacyCall(on(), { userId: 'u_infer', model: 'anthropic/claude-sonnet-5-5', creditCost: 8 })).toBe(true);
		expect(await db.prepare("SELECT credits, source FROM credit_uses WHERE user_id = 'u_infer'").first()).toEqual({ credits: 136, source: 'infer' });
	});
});
```

In the Premium case the pool is 100,000 and 5,000 extra credits are left after it, so the turn starts; once those are used too, nothing is left.

- [ ] **Step 3: Write the failing WebSocket and wiring tests.** Add to `worker/agents/core/websocket.test.ts`:

```ts
import type { checkCreditsBeforeTurn } from '../../services/billing/metering';

function creditCheck(order: string[], result: Awaited<ReturnType<typeof checkCreditsBeforeTurn>>): typeof checkCreditsBeforeTurn {
	return async () => {
		order.push('credit-check');
		return result;
	};
}

const REFUSAL = { code: 'plan_limit' as const, limit: 'aiCredits' as const, plan: 'basic' as const, upgradeTo: 'pro' as const, message: "You've used this month's free AI credits. They refill on November 12, or get Pro for 20,000 a month." };

describe('the credit check before a turn', () => {
	it('refuses with the plan limit and skips the old usage check while billing is on', async () => {
		const order: string[] = [];
		const { agent, connection, sent, calls } = fakes({ setModel: async () => undefined });
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), recordingCheck(order, { allowed: true }), creditCheck(order, { billing: true, refusal: REFUSAL }));
		expect(order).toEqual(['credit-check']);
		expect(calls).toEqual([]);
		expect(sent).toEqual([{ type: 'error', error: REFUSAL.message, code: 'PLAN_LIMIT', planLimit: REFUSAL, showAsPopup: true }]);
	});

	it('lets the turn start with credit left, and keeps the old check while billing is off', async () => {
		const order: string[] = [];
		const { agent, connection } = fakes({ setModel: async () => undefined }, order);
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), recordingCheck(order, { allowed: true }), creditCheck(order, { billing: true, refusal: null }));
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), recordingCheck(order, { allowed: true }), creditCheck(order, { billing: false }));
		expect(order).toEqual(['credit-check', `input:${RESUME_BUILD_MESSAGE}`, 'credit-check', 'usage-check', `input:${RESUME_BUILD_MESSAGE}`]);
	});
});
```

Replace the metering test in `worker/agents/think/model-wiring.test.ts`:

```ts
	it("charges each step from its real usage at the turn's model prices, or by the old daily counter while billing is off", () => {
		const agent = source('/worker/agents/think/ThinkAgent.ts');
		const beforeTurn = agent.slice(agent.indexOf('override async beforeTurn('), agent.indexOf('override getSkills('));
		const beforeStep = agent.slice(agent.indexOf('override async beforeStep('), agent.indexOf('override async onStepFinish('));
		const onStepFinish = agent.slice(agent.indexOf('override async onStepFinish('), agent.indexOf('turnCreditsUsed(): number'));
		expect(beforeTurn).toContain('resolveThinkModel(');
		expect(beforeTurn).toContain('ctx.model');
		expect(beforeTurn).toContain('isBillingOn(this.env, config.userId)');
		expect(beforeTurn).toContain('prices: model.prices');
		expect(beforeTurn).toContain('creditCost');
		expect(beforeStep).toContain('this.turnUsage.creditCost');
		expect(beforeStep).not.toContain('resolveThinkModel');
		expect(onStepFinish).toContain('stepCredits(usage.prices, stepUsage, usage.typical)');
		expect(onStepFinish).toContain('useKey: `${this.name}:${usage.turnId}:${ctx.stepNumber}`');
		expect(onStepFinish).not.toContain('resolveThinkModel');
	});
```

Add to `worker/agents/think/model-wiring.test.ts`'s `describe`:

```ts
	it('checks credits before a new store starts, and charges older AI calls through billing when it is on', () => {
		const controller = source('/worker/api/controllers/agent/controller.ts');
		const credit = controller.indexOf('checkCreditsBeforeTurn(env, user.id)');
		expect(credit).toBeGreaterThan(-1);
		expect(credit).toBeLessThan(controller.indexOf('enforceAppCreationRateLimit('));
		expect(controller).toContain('createPlanLimitResponse(credits.refusal)');
		const infer = source('/worker/agents/inferutils/core.ts');
		expect(infer.indexOf('chargeLegacyCall(env,')).toBeLessThan(infer.indexOf('RateLimitService.enforceLLMCallsRateLimit('));
	});
```

Add `'/worker/agents/inferutils/core.ts'` to its glob.

- [ ] **Step 4: Write the failing frontend tests.** `src/components/billing/upgrade-action.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PlanLimitRefusal } from '@/api-types';
import { announcePlanLimit, onPlanLimit } from '@/lib/plan-limit-events';
import { UPGRADE_TITLES, upgradeActionFor } from './upgrade-action';

function refusal(overrides: Partial<PlanLimitRefusal> = {}): PlanLimitRefusal {
	return { code: 'plan_limit', limit: 'liveStores', plan: 'basic', upgradeTo: 'pro', message: 'Basic includes 1 live store. Get Pro for up to 3, or Premium for up to 10.', ...overrides };
}

describe('the Upgrade dialog', () => {
	it('starts a checkout from Basic, moves Pro up on the billing page, sells Premium credits, and sends the rest to sales', () => {
		expect(upgradeActionFor(refusal())).toEqual({ kind: 'checkout', plan: 'pro', label: 'Get Pro' });
		expect(upgradeActionFor(refusal({ limit: 'extraCredits', upgradeTo: 'premium' }))).toEqual({ kind: 'checkout', plan: 'premium', label: 'Get Premium' });
		expect(upgradeActionFor(refusal({ plan: 'pro', upgradeTo: 'premium' }))).toEqual({ kind: 'link', to: '/settings/billing?plan=premium', label: 'Move to Premium' });
		expect(upgradeActionFor(refusal({ plan: 'premium', limit: 'aiCredits', upgradeTo: 'credits' }))).toEqual({ kind: 'link', to: '/settings/billing#extra-credits', label: 'Buy credits' });
		expect(upgradeActionFor(refusal({ plan: 'premium', upgradeTo: 'enterprise' }))).toEqual({ kind: 'link', to: '/contact?topic=enterprise', label: 'Talk to us' });
		expect(upgradeActionFor(refusal({ plan: 'enterprise', upgradeTo: null }))).toEqual({ kind: 'none' });
	});

	it('has a title for every limit', () => {
		expect(Object.keys(UPGRADE_TITLES).sort()).toEqual(['aiCredits', 'extraCredits', 'liveStores', 'newStoresPerDay', 'ownDomainsPerLiveStore', 'storesLifetime', 'supplierCatalog']);
	});

	it('hands each refusal to whoever listens, until they stop', () => {
		const heard: string[] = [];
		const stop = onPlanLimit((entry) => heard.push(entry.limit));
		announcePlanLimit(refusal());
		stop();
		announcePlanLimit(refusal({ limit: 'aiCredits' }));
		expect(heard).toEqual(['liveStores']);
	});
});
```

`src/components/billing/billing-ui-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/lib/api-client.ts', '/src/routes/chat/utils/handle-websocket-message.ts', '/src/App.tsx', '/src/utils/usage-limit-checker.tsx', '/src/components/usage-limits-badge.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('plan limits in the app', () => {
	it('opens one Upgrade dialog for every refusal, from the API and from the build socket', () => {
		const client = source('/src/lib/api-client.ts');
		expect(client).toContain('isPlanLimitRefusal(data?.error?.planLimit)');
		expect(client.match(/announcePlanLimit\(/g)?.length).toBeGreaterThanOrEqual(2);
		const socket = source('/src/routes/chat/utils/handle-websocket-message.ts');
		expect(socket).toContain('errorData.code === PLAN_LIMIT_ERROR_CODE');
		expect(socket).toContain('announcePlanLimit(errorData.planLimit)');
		expect(source('/src/App.tsx')).toContain('<UpgradeDialogHost />');
	});

	it("stops asking for a Cloudflare account while billing is on, and shows the credits left to everyone", () => {
		const checker = source('/src/utils/usage-limit-checker.tsx');
		expect(checker).toContain('if (limitsData.billing) return { canProceed: true };');
		const badge = source('/src/components/usage-limits-badge.tsx');
		expect(badge).toContain('!data.cloudflareConnectEnabled && !data.billing');
	});
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/credit-notices.test.ts worker/services/billing/metering.sql.test.ts worker/agents/core/websocket.test.ts worker/agents/think/model-wiring.test.ts`
Expected: FAIL, failed imports and the new wiring missing.

Run: `rtk proxy bun run test -- src/components/billing/upgrade-action.test.ts src/components/billing/billing-ui-guard.test.ts`
Expected: FAIL.

- [ ] **Step 6: Implement the notices and metering.**

**`credit-notices.ts`:**

```ts
/** The 20% and 5% warnings: checked after a step is charged, sent once a period each, never throwing. */
export async function noticeCreditUse(deps: CreditNoticeDeps, use: CreditUse): Promise<CreditAlert | null> {
	try {
		if (!alertsMayBeDue(use.state)) return null;
		const balance = await deps.readBalance(use.userId, use.period, use.pool);
		const alert = creditAlertDue(balance);
		if (!alert) return null;
		const email = { kind: alert, plan: use.plan, left: balance.left, renewsAt: use.period.endMs };
		return (await claimAndSendNotice(deps.mail, use.userId, { key: creditAlertKey(alert, use.period.key), email })) === 'sent' ? alert : null;
	} catch (error) {
		logger.error('Could not check the credit warnings', { userId: use.userId, error });
		return null;
	}
}
```

`creditNoticeDepsFromEnv(env)` is `{ readBalance: (…) => new CreditLedgerService(env).readBalance(…), mail: claimingMailFromEnv(env) }`.

**`metering.ts`:**

```ts
const RECORD_TRIES = 3;

export function creditRefusal(account: PlanAccount, balance: CreditBalance): PlanLimitRefusal | null {
	return assertWithinLimit(account, 'aiCredits', account.limits.aiCredits - balance.left);
}

/** Before a turn: some credit must be left. A started turn always finishes; its overrun is settled later. */
export async function checkCreditsBeforeTurn(env: Env, userId: string, nowMs = Date.now()): Promise<CreditCheck> {
	if (!isBillingOn(env, userId)) return { billing: false };
	const account = await loadAccount(env, userId, nowMs);
	return { billing: true, refusal: creditRefusal(account, await loadCredits(env, account)) };
}

/** Records a charged step with the same key up to three times, then checks the warnings. */
export async function chargeStep(deps: MeteringDeps, charge: StepCharge): Promise<PeriodState | null> {
	let failure: unknown = null;
	for (let attempt = 0; attempt < RECORD_TRIES; attempt += 1) {
		try {
			const state = await deps.ledger.recordUse({ ...charge, now: deps.now() });
			await noticeCreditUse(deps.notices, { userId: charge.userId, plan: charge.plan, period: charge.period, pool: charge.pool, state });
			return state;
		} catch (error) {
			failure = error;
		}
	}
	logger.error('A charged step could not be recorded', { useKey: charge.useKey, credits: charge.credits, error: failure });
	return null;
}
```

- **`meteringDepsFromEnv(env)`:** `{ ledger: new CreditLedgerService(env), notices: creditNoticeDepsFromEnv(env), now: () => new Date() }`.
- **`chargeLegacyCall(env, { userId, model, creditCost })`:**
  - answers false when `!isBillingOn(env, userId)`;
  - otherwise loads the account and charges `legacyCallCredits(creditCost)` with `source: 'infer'`, `useKey: `infer:${userId}:${crypto.randomUUID()}``, `usage: null`;
  - answers true. Charging never refuses: the turn's check came first.

**`usage-summary.ts`:** `billingUsage(account, balance)` answers:
- `config: { limit: { type: 'credits', window: 'monthly', maxValue: balance.available, enabled: true, resetAt: new Date(account.period.endMs).toISOString() }, unlimited: false }`;
- `usage: { credits: { monthly: balance.used } }`;
- `limitCheck: { withinLimits: balance.left > 0, exceededLimits: [], message: balance.left > 0 ? 'Within limits' : 'Limit exceeded' }`;
- `billing: { plan: account.plan, renewsAt: account.period.endMs }`.

- [ ] **Step 7: Charge Think's steps.** In `ThinkAgent.ts`:

```ts
	/** Metering fixed when the turn starts, so a mid-turn model switch can't reprice its steps. */
	private turnUsage:
		| { mode: 'credits'; userId: string; plan: PlanId; period: LedgerPeriod; pool: number; turnId: string; model: string; prices: TokenPrices; typical: number }
		| { mode: 'daily'; config: RateLimitSettings; hasCloudflareConfigured: boolean; creditCost: number }
		| null = null;
	private turnCredits = 0;
```

**`beforeTurn`:**
- resets `turnCredits`;
- resolves `const model = resolveThinkModel(turnModelId)`;
- with `isBillingOn(this.env, config.userId)`: `loadAccount`, then `{ mode: 'credits', userId, plan: account.plan, period: account.period, pool: account.limits.aiCredits, turnId: crypto.randomUUID(), model: model.id, prices: model.prices, typical: model.creditsPerStep }`;
- otherwise today's object, with `mode: 'daily'` and `creditCost: model.config.creditCost`;
- keeps the `try`/`catch` and its warning.

**`beforeStep`:** calls `enforceLLMCallsRateLimit` only when `this.turnUsage?.mode === 'daily'`, unchanged otherwise.

**`onStepFinish` and `turnCreditsUsed`,** after `beforeStep`:

```ts
	/** Charges the step just finished from the tokens it used; a failed record is retried, and never fails the turn. */
	override async onStepFinish(ctx: StepContext): Promise<void> {
		const usage = this.turnUsage;
		if (usage?.mode !== 'credits') return;
		const stepUsage = stepUsageFrom(ctx.usage);
		const credits = stepCredits(usage.prices, stepUsage, usage.typical);
		this.turnCredits += credits;
		await chargeStep(meteringDepsFromEnv(this.env), {
			userId: usage.userId,
			period: usage.period,
			pool: usage.pool,
			plan: usage.plan,
			useKey: `${this.name}:${usage.turnId}:${ctx.stepNumber}`,
			credits,
			source: 'think',
			model: usage.model,
			usage: stepUsage,
		});
	}

	/** The credits this turn's steps were charged, for the build summary. */
	turnCreditsUsed(): number {
		return this.turnCredits;
	}
```

Import `StepContext` as a type from `@cloudflare/think`.

- [ ] **Step 8: Check credits before prompts and new stores; charge older calls.**

**`websocket.ts`:**
- `handleWebSocketMessage` gains a fifth parameter, `creditCheck: typeof checkCreditsBeforeTurn = checkCreditsBeforeTurn`, passed to both `ensureCanPrompt` calls.
- `ensureCanPrompt` first runs `creditCheck(env, userId)`:
  - with billing on and a refusal: sends `{ error: refusal.message, code: PLAN_LIMIT_ERROR_CODE, planLimit: refusal, showAsPopup: true }` and answers false;
  - with billing on and no refusal: answers true, skipping the Cloudflare usage check. Think always runs on Estori's gateway;
  - with billing off: today's check, unchanged.
- In `websocketTypes.ts`, `ErrorMessage` gains `planLimit?: PlanLimitRefusal`.

**The agent controller, `startCodeGeneration`,** before `enforceAppCreationRateLimit`:

```ts
            const credits = await checkCreditsBeforeTurn(env, user.id);
            if (credits.billing && credits.refusal) return CodingAgentController.createPlanLimitResponse(credits.refusal);
```

With billing on, `checkUsageAndBalance` runs only when `behaviorType !== 'think'`, the older builders that use the seller's own Cloudflare account.

**`inferutils/core.ts`:** before today's call:

```ts
        const modelCreditCost = AI_MODEL_CONFIG[modelName as AIModels]?.creditCost ?? 0;
        const chargedByBilling = !isUsingBYOK && (await chargeLegacyCall(env, { userId: metadata.userId, model: modelName, creditCost: modelCreditCost }));
        if (!chargedByBilling) {
            await RateLimitService.enforceLLMCallsRateLimit(/* unchanged arguments */);
        }
```

**`LimitsController.getUsage`:** with `isBillingOn(env, user.id)`:
- reads the gateway connection and preference as today, but not `checkUsageAndBalance`;
- spreads `billingUsage(account, await loadCredits(env, account))` over the response;
- sets `cloudflareCredits: null`, `hasUserToken: false`, `cloudflareConnectEnabled: false`.
- Billing off is unchanged, with `billing: null`.

- [ ] **Step 9: The Upgrade dialog and the app's wiring.**

**`plan-limit-events.ts`:** a module-level `Set` of listeners.
- `announcePlanLimit(refusal)` calls each;
- `onPlanLimit(listener)` adds one and answers a function that removes it.

**`upgrade-action.ts`:**

```ts
export type UpgradeAction = { kind: 'checkout'; plan: PaidPlanId; label: string } | { kind: 'link'; to: string; label: string } | { kind: 'none' };

export const UPGRADE_TITLES: Record<PlanLimitKey, string> = {
	aiCredits: "You're out of AI credits",
	storesLifetime: "You've started all your stores",
	newStoresPerDay: "That's today's new stores",
	liveStores: "You've reached your live stores",
	ownDomainsPerLiveStore: "Own domains aren't on your plan",
	supplierCatalog: 'Catalog products need Pro or Premium',
	extraCredits: 'Extra credits come with Premium',
};

/** Basic buys a plan at checkout; Pro moves up on the billing page, where the charge is explained first. */
export function upgradeActionFor(refusal: PlanLimitRefusal): UpgradeAction {
	switch (refusal.upgradeTo) {
		case 'pro':
			return { kind: 'checkout', plan: 'pro', label: 'Get Pro' };
		case 'premium':
			return refusal.plan === 'basic' ? { kind: 'checkout', plan: 'premium', label: 'Get Premium' } : { kind: 'link', to: `${BILLING_PATH}?plan=premium`, label: 'Move to Premium' };
		case 'credits':
			return { kind: 'link', to: `${BILLING_PATH}#extra-credits`, label: 'Buy credits' };
		case 'enterprise':
			return { kind: 'link', to: contactPath('enterprise'), label: 'Talk to us' };
		default:
			return { kind: 'none' };
	}
}
```

**`UpgradeDialog.tsx`:**
- **`UpgradeDialog({ refusal, onClose })`:**
  - uses the existing `Dialog` components;
  - the title is `UPGRADE_TITLES[refusal.limit]`, and the description `refusal.message`;
  - a `checkout` action calls `apiClient.startPlanCheckout(plan)` and sets `window.location.href` to the answer's URL, with a spinner on the button. A 409 sends the seller to `BILLING_PATH`;
  - a `link` action is a router `Link` that closes the dialog;
  - "Not now" closes it.
- **`UpgradeDialogHost()`:** subscribes with `onPlanLimit` in an effect and keeps the latest refusal in state.
- Mount `<UpgradeDialogHost />` in `src/App.tsx`, next to `<TermsGate />`.

**`api-client.ts`:**
- `ApiError` gains `public planLimit: PlanLimitRefusal | null = null`, set from `isPlanLimitRefusal(data?.error?.planLimit)`.
- `requestRaw` calls `announcePlanLimit` for a 402 with a refusal, before throwing.
- `createAgentSession` does the same for its 402, then throws `Error(data.error.message)`.

**The build socket:** in `handle-websocket-message.ts`'s `'error'` case, first:

```ts
                if (errorData.code === PLAN_LIMIT_ERROR_CODE && isPlanLimitRefusal(errorData.planLimit)) {
                    announcePlanLimit(errorData.planLimit);
                    break;
                }
```

**Limits UI:**
- `UsageSummary` gains `billing?: { plan: PlanId; renewsAt: number } | null`.
- In `usage-limit-checker.tsx`, `checkCanSendPrompt` and `getBackendLimitDialog` start with `if (limitsData.billing) return { canProceed: true };`, after their null checks. With billing on, the server's refusal opens the Upgrade dialog, so its copy lives in one place.
- In `usage-limits-badge.tsx`:
  - `hidden` becomes `!loading && Boolean(data && !data.cloudflareConnectEnabled && !data.billing)`;
  - with billing, the text is "{n} credits left" (no "free"), and the mobile text "{n} credits".

- [ ] **Step 10: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/credit-notices.test.ts worker/services/billing/metering.sql.test.ts worker/agents/core/websocket.test.ts worker/agents/think/model-wiring.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- src/components/billing/upgrade-action.test.ts src/components/billing/billing-ui-guard.test.ts worker/api/controllers/limits/plan-wiring.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 11: Commit**

```bash
git add worker/services/billing worker/agents/think/ThinkAgent.ts worker/agents/think/model-wiring.test.ts worker/agents/core/websocket.ts worker/agents/core/websocket.test.ts worker/api/websocketTypes.ts worker/api/controllers/agent/controller.ts worker/agents/inferutils/core.ts worker/api/controllers/limits/controller.ts src/lib/plan-limit-events.ts src/components/billing src/hooks/use-limits.ts src/components/usage-limits-badge.tsx src/utils/usage-limit-checker.tsx src/lib/api-client.ts src/routes/chat/utils/handle-websocket-message.ts src/App.tsx
git commit -m "feat(billing): charge each ai step from its real cost, check credits before a turn, and show one upgrade dialog for every limit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Stores, live stores, own domains and the catalog

**Files:**
- Create `worker/services/billing/store-limits.ts`.
- Modify:
  - worker: `worker/api/controllers/agent/controller.ts`, `worker/api/controllers/liveStores/controller.ts`, `worker/database/services/LiveStoreService.ts`, `worker/agents/think/catalog-tools.ts`, `worker/agents/think/ThinkAgent.ts`;
  - shared: `shared/types/billing.ts` (`NEW_CATALOG_PRODUCTS_ERROR`);
  - space: `space/src/space/store-manifest.ts`, `space/src/space/durable-object.ts`, `space/src/space/drafts-store.ts` (`PublishDraftOptions`), `space/src/index.ts` (export it).
- Test:
  - `worker/services/billing/store-limits.test.ts`;
  - `worker/api/controllers/liveStores/controller-billing.sql.test.ts`;
  - `worker/api/controllers/liveStores/live-store-routes-wiring.test.ts`;
  - `worker/agents/think/catalog-tools.test.ts`;
  - `space/src/space/store-manifest.test.ts`, `space/test/drafts-wiring.test.ts`.

**Interfaces:**
- **Consumes:** `assertWithinLimit` (Task 1); `BillingService.reserveStore` (Task 3); `loadAccount`, `BillingAccount` (Task 5); `createPlanLimitResponse` (Task 8); `RateLimitService.enforceAppCreationRateLimit`, `RateLimitExceededError`.
- **Produces:**
  - `store-limits.ts`:
    - `StoreStartDeps { reserveStore(cap: number | null): Promise<{ reserved: boolean; started: number }>; takeDailyStore(limit: number): Promise<boolean> }`;
    - `checkStoreStart(deps, account: BillingAccount): Promise<PlanLimitRefusal | null>`;
    - `storeStartDepsFromEnv(env, user: AuthUser, request: Request, rateLimit: RateLimitSettings): StoreStartDeps`.
  - `LiveStoreService.liveCountOf(userId): Promise<number>`.
  - `NEW_CATALOG_PRODUCTS_ERROR = 'This version adds catalog products, which need Pro or Premium.'` in `shared/types/billing.ts`, mirrored in `space/src/space/store-manifest.ts`.
  - space:
    - `catalogVariantIdsOf(manifest: string | null): Set<string>`;
    - `newCatalogVariantIds(draft: string | null, live: string | null): string[]`;
    - `PublishDraftOptions { refuseNewCatalogProducts?: boolean }`;
    - `SpaceDO.publishDraft(id?: string, options?: PublishDraftOptions)`.
  - `CatalogToolDeps` gains `catalogRefusal(): Promise<PlanLimitRefusal | null>`; `catalogToolDepsFromEnv(env, userId: string | null)`.

- [ ] **Step 1: Write the failing store test** `worker/services/billing/store-limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, type PlanId } from '../../../shared/types/plans';
import type { BillingAccount } from './account';
import { checkStoreStart, type StoreStartDeps } from './store-limits';

function account(plan: PlanId, billing = true): BillingAccount {
	const period = { key: 'acct:1', startMs: 0, endMs: Date.UTC(2026, 10, 12) };
	return { billing, userId: 'u1', plan, limits: billing ? PLAN_LIMITS[plan] : { ...PLAN_LIMITS.basic, storesLifetime: null, liveStores: null }, creditsResetAt: period.endMs, source: 'free', period, graceEndsAtMs: null, subscription: null };
}

function counters(started: number, today: number) {
	const calls: string[] = [];
	const deps: StoreStartDeps = {
		reserveStore: async (cap) => {
			calls.push(`reserve:${cap}`);
			if (cap !== null && started >= cap) return { reserved: false, started };
			started += 1;
			return { reserved: true, started };
		},
		takeDailyStore: async (limit) => {
			calls.push(`daily:${limit}`);
			if (today >= limit) return false;
			today += 1;
			return true;
		},
	};
	return { deps, calls };
}

describe('checkStoreStart', () => {
	it("starts Basic's stores up to its third, counting deleted ones, and refuses after", async () => {
		const { deps, calls } = counters(2, 0);
		expect(await checkStoreStart(deps, account('basic'))).toBeNull();
		expect(await checkStoreStart(deps, account('basic'))).toMatchObject({ limit: 'storesLifetime', upgradeTo: 'pro', message: "Basic includes 3 stores, counting ones you've deleted. Get Pro to start up to 10 a day." });
		expect(calls).toEqual(['reserve:3', 'reserve:3']);
	});

	it('limits Pro and Premium per day, and still counts their stores in case they move to Basic', async () => {
		const pro = counters(40, 9);
		expect(await checkStoreStart(pro.deps, account('pro'))).toBeNull();
		expect(await checkStoreStart(pro.deps, account('pro'))).toMatchObject({ limit: 'newStoresPerDay', upgradeTo: 'premium' });
		expect(pro.calls).toEqual(['daily:10', 'reserve:null', 'daily:10']);
		const premium = counters(0, 25);
		expect(await checkStoreStart(premium.deps, account('premium'))).toMatchObject({ limit: 'newStoresPerDay', upgradeTo: 'enterprise' });
	});

	it("checks nothing new while billing is off; today's daily limit stays with the controller", async () => {
		const { deps, calls } = counters(99, 99);
		expect(await checkStoreStart(deps, account('basic', false))).toBeNull();
		expect(calls).toEqual([]);
	});
});
```

- [ ] **Step 2: Write the failing live store test** `worker/api/controllers/liveStores/controller-billing.sql.test.ts`:

```ts
/** Plan limits at Go live and on own domains, on real SQL with SpaceDO stood in. */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertApp, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { LiveStoreService } from '../../../database/services/LiveStoreService';
import { NEW_CATALOG_PRODUCTS_ERROR } from '../../../../shared/types/billing';
import { LiveStoreController } from './controller';
import type { RouteContext } from '../../types/route-context';

vi.mock('../../../agents', () => ({ getAgentStub: async () => ({ cancelLeftoverMerge: async () => undefined }) }));

let db: D1Database;
const DAY = 86_400_000;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'u_basic');
	await insertUser(db, 'u_pro');
	await insertSubscription(db, { userId: 'u_pro', stripeSubscriptionId: 'sub_pro', status: 'active', plan: 'pro', currentPeriodStart: new Date(Date.now() - DAY), currentPeriodEnd: new Date(Date.now() + 29 * DAY) });
	for (const [id, userId] of [['app_live', 'u_basic'], ['app_next', 'u_basic'], ['app_pro_1', 'u_pro'], ['app_pro_2', 'u_pro']] as const) await insertApp(db, { id, userId });
});

/** SpaceDO as the controller sees it; `addsCatalog` makes the draft add catalog products. */
function spaces(addsCatalog = false) {
	const published: Array<{ appId: string; refuseNewCatalogProducts: boolean }> = [];
	const namespace = {
		idFromName: (name: string) => name,
		get: (appId: string) => ({
			publishDraft: async (_draftId?: string, options?: { refuseNewCatalogProducts?: boolean }) => {
				published.push({ appId, refuseNewCatalogProducts: options?.refuseNewCatalogProducts === true });
				if (addsCatalog && options?.refuseNewCatalogProducts) return { error: NEW_CATALOG_PRODUCTS_ERROR };
				return { commitHash: 'c0ffee1', storeManifest: null, draftId: 'main', draftName: 'Main' };
			},
			getPublishContext: async () => ({ active: { id: 'main', name: 'Main', tip: 'c0ffee1' }, publishedDraft: null }),
			getStoreManifest: async () => ({ commitHash: 'c0ffee1', manifest: null }),
		}),
	};
	return { namespace, published };
}

function call(method: 'publish' | 'addDomain', appId: string, userId: string, namespace: unknown, extra: Record<string, unknown> = { BILLING: 'on' }) {
	const env = envWith(db, { STORES_DOMAIN: 'stores.example', CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod', JWT_SECRET: 'live-store-billing-test-secret-0123', SPACE_DO: namespace, ...extra });
	const body = method === 'publish' ? { slug: appId.replace(/_/g, '-') } : { hostname: 'shop.example.com' };
	const request = new Request(`https://estori.app/api/stores/${appId}/live/${method === 'publish' ? 'publish' : 'domain'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	return LiveStoreController[method](request, env, {} as ExecutionContext, { pathParams: { id: appId }, user: { id: userId } } as unknown as RouteContext);
}

describe('plan limits at Go live', () => {
	it("republishes Basic's live store, and refuses a second live store before anything is published", async () => {
		await new LiveStoreService(envWith(db)).publish({ appId: 'app_live', slug: 'app-live', commit: 'c0ffee0', now: new Date() });
		const { namespace, published } = spaces();
		expect((await call('publish', 'app_live', 'u_basic', namespace)).status).toBe(200);
		const refused = await call('publish', 'app_next', 'u_basic', namespace);
		expect(refused.status).toBe(402);
		expect((await refused.json()).error.planLimit).toMatchObject({ limit: 'liveStores', plan: 'basic', upgradeTo: 'pro' });
		expect(published.map((entry) => entry.appId)).toEqual(['app_live']);
	});

	it('asks SpaceDO to refuse new catalog products without the catalog, and answers with the plan limit', async () => {
		await new LiveStoreService(envWith(db)).publish({ appId: 'app_live', slug: 'app-live', commit: 'c0ffee0', now: new Date() });
		const basic = spaces(true);
		const refused = await call('publish', 'app_live', 'u_basic', basic.namespace);
		expect(refused.status).toBe(402);
		expect((await refused.json()).error.planLimit).toMatchObject({ limit: 'supplierCatalog', message: 'Adding catalog products to your store comes with Pro and Premium. Products already live keep selling.' });
		const pro = spaces(true);
		expect((await call('publish', 'app_pro_1', 'u_pro', pro.namespace)).status).toBe(200);
		expect(pro.published).toEqual([{ appId: 'app_pro_1', refuseNewCatalogProducts: false }]);
	});

	it('refuses an own domain on Basic, and changes nothing while billing is off', async () => {
		const { namespace, published } = spaces(true);
		const domain = await call('addDomain', 'app_live', 'u_basic', namespace);
		expect(domain.status).toBe(402);
		expect((await domain.json()).error.planLimit).toMatchObject({ limit: 'ownDomainsPerLiveStore', message: 'Own domains come with Pro and Premium.' });
		expect((await call('addDomain', 'app_live', 'u_basic', namespace, {})).status).not.toBe(402);
		expect((await call('publish', 'app_next', 'u_basic', namespace, {})).status).toBe(200);
		expect(published).toEqual([{ appId: 'app_next', refuseNewCatalogProducts: false }]);
	});
});
```

- [ ] **Step 3: Write the failing space, wiring and catalog tool tests.** Add to `space/src/space/store-manifest.test.ts`:

```ts
import { NEW_CATALOG_PRODUCTS_ERROR, catalogVariantIdsOf, newCatalogVariantIds } from "./store-manifest"

const manifest = (...ids: string[]) =>
  JSON.stringify({ products: [{ id: "lamp", name: "Lamp", variants: ids.map((id, index) => ({ id: `v${index}`, name: "V", priceCents: 1000, catalogVariantId: id })) }, { id: "own", name: "Own", variants: [{ id: "o", name: "O", priceCents: 500 }] }] })

describe("catalog products in a version", () => {
  it("reads the catalog variants, and finds those the draft adds to the live version", () => {
    expect(catalogVariantIdsOf(manifest("cv_a", "cv_b"))).toEqual(new Set(["cv_a", "cv_b"]))
    expect(catalogVariantIdsOf(null)).toEqual(new Set())
    expect(catalogVariantIdsOf("{")).toEqual(new Set())
    expect(newCatalogVariantIds(manifest("cv_a", "cv_c"), manifest("cv_a", "cv_b"))).toEqual(["cv_c"])
    expect(newCatalogVariantIds(manifest("cv_a"), manifest("cv_a", "cv_b"))).toEqual([])
    expect(newCatalogVariantIds(manifest("cv_a"), null)).toEqual(["cv_a"])
    expect(NEW_CATALOG_PRODUCTS_ERROR).toBe("This version adds catalog products, which need Pro or Premium.")
  })
})
```

Add to `space/test/drafts-wiring.test.ts`:

```ts
  it("refuses new catalog products only when asked, after deploying and before publishing", () => {
    const publish = methodBody(spaceDo, "async publishDraft(")
    const check = publish.indexOf("newCatalogVariantIds(")
    expect(publish).toContain("options.refuseNewCatalogProducts")
    expect(check).toBeGreaterThan(publish.indexOf("await this.deploy(draft.branch)"))
    expect(check).toBeLessThan(publish.indexOf("publishLiveDeployment(sql, Date.now(), draft.branch)"))
    expect(publish).toContain("return { error: NEW_CATALOG_PRODUCTS_ERROR }")
  })
```

In `live-store-routes-wiring.test.ts`, change `'space.publishDraft(draftId)'` to `'space.publishDraft(draftId, { refuseNewCatalogProducts })'`, and add:

```ts
	it('checks the live-store limit before publishing, and the domain limit before adding one', () => {
		const controller = source('/worker/api/controllers/liveStores/controller.ts');
		const publish = controller.slice(controller.indexOf('static async publish('), controller.indexOf('static async offline('));
		expect(publish.indexOf("assertWithinLimit(account, 'liveStores'")).toBeLessThan(publish.indexOf('space.publishDraft('));
		expect(publish).toContain('published.error === NEW_CATALOG_PRODUCTS_ERROR');
		const addDomain = controller.slice(controller.indexOf('static async addDomain('), controller.indexOf('static async checkDomain('));
		expect(addDomain.indexOf("assertWithinLimit(account, 'ownDomainsPerLiveStore', 0)")).toBeLessThan(addDomain.indexOf('addStoreDomain('));
	});

	it('mirrors the catalog refusal SpaceDO answers', () => {
		const space = Object.values(spaceSources)[0] ?? '';
		expect(space).toContain(`"${NEW_CATALOG_PRODUCTS_ERROR}"`);
	});
```

At the top of the file, add `import { NEW_CATALOG_PRODUCTS_ERROR } from '../../../../shared/types/billing';` and `const spaceSources = import.meta.glob<string>('/space/src/space/store-manifest.ts', { query: '?raw', import: 'default', eager: true });`.

In `worker/agents/think/catalog-tools.test.ts`:
- give the shared `tools` a `catalogRefusal: async () => null`;
- change the agent pin to `'...createCatalogTools(catalogToolDepsFromEnv(this.env, this.getConfig<ThinkAgentConfig>()?.userId ?? null))'`;
- add:

```ts
	it("tell the AI, in the seller's words, that catalog products need Pro or Premium", async () => {
		const refusal = { code: 'plan_limit' as const, limit: 'supplierCatalog' as const, plan: 'basic' as const, upgradeTo: 'pro' as const, message: 'Adding catalog products to your store comes with Pro and Premium. Products already live keep selling.' };
		const basic = createCatalogTools({ search: async () => [PRODUCT], get: async () => PRODUCT, catalogRefusal: async () => refusal });
		for (const output of [await run(basic.search_catalog, {}), await run(basic.get_catalog_product, { productId: 'cp_1' })]) {
			expect(JSON.parse(output).notice).toBe(`${refusal.message} Tell the seller this before adding a catalog product to their store.`);
		}
		expect(JSON.parse(await run(tools.search_catalog, {})).notice).toBeUndefined();
	});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/store-limits.test.ts worker/api/controllers/liveStores/controller-billing.sql.test.ts worker/api/controllers/liveStores/live-store-routes-wiring.test.ts`
Expected: FAIL.

Run: `rtk proxy bun run test -- worker/agents/think/catalog-tools.test.ts space/src/space/store-manifest.test.ts space/test/drafts-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 5: Starting stores.** `store-limits.ts`:

```ts
/** New stores on a plan: Pro and Premium per day, Basic in the account's lifetime. Every start is counted. */
export async function checkStoreStart(deps: StoreStartDeps, account: BillingAccount): Promise<PlanLimitRefusal | null> {
	if (!account.billing) return null;
	const perDay = account.limits.newStoresPerDay;
	if (perDay !== null && !(await deps.takeDailyStore(perDay))) return assertWithinLimit(account, 'newStoresPerDay', perDay);
	const place = await deps.reserveStore(account.limits.storesLifetime);
	return place.reserved ? null : assertWithinLimit(account, 'storesLifetime', place.started);
}
```

**`storeStartDepsFromEnv(env, user, request, rateLimit)`:**
- `reserveStore` is `new BillingService(env).reserveStore(user.id, cap, new Date())`.
- `takeDailyStore(limit)` runs `RateLimitService.enforceAppCreationRateLimit` with `appCreation` set to `{ ...rateLimit.appCreation, enabled: true, limit, dailyLimit: limit, period: 86_400 }`. It answers false on `RateLimitExceededError`, and rethrows anything else.

**In the agent controller,** right after the credit check from Task 10:
- with `credits.billing`: `const refusal = await checkStoreStart(storeStartDepsFromEnv(env, user, request, context.config.security.rateLimit), await loadAccount(env, user.id));` and a refusal answers `createPlanLimitResponse(refusal)`;
- otherwise today's `enforceAppCreationRateLimit` block, unchanged.

A start that fails later still counts (spec decision 29a).

- [ ] **Step 6: Live stores and domains.**

**`LiveStoreService.liveCountOf(userId)`:**

```sql
SELECT COUNT(*) FROM live_stores ls JOIN apps a ON a.id = ls.app_id WHERE a.user_id = ? AND ls.status = 'live'
```

**In `LiveStoreController`:**
- `liveStoreAccount(env, context)` answers `loadAccount(env, context.user.id)`, or null without a user. The routes are owner-only, so production always has one; billing is off for the existing tests that call without one.
- **`publish`,** after the slug checks and before the agent's merge cleanup:
  - when the account exists and `(await stores.getByApp(appId))?.status !== 'live'`, `assertWithinLimit(account, 'liveStores', await stores.liveCountOf(account.userId))`. A refusal answers `this.createPlanLimitResponse<LiveStoreView>(refusal)`;
  - republishing a live store skips the count;
  - `const refuseNewCatalogProducts = account !== null && assertWithinLimit(account, 'supplierCatalog') !== null;` and `space.publishDraft(draftId, { refuseNewCatalogProducts })`;
  - when `published.error === NEW_CATALOG_PRODUCTS_ERROR`, answer the `supplierCatalog` refusal as a 402.
- **`addDomain`,** first: `assertWithinLimit(account, 'ownDomainsPerLiveStore', 0)`. The 0 is the domains the store has, since a store holds at most one. A refusal answers 402.
- `LiveSpaceStub.publishDraft` gains the options parameter, typed with `PublishDraftOptions` from `@space-do/space`.

- [ ] **Step 7: The catalog in SpaceDO and in the AI's tools.**

**`space/src/space/store-manifest.ts`:**

```ts
/** Mirrors NEW_CATALOG_PRODUCTS_ERROR in shared/types/billing.ts, which this package can't import. */
export const NEW_CATALOG_PRODUCTS_ERROR = "This version adds catalog products, which need Pro or Premium."

/** The catalog variants a manifest sells; a manifest that doesn't parse sells none. Validation happens in the worker. */
export function catalogVariantIdsOf(manifest: string | null): Set<string> {
  const ids = new Set<string>()
  if (!manifest) return ids
  let parsed: unknown
  try {
    parsed = JSON.parse(manifest)
  } catch {
    return ids
  }
  const products = typeof parsed === "object" && parsed !== null ? (parsed as { products?: unknown }).products : undefined
  if (!Array.isArray(products)) return ids
  for (const product of products) {
    const variants = typeof product === "object" && product !== null ? (product as { variants?: unknown }).variants : undefined
    if (!Array.isArray(variants)) continue
    for (const variant of variants) {
      const id = typeof variant === "object" && variant !== null ? (variant as { catalogVariantId?: unknown }).catalogVariantId : undefined
      if (typeof id === "string") ids.add(id)
    }
  }
  return ids
}

export function newCatalogVariantIds(draft: string | null, live: string | null): string[] {
  const published = catalogVariantIdsOf(live)
  return [...catalogVariantIdsOf(draft)].filter((id) => !published.has(id))
}
```

**`SpaceDO.publishDraft(id?: string, options: PublishDraftOptions = {})`:**
- after the stale-draft deploy and before `publishLiveDeployment`, when `options.refuseNewCatalogProducts`, reads the draft branch's and the live branch's `store_manifest` the way `getStoreManifest` does;
- answers `{ error: NEW_CATALOG_PRODUCTS_ERROR }` when `newCatalogVariantIds` finds any.
- Comparing with the live version is the spec's rule: products already live keep selling, and only new ones are refused.

**`catalog-tools.ts`:**
- `CatalogToolDeps` gains `catalogRefusal()`.
- Both tools add `notice: `${refusal.message} Tell the seller this before adding a catalog product to their store.`` to their JSON when it answers a refusal. They still return the products, so the AI can describe them.
- `catalogToolDepsFromEnv(env, userId)` answers `assertWithinLimit(await loadAccount(env, userId), 'supplierCatalog')`, or null without a user.
- ThinkAgent passes `this.getConfig<ThinkAgentConfig>()?.userId ?? null`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/store-limits.test.ts worker/api/controllers/liveStores/controller-billing.sql.test.ts worker/api/controllers/liveStores/controller.sql.test.ts worker/api/controllers/liveStores/live-store-routes-wiring.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- worker/agents/think/catalog-tools.test.ts space/src/space/store-manifest.test.ts space/test/drafts-wiring.test.ts worker/agents/think/model-wiring.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add worker/services/billing/store-limits.ts worker/services/billing/store-limits.test.ts worker/api/controllers/agent/controller.ts worker/api/controllers/liveStores worker/database/services/LiveStoreService.ts worker/agents/think/catalog-tools.ts worker/agents/think/catalog-tools.test.ts worker/agents/think/ThinkAgent.ts shared/types/billing.ts space/src/space/store-manifest.ts space/src/space/store-manifest.test.ts space/src/space/durable-object.ts space/src/space/drafts-store.ts space/src/index.ts space/test/drafts-wiring.test.ts
git commit -m "feat(billing): plan limits on new stores, live stores, own domains and new catalog products, without touching what is live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: The pricing page, the calculator, the billing page and the banner

**Files:**
- Create:
  - `src/routes/settings/billing-view.ts` (pure), `src/routes/settings/billing.tsx`;
  - `src/hooks/use-billing.ts`;
  - `src/components/billing/PlanButton.tsx`, `src/components/billing/BillingBanner.tsx`.
- Modify:
  - plan answer: `shared/types/plan.ts` (`billing`), `worker/api/controllers/limits/controller.ts` (`getPublicPlan`);
  - pricing: `src/components/marketing/PlanLimits.tsx`, `src/components/pricing/PlanCards.tsx`, `ComparePlans.tsx`, `Calculator.tsx`, `src/routes/pricing.tsx`, `src/content/positioning.ts`, `src/lib/contact.ts`, `src/components/contact/ContactForm.tsx`;
  - app: `src/routes.tsx`, `src/routes/settings/index.tsx`, `src/components/layout/app-layout.tsx`.
- Test:
  - `src/routes/settings/billing-view.test.ts`;
  - `src/routes/billing-page-guard.test.ts`;
  - `src/routes/pricing-guard.test.ts`, `src/routes/calculator-guard.test.ts`, `src/routes/contact-guard.test.ts` (updated);
  - `worker/api/controllers/limits/plan-wiring.test.ts` (updated).

**Interfaces:**
- **Consumes:**
  - from Task 1: `PLAN_LIMITS`, `PLAN_PRICES_CENTS`, `EXTRA_CREDITS`, `extraCreditsPriceCents`, `assertWithinLimit`, `planName`, `formatBillingDate`, `formatCredits`, `formatUsd`;
  - from Task 2: `recommendPlan`, `DAYS_PER_MONTH`, `ENTERPRISE_FROM_CREDITS`;
  - from Task 8: `BillingView`, `apiClient` billing calls, `queryKeys.billing`;
  - from Task 10: `upgradeActionFor`, `UpgradeAction`;
  - from Task 5: `isBillingOn`.
- **Produces:**
  - `PublicPlanLimits.billing: boolean`;
  - `useBilling()`;
  - `PlanButton({ plan, variant?, className? })`;
  - `billing-view.ts`:
    - `CONFIRM_POLL_MS = 2_000`, `CONFIRM_TIMEOUT_MS = 30_000`;
    - `checkoutReturnOf(search: string): 'plan' | 'credits' | 'cancelled' | null`;
    - `requestedPlanOf(search: string): PaidPlanId | null`;
    - `PlanChoice { plan: PaidPlanId; action: 'checkout' | 'upgrade' | 'downgrade' | 'resume' | 'cancel-change' | 'current' | 'none'; label: string; note: string | null }`;
    - `planChoicesFor(view: BillingView): PlanChoice[]` (Pro, then Premium);
    - `confirmationFor(view: BillingView, action: 'upgrade' | 'downgrade' | 'cancel'): { title: string; body: string; confirm: string }`;
    - `isConfirmed(kind: 'plan' | 'credits', initial: BillingView, current: BillingView): boolean`;
    - `BillingBanner = { tone: 'warning' | 'info'; message: string; action: UpgradeAction | { kind: 'portal'; label: string } }`, `billingBannerFor(view: BillingView | undefined): BillingBanner | null`.
  - `pricingFaq(billing: boolean): readonly FaqItem[]`, replacing `PRICING_FAQ`.

- [ ] **Step 1: Write the failing view test** `src/routes/settings/billing-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, type BillingView, type PlanId } from '@/api-types';
import { billingBannerFor, checkoutReturnOf, confirmationFor, isConfirmed, planChoicesFor, requestedPlanOf } from './billing-view';

const NOV_5 = Date.UTC(2026, 10, 5, 10);

function view(plan: PlanId, overrides: Partial<BillingView> = {}): BillingView {
	return {
		enabled: true,
		plan,
		source: plan === 'basic' ? 'free' : 'subscription',
		status: plan === 'basic' ? null : 'active',
		periodStart: Date.UTC(2026, 9, 5, 10),
		periodEnd: NOV_5,
		cancelAtPeriodEnd: false,
		pendingPlan: null,
		pendingPlanAt: null,
		graceEndsAt: null,
		paymentFailing: false,
		credits: { pool: PLAN_LIMITS[plan].aiCredits, granted: 0, used: 0, left: PLAN_LIMITS[plan].aiCredits, purchasedLeft: 0, available: PLAN_LIMITS[plan].aiCredits, renewsAt: NOV_5 },
		alert: null,
		purchases: [],
		limits: PLAN_LIMITS[plan],
		canManageBilling: plan !== 'basic',
		canBuyCredits: plan === 'premium',
		...overrides,
	};
}

const actions = (choices: ReturnType<typeof planChoicesFor>) => choices.map((choice) => `${choice.plan}:${choice.action}`);

describe('the billing page', () => {
	it('reads where the seller came back from, and the plan a link asked for', () => {
		expect(checkoutReturnOf('?checkout=success')).toBe('plan');
		expect(checkoutReturnOf('?credits=success')).toBe('credits');
		expect(checkoutReturnOf('?checkout=cancelled')).toBe('cancelled');
		expect(checkoutReturnOf('')).toBeNull();
		expect(requestedPlanOf('?plan=premium')).toBe('premium');
		expect(requestedPlanOf('?plan=enterprise')).toBeNull();
	});

	it('offers each plan the next step that fits the account', () => {
		expect(actions(planChoicesFor(view('basic')))).toEqual(['pro:checkout', 'premium:checkout']);
		expect(actions(planChoicesFor(view('pro')))).toEqual(['pro:current', 'premium:upgrade']);
		expect(actions(planChoicesFor(view('premium')))).toEqual(['pro:downgrade', 'premium:current']);
		expect(planChoicesFor(view('premium', { pendingPlan: 'pro', pendingPlanAt: NOV_5 }))).toEqual([
			{ plan: 'pro', action: 'none', label: 'Starts November 5', note: null },
			{ plan: 'premium', action: 'cancel-change', label: 'Keep Premium', note: 'Moves to Pro on November 5' },
		]);
		expect(planChoicesFor(view('pro', { cancelAtPeriodEnd: true }))[0]).toEqual({ plan: 'pro', action: 'resume', label: 'Keep Pro', note: 'Ends on November 5' });
		expect(actions(planChoicesFor(view('pro', { status: 'past_due', paymentFailing: true })))).toEqual(['pro:current', 'premium:none']);
		expect(actions(planChoicesFor(view('enterprise', { source: 'override' })))).toEqual(['pro:none', 'premium:none']);
	});

	it('explains a charge or a change before asking to confirm it', () => {
		expect(confirmationFor(view('pro'), 'upgrade')).toEqual({
			title: 'Move to Premium now?',
			body: "You'll have 100,000 AI credits a month right away, and the credits you've used this month count against them. We'll charge the difference for the rest of this month, then Premium renews at $199 a month.",
			confirm: 'Move to Premium',
		});
		expect(confirmationFor(view('premium'), 'downgrade').body).toBe("You keep Premium until November 5. Then Pro renews at $49 a month, with 20,000 AI credits a month. There's no refund for the rest of this month.");
		expect(confirmationFor(view('premium'), 'cancel').body).toBe('Premium stays on until November 5, then your account moves to Basic. Your stores stay live.');
	});

	it('knows when the webhook has recorded a payment', () => {
		expect(isConfirmed('plan', view('basic'), view('basic'))).toBe(false);
		expect(isConfirmed('plan', view('basic'), view('pro'))).toBe(true);
		const before = view('premium', { credits: { ...view('premium').credits!, purchasedLeft: 0 } });
		expect(isConfirmed('credits', before, before)).toBe(false);
		expect(isConfirmed('credits', before, view('premium', { credits: { ...view('premium').credits!, purchasedLeft: 5_000 } }))).toBe(true);
	});

	it('puts a failed payment, then a credit warning, in the banner, with the next step for the plan', () => {
		expect(billingBannerFor(view('pro', { status: 'past_due', paymentFailing: true, graceEndsAt: NOV_5 }))).toEqual({ tone: 'warning', message: "Your last payment didn't go through. Update your card by November 5 to keep Pro.", action: { kind: 'portal', label: 'Update card' } });
		const low = { ...view('basic').credits!, used: 4_000, left: 1_000 };
		expect(billingBannerFor(view('basic', { alert: 'credits_20', credits: low }))).toEqual({ tone: 'info', message: 'You have 1,000 AI credits left until November 5.', action: { kind: 'checkout', plan: 'pro', label: 'Get Pro' } });
		expect(billingBannerFor(view('premium', { alert: 'credits_5' }))?.action).toEqual({ kind: 'link', to: '/settings/billing#extra-credits', label: 'Buy credits' });
		expect(billingBannerFor(view('basic'))).toBeNull();
		expect(billingBannerFor(view('basic', { enabled: false, alert: 'credits_5' }))).toBeNull();
	});
});
```

- [ ] **Step 2: Write the failing guards.** `src/routes/billing-page-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/routes.tsx', '/src/routes/settings/index.tsx', '/src/routes/settings/billing.tsx', '/src/components/layout/app-layout.tsx', '/src/components/billing/PlanButton.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the billing page', () => {
	it('is a signed-in page in the app, linked from settings only when billing is on', () => {
		const routes = source('/src/routes.tsx');
		const appRoutes = routes.slice(routes.indexOf('Component: AppShell'), routes.indexOf('Component: PublicShell'));
		expect(appRoutes).toContain("path: 'settings/billing'");
		expect(appRoutes.slice(appRoutes.indexOf("path: 'settings/billing'"), appRoutes.indexOf("path: 'settings/billing'") + 200)).toContain('<ProtectedRoute>');
		const settings = source('/src/routes/settings/index.tsx');
		expect(settings).toContain('billing.data?.enabled &&');
		expect(settings).toContain('to={BILLING_PATH}');
	});

	it('waits for the webhook after a checkout, every 2 seconds for up to 30', () => {
		const page = source('/src/routes/settings/billing.tsx');
		expect(page).toContain('refetchInterval: confirming ? CONFIRM_POLL_MS : false');
		expect(page).toContain('CONFIRM_TIMEOUT_MS');
		expect(page).toContain('Confirming your payment…');
		expect(page).toContain('Your payment is being confirmed. Refresh in a minute.');
		expect(page).toContain('id="extra-credits"');
	});

	it('shows the banner on every app page, and sends signed-out buyers to sign up, then back to their plan', () => {
		expect(source('/src/components/layout/app-layout.tsx')).toContain('<BillingBanner />');
		const button = source('/src/components/billing/PlanButton.tsx');
		expect(button).toContain('setIntendedUrl(`${BILLING_PATH}?plan=${plan}`)');
		expect(button).toContain("navigate('/signup')");
		expect(button).toContain('apiClient.startPlanCheckout(plan)');
	});
});
```

In `src/routes/pricing-guard.test.ts`:
- the order test pins `'<PublicFaq leading={pricingFaq(billing)} />'`;
- replace the three card tests with:

```ts
	it('shows Basic, Pro and Premium side by side in one frame, with Enterprise on its own band', () => {
		const cards = source(CARDS);
		expect(cards).toContain('md:grid-cols-3');
		for (const card of ['<BasicPlan billing={billing} />', '<PaidPlan plan="pro" billing={billing} />', '<PaidPlan plan="premium" billing={billing} />', '<EnterpriseBand />']) expect(cards).toContain(card);
	});

	it('prices Pro and Premium from the plan table, never typed in', () => {
		const cards = source(CARDS);
		expect(cards).toContain('<Price cents={PLAN_PRICES_CENTS[plan]} />');
		expect(cards).not.toMatch(/\$(49|199)\b/);
	});

	it("sells Pro and Premium once billing is on, and until then marks them coming soon and leads to sales", () => {
		const cards = source(CARDS);
		expect(cards).toContain('billing ? <PlanButton plan={plan}');
		expect(cards).toContain("contactPath('premium')");
		expect(cards).toContain('<ComingSoon />');
		expect(cards).toContain('Paid plans are coming soon');
		expect(cards).not.toMatch(/Buy now|Subscribe|checkout/i);
	});
```

- the credit questions test checks `pricingFaq` and the questions `'What are AI credits?'`, `'What happens when I run out of credits?'`, `'Can I buy more credits?'`, `'Can I change or cancel my plan?'` and `'Are Pro and Premium available now?'`.

In `src/routes/calculator-guard.test.ts`, replace `"contactPath('premium', recommendation.tier.credits)"` with:

```ts
		expect(calculator).toContain("contactPath('premium', needed)");
		expect(calculator).toContain('<PlanButton plan={recommendation.plan}');
		expect(calculator).toContain('recommendPlan(needed, freeMonthly ?? undefined)');
```

In `worker/api/controllers/limits/plan-wiring.test.ts`, pin `'billing: isBillingOn(env, context.user?.id ?? null)'` in the controller.

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- src/routes/settings/billing-view.test.ts src/routes/billing-page-guard.test.ts src/routes/pricing-guard.test.ts src/routes/calculator-guard.test.ts worker/api/controllers/limits/plan-wiring.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `billing-view.ts`.**
- **`checkoutReturnOf`:** `checkout=success` is `'plan'`, `credits=success` is `'credits'`, `checkout=cancelled` is `'cancelled'`, else null.
- **`requestedPlanOf`:** `plan` when `isPaidPlanId`.
- **`planChoicesFor(view)`,** in order Pro then Premium. Dates use `formatBillingDate`.

| Account | Pro | Premium |
| --- | --- | --- |
| Basic | `checkout` "Get Pro" | `checkout` "Get Premium" |
| `source === 'override'` | `none` "Set by Estori", note "Talk to us to change your plan." | the same |
| `paymentFailing` | its own plan `current` "Your plan", the other `none` "Update your card first" | the same |
| Pro | `current` "Your plan" | `upgrade` "Move to Premium" |
| Pro, cancelling | `resume` "Keep Pro", note "Ends on {date}" | `none` "Keep Pro first" |
| Premium | `downgrade` "Move to Pro at renewal" | `current` "Your plan" |
| Premium, Pro pending | `none` "Starts {date}" | `cancel-change` "Keep Premium", note "Moves to Pro on {date}" |
| Premium, cancelling | `none` "Keep Premium first" | `resume` "Keep Premium", note "Ends on {date}" |

- **`confirmationFor(view, action)`:**
  - `upgrade`: the title, body and button the test pins;
  - `downgrade`: title "Move to Pro at renewal?", the pinned body, button "Move to Pro";
  - `cancel`: title "Cancel {Plan}?", the pinned body, button "Cancel {Plan}".
  - Numbers come from `PLAN_LIMITS` and `PLAN_PRICES_CENTS`.
- **`isConfirmed`:** `plan` is true when `current.plan` is paid and `current.source !== 'free'`; `credits` is true when `current.credits.purchasedLeft > initial.credits.purchasedLeft`.
- **`billingBannerFor(view)`:**
  - null when the view is missing or `!view.enabled`;
  - a failing payment with `graceEndsAt`: the warning the test pins;
  - a failing payment after the grace period: "Your last payment didn't go through, so your account is on Basic until it's paid. Update your card.";
  - otherwise, with `alert`:
    - the message "You have {left} AI credits left until {date}.", tone `warning` at 5% and `info` at 20%;
    - the action is `upgradeActionFor(assertWithinLimit({ billing: true, plan, limits, creditsResetAt: credits.renewsAt }, 'aiCredits', limits.aiCredits))`, so each plan's next step comes from the shared table.

- [ ] **Step 5: The pages and components.**

**The public plan answer:**
- `PublicPlanLimits` gains `billing: boolean`.
- `getPublicPlan` answers `{ ...publicPlanFromSettings(...), billing: isBillingOn(env, context.user?.id ?? null) }`.
- Signed-out visitors see billing only once `BILLING=on`.

**`useBilling()`:** `useQuery({ queryKey: queryKeys.billing(), queryFn: () => unwrap(apiClient.getBilling(), "Couldn't load your plan"), enabled: isAuthenticated, staleTime: 60_000 })`.

**`PlanButton({ plan })`:**
- **Signed out:** `setIntendedUrl(`${BILLING_PATH}?plan=${plan}`)`, then `navigate('/signup')`.
- **Signed in:** `apiClient.startPlanCheckout(plan)`, then `window.location.href = url`. A 409 navigates to `${BILLING_PATH}?plan=${plan}`.
- The label is "Get Pro" or "Get Premium", with a spinner while waiting.

**`PlanLimits`:** with `plan.data?.billing`, it renders "5,000 AI credits a month · 3 stores · 1 live store" from `PLAN_LIMITS.basic`, through `formatCredits`. Otherwise today's daily line.

**`PlanCards`:**
- `const billing = usePublicPlan().data?.billing === true;`.
- `md:grid-cols-3` holds `<BasicPlan billing={billing} />`, `<PaidPlan plan="pro" billing={billing} />` and `<PaidPlan plan="premium" billing={billing} />`; `<EnterpriseBand />` is unchanged.
- **`PaidPlan`:**
  - `planName`, the tagline, `<Price cents={PLAN_PRICES_CENTS[plan]} />`, and "{credits} AI credits a month" from `PLAN_LIMITS`;
  - then `billing ? <PlanButton plan={plan} … /> : <PillLink to={contactPath('premium')} …>`, with `<ComingSoon />` and "Paid plans are coming soon. Tell us what you need and we'll set you up as they open." while billing is off;
  - features:
    - Pro: "Everything in Basic", "Up to 3 live stores, 10 new stores a day", "Your own domain on each live store", "The supplier catalog";
    - Premium: "Everything in Pro", "Up to 10 live stores, 25 new stores a day", "Buy extra credits any time", the capability features from today's Premium card, and "Priority email support".
- **`BasicPlan`** adds "1 live store, 3 stores in all" while billing is on.

**`ComparePlans`:** it maps `PLANS`, which now has four plans. The phone picker's default plan becomes `'pro'`.

**`Calculator`:**
- `const billing = plan.data?.billing === true;`;
- `const freeMonthly = !billing && plan.data?.aiCreditsPerDay != null ? plan.data.aiCreditsPerDay * DAYS_PER_MONTH : null;`;
- `const recommendation = recommendPlan(needed, freeMonthly ?? undefined);`.
- **`planPrice`:**
  - Basic "$0";
  - Pro `formatUsd(PLAN_PRICES_CENTS.pro)`;
  - Premium `formatUsd(PLAN_PRICES_CENTS.premium + extraCreditsPriceCents(recommendation.extraCredits))`;
  - Enterprise "Let's talk".
- **The summary line:**
  - Premium with extra credits: "Premium, 100,000 credits a month, plus {extra} extra credits ($X)";
  - Pro: "Pro, 20,000 credits a month";
  - Basic: "Basic, {5,000 credits a month | the free daily allowance}".
- **The next step:**
  - Basic: `<StartBuildingButton variant="blue" />`;
  - Pro or Premium: `billing ? <PlanButton plan={recommendation.plan} /> : <PillLink to={contactPath('premium', needed)} …>`;
  - Enterprise: `contactPath('enterprise')`.
- The phone summary bar keeps `{planPrice(recommendation)}`.

**`contact.ts`:**
- `contactPrefill` accepts `credits` when it is a whole number from 1 to 10,000,000, without `PREMIUM_TIERS`.
- The form's sentence becomes "You need about {credits} AI credits a month.".

**`positioning.ts`:** `pricingFaq(billing)`.
- **Billing on:**
  - "What are AI credits?": "Credits pay for the AI's work. Each step is charged from the work it really does, at the price of the model you pick, so lighter models go further. A typical step takes about 16 to 445 credits.";
  - "What happens when I run out of credits?": "Building and chatting pause until your credits renew, and your stores keep working. On Premium you can buy extra credits at once.";
  - "Can I buy more credits?": "On Premium, yes: $1.50 per 1,000, from 5,000 at a time. They're used after your monthly credits and last 12 months.";
  - "Can I change or cancel my plan?": "Any time, from your billing page. Moving to Premium happens at once; moving to Pro or cancelling happens at the end of the month you paid for.";
  - "Do unused credits roll over?": "Monthly credits don't; extra credits you buy do, for 12 months."
- **Billing off:** today's first two answers; "Are Pro and Premium available now?": "Not yet, they're coming soon. Tell us what you need and we'll set you up as they open."; and "Do unused credits roll over?": "No. Basic's allowance refills every day."
- `pricing.tsx` reads `usePublicPlan()` and renders `<PublicFaq leading={pricingFaq(billing)} />`.

**`/settings/billing`, `src/routes/settings/billing.tsx`:**
- Register it under `AppShell` as `{ path: 'settings/billing', element: (<ProtectedRoute><BillingPage /></ProtectedRoute>) }`.
- **Billing off** (`!data.enabled`): one card, "Plans aren't open for your account yet." with a link to `/pricing`.
- **The current plan:** name, status, "Renews on {date}" or "Ends on {date}", and a failing-payment note with "Update card".
- **The plans:** Pro and Premium side by side from `planChoicesFor`.
  - `checkout` calls `startPlanCheckout`;
  - `upgrade`, `downgrade` and Cancel open a confirmation from `confirmationFor`, then call `changePlan` or `cancelPlan`;
  - `resume` calls `resumePlan`, and `cancel-change` calls `changePlan(view.plan)`;
  - after each answer, invalidate `queryKeys.billing()` and toast "Done. It can take a few seconds to show here.";
  - `?plan=` from `requestedPlanOf` opens that plan's action once: the checkout button for Basic, the confirmation for Pro.
- **Credits:**
  - "{used} of {pool} AI credits used this month";
  - grants as "Added by Estori";
  - extra credits left, with each purchase's expiry ("5,000 left, expire October 19, 2027");
  - "Renews on {date}".
- **Extra credits,** `id="extra-credits"`:
  - on Premium, a stepper from 5,000 in steps of 1,000 up to 1,000,000, the price from `extraCreditsPriceCents`, and "Buy credits" calling `buyCredits`;
  - otherwise "Extra credits come with Premium." with a `PlanButton` or the upgrade choice.
- **Manage billing** (`canManageBilling`) calls `openBillingPortal`. **Cancel plan** shows on Pro and Premium when not cancelling.
- **Back from checkout:**
  - for `plan` or `credits`, set `confirming` and use `useQuery`'s `refetchInterval: confirming ? CONFIRM_POLL_MS : false`;
  - show "Confirming your payment…" until `isConfirmed(...)`;
  - after `CONFIRM_TIMEOUT_MS`, stop and show "Your payment is being confirmed. Refresh in a minute.";
  - `cancelled` shows "Checkout cancelled. Nothing was charged.".
- Every Stripe redirect sets `window.location.href`.

**Settings and the app layout:**
- In `settings/index.tsx`, a "Plan and billing" `LayerCard` shows your plan and a `Link to={BILLING_PATH}`, inside `billing.data?.enabled && (…)`.
- **`BillingBanner`** renders `billingBannerFor(useBilling().data)` above the app layout's `<Outlet />`:
  - `portal` actions call `openBillingPortal`;
  - `checkout` and `link` actions use `PlanButton` or `Link`;
  - a close button hides it for the rest of the session, stored under `billing-banner:{alert or 'payment'}:{renewsAt}` in `sessionStorage`, inside try/catch.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- src/routes/settings/billing-view.test.ts src/routes/billing-page-guard.test.ts src/routes/pricing-guard.test.ts src/routes/calculator-guard.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- src/routes/contact-guard.test.ts src/lib/plans.test.ts src/lib/credits.test.ts worker/api/controllers/limits/plan-wiring.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors. The Premium-tier errors left by Tasks 1 and 2 are gone.

- [ ] **Step 7: Check the pages by eye.** Start the dev server with `BILLING_USER_IDS` naming a local test account, from the person's `.dev.vars` (they add it themselves).
- `/pricing` signed out shows "coming soon".
- Signed in as that account, it shows Get Pro and Get Premium.
- `/settings/billing` shows Basic's credits.
- The calculator recommends Premium with extra credits at 150,000 credits a month.
- Check the light and dark themes, and a 375 px wide phone.

- [ ] **Step 8: Commit**

```bash
git add shared/types/plan.ts worker/api/controllers/limits src/routes/settings src/routes/billing-page-guard.test.ts src/routes/pricing-guard.test.ts src/routes/calculator-guard.test.ts src/routes/contact-guard.test.ts src/routes/pricing.tsx src/routes.tsx src/hooks/use-billing.ts src/components/billing src/components/marketing/PlanLimits.tsx src/components/pricing src/content/positioning.ts src/lib/contact.ts src/components/contact/ContactForm.tsx src/components/layout/app-layout.tsx
git commit -m "feat(billing): basic, pro and premium on the pricing page and calculator, a billing page with extra credits, and the billing banner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Admin endpoints

**Files:**
- Create:
  - `worker/api/controllers/admin/billing.ts`;
  - `worker/api/controllers/admin/billing.sql.test.ts`.
- Modify:
  - `worker/api/routes/billingRoutes.ts`;
  - `worker/database/services/BillingService.ts` (`linkCustomer`);
  - `shared/types/billing.ts` (admin types);
  - `worker/api/controllers/billing/billing-routes-wiring.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 1: `PLAN_IDS`, `planLimitOverridesFrom`;
  - from Task 3: `PlanAdminService.addOverride`, `latestOverride`;
  - from Task 4: `CreditLedgerService.addGrant`, `grantsOf`, `purchasesOf`;
  - from Task 5: `loadAccount`, `loadCredits`;
  - from Task 8: `billingView`;
  - existing: `stripeModeOf`, `AuthConfig.admin`.
- **Produces:**
  - `shared/types/billing.ts`:
    - `AdminBillingView = BillingView & { userId: string; override: { plan: PlanId | null; limits: PlanLimitOverrides; until: number | null; reason: string; createdAt: number } | null; grants: Array<{ credits: number; reason: string; createdAt: number }>; stripeCustomerUrl: string | null; stripeSubscriptionUrl: string | null }`;
    - `PlanOverrideRequest { plan: PlanId | null; limits?: PlanLimitOverrides; until?: string | null; reason: string }`;
    - `CreditGrantRequest { credits: number; reason: string }`.
  - `BillingService.linkCustomer(userId, stripeCustomerId, now): Promise<void>` (replaces the stored customer).
  - `BillingAdminController`:
    - `get`, `GET /api/admin/users/:userId/billing`;
    - `setPlan`, `PUT /api/admin/users/:userId/plan`;
    - `grantCredits`, `POST /api/admin/users/:userId/credits`;
    - `linkTestCustomer`, `PUT /api/admin/users/:userId/stripe-customer`, test mode only, for the test-clock scenarios.
    - All use `AuthConfig.admin`.

- [ ] **Step 1: Write the failing test** `worker/api/controllers/admin/billing.sql.test.ts`:

```ts
/** Admins' billing endpoints on real SQL: overrides and grants are recorded with the admin and the reason. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertBillingCustomer, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { BillingAdminController } from './billing';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
const DAY = 86_400_000;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'u_admin');
	await insertUser(db, 'u_seller', { createdAt: new Date(Date.now() - 40 * DAY) });
	await insertUser(db, 'u_paying');
	await insertSubscription(db, { userId: 'u_paying', stripeSubscriptionId: 'sub_paying', status: 'active', currentPeriodStart: new Date(Date.now() - DAY), currentPeriodEnd: new Date(Date.now() + 29 * DAY) });
});

const env = (extra: Record<string, unknown> = {}) => envWith(db, { BILLING: 'on', STRIPE_SECRET_KEY: 'sk_test_fake', ...extra });
const context = (userId: string) => ({ user: { id: 'u_admin' }, pathParams: { userId }, queryParams: new URLSearchParams() }) as unknown as RouteContext;
const request = (method: string, body?: unknown) => new Request('https://estori.app/api/admin', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('admin billing endpoints', () => {
	it('puts an account on Enterprise with custom limits, recorded with the admin and the reason', async () => {
		const response = await BillingAdminController.setPlan(request('PUT', { plan: 'enterprise', limits: { aiCredits: 500_000, liveStores: 40 }, reason: 'Signed Enterprise contract' }), env(), {} as ExecutionContext, context('u_seller'));
		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ plan: 'enterprise', source: 'override', limits: { aiCredits: 500_000, liveStores: 40, newStoresPerDay: 25 }, override: { plan: 'enterprise', reason: 'Signed Enterprise contract' } });
		expect(await db.prepare("SELECT user_id, action FROM audit_logs WHERE entity_id = 'u_seller'").first()).toEqual({ user_id: 'u_admin', action: 'plan_override' });
	});

	it('refuses an override without a reason, with an unknown plan, or with limits out of range', async () => {
		for (const body of [{ plan: 'enterprise' }, { plan: 'gold', reason: 'Because' }, { plan: 'premium', limits: { liveStores: -1 }, reason: 'Because' }, { plan: 'premium', until: 'tomorrow', reason: 'Because' }]) {
			expect((await BillingAdminController.setPlan(request('PUT', body), env(), {} as ExecutionContext, context('u_seller'))).status).toBe(400);
		}
	});

	it("adds credits to the account's current period, shown as added by Estori", async () => {
		const response = await BillingAdminController.grantCredits(request('POST', { credits: 10_000, reason: 'Launch partner' }), env(), {} as ExecutionContext, context('u_seller'));
		expect((await response.json()).data).toMatchObject({ credits: { pool: 5_000, granted: 10_000, left: 15_000 }, grants: [{ credits: 10_000, reason: 'Launch partner' }] });
		expect((await BillingAdminController.grantCredits(request('POST', { credits: 10_000, reason: 'x' }), env({ BILLING: undefined }), {} as ExecutionContext, context('u_seller'))).status).toBe(409);
	});

	it('links a test-clock customer only in test mode, and never over a live subscription', async () => {
		await insertBillingCustomer(db, 'u_seller', 'cus_old');
		const linked = await BillingAdminController.linkTestCustomer(request('PUT', { stripeCustomerId: 'cus_clock' }), env(), {} as ExecutionContext, context('u_seller'));
		expect(linked.status).toBe(200);
		expect(await db.prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = 'u_seller'").first()).toEqual({ stripe_customer_id: 'cus_clock' });
		expect((await BillingAdminController.linkTestCustomer(request('PUT', { stripeCustomerId: 'cus_x' }), env({ STRIPE_SECRET_KEY: 'sk_live_fake' }), {} as ExecutionContext, context('u_seller'))).status).toBe(409);
		expect((await BillingAdminController.linkTestCustomer(request('PUT', { stripeCustomerId: 'cus_x' }), env(), {} as ExecutionContext, context('u_paying'))).status).toBe(409);
	});

	it("shows an account's billing with links to Stripe", async () => {
		await insertBillingCustomer(db, 'u_paying', 'cus_paying');
		const response = await BillingAdminController.get(request('GET'), env(), {} as ExecutionContext, context('u_paying'));
		expect((await response.json()).data).toMatchObject({
			userId: 'u_paying',
			plan: 'pro',
			stripeCustomerUrl: 'https://dashboard.stripe.com/test/customers/cus_paying',
			stripeSubscriptionUrl: 'https://dashboard.stripe.com/test/subscriptions/sub_paying',
		});
	});
});
```

Add to `billing-routes-wiring.test.ts`:

```ts
	it('keeps account billing changes to admins', () => {
		const routes = source('/worker/api/routes/billingRoutes.ts');
		for (const route of ["'/api/admin/users/:userId/billing'", "'/api/admin/users/:userId/plan'", "'/api/admin/users/:userId/credits'", "'/api/admin/users/:userId/stripe-customer'"]) {
			const start = routes.indexOf(route);
			expect(start, route).toBeGreaterThan(-1);
			expect(routes.slice(start, start + 160), route).toContain('setAuthLevel(AuthConfig.admin)');
		}
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/api/controllers/admin/billing.sql.test.ts worker/api/controllers/billing/billing-routes-wiring.test.ts`
Expected: FAIL, "Failed to resolve import ./billing".

- [ ] **Step 3: Implement the controller.**

**`BillingAdminController extends BaseController`.** Every method reads `context.pathParams.userId`, answers 404 when `UserService.findUser` finds nobody, and answers the account's `AdminBillingView` on success.

**The view** is `billingView(...)` plus:
- `override`: the latest active one, parsed;
- `grants`: `grantsOf(userId, account.period.key)`;
- the Stripe links: `https://dashboard.stripe.com/${stripeModeOf(env) === 'test' ? 'test/' : ''}customers/{id}` and `…/subscriptions/{id}`, or null without an id.

**`setPlan`** validates the body and answers 400 "Pick a plan, give a reason, and keep the limits in range." when:
- `plan` isn't in `PLAN_IDS` or null;
- `limits`, when given, fails `planLimitOverridesFrom`;
- `until`, when given, isn't an ISO date in the future;
- `reason` isn't 3 to 500 characters after trimming.

Then `PlanAdminService.addOverride({ userId, plan, limits: limits ?? {}, until, adminUserId: context.user.id, reason, now })`. A null plan ends the override.

**`grantCredits`:**
- `credits` must be an integer from 1 to 10,000,000, with the same reason rule;
- billing off for the account answers 409 "Billing isn't on for this account.";
- otherwise `CreditLedgerService.addGrant` on `loadAccount`'s period and pool.

**`linkTestCustomer`:**
- 409 "Only in Stripe test mode." unless `stripeModeOf(env) === 'test'`;
- 409 "This account has a live subscription." when its row's status is live;
- 400 unless `stripeCustomerId` starts with `cus_`;
- otherwise `BillingService.linkCustomer` (an upsert on `user_id`), and an audit row `billing_customer` / `link_test_customer` in the same batch.

**Routes,** in `setupBillingRoutes` after the seller routes:

```ts
	app.get('/api/admin/users/:userId/billing', setAuthLevel(AuthConfig.admin), adaptController(BillingAdminController, BillingAdminController.get));
	app.put('/api/admin/users/:userId/plan', setAuthLevel(AuthConfig.admin), adaptController(BillingAdminController, BillingAdminController.setPlan));
	app.post('/api/admin/users/:userId/credits', setAuthLevel(AuthConfig.admin), adaptController(BillingAdminController, BillingAdminController.grantCredits));
	app.put('/api/admin/users/:userId/stripe-customer', setAuthLevel(AuthConfig.admin), adaptController(BillingAdminController, BillingAdminController.linkTestCustomer));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/api/controllers/admin/billing.sql.test.ts worker/api/controllers/billing/billing-routes-wiring.test.ts worker/database/services/billing.sql.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add worker/api/controllers/admin/billing.ts worker/api/controllers/admin/billing.sql.test.ts worker/api/routes/billingRoutes.ts worker/api/controllers/billing/billing-routes-wiring.test.ts worker/database/services/BillingService.ts shared/types/billing.ts
git commit -m "feat(billing): admin endpoints for an account's billing, enterprise and comp overrides, credit grants and test customers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Terms, refunds and the checkout agreement

**Files:**
- Modify:
  - `src/content/legal/terms.md`, `src/content/legal/refunds.md`, `src/content/legal/privacy.md` (version only);
  - `shared/types/legal.ts` (`TERMS_VERSION`);
  - `src/content/legal/legal-documents.test.ts`.

**Interfaces:**
- **Consumes:** `renewalDisclosure`, `EXTRA_CREDITS_DISCLOSURE` (Task 3), which say the same as the Terms.
- **Produces:** `TERMS_VERSION = '2026-10-19'`, and a new section 11, "Plans, AI credits and extra credits". Sections 11 to 21 become 12 to 22.

- [ ] **Step 1: Write the failing test.** In `legal-documents.test.ts`:
- the selling-terms test expects `terms.version` to be `'2026-10-19'`, keeps `## 10. Selling in your own store`, and expects `## 22. Contact`;
- add:

```ts
	it('adds plans, credits and extra credits as section 11, with renewal, cancelling and refunds', () => {
		const terms = LEGAL_DOCUMENTS.terms.body;
		expect(terms).toContain('## 11. Plans, AI credits and extra credits');
		for (const promise of [
			'renew automatically every month until you cancel',
			'Cancelling takes effect at the end of the period you paid for',
			'no refunds for part of a period',
			'Credits have no cash value',
			"charged from the AI's real usage",
			"Monthly credits don't carry over",
			'Extra credits are used after your monthly credits and expire 12 months after purchase',
			'non-refundable, except when you were charged twice or your account could not use them',
			"at least 30 days' notice",
		]) {
			expect(terms).toContain(promise);
		}
		expect(terms).not.toContain('Purchases are one-time payments');
		expect(terms).toContain('A paid site is a one-time payment in US dollars');
		const refunds = LEGAL_DOCUMENTS.refunds.body;
		expect(refunds).toContain('Pro, Premium and extra credits');
		expect(refunds).toContain('within 14 days');
	});

	it('says at checkout what the Terms say', () => {
		const terms = LEGAL_DOCUMENTS.terms.body;
		expect(EXTRA_CREDITS_DISCLOSURE.startsWith('Extra credits are used after your monthly credits and expire 12 months after purchase')).toBe(true);
		expect(terms).toContain(EXTRA_CREDITS_DISCLOSURE.replace(/\.$/, ''));
		expect(renewalDisclosure('pro')).toContain('until you cancel');
	});
```

with `import { EXTRA_CREDITS_DISCLOSURE, renewalDisclosure } from '../../../shared/types/billing';`.

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy bun run test -- src/content/legal/legal-documents.test.ts`
Expected: FAIL, version and section 11 missing.

- [ ] **Step 3: Write the wording.**

**`terms.md`:**
- In section 6, replace "Purchases are one-time payments in US dollars." with "A paid site is a one-time payment in US dollars."
- Insert after section 10:

```markdown
## 11. Plans, AI credits and extra credits

Estori has a free plan, Basic, and paid plans, Pro and Premium, at the prices on our pricing page when you subscribe. Paid plans are billed in US dollars to your card through Stripe, and renew automatically every month until you cancel. You can cancel any time from your billing page in Estori. Cancelling takes effect at the end of the period you paid for; until then you keep your plan. Moving from Pro to Premium takes effect at once, and we charge the difference for the rest of the period. Moving from Premium to Pro takes effect at the next renewal. There are no refunds for part of a period or for a move to Pro.

Each plan includes AI credits for each period. Credits pay for the AI's work: each step the AI takes is charged from the AI's real usage, at the price of the model you choose. Monthly credits don't carry over to the next period. Credits have no cash value and can't be transferred or exchanged for money.

On Premium you can buy extra credits. Extra credits are used after your monthly credits and expire 12 months after purchase. They stay yours if you change plans. Extra credits are non-refundable, except when you were charged twice or your account could not use them; refunded extra credits that are still unused are removed from your account.

A turn the AI has started always finishes. If it uses more credits than you had left, the difference is taken from your extra credits; if you have none, we don't charge you for it.

We may change the prices or the credits of a plan with at least 30 days' notice. A change applies from your first renewal after it takes effect. Plans also set limits, such as how many stores can be live at once; going over a limit after a plan change never takes a live store offline.
```

- Renumber the later sections, and every "section N" reference to them in the Terms and the other legal pages. Search the repository for references to the old numbers, such as "section 14", and update them.
- Set the front matter `version: 2026-10-19` and `updated: October 19, 2026`.

**`refunds.md`:** after the paid-site section, add "## Pro, Premium and extra credits":
- Payments for Pro, Premium and extra credits are refundable only when you were charged twice, or when your account couldn't use Estori. Ask within 14 days of the payment, as above.
- A refund of extra credits removes the unused credits it covers.
- Cancelling a plan stops its renewal; the current period isn't refunded.
- Update the opening paragraph to say the policy covers plans and extra credits too, and set the version and date.

**`privacy.md` and `legal.ts`:**
- `privacy.md` gets `version: 2026-10-19`, since the two versions move together.
- `TERMS_VERSION` becomes `'2026-10-19'`. `SELLER_TERMS_VERSION` stays `'2026-10-16'`, because section 10 didn't change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- src/content/legal/legal-documents.test.ts`
Expected: PASS.

Run: `rg -n "TERMS_VERSION|2026-10-16" src worker shared --type ts`
Expected: no test or guard still pins the old Terms version. Update any that does.

- [ ] **Step 5: Commit**

```bash
git add src/content/legal shared/types/legal.ts
git commit -m "feat(billing): terms and refund policy for plans, ai credits and extra credits, with everyone accepting the new terms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: The enforcement notice, the Stripe scenarios, the by-eye check and the PR

**Files:**
- Create:
  - `worker/services/billing/enforcement-notice.ts`;
  - `scripts/stripe-billing-scenarios.ts`;
  - `docs/estori/billing-test-scenarios.md`.
- Modify:
  - `worker/services/billing/jobs.ts` (the hourly run sends the notice);
  - `worker/types/env.d.ts` (`BILLING_ENFORCEMENT_FROM`);
  - `worker/database/services/BillingService.ts` (`accountsWithoutNotice`, `storesStartedOf`);
  - `worker/database/services/LiveStoreService.ts` (`liveAppsOf`);
  - `docs/estori/launch-checklist.md` (the owner steps).
- Test:
  - `worker/services/billing/enforcement-notice.sql.test.ts`;
  - `scripts/stripe-billing-scenarios.test.ts`.

**Interfaces:**
- **Consumes:**
  - `claimAndSendNotice`, `claimingMailFromEnv` (Task 7);
  - `LiveStoreService.liveCountOf` (Task 11);
  - `parseStoreManifest` (existing);
  - the admin endpoints (Task 13);
  - the webhook (Task 9).
- **Produces:**
  - `enforcement-notice.ts`:
    - `enforcementStartsOn(value: string | undefined): number | null` (UTC midnight of a `YYYY-MM-DD` date);
    - `sellsCatalogProducts(manifest: string | null): boolean`;
    - `EnforcementDeps { accounts(key: string, limit: number): Promise<string[]>; liveStores(userId: string): Promise<string[]>; storesStarted(userId: string): Promise<number>; liveManifest(appId: string): Promise<string | null>; mail: ClaimingMailDeps }`;
    - `sendEnforcementNotices(deps, startsOnMs: number, nowMs: number): Promise<number>`;
    - `enforcementDepsFromEnv(env)`.
  - `BillingService.accountsWithoutNotice(key: string, limit: number): Promise<string[]>`, `storesStartedOf(userId): Promise<number>`.
  - `LiveStoreService.liveAppsOf(userId): Promise<string[]>`.
  - `scripts/stripe-billing-scenarios.ts`:
    - `ScenarioConfig { stripeKey: string; baseUrl: string; adminCookie: string; stagingKey: string | null; userId: string }`;
    - `readScenarioConfig(env: Record<string, string | undefined>): ScenarioConfig` (throws on a live key);
    - `waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, options?: { tries: number; delayMs: number }): Promise<T>`;
    - `SCENARIOS: ReadonlyArray<{ id: number; name: string; byEye: boolean }>`.
  - Env: `BILLING_ENFORCEMENT_FROM?: string`.

- [ ] **Step 1: Write the failing notice test** `worker/services/billing/enforcement-notice.sql.test.ts`:

```ts
/** A week's notice before limits apply: once per account, with a line for accounts already over Basic. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { LiveStoreService } from '../../database/services/LiveStoreService';
import { BillingService } from '../../database/services/BillingService';
import { enforcementDepsFromEnv, enforcementStartsOn, sellsCatalogProducts, sendEnforcementNotices } from './enforcement-notice';

let db: D1Database;
const STARTS = Date.parse('2026-11-01T00:00:00Z');
const NOW = Date.parse('2026-10-25T10:05:00Z');
const CATALOG = JSON.stringify({ products: [{ id: 'lamp', name: 'Lamp', variants: [{ id: 'v', name: 'Black', priceCents: 3500, catalogVariantId: '5e0c1d64-8f1e-4a7b-9b55-2f7f6c1d9a10' }] }] });

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_small', 'u_big', 'u_catalog']) await insertUser(db, id);
	for (const [id, userId] of [['app_s', 'u_small'], ['app_b1', 'u_big'], ['app_b2', 'u_big'], ['app_c', 'u_catalog']] as const) await insertApp(db, { id, userId });
});

function env(sent: Array<{ to: string; text: string }>): Env {
	const namespace = { idFromName: (name: string) => name, get: (appId: string) => ({ getStoreManifest: async () => ({ commitHash: 'c1', manifest: appId === 'app_c' ? CATALOG : null }) }) };
	return envWith(db, {
		ENVIRONMENT: 'prod',
		CUSTOM_DOMAIN: 'estori.app',
		SPACE_DO: namespace,
		EMAIL: {
			send: async (message: { to: string; text: string }) => {
				sent.push({ to: message.to, text: message.text });
				return { messageId: 'm1' };
			},
		},
	});
}

describe('the enforcement notice', () => {
	it('reads the start date, and finds catalog products in a live version', () => {
		expect(enforcementStartsOn('2026-11-01')).toBe(STARTS);
		for (const bad of [undefined, '', 'November 1', '2026-13-01']) expect(enforcementStartsOn(bad)).toBeNull();
		expect(sellsCatalogProducts(CATALOG)).toBe(true);
		expect(sellsCatalogProducts(null)).toBe(false);
		expect(sellsCatalogProducts('{')).toBe(false);
	});

	it('tells every account once, adding a line for those over Basic, and stops when limits start', async () => {
		const stores = new LiveStoreService(envWith(db));
		for (const appId of ['app_s', 'app_b1', 'app_b2', 'app_c']) await stores.publish({ appId, slug: appId.replace('_', '-'), commit: 'c1', now: new Date(NOW) });
		await new BillingService(envWith(db)).reserveStore('u_small', null, new Date(NOW));
		const sent: Array<{ to: string; text: string }> = [];
		const deps = enforcementDepsFromEnv(env(sent));
		expect(await sendEnforcementNotices(deps, STARTS, NOW)).toBe(3);
		expect(await sendEnforcementNotices(deps, STARTS, NOW + 3_600_000)).toBe(0);
		const over = (userId: string) => sent.find((email) => email.to.startsWith(userId))?.text.includes('to publish more, get Pro or Premium');
		expect([over('u_small'), over('u_big'), over('u_catalog')]).toEqual([false, true, true]);
		expect(await sendEnforcementNotices(deps, STARTS, STARTS)).toBe(0);
	});
});
```

`insertUser` writes `{id}@example.test`, which the `startsWith` check relies on.

- [ ] **Step 2: Write the failing script test** `scripts/stripe-billing-scenarios.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SCENARIOS, readScenarioConfig, waitFor } from './stripe-billing-scenarios';

const ENV = { STRIPE_SECRET_KEY: 'sk_test_fake', ESTORI_BASE_URL: 'https://staging.estori.app', ESTORI_ADMIN_COOKIE: 'session=abc', ESTORI_STAGING_KEY: 'gate', ESTORI_TEST_USER_ID: 'u_test' };

describe('the Stripe billing scenarios', () => {
	it('runs only in test mode, against the account it is given', () => {
		expect(readScenarioConfig(ENV)).toEqual({ stripeKey: 'sk_test_fake', baseUrl: 'https://staging.estori.app', adminCookie: 'session=abc', stagingKey: 'gate', userId: 'u_test' });
		expect(() => readScenarioConfig({ ...ENV, STRIPE_SECRET_KEY: 'sk_live_fake' })).toThrow('Run the scenarios with a test key only.');
		expect(() => readScenarioConfig({ ...ENV, ESTORI_TEST_USER_ID: undefined })).toThrow('Set ESTORI_TEST_USER_ID');
	});

	it("covers the spec's ten scenarios, with 3-D Secure by eye", () => {
		expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(SCENARIOS.filter((scenario) => scenario.byEye).map((scenario) => scenario.id)).toEqual([6]);
	});

	it('waits for the webhook to land, and gives up after its tries', async () => {
		let reads = 0;
		expect(await waitFor(async () => ++reads, (value) => value >= 3, { tries: 5, delayMs: 0 })).toBe(3);
		await expect(waitFor(async () => 0, (value) => value > 0, { tries: 2, delayMs: 0 })).rejects.toThrow('Gave up after 2 tries');
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/enforcement-notice.sql.test.ts scripts/stripe-billing-scenarios.test.ts`
Expected: FAIL, failed imports.

- [ ] **Step 4: Implement the notice.**

**`enforcementStartsOn(value)`:** matches `^\d{4}-\d{2}-\d{2}$`, builds `Date.UTC`, and answers null unless the date round-trips (so `2026-13-01` fails).

**`sellsCatalogProducts(manifest)`:** true when `parseStoreManifest(manifest)` is ok and any product's variant has a `catalogVariantId`.

**`sendEnforcementNotices(deps, startsOnMs, nowMs)`:**
1. Answer 0 when `nowMs >= startsOnMs`.
2. The key is `enforcement_notice:{YYYY-MM-DD}`. Read up to 100 `deps.accounts(key, 100)`.
3. For each account, `overLimits` is true when any of these holds:
   - more than one live store;
   - more than 3 stores started;
   - a live version that sells catalog products.
4. Claim and send `{ kind: 'enforcement_notice', startsOn: startsOnMs, overLimits }`.
5. Answer the count sent. Each account is caught and logged on its own.

**`enforcementDepsFromEnv(env)`:**
- `accounts`: `BillingService.accountsWithoutNotice(key, limit)`, the users not deleted without that notice;
- `liveStores`: `LiveStoreService.liveAppsOf`;
- `storesStarted`: `BillingService.storesStartedOf`, from `account_store_counts`, 0 without a row;
- `liveManifest`: SpaceDO's `getStoreManifest('live')`;
- `mail`: `claimingMailFromEnv(env)`.

**`runHourlyBilling`** also calls `sendEnforcementNotices(enforcementDepsFromEnv(env), startsOn, nowMs)` when `enforcementStartsOn(env.BILLING_ENFORCEMENT_FROM)` isn't null. It runs whatever the billing flag says: the notice goes out before the flag turns on.

**`env.d.ts`:** add `// "YYYY-MM-DD": the day plan limits start; the hourly run emails every account the week before. BILLING_ENFORCEMENT_FROM?: string;`.

- [ ] **Step 5: The scenarios script.**

```ts
/**
 * Billing end to end in Stripe test mode against a deployed Estori (staging), using test clocks to move time.
 * After each step it reads Estori's billing view through the admin API and checks the plan and credits.
 * Usage: STRIPE_SECRET_KEY=sk_test_... ESTORI_BASE_URL=https://staging.estori.app ESTORI_ADMIN_COOKIE='...'
 *        ESTORI_STAGING_KEY=... ESTORI_TEST_USER_ID=... bun scripts/stripe-billing-scenarios.ts [--only 1,2]
 */
```

**`readScenarioConfig`:**
- throws "Run the scenarios with a test key only." for a key not starting with `sk_test_` or `rk_test_`;
- throws "Set {NAME}" for each missing value; only `ESTORI_STAGING_KEY` is optional.

**`waitFor`:** reads up to `tries` times (default 15), `delayMs` apart (default 2,000), answers the first value `done` accepts, and otherwise throws `Gave up after {tries} tries`.

**Calls:**
- Stripe calls use `createStripeClient`'s request shape, with `encodeForm`, the pinned version and idempotency keys.
- Estori calls send the `Cookie` header and `x-estori-staging-key`.

**The account:** the scenarios share one test account.
1. Create a test clock.
2. Create a customer on it with `metadata[estori_user_id]`, attach `pm_card_visa`, and set it as the default.
3. Link the customer with `PUT /api/admin/users/:userId/stripe-customer`.
4. Before scenario 1, end any override with `PUT /api/admin/users/:userId/plan` and `{ plan: null, reason: 'Billing scenarios' }`.

| # | Scenario | The script does | Estori's view must show |
| --- | --- | --- | --- |
| 1 | Subscribe to Pro | create a subscription for the Pro price with `metadata[estori_user_id]` | `plan: 'pro'`, `status: 'active'`, 20,000 credits |
| 2 | Renew a month later | advance the clock past the period end | a new `periodStart`, `credits.used` 0 |
| 3 | Pro to Premium mid-period | update the item to Premium with `proration_behavior=always_invoice`, `payment_behavior=error_if_incomplete` | `plan: 'premium'`, 100,000 credits |
| 4 | Premium to Pro at renewal | create the schedule as `scheduleSubscriptionPrice` does; then advance the clock past the period end | `pendingPlan: 'pro'`; then `plan: 'pro'`, `pendingPlan: null` |
| 5 | Failed renewal, grace, new card | set `pm_card_chargeCustomerFail` (4000 0000 0000 0341) as default; advance past renewal; advance 8 days; set `pm_card_visa` and pay the open invoice | `status: 'past_due'` with the plan kept and `graceEndsAt` set; then `plan: 'basic'`; then `status: 'active'` with the plan back |
| 6 | 3-D Secure at checkout | prints a reminder: by eye with 4000 0025 0000 3155 | (by eye) |
| 7 | Cancel at the period end | `cancel_at_period_end=true` | `cancelAtPeriodEnd: true`, the plan kept |
| 8 | Resume before the end | `cancel_at_period_end=false` | `cancelAtPeriodEnd: false` |
| 9 | An expired checkout | create a credits Checkout Session with the account's metadata, then expire it | no new purchase |
| 10 | Extra credits bought, then refunded | asks the person to buy 5,000 credits on the billing page with 4242 4242 4242 4242, waits for the purchase, then refunds its payment in full | `purchasedLeft` 5,000; then 0 |

**Running it:**
- Each scenario prints "PASS n name" or "FAIL n name: reason".
- The run ends by deleting the test clock, which removes its customer and subscriptions.
- `main()` runs only when `import.meta.main`, and exits 1 on any failure.

- [ ] **Step 6: The written checklist** `docs/estori/billing-test-scenarios.md`. List:
- the ten scenarios, with how to run them and what Estori must show;
- the by-eye journeys:
  - buying Pro from `/pricing` signed out, through sign-up;
  - buying Premium from a limit dialog;
  - moving between plans on the billing page;
  - Manage billing;
  - buying extra credits;
  - each limit dialog;
  - the banner at 20% and 5%;
  - the failed-payment banner;
  - each Estori email, with its "[Staging]" prefix on staging.

Add the owner steps from spec section 14 to `docs/estori/launch-checklist.md`:
- the setup script in each mode, and `STRIPE_PRICE_IDS`;
- the portal and the Terms of Service URL;
- Smart Retries;
- Stripe's emails off;
- the billing webhook events, `charge.refunded` included;
- the Enterprise override for the owner's account;
- confirming the Gemini prices;
- `BILLING_ENFORCEMENT_FROM` a week before `BILLING=on`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/enforcement-notice.sql.test.ts scripts/stripe-billing-scenarios.test.ts worker/services/billing/jobs.sql.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add worker/services/billing/enforcement-notice.ts worker/services/billing/enforcement-notice.sql.test.ts worker/services/billing/jobs.ts worker/types/env.d.ts worker/database/services/BillingService.ts worker/database/services/LiveStoreService.ts scripts/stripe-billing-scenarios.ts scripts/stripe-billing-scenarios.test.ts docs/estori/billing-test-scenarios.md docs/estori/launch-checklist.md
git commit -m "feat(billing): a week's notice before limits apply, the stripe test-clock scenarios, and the billing checklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: The by-eye check on local.**
1. Restart the dev server. The person running it has added `BILLING_USER_IDS` (the local test account), `STRIPE_PRICE_IDS` from a test-mode run of the setup script, and the test keys to `.dev.vars`.
2. Run `stripe listen --forward-to localhost:<port>/api/stripe/webhook` as for store payments.
3. Sign in with the test account from `.superpowers/realtest/local-accounts.md`. Never paste its password into chat.
4. Walk the by-eye list from Step 6:
   - buy Pro with 4242 4242 4242 4242;
   - move to Premium;
   - buy 5,000 extra credits;
   - schedule Pro;
   - cancel and keep the plan;
   - open Manage billing.
5. Run out of credits with a small admin override (`aiCredits: 200`). Check the Upgrade dialog, the 20% and 5% banner and emails, and that the turn in progress finished.
6. As a Basic account, try:
   - a second live store;
   - an own domain;
   - a version adding a catalog product.
   Each opens the Upgrade dialog, and the live store keeps serving.
7. With `BILLING_USER_IDS` emptied, check `/pricing` shows "coming soon" and the old daily allowance.

- [ ] **Step 10: The CI steps**

```bash
npx eslint .
```

```bash
bun run typecheck
```

```bash
bun run build
```

```bash
bun run bundle:check
```

```bash
bun run test
```

Expected: all pass. Report the shard totals.

- [ ] **Step 11: Final review.** Run the fresh whole-branch review the execution skill names, with this plan's Review Focus. Fix its Critical and Important findings with failing tests first.

- [ ] **Step 12: Open the PR into `main`.**
- Push `feat/billing` and open the PR with `gh pr create --base main`.
- The description says:
  - what was built, by area;
  - the choices from the top of this plan;
  - the migration number;
  - the owner steps from spec section 14;
  - the by-eye results;
  - the test totals;
  - that billing stays off until `BILLING` or `BILLING_USER_IDS` is set.
- End the description with "Generated with [Claude Code](https://claude.com/claude-code)".
- Don't merge.
