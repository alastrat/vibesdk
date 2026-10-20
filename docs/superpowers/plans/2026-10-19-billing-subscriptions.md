# Billing and Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers buy Premium by card and manage it from Estori. Every plan's limits live in one shared table and are enforced where they matter. Estori's records and emails follow Stripe.

**Architecture:**
- **One limits table.** `shared/types/plans.ts` holds `PLAN_LIMITS`, the pure `limitsFor` and `assertWithinLimit`, and the `plan_limit` refusal. The Worker, the pricing page and the AI's tools all read it.
- **The account's plan** comes from D1: the `subscriptions` row (Stripe's state), the 7-day grace, the latest `plan_overrides` row and this period's `credit_grants`. Basic's numbers and the per-user KV overrides still come from the live configuration. `loadAccount(env, userId)` puts it together.
- **Stripe is the source of truth.** The webhook re-reads the subscription from Stripe's API on every billing event. It records the event, the rebuilt row and the notices to send in one D1 batch. A daily job re-reads suspicious rows the same way. Billing API calls only ask Stripe for changes; the page polls until the webhook lands.
- **Credits** stay counted per step in `DORateLimitStore`. Basic keeps today's daily bucket. Premium and Enterprise get one bucket per billing period, keyed by its start. One plan check runs before every turn and every new store.
- **Everything new is behind the `billing` flag** (`BILLING=on`, or `BILLING_USER_IDS`). With the flag off, `limitsFor` returns today's Basic and no new limit is enforced.

**Tech Stack:** Cloudflare Workers, D1 with drizzle, Durable Objects (`DORateLimitStore`, `ThinkAgent`, SpaceDO), the Stripe REST API `2026-03-25.dahlia` over fetch (no SDK), Hono, React 19, TanStack Query, vitest-pool-workers.

**Spec:** `docs/superpowers/specs/2026-10-19-billing-subscriptions-design.md`

## Rulings against the spec

Each keeps the spec's intent. Each gets a `Ruling:` line in the ledger at Task 1.

1. **Rows are rebuilt from the subscription as Stripe's API returns it, not from the copy inside the event.**
   - **Why:** event payloads use the webhook endpoint's API version, and since `2025-03-31.basil` the period fields moved to `items.data[]` and an invoice's subscription moved to `parent.subscription_details`. Invoice events carry no subscription at all. The store webhook already re-reads sessions through the API for the same reason. A fresh read also converges on Stripe's latest state whatever order events arrive in.
   - **Cost if wrong:** one Stripe read per billing event. While Stripe is unreachable the webhook answers 500 and Stripe retries.
2. **The webhook also handles `subscription_schedule.created`, `.updated`, `.released` and `.canceled`.** Owner step 5 gains these four events.
   - **Why:** a downgrade is a schedule. Stripe may not send `customer.subscription.updated` when a schedule is attached or released, so without these events the page would never show, or clear, a pending downgrade.
   - **Cost if wrong:** four more event types that each cost one Stripe read.
3. **Scenario 6 (3-D Secure at checkout) is a by-eye step, not part of `scripts/stripe-billing-scenarios.ts`.**
   - **Why:** it needs Stripe's hosted Checkout page in a browser. Test clocks also attach only to customers created with them, so the script links a test-clock customer to the test account through a test-mode-only admin endpoint (Task 11). It reads the plan "at" the clock's time through the admin billing read, because Estori's own clock doesn't move with the test clock.
   - **Cost if wrong:** 3-D Secure at checkout needs a person before each release. The other eight scenarios run unattended.

## Choices the spec leaves open

Made here, one line each. Task 1's ledger records them too.

1. **Monthly pools without a subscription** (Enterprise, or a comp with no paid subscription) run on the UTC calendar month.
2. **Enterprise without custom limits** starts at Premium's largest numbers: 200,000 credits, 25 new stores a day, 10 live stores, a domain per live store, the catalog.
3. **Per-user KV credit overrides** (`user_config:<id>` `llmCalls`) apply only to a daily allowance. A monthly pool ignores them. New-store overrides apply on every plan.
4. **Upgrades use `payment_behavior: 'error_if_incomplete'`.** A declined card refuses the upgrade with a message, so nothing changes until Stripe has the money.
5. **Cancelling a pending downgrade** is choosing the current pool again on the billing page. It releases the schedule.
6. **Cancelling with a pending downgrade** releases the schedule first.
7. **Every billing email is deduped through `billing_notices`**, not just the credit warnings. Keys: one per subscription, invoice or period, as Task 7 lists.
8. **"Premium ending"** is sent when the cancel is recorded and names the last day. **"Premium ended"** is sent when the subscription is deleted.
9. **The payment-failed email** is sent once per invoice, not once per retry.
10. **The grace period** ends 7 days after the start of the period whose renewal failed: `current_period_start + 7 days`.
11. **A $0 invoice** (a full promotion code) sends no receipt.
12. **A second live subscription for one account** (two checkouts in two tabs) is refused, and an alert tells the team to refund it. The first one stays.
13. **`subscriptions` gains two columns** beyond the spec's list: `stripe_schedule_id`, so a pending downgrade can be released, and `stripe_created_at`, so a newer subscription can replace an ended one.
14. **The enforcement notice** goes to every account that has at least one app. An admin endpoint sends it in batches, and `scripts/billing-enforcement-notice.ts` drives the batches.
15. **Task order:** emails (Task 5) come before the billing API and the webhook, which send them. The shared Upgrade dialog arrives with credits (Task 8), its first user.

## Global Constraints

- No `any`. No emojis in code, comments or copy.
- **Anti-goals (spec section 1):**
  - a downgrade or a failed card never takes a live store offline, stops its checkout, or removes its domain;
  - Estori's records follow Stripe: no row changes until Stripe confirms;
  - no overage billing and no automatic tier jumps.
- **Plans:** `{ plan: 'basic' | 'premium' | 'enterprise', tier: 1 | 2 | 3 | 4 | null }`. Tiers: 20,000 credits for $99, 50,000 for $199, 100,000 for $349, 200,000 for $599, billed monthly.
- **Limits (spec section 3):**
  - **Basic:** credits and new stores a day come from the live configuration (200 and 3 by default); 1 live store; no own domains; no supplier catalog.
  - **Premium:** the tier's monthly pool; 25 new stores a day; 10 live stores; 1 own domain per live store; the catalog.
  - **Enterprise:** set per account.
  - **Drafts:** 5 per store on every plan.
- **Limits are worked out in this order, later steps winning:** the plan's row; the tier's pool; the per-user KV overrides; the admin plan override. Grants add to the credit limit last.
- **Grace:** `past_due` stays Premium for 7 days, then Basic while Stripe keeps retrying. A successful payment restores Premium.
- **Prices come only from `STRIPE_PREMIUM_PRICE_IDS`** (JSON, tier to price id), never from the browser. Every Stripe call goes through `createStripeClient`, which pins `Stripe-Version: 2026-03-25.dahlia`.
- **Billing emails** come from Estori through `createEmailSender`, so staging's "[Staging] " prefix and recipient allowlist apply. Stripe's own customer emails stay off.
- **Flag:** `BILLING=on` turns billing on for everyone. `BILLING_USER_IDS` (comma-separated) turns it on for those accounts while `BILLING` isn't `on`. With the flag off, nothing new is enforced and the pricing page keeps "coming soon".
- **Refusals** are HTTP 402 with `error: { code: 'plan_limit', planLimit: { code, limit, plan, upgradeTo, message } }`. Over WebSocket they are `{ type: 'error', code: 'PLAN_LIMIT', planLimit }`. Their copy is built once, in `assertWithinLimit`.
- **Seller copy:**
  - follows `src/routes/copy-rules.ts`, so no supplier or AI assistant names (saying "the AI" is fine);
  - says "AI credits", "credit pool", "Premium", "Basic";
  - never says "subscription schedule" or "proration".
- **Admin endpoints** use `AuthConfig.admin` (`isPlatformAdmin`) and write an `audit_logs` row in the same batch as their change.
- **Migrations:** one drizzle migration, generated with `bun run db:generate -- --name billing`. It takes the next free number (0029 on this branch, unless another branch merged one first).
- **Never read `.dev.vars`.** To try billing locally, the person running it adds `BILLING`, `STRIPE_PREMIUM_PRICE_IDS` and the test keys there themselves.
- **Commits:** subjects are lowercase after the type. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:**
  - `.dev.vars` or `bun.lockb`;
  - anything under `.superpowers/` or `.playwright-mcp/`;
  - `src/routes/landing/LandingPage.tsx` or `wrangler.jsonc`, which carry local changes;
  - the untracked `docs/superpowers/specs/2026-10-18-shopper-order-access-design.md`.
- **Tests:**
  - Run from the repo root, as `rtk proxy bun run test -- <files>`.
  - Run a few files at a time: many files at once exhausts ports.
  - Type-check with `bun run typecheck`.
- **Before the PR:** `npx eslint .`, `bun run typecheck`, `bun run build`, `bun run bundle:check`, and `bun run test` (sharded).
- **Don't merge the PR.** The owner merges.

## Review Focus

1. **Webhook deliveries that repeat, arrive out of order, or come from another subscription.** This covers a retry, `updated` before `created`, a late event from an ended subscription, and a second paid subscription from two checkout tabs.
   - **Expect:**
     - the row ends at Stripe's latest state;
     - each email goes once;
     - a late event from an ended subscription changes nothing;
     - a second live subscription is refused and alerted, and the first is kept.
   - **Guarded by:** the duplicate, out-of-order, late-event and second-subscription tests in Task 7.
2. **An account over its plan after a downgrade or a failed card,** for example 3 live stores on Basic with catalog products in them.
   - **Expect:**
     - every store keeps serving;
     - republishing a live store always works, including its existing catalog products;
     - publishing a store that isn't live is refused;
     - a version that adds a new catalog product is refused.
   - **Guarded by:** the republish, new-store and catalog tests in Task 9.
3. **Credits at the boundary.** Cases: a turn that starts just under the limit, the next turn, many steps past 80%, and a ThinkAgent restart mid-period.
   - **Expect:**
     - the started turn finishes;
     - the next turn is refused;
     - each warning email goes once per period.
   - **Guarded by:** the meter tests in Task 3 and the notice tests in Task 8.
4. **The grace clock.** Cases: day 6 and day 8 of a failed renewal, a payment on day 9, and a tier change while `past_due`.
   - **Expect:**
     - Premium on day 6, Basic on day 8;
     - Premium again as soon as the payment lands;
     - the tier change refused with "Update your card".
   - **Guarded by:** the grace tests in Task 3 and Task 7, and the past-due refusal in Task 6.
5. **The flag.** Cases: `BILLING` off with or without the account in `BILLING_USER_IDS`, spaces and empty entries in the list, and signed-out visitors.
   - **Expect:**
     - accounts outside the flag see exactly today's behavior: no new refusals, the same credit bucket, "coming soon" on pricing;
     - accounts inside it see billing.
   - **Guarded by:** the flag tests in Task 3, the flag-off WebSocket test in Task 8, the flag-off publish test in Task 9, and the pricing guard in Task 10.

---

### Task 1: The plan limits module

**Files:**
- Create `shared/types/plans.ts`.
- Modify:
  - `shared/types/drafts.ts` (add `DRAFT_LIMIT`);
  - `src/api-types.ts` (re-export);
  - `src/lib/plans.ts`;
  - `src/components/pricing/PlanCards.tsx`.
- Test:
  - `shared/types/plans.test.ts`;
  - `src/lib/plans.test.ts`;
  - `src/routes/pricing-guard.test.ts`.

**Interfaces:**
- **Consumes:** `DRAFT_LIMIT` (added here).
- **Produces** (all from `shared/types/plans.ts`, re-exported through `@/api-types`):
  - constants:
    - `PLAN_IDS`, `PREMIUM_TIER_NUMBERS`, `PREMIUM_TIERS`, `PLAN_LIMITS`;
    - `PLAN_LIMIT_CODE = 'plan_limit'`, `GRACE_PERIOD_DAYS = 7`.
  - types:
    - `PlanId`, `PremiumTierNumber`, `PremiumTier { tier; credits; priceCents }`;
    - `CreditsWindow = 'day' | 'period'`;
    - `PlanLimits { aiCredits: number; aiCreditsWindow: CreditsWindow; newStoresPerDay: number; liveStores: number | null; ownDomainsPerLiveStore: number; supplierCatalog: boolean; draftsPerStore: number }`;
    - `PlanLimitKey = 'aiCredits' | 'newStoresPerDay' | 'liveStores' | 'ownDomainsPerLiveStore' | 'supplierCatalog'`;
    - `PlanLimitOverrides` (the admin's partial limits);
    - `PlanAccountInput`;
    - `PlanAccount { billing: boolean; plan: PlanId; tier: PremiumTierNumber | null; limits: PlanLimits; creditsResetAt: number }`;
    - `PlanLimitRefusal { code: 'plan_limit'; limit: PlanLimitKey; plan: PlanId; upgradeTo: 'premium' | 'enterprise' | null; message: string }`.
  - functions:
    - `premiumTier(tier): PremiumTier`, `isPremiumTierNumber(value: unknown): value is PremiumTierNumber`;
    - `limitsFor(input: PlanAccountInput): PlanLimits`;
    - `assertWithinLimit(account: PlanAccount, key: PlanLimitKey, current?: number): PlanLimitRefusal | null`;
    - `isPlanLimitRefusal(value: unknown): value is PlanLimitRefusal`;
    - `planLimitOverridesFrom(value: unknown): PlanLimitOverrides | null`;
    - `formatBillingDate(ms: number): string` ("November 19", UTC);
    - `formatUsd(cents: number): string` (moved here from `src/lib/plans.ts`, which re-exports it).

- [ ] **Step 1: Ledger the rulings and choices.** Write the three rulings from "Rulings against the spec" and the fifteen choices from "Choices the spec leaves open" into the ledger, one `Ruling:` or `Choice:` line each.

- [ ] **Step 2: Write the failing test** `shared/types/plans.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DRAFT_LIMIT } from './drafts';
import {
	PLAN_LIMITS,
	PREMIUM_TIERS,
	assertWithinLimit,
	formatBillingDate,
	isPlanLimitRefusal,
	limitsFor,
	planLimitOverridesFrom,
	premiumTier,
	type PlanAccount,
	type PlanAccountInput,
} from './plans';

const RENEWAL = Date.UTC(2026, 10, 19);

function input(overrides: Partial<PlanAccountInput> = {}): PlanAccountInput {
	return { billing: true, plan: 'basic', tier: null, basic: { aiCreditsPerDay: 200, newStoresPerDay: 3 }, userOverrides: {}, adminLimits: null, grantedCredits: 0, ...overrides };
}

function account(overrides: Partial<PlanAccountInput> = {}): PlanAccount {
	const values = input(overrides);
	return { billing: values.billing, plan: values.plan, tier: values.tier, limits: limitsFor(values), creditsResetAt: RENEWAL };
}

describe('the plan table', () => {
	it('sells the four Premium pools the pricing page shows', () => {
		expect(PREMIUM_TIERS).toEqual([
			{ tier: 1, credits: 20_000, priceCents: 9_900 },
			{ tier: 2, credits: 50_000, priceCents: 19_900 },
			{ tier: 3, credits: 100_000, priceCents: 34_900 },
			{ tier: 4, credits: 200_000, priceCents: 59_900 },
		]);
		expect(premiumTier(3).credits).toBe(100_000);
	});

	it('keeps 5 drafts per store on every plan', () => {
		expect(DRAFT_LIMIT).toBe(5);
		for (const plan of ['basic', 'premium', 'enterprise'] as const) expect(PLAN_LIMITS[plan].draftsPerStore).toBe(DRAFT_LIMIT);
	});
});

describe('limitsFor', () => {
	it('gives Basic the live daily numbers, 1 live store, no own domains and no catalog', () => {
		expect(limitsFor(input())).toEqual({ aiCredits: 200, aiCreditsWindow: 'day', newStoresPerDay: 3, liveStores: 1, ownDomainsPerLiveStore: 0, supplierCatalog: false, draftsPerStore: 5 });
		expect(limitsFor(input({ basic: { aiCreditsPerDay: 500, newStoresPerDay: 5 } }))).toMatchObject({ aiCredits: 500, newStoresPerDay: 5 });
	});

	it("gives Premium the tier's monthly pool, 25 new stores a day, 10 live stores, a domain each and the catalog", () => {
		expect(limitsFor(input({ plan: 'premium', tier: 2 }))).toEqual({ aiCredits: 50_000, aiCreditsWindow: 'period', newStoresPerDay: 25, liveStores: 10, ownDomainsPerLiveStore: 1, supplierCatalog: true, draftsPerStore: 5 });
		for (const tier of PREMIUM_TIERS) expect(limitsFor(input({ plan: 'premium', tier: tier.tier })).aiCredits).toBe(tier.credits);
	});

	it("starts Enterprise at Premium's largest numbers until an admin sets its own", () => {
		expect(limitsFor(input({ plan: 'enterprise' }))).toMatchObject({ aiCredits: 200_000, aiCreditsWindow: 'period', newStoresPerDay: 25, liveStores: 10, supplierCatalog: true });
		expect(limitsFor(input({ plan: 'enterprise', adminLimits: { aiCredits: 1_000_000, liveStores: 50 } }))).toMatchObject({ aiCredits: 1_000_000, liveStores: 50 });
	});

	it("applies the account's own KV overrides, but keeps a daily credit override off a monthly pool", () => {
		expect(limitsFor(input({ userOverrides: { newStoresPerDay: 1000, aiCreditsPerDay: 900 } }))).toMatchObject({ newStoresPerDay: 1000, aiCredits: 900 });
		expect(limitsFor(input({ plan: 'premium', tier: 1, userOverrides: { newStoresPerDay: 1000, aiCreditsPerDay: 900 } }))).toMatchObject({ newStoresPerDay: 1000, aiCredits: 20_000 });
	});

	it('lets an admin override win over the KV override, and adds grants last', () => {
		const limits = limitsFor(input({ plan: 'premium', tier: 1, userOverrides: { newStoresPerDay: 1000 }, adminLimits: { newStoresPerDay: 40, supplierCatalog: false }, grantedCredits: 5_000 }));
		expect(limits).toMatchObject({ newStoresPerDay: 40, supplierCatalog: false, aiCredits: 25_000 });
	});

	it("returns today's Basic for everyone while billing is off: no live-store, domain or catalog limit, and no grants", () => {
		expect(limitsFor(input({ billing: false, plan: 'premium', tier: 4, grantedCredits: 5_000, userOverrides: { newStoresPerDay: 1000 } }))).toEqual({
			aiCredits: 200,
			aiCreditsWindow: 'day',
			newStoresPerDay: 1000,
			liveStores: null,
			ownDomainsPerLiveStore: 1,
			supplierCatalog: true,
			draftsPerStore: 5,
		});
	});
});

describe('assertWithinLimit', () => {
	it('allows Basic below each limit and refuses at and above it, with the copy from the spec', () => {
		const basic = account();
		expect(assertWithinLimit(basic, 'aiCredits', 199)).toBeNull();
		for (const used of [200, 260]) {
			expect(assertWithinLimit(basic, 'aiCredits', used)).toEqual({
				code: 'plan_limit',
				limit: 'aiCredits',
				plan: 'basic',
				upgradeTo: 'premium',
				message: "You've used today's free AI credits. They reset at midnight UTC, or get Premium for a monthly pool.",
			});
		}
		expect(assertWithinLimit(basic, 'liveStores', 0)).toBeNull();
		expect(assertWithinLimit(basic, 'liveStores', 1)?.message).toBe('Basic includes 1 live store. Get Premium for up to 10.');
		expect(assertWithinLimit(basic, 'newStoresPerDay', 2)).toBeNull();
		expect(assertWithinLimit(basic, 'newStoresPerDay', 3)?.message).toBe("You've started 3 new stores today. Start more tomorrow, or get Premium for up to 25 a day.");
		expect(assertWithinLimit(basic, 'ownDomainsPerLiveStore', 0)?.message).toBe('Own domains come with Premium.');
		expect(assertWithinLimit(basic, 'supplierCatalog')?.message).toBe('Adding catalog products to your store comes with Premium. Products already live keep selling.');
	});

	it('tells Premium when its pool refills, and points the largest pool and other limits at Enterprise', () => {
		const premium = account({ plan: 'premium', tier: 2 });
		expect(assertWithinLimit(premium, 'aiCredits', 49_999)).toBeNull();
		expect(assertWithinLimit(premium, 'aiCredits', 50_000)).toMatchObject({ plan: 'premium', upgradeTo: 'premium', message: "You've used this month's credits. Move to a bigger pool now, or wait until November 19." });
		expect(assertWithinLimit(account({ plan: 'premium', tier: 4 }), 'aiCredits', 200_000)).toMatchObject({ upgradeTo: 'enterprise', message: "You've used this month's credits. Talk to us about a bigger pool, or wait until November 19." });
		expect(assertWithinLimit(premium, 'liveStores', 10)).toMatchObject({ upgradeTo: 'enterprise', message: 'Premium includes 10 live stores. Talk to us about Enterprise for more.' });
		expect(assertWithinLimit(premium, 'newStoresPerDay', 25)?.message).toBe("You've started 25 new stores today. Start more tomorrow, or talk to us about Enterprise.");
		expect(assertWithinLimit(premium, 'supplierCatalog')).toBeNull();
		expect(assertWithinLimit(premium, 'ownDomainsPerLiveStore', 0)).toBeNull();
	});

	it('offers Enterprise accounts no upgrade', () => {
		expect(assertWithinLimit(account({ plan: 'enterprise', adminLimits: { liveStores: 3 } }), 'liveStores', 3)).toMatchObject({ upgradeTo: null, message: 'Enterprise includes 3 live stores. Talk to us to raise it.' });
	});

	it('refuses nothing while billing is off', () => {
		const off = account({ billing: false });
		expect(assertWithinLimit(off, 'aiCredits', 10_000)).toBeNull();
		expect(assertWithinLimit(off, 'liveStores', 50)).toBeNull();
		expect(assertWithinLimit(off, 'supplierCatalog')).toBeNull();
	});

	it('recognizes a refusal that crossed the network, and nothing else', () => {
		expect(isPlanLimitRefusal(JSON.parse(JSON.stringify(assertWithinLimit(account(), 'supplierCatalog'))))).toBe(true);
		for (const value of [null, 'plan_limit', { code: 'plan_limit', limit: 'nope', plan: 'basic', upgradeTo: null, message: 'x' }]) expect(isPlanLimitRefusal(value)).toBe(false);
	});
});

describe('admin limit overrides', () => {
	it('reads only known limits within range', () => {
		expect(planLimitOverridesFrom({ aiCredits: 300_000, liveStores: 25, supplierCatalog: true })).toEqual({ aiCredits: 300_000, liveStores: 25, supplierCatalog: true });
		expect(planLimitOverridesFrom({})).toEqual({});
		for (const bad of [{ aiCredits: 0 }, { liveStores: 1.5 }, { supplierCatalog: 'yes' }, { draftsPerStore: 9 }, { ownDomainsPerLiveStore: 2 }, { toString: 1 }, 'x', null, []]) {
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

- [ ] **Step 4: Implement `shared/types/plans.ts`**

Add `export const DRAFT_LIMIT = 5;` to `shared/types/drafts.ts`, with the comment "Drafts per store, counting Main. Mirrors DRAFT_LIMIT in space/src/space/drafts-store.ts."

```ts
/** Every plan's limits, defined once: the Worker enforces them, the pricing page shows them, admins override them. Pure. */

import { DRAFT_LIMIT } from './drafts';

export const PLAN_IDS = ['basic', 'premium', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PREMIUM_TIER_NUMBERS = [1, 2, 3, 4] as const;
export type PremiumTierNumber = (typeof PREMIUM_TIER_NUMBERS)[number];

/** A Premium credit pool and its monthly price. */
export interface PremiumTier {
	tier: PremiumTierNumber;
	credits: number;
	priceCents: number;
}

/** Premium's monthly pools, smallest first. Bigger pools cost less per credit. */
export const PREMIUM_TIERS: readonly PremiumTier[] = [
	{ tier: 1, credits: 20_000, priceCents: 9_900 },
	{ tier: 2, credits: 50_000, priceCents: 19_900 },
	{ tier: 3, credits: 100_000, priceCents: 34_900 },
	{ tier: 4, credits: 200_000, priceCents: 59_900 },
];

export function isPremiumTierNumber(value: unknown): value is PremiumTierNumber {
	return (PREMIUM_TIER_NUMBERS as readonly unknown[]).includes(value);
}

export function premiumTier(tier: PremiumTierNumber): PremiumTier {
	const found = PREMIUM_TIERS.find((entry) => entry.tier === tier);
	if (!found) throw new Error(`Unknown Premium tier: ${tier}`);
	return found;
}

/** A UTC day on Basic; the billing period (or calendar month) on a monthly pool. */
export type CreditsWindow = 'day' | 'period';

export interface PlanLimits {
	/** AI credits per window, grants included. */
	aiCredits: number;
	aiCreditsWindow: CreditsWindow;
	newStoresPerDay: number;
	/** Published stores at once; null means no limit (billing off). */
	liveStores: number | null;
	ownDomainsPerLiveStore: number;
	supplierCatalog: boolean;
	draftsPerStore: number;
}

export type PlanLimitKey = 'aiCredits' | 'newStoresPerDay' | 'liveStores' | 'ownDomainsPerLiveStore' | 'supplierCatalog';

/** The custom limits an admin plan override may set. */
export interface PlanLimitOverrides {
	aiCredits?: number;
	newStoresPerDay?: number;
	liveStores?: number;
	ownDomainsPerLiveStore?: number;
	supplierCatalog?: boolean;
}

interface PlanRow {
	/** 'live' reads Basic's daily allowance from the live configuration; 'tier' reads the Premium tier's pool. */
	aiCredits: number | 'live' | 'tier';
	aiCreditsWindow: CreditsWindow;
	/** 'live' reads Basic's new stores a day from the live configuration. */
	newStoresPerDay: number | 'live';
	liveStores: number;
	ownDomainsPerLiveStore: number;
	supplierCatalog: boolean;
	draftsPerStore: number;
}

export const PLAN_LIMITS: Readonly<Record<PlanId, PlanRow>> = {
	basic: { aiCredits: 'live', aiCreditsWindow: 'day', newStoresPerDay: 'live', liveStores: 1, ownDomainsPerLiveStore: 0, supplierCatalog: false, draftsPerStore: DRAFT_LIMIT },
	premium: { aiCredits: 'tier', aiCreditsWindow: 'period', newStoresPerDay: 25, liveStores: 10, ownDomainsPerLiveStore: 1, supplierCatalog: true, draftsPerStore: DRAFT_LIMIT },
	enterprise: { aiCredits: 200_000, aiCreditsWindow: 'period', newStoresPerDay: 25, liveStores: 10, ownDomainsPerLiveStore: 1, supplierCatalog: true, draftsPerStore: DRAFT_LIMIT },
};

export const PLAN_LIMIT_CODE = 'plan_limit';
export const GRACE_PERIOD_DAYS = 7;

export interface PlanAccountInput {
	billing: boolean;
	plan: PlanId;
	tier: PremiumTierNumber | null;
	/** Basic's live numbers: code defaults plus the global KV overrides. */
	basic: { aiCreditsPerDay: number; newStoresPerDay: number };
	/** The account's own `user_config:<id>` rate-limit overrides, when set. */
	userOverrides: { aiCreditsPerDay?: number; newStoresPerDay?: number };
	adminLimits: PlanLimitOverrides | null;
	/** Credits Estori added to the current window. */
	grantedCredits: number;
}

export interface PlanAccount {
	billing: boolean;
	plan: PlanId;
	tier: PremiumTierNumber | null;
	limits: PlanLimits;
	/** When the credits window resets: the next UTC midnight on Basic, the period's end otherwise. */
	creditsResetAt: number;
}

export interface PlanLimitRefusal {
	code: typeof PLAN_LIMIT_CODE;
	limit: PlanLimitKey;
	plan: PlanId;
	/** The plan that lifts the limit; null when none does. */
	upgradeTo: 'premium' | 'enterprise' | null;
	message: string;
}
```

Then:
- **`limitsFor(input)`:**
  - Billing off: return Basic's live numbers, with the KV overrides for both credits and new stores, `liveStores: null`, `ownDomainsPerLiveStore: 1`, `supplierCatalog: true`, `draftsPerStore: DRAFT_LIMIT`. No grants.
  - Billing on, in the order of Global Constraints:
    1. resolve the row's `'live'` from `input.basic` and `'tier'` from `premiumTier(input.tier ?? 1)`;
    2. apply `userOverrides.newStoresPerDay`;
    3. apply `userOverrides.aiCreditsPerDay` only when the window is `'day'`;
    4. spread `adminLimits`;
    5. add `grantedCredits` to `aiCredits`.
- **`assertWithinLimit`:**
  - returns null when `!account.billing`;
  - `supplierCatalog` is reached when it's false;
  - `liveStores` when not null and `current >= limit`;
  - the other keys when `current >= limit`;
  - `current` defaults to 0.
- **`upgradeTo`:**
  - Basic: `'premium'`;
  - Premium credits below tier 4: `'premium'`;
  - Premium otherwise: `'enterprise'`;
  - Enterprise: null.
- **Messages,** exactly as the test pins:
  - `count(n, noun)` writes "1 live store" and "3 new stores";
  - the plan names are "Basic", "Premium", "Enterprise";
  - the Premium credit dates use `formatBillingDate(account.creditsResetAt)`.
- **`formatBillingDate`:** `new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })`.
- **`formatUsd`:** move the function body from `src/lib/plans.ts` unchanged.
- **`planLimitOverridesFrom`:**
  - accepts only a plain object whose own keys are known;
  - ranges: `aiCredits` 1 to 10,000,000, `newStoresPerDay` 1 to 10,000, `liveStores` 0 to 10,000, `ownDomainsPerLiveStore` 0 or 1, and `supplierCatalog` a boolean;
  - use `Object.hasOwn` against the ranges table, as `parseSellerLimitsOverride` does.
- **`isPlanLimitRefusal`:** checks `code`, a known `limit`, a known `plan`, a string `message` and an allowed `upgradeTo`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `rtk proxy bun run test -- shared/types/plans.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: Point the pricing code at the table.** In `src/api-types.ts`, next to the `PublicPlanLimits` re-export, add:

```ts
export type { CreditsWindow, PlanAccount, PlanId, PlanLimitKey, PlanLimitOverrides, PlanLimitRefusal, PlanLimits, PremiumTier, PremiumTierNumber } from '../shared/types/plans.js';
export { GRACE_PERIOD_DAYS, PLAN_IDS, PLAN_LIMITS, PLAN_LIMIT_CODE, PREMIUM_TIERS, PREMIUM_TIER_NUMBERS, formatBillingDate, formatUsd, isPlanLimitRefusal, isPremiumTierNumber, premiumTier } from '../shared/types/plans.js';
export { DRAFT_LIMIT } from '../shared/types/drafts.js';
```

In `src/lib/plans.ts`:
- **Types:** `PlanId`, `PremiumTier` and `PREMIUM_TIERS` re-export the shared ones. `formatUsd` re-exports the shared one. Delete the local definitions.
- **`CATALOG_PLANS`:** becomes `{ basic: PLAN_LIMITS.basic.supplierCatalog, premium: PLAN_LIMITS.premium.supplierCatalog, enterprise: PLAN_LIMITS.enterprise.supplierCatalog }`.
- **New store-builder rows,** after "Live preview on desktop and phone":

```ts
		{ label: 'Live stores at once', cells: { basic: String(PLAN_LIMITS.basic.liveStores), premium: String(PLAN_LIMITS.premium.liveStores), enterprise: 'Custom' } },
		{ label: 'Your own domain', cells: { basic: false, premium: 'One per live store', enterprise: 'One per live store' } },
```

In `PlanCards.tsx`, add two `Feature`s to `PremiumPlan`'s list, after "Everything in Basic":

```tsx
				<Feature>Up to {PLAN_LIMITS.premium.liveStores} live stores, each on your own domain</Feature>
				<Feature capability="product-catalog">Curated supplier catalog</Feature>
```

- [ ] **Step 7: Update the pricing tests.** In `src/lib/plans.test.ts`:
- change `expect(PREMIUM_TIERS[0]).toEqual({ credits: 20_000, priceCents: 9_900 })` to include `tier: 1`;
- add:

```ts
	it('takes the live-store and catalog cells from the shared limits table', () => {
		const builder = PLAN_COMPARISON.find((section) => section.capability === 'store-builder');
		expect(builder?.rows.find((row) => row.label === 'Live stores at once')?.cells).toEqual({ basic: '1', premium: '10', enterprise: 'Custom' });
		expect(PLAN_COMPARISON.find((section) => section.capability === 'product-catalog')?.rows[0]?.cells).toEqual({ basic: false, premium: true, enterprise: true });
	});
```

In `src/routes/pricing-guard.test.ts`, add:

```ts
	it("states Premium's live stores from the shared limits table, never typed in", () => {
		const cards = source(CARDS);
		expect(cards).toContain('PLAN_LIMITS.premium.liveStores');
		expect(cards).not.toMatch(/\b10 live stores\b/);
	});
```

- [ ] **Step 8: Run the tests**

Run: `rtk proxy bun run test -- shared/types/plans.test.ts src/lib/plans.test.ts src/routes/pricing-guard.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add shared/types/plans.ts shared/types/plans.test.ts shared/types/drafts.ts src/api-types.ts src/lib/plans.ts src/lib/plans.test.ts src/components/pricing/PlanCards.tsx src/routes/pricing-guard.test.ts
git commit -m "feat(billing): one table of plan limits, with the refusal and its copy, read by the pricing page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Billing tables and their services

**Files:**
- Create:
  - `shared/types/billing.ts`;
  - `worker/database/services/BillingService.ts`;
  - `worker/database/services/PlanAdminService.ts`;
  - `worker/database/services/unique-violation.ts`;
  - the generated migration `migrations/00NN_billing.sql` and its snapshot.
- Modify:
  - `worker/database/schema.ts`;
  - `worker/database/index.ts`;
  - `worker/database/services/LiveStoreService.ts` (use the extracted `isUniqueViolation`);
  - `worker/database/test-support/real-d1.ts`.
- Test: `worker/database/services/billing.sql.test.ts`.

**Interfaces:**
- **Consumes:** `PlanId`, `PremiumTierNumber`, `PlanLimitOverrides` (Task 1).
- **Produces:**
  - `shared/types/billing.ts`:
    - status lists: `SUBSCRIPTION_STATUSES` and `SubscriptionStatus`; `LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due']`; `BILLING_EVENT_RESULTS = ['applied', 'ignored', 'refused']` and `BillingEventResult`;
    - notice kinds: `BILLING_NOTICE_KINDS = ['premium_started', 'receipt', 'tier_upgraded', 'downgrade_scheduled', 'payment_failed', 'premium_ending', 'premium_ended', 'credits_80', 'credits_100', 'enforcement_notice']` and `BillingNoticeKind`;
    - paths and codes: `BILLING_PATH = '/settings/billing'`; `PREMIUM_CHECKOUT_KIND = 'estori_premium'`; `PLAN_LIMIT_ERROR_CODE = 'PLAN_LIMIT'`;
    - `renewalDisclosure(priceCents: number): string`, plus the view types Task 6 fills in.
  - Schema tables `billingCustomers`, `subscriptions`, `billingEvents`, `billingNotices`, `planOverrides`, `creditGrants`, with the types `SubscriptionRecord`, `PlanOverrideRecord` and `CreditGrantRecord`.
  - `BillingService`:
    - customers: `customerOf(userId)`, `userOfCustomer(stripeCustomerId)`, `saveCustomer(userId, stripeCustomerId, now): Promise<string>`;
    - subscriptions: `subscriptionOf(userId): Promise<SubscriptionRecord | null>`;
    - events: `eventSeen(eventId)`, `recordEvent(input: BillingEventInput): Promise<void>` (it throws when any key in the batch already exists);
    - notices: `sentNoticeKeys(userId, keys): Promise<Set<string>>`, `claimNotice(userId, key, kind, now): Promise<boolean>`;
    - repair: `subscriptionsToRepair(nowMs): Promise<SubscriptionRecord[]>`.
  - `PlanAdminService`:
    - overrides: `latestOverride(userId)`, `addOverride(input: PlanOverrideInput)`;
    - grants: `grantedCredits(userId, periodStart: Date): Promise<number>`, `grantsOf(userId, periodStart)`, `addGrant(input: CreditGrantInput)`.
  - Test helpers: `insertSubscription(db, row)`, `insertBillingCustomer(db, userId, stripeCustomerId)`.

- [ ] **Step 1: Write the failing test** `worker/database/services/billing.sql.test.ts`:

```ts
/** The billing tables on real SQL: customers kept once, events written all-or-nothing, notices claimed once, overrides audited. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertSubscription, insertUser, migratedD1 } from '../test-support/real-d1';
import { BillingService } from './BillingService';
import { PlanAdminService } from './PlanAdminService';
import type { SubscriptionRecord } from '../schema';

let db: D1Database;
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_pay', 'u_two', 'u_admin', 'u_due', 'u_fresh', 'u_ending']) await insertUser(db, id);
});

function row(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: 'u_two',
		stripeSubscriptionId: 'sub_two',
		status: 'active',
		tier: 1,
		currentPeriodStart: at('2026-10-01T00:00:00Z'),
		currentPeriodEnd: at('2026-11-01T00:00:00Z'),
		cancelAtPeriodEnd: false,
		pendingTier: null,
		pendingTierAt: null,
		stripeScheduleId: null,
		stripeCreatedAt: at('2026-10-01T00:00:00Z'),
		updatedAt: at('2026-10-01T00:00:05Z'),
		...overrides,
	};
}

describe('billing customers', () => {
	it('keeps the first Stripe customer an account gets, and finds the account from it', async () => {
		const billing = new BillingService(envWith(db));
		expect(await billing.saveCustomer('u_pay', 'cus_first', at('2026-10-19T00:00:00Z'))).toBe('cus_first');
		expect(await billing.saveCustomer('u_pay', 'cus_second', at('2026-10-19T00:01:00Z'))).toBe('cus_first');
		expect(await billing.customerOf('u_pay')).toBe('cus_first');
		expect(await billing.userOfCustomer('cus_first')).toBe('u_pay');
		expect(await billing.userOfCustomer('cus_second')).toBeNull();
	});
});

describe('billing events', () => {
	it('writes an event with its row and notices together, and refuses the same event twice', async () => {
		const billing = new BillingService(envWith(db));
		const input = {
			event: { id: 'evt_a', type: 'customer.subscription.created', objectId: 'sub_two', userId: 'u_two', result: 'applied' as const },
			row: row(),
			notices: [{ key: 'premium_started:sub_two', kind: 'premium_started' as const }],
			now: at('2026-10-01T00:00:05Z'),
		};
		await billing.recordEvent(input);
		expect(await billing.eventSeen('evt_a')).toBe(true);
		expect(await billing.subscriptionOf('u_two')).toMatchObject({ stripeSubscriptionId: 'sub_two', status: 'active', tier: 1 });
		expect(await billing.sentNoticeKeys('u_two', ['premium_started:sub_two', 'receipt:in_1'])).toEqual(new Set(['premium_started:sub_two']));
		await expect(billing.recordEvent(input)).rejects.toThrow();
	});

	it('writes nothing when a notice is already recorded, so the event can be retried', async () => {
		const billing = new BillingService(envWith(db));
		const notices = [{ key: 'premium_started:sub_two', kind: 'premium_started' as const }];
		await billing.recordEvent({ event: { id: 'evt_a2', type: 'customer.subscription.created', objectId: 'sub_two', userId: 'u_two', result: 'applied' }, row: row(), notices, now: at('2026-10-01T00:00:05Z') });
		await expect(
			billing.recordEvent({ event: { id: 'evt_b', type: 'customer.subscription.updated', objectId: 'sub_two', userId: 'u_two', result: 'applied' }, row: row({ tier: 3 }), notices, now: at('2026-10-02T00:00:00Z') }),
		).rejects.toThrow();
		expect(await billing.eventSeen('evt_b')).toBe(false);
		expect((await billing.subscriptionOf('u_two'))?.tier).toBe(1);
	});

	it('records an ignored event without writing a row', async () => {
		const billing = new BillingService(envWith(db));
		await billing.recordEvent({ event: { id: 'evt_c', type: 'invoice.paid', objectId: 'in_9', userId: null, result: 'ignored' }, row: null, notices: [], now: at('2026-10-03T00:00:00Z') });
		expect(await billing.eventSeen('evt_c')).toBe(true);
		expect(await billing.subscriptionOf('u_two')).toBeNull();
	});

	it('claims a notice once', async () => {
		const billing = new BillingService(envWith(db));
		expect(await billing.claimNotice('u_two', 'credits_80:1790812800', 'credits_80', at('2026-10-10T00:00:00Z'))).toBe(true);
		expect(await billing.claimNotice('u_two', 'credits_80:1790812800', 'credits_80', at('2026-10-11T00:00:00Z'))).toBe(false);
	});

	it('lists subscriptions to re-read: past due for over a day, or set to end and past their end', async () => {
		await insertSubscription(db, { userId: 'u_due', stripeSubscriptionId: 'sub_due', status: 'past_due', currentPeriodStart: at('2026-10-10T00:00:00Z'), currentPeriodEnd: at('2026-11-10T00:00:00Z') });
		await insertSubscription(db, { userId: 'u_fresh', stripeSubscriptionId: 'sub_fresh', status: 'past_due', currentPeriodStart: at('2026-10-11T12:00:00Z'), currentPeriodEnd: at('2026-11-11T12:00:00Z') });
		await insertSubscription(db, { userId: 'u_ending', stripeSubscriptionId: 'sub_ending', status: 'active', cancelAtPeriodEnd: true, currentPeriodStart: at('2026-09-11T00:00:00Z'), currentPeriodEnd: at('2026-10-11T00:00:00Z') });
		const due = await new BillingService(envWith(db)).subscriptionsToRepair(Date.parse('2026-10-11T18:00:00Z'));
		expect(due.map((entry) => entry.stripeSubscriptionId).sort()).toEqual(['sub_due', 'sub_ending']);
	});
});

describe('plan overrides and credit grants', () => {
	it('reads the latest override, and writes each one with an audit entry naming the admin', async () => {
		const admin = new PlanAdminService(envWith(db));
		await admin.addOverride({ userId: 'u_pay', plan: 'enterprise', tier: null, limits: { aiCredits: 500_000 }, until: null, adminUserId: 'u_admin', reason: 'Signed Enterprise contract', now: at('2026-10-19T00:00:00Z') });
		await admin.addOverride({ userId: 'u_pay', plan: null, tier: null, limits: {}, until: null, adminUserId: 'u_admin', reason: 'Contract ended', now: at('2026-10-20T00:00:00Z') });
		expect(await admin.latestOverride('u_pay')).toMatchObject({ plan: null, reason: 'Contract ended' });
		const audits = await db.prepare("SELECT user_id, entity_type, entity_id, action FROM audit_logs WHERE entity_id = 'u_pay' ORDER BY created_at").all();
		expect(audits.results).toEqual([
			{ user_id: 'u_admin', entity_type: 'billing_plan', entity_id: 'u_pay', action: 'plan_override' },
			{ user_id: 'u_admin', entity_type: 'billing_plan', entity_id: 'u_pay', action: 'plan_override' },
		]);
	});

	it('sums the grants of one period only', async () => {
		const admin = new PlanAdminService(envWith(db));
		const october = at('2026-10-01T00:00:00Z');
		await admin.addGrant({ userId: 'u_two', credits: 5_000, periodStart: october, adminUserId: 'u_admin', reason: 'Launch partner', now: at('2026-10-05T00:00:00Z') });
		await admin.addGrant({ userId: 'u_two', credits: 1_000, periodStart: october, adminUserId: 'u_admin', reason: 'Support case', now: at('2026-10-06T00:00:00Z') });
		await admin.addGrant({ userId: 'u_two', credits: 9_000, periodStart: at('2026-09-01T00:00:00Z'), adminUserId: 'u_admin', reason: 'Last month', now: at('2026-09-05T00:00:00Z') });
		expect(await admin.grantedCredits('u_two', october)).toBe(6_000);
		expect((await admin.grantsOf('u_two', october)).map((grant) => grant.credits)).toEqual([5_000, 1_000]);
		const audit = await db.prepare("SELECT action FROM audit_logs WHERE entity_id = 'u_two' AND entity_type = 'credit_grant'").all();
		expect(audit.results).toHaveLength(3);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy bun run test -- worker/database/services/billing.sql.test.ts`
Expected: FAIL, "Failed to resolve import ./BillingService".

- [ ] **Step 3: Add `shared/types/billing.ts`** with the constants and types from Interfaces. The disclosure copy is fixed by spec section 10a:

```ts
/** Shown above the pay button at checkout; the Terms say the same. */
export function renewalDisclosure(priceCents: number): string {
	return `Premium renews every month at ${formatUsd(priceCents)} until you cancel. Cancel any time in Estori; it ends at the end of the period.`;
}
```

- [ ] **Step 4: Add the tables to `worker/database/schema.ts`.** Put them after `shopperEmails`. Import the enums from `shared/types/billing` and `shared/types/plans`.

```ts
/** The Stripe customer Estori bills for Premium: one per account, on the platform account. */
export const billingCustomers = sqliteTable('billing_customers', {
    userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

/** An account's Premium subscription as Stripe last had it; one row per account, rebuilt on every billing event. */
export const subscriptions = sqliteTable('subscriptions', {
    userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
    status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull(),
    tier: integer('tier').notNull(),
    currentPeriodStart: integer('current_period_start', { mode: 'timestamp' }).notNull(),
    currentPeriodEnd: integer('current_period_end', { mode: 'timestamp' }).notNull(),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
    pendingTier: integer('pending_tier'),
    pendingTierAt: integer('pending_tier_at', { mode: 'timestamp' }),
    /** The schedule holding a pending downgrade; releasing it cancels the downgrade. */
    stripeScheduleId: text('stripe_schedule_id'),
    /** When Stripe created the subscription: a newer one replaces an ended one, never a live one. */
    stripeCreatedAt: integer('stripe_created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    statusIdx: index('subscriptions_status_idx').on(table.status),
}));

/** Each Stripe event Estori handled, recorded in the same batch as what it changed, so a retry is a no-op. */
export const billingEvents = sqliteTable('billing_events', {
    stripeEventId: text('stripe_event_id').primaryKey(),
    type: text('type').notNull(),
    objectId: text('object_id'),
    userId: text('user_id'),
    result: text('result', { enum: BILLING_EVENT_RESULTS }).notNull(),
    receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
});

/** Billing emails already sent: one row per account and notice key, such as a subscription, an invoice or a period. */
export const billingNotices = sqliteTable('billing_notices', {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    noticeKey: text('notice_key').notNull(),
    kind: text('kind', { enum: BILLING_NOTICE_KINDS }).notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.userId, table.noticeKey] }),
}));

/** Admin plan overrides, newest first wins; a row with no plan ends the override. */
export const planOverrides = sqliteTable('plan_overrides', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    plan: text('plan', { enum: PLAN_IDS }),
    tier: integer('tier'),
    /** JSON `PlanLimitOverrides`. */
    limits: text('limits').notNull().default('{}'),
    until: integer('until', { mode: 'timestamp' }),
    adminUserId: text('admin_user_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    userCreatedIdx: index('plan_overrides_user_created_idx').on(table.userId, table.createdAt),
}));

/** Credits Estori added to one credit window of an account ("Added by Estori"). */
export const creditGrants = sqliteTable('credit_grants', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    credits: integer('credits').notNull(),
    periodStart: integer('period_start', { mode: 'timestamp' }).notNull(),
    adminUserId: text('admin_user_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    userPeriodIdx: index('credit_grants_user_period_idx').on(table.userId, table.periodStart),
}));

export type SubscriptionRecord = typeof subscriptions.$inferSelect;
export type PlanOverrideRecord = typeof planOverrides.$inferSelect;
export type CreditGrantRecord = typeof creditGrants.$inferSelect;
```

- [ ] **Step 5: Generate the migration**

Run: `bun run db:generate -- --name billing`
Expected: a new `migrations/00NN_billing.sql` with six `CREATE TABLE` statements and the three indexes, plus its snapshot and journal entry. Read the SQL. It must create nothing else, and must not alter existing tables.

- [ ] **Step 6: Implement the services.**

**Unique violations:**
- Move `isUniqueViolation` from `LiveStoreService.ts` into `worker/database/services/unique-violation.ts`, exported.
- Import it back into `LiveStoreService`.

**`BillingService extends BaseService`:**
- **`saveCustomer`:** inserts with `onConflictDoNothing()`, then reads back the kept id. It throws if none was stored.
- **`sentNoticeKeys`:** returns an empty set for no keys. Otherwise it selects with `inArray`.
- **`recordEvent(input)`** builds one `this.database.batch([eventInsert, ...rest])`. Type `rest` as `BatchItem<'sqlite'>[]` from `drizzle-orm/batch`. The batch holds:
  - the `billing_events` insert;
  - when `row` is set, an upsert of `subscriptions` on `userId` that sets every other column;
  - one plain `billing_notices` insert per notice, for `row.userId`, or `event.userId` when no row is written.
  - It doesn't catch anything: a duplicate key anywhere rolls the whole batch back and throws, and the caller decides.
- **`claimNotice`:** inserts with `onConflictDoNothing().returning({ key: billingNotices.noticeKey })`. It's true when a row came back.
- **`subscriptionsToRepair(nowMs)`** selects:
  - `status = 'past_due'` with `current_period_start <= now - 1 day`;
  - or `cancel_at_period_end = 1` with `current_period_end <= now` and a status in `LIVE_SUBSCRIPTION_STATUSES`.

```ts
export interface BillingEventInput {
	event: { id: string; type: string; objectId: string | null; userId: string | null; result: BillingEventResult };
	/** The subscription row as Stripe now has it; null records the event alone. */
	row: SubscriptionRecord | null;
	notices: ReadonlyArray<{ key: string; kind: BillingNoticeKind }>;
	now: Date;
}
```

**`PlanAdminService extends BaseService`:**

```ts
export interface PlanOverrideInput {
	userId: string;
	plan: PlanId | null;
	tier: PremiumTierNumber | null;
	limits: PlanLimitOverrides;
	until: Date | null;
	adminUserId: string;
	reason: string;
	now: Date;
}

export interface CreditGrantInput {
	userId: string;
	credits: number;
	periodStart: Date;
	adminUserId: string;
	reason: string;
	now: Date;
}
```

- **`addOverride`** batches two rows:
  - the override, with `id: generateId()` and `limits: JSON.stringify(input.limits)`;
  - an `audit_logs` row with `{ id: generateId(), userId: adminUserId, entityType: 'billing_plan', entityId: input.userId, action: 'plan_override', newValues: { plan, tier, limits, until, reason }, createdAt: now }`.
- **`addGrant`** does the same with `entityType: 'credit_grant'` and `action: 'credit_grant'`.
- **`latestOverride`** orders by `createdAt` descending, with limit 1.
- **`grantedCredits`** uses ``sql<number>`coalesce(sum(${creditGrants.credits}), 0)` ``.
- **`grantsOf`** orders by `createdAt`.
- Export both services from `worker/database/index.ts`.

**Test helpers** in `real-d1.ts`:
- `insertSubscription(db, { userId, stripeSubscriptionId, status, tier?, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd? })` writes seconds, `tier ?? 1`, and `stripe_created_at = updated_at = currentPeriodStart`;
- `insertBillingCustomer(db, userId, stripeCustomerId)` writes `created_at = 0`.

- [ ] **Step 7: Run the tests**

Run: `rtk proxy bun run test -- worker/database/services/billing.sql.test.ts worker/database/services/live-stores.sql.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add shared/types/billing.ts worker/database/schema.ts worker/database/index.ts worker/database/services/BillingService.ts worker/database/services/PlanAdminService.ts worker/database/services/unique-violation.ts worker/database/services/LiveStoreService.ts worker/database/services/billing.sql.test.ts worker/database/test-support/real-d1.ts migrations/
git commit -m "feat(billing): tables for customers, subscriptions, events, notices, plan overrides and credit grants

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: The account's plan, the flag and the credit meter

**Files:**
- Create:
  - `worker/services/billing/flag.ts`;
  - `worker/services/billing/account.ts`;
  - `worker/services/billing/credits.ts`.
- Modify:
  - `worker/types/env.d.ts`;
  - `shared/types/billing.ts` (add `BillingSource`).
- Test:
  - `worker/services/billing/account.test.ts`;
  - `worker/services/billing/account.sql.test.ts`;
  - `worker/services/billing/credits.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 1: `limitsFor`, `PlanAccount`, `PlanAccountInput`, `planLimitOverridesFrom`, `GRACE_PERIOD_DAYS`, `isPremiumTierNumber`;
  - from Task 2: `BillingService.subscriptionOf`, `PlanAdminService.latestOverride`, `PlanAdminService.grantedCredits`, `SubscriptionRecord`, `PlanOverrideRecord`;
  - existing: `getGlobalConfigurableSettings`, `publicPlanFromSettings`, `RateLimitService.buildRateLimitKey`, `DORateLimitStore`.
- **Produces:**
  - `isBillingOn(env: { BILLING?: string; BILLING_USER_IDS?: string }, userId: string | null): boolean`;
  - `BillingSource = 'free' | 'subscription' | 'override'` (in `shared/types/billing.ts`);
  - from `account.ts`:
    - time helpers: `DAY_MS`, `utcDayStart(ms)`, `utcMonthBounds(ms): { startMs; endMs }`;
    - `graceEndsAt(subscription: Pick<SubscriptionRecord, 'status' | 'currentPeriodStart'>): number | null`;
    - `ResolvedPlan { plan; tier; source: BillingSource; periodStartMs; periodEndMs; graceEndsAtMs: number | null; overrideLimits: PlanLimitOverrides | null }`;
    - `resolvePlan(input: { subscription: SubscriptionRecord | null; override: PlanOverrideRecord | null; nowMs: number }): ResolvedPlan`;
    - `userLimitOverrides(stored: string | null): PlanAccountInput['userOverrides']`;
    - `BillingAccount extends PlanAccount { userId; source; periodStartMs; periodEndMs; graceEndsAtMs; grantedCredits; subscription: SubscriptionRecord | null }`;
    - `loadAccount(env: Env, userId: string, nowMs?: number): Promise<BillingAccount>`;
  - from `credits.ts`:
    - `PERIOD_BUCKET_WINDOW_SECONDS = 32 days`, `PERIOD_BUCKET_SIZE_SECONDS = 3600`;
    - `CreditBucket { key: string; window: CreditsWindow; config: DORateLimitConfig }`;
    - `creditBucketFor(account: Pick<BillingAccount, 'userId' | 'limits' | 'periodStartMs'>, llmCalls: LLMCallsRateLimitConfig): CreditBucket`;
    - `creditsUsed(env: Env, bucket: CreditBucket): Promise<number>`;
    - `recordCredits(env: Env, bucket: CreditBucket, cost: number): Promise<number>` (credits used after the step).

- [ ] **Step 1: Write the failing pure tests.** `worker/services/billing/account.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { graceEndsAt, resolvePlan, userLimitOverrides } from './account';
import { isBillingOn } from './flag';
import type { PlanOverrideRecord, SubscriptionRecord } from '../../database/schema';

const NOW = Date.parse('2026-10-19T15:00:00Z');

function sub(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: 'u1',
		stripeSubscriptionId: 'sub_1',
		status: 'active',
		tier: 2,
		currentPeriodStart: new Date('2026-10-05T10:00:00Z'),
		currentPeriodEnd: new Date('2026-11-05T10:00:00Z'),
		cancelAtPeriodEnd: false,
		pendingTier: null,
		pendingTierAt: null,
		stripeScheduleId: null,
		stripeCreatedAt: new Date('2026-09-05T10:00:00Z'),
		updatedAt: new Date('2026-10-05T10:00:00Z'),
		...overrides,
	};
}

function override(overrides: Partial<PlanOverrideRecord> = {}): PlanOverrideRecord {
	return { id: 'po_1', userId: 'u1', plan: 'enterprise', tier: null, limits: '{"aiCredits":500000}', until: null, adminUserId: 'u_admin', reason: 'Contract', createdAt: new Date('2026-10-01T00:00:00Z'), ...overrides };
}

describe('resolvePlan', () => {
	it('is Basic over the UTC day without a subscription', () => {
		expect(resolvePlan({ subscription: null, override: null, nowMs: NOW })).toEqual({
			plan: 'basic',
			tier: null,
			source: 'free',
			periodStartMs: Date.parse('2026-10-19T00:00:00Z'),
			periodEndMs: Date.parse('2026-10-20T00:00:00Z'),
			graceEndsAtMs: null,
			overrideLimits: null,
		});
	});

	it('is Premium at the tier over the billing period while active or trialing', () => {
		for (const status of ['active', 'trialing'] as const) {
			expect(resolvePlan({ subscription: sub({ status }), override: null, nowMs: NOW })).toMatchObject({
				plan: 'premium',
				tier: 2,
				source: 'subscription',
				periodStartMs: Date.parse('2026-10-05T10:00:00Z'),
				periodEndMs: Date.parse('2026-11-05T10:00:00Z'),
			});
		}
	});

	it('keeps Premium for 7 days of a failed renewal, then Basic', () => {
		const pastDue = sub({ status: 'past_due', currentPeriodStart: new Date('2026-10-12T15:00:00Z') });
		expect(graceEndsAt(pastDue)).toBe(Date.parse('2026-10-19T15:00:00Z'));
		expect(resolvePlan({ subscription: pastDue, override: null, nowMs: Date.parse('2026-10-19T14:59:59Z') })).toMatchObject({ plan: 'premium', graceEndsAtMs: Date.parse('2026-10-19T15:00:00Z') });
		expect(resolvePlan({ subscription: pastDue, override: null, nowMs: Date.parse('2026-10-19T15:00:00Z') })).toMatchObject({ plan: 'basic', source: 'free' });
		expect(graceEndsAt(sub())).toBeNull();
	});

	it('is Basic for every ended or unpaid status', () => {
		for (const status of ['unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'] as const) {
			expect(resolvePlan({ subscription: sub({ status }), override: null, nowMs: NOW }).plan).toBe('basic');
		}
	});

	it('lets an admin override win until it ends or is cleared', () => {
		expect(resolvePlan({ subscription: sub(), override: override(), nowMs: NOW })).toMatchObject({ plan: 'enterprise', source: 'override', overrideLimits: { aiCredits: 500_000 }, periodStartMs: Date.parse('2026-10-05T10:00:00Z') });
		expect(resolvePlan({ subscription: null, override: override(), nowMs: NOW })).toMatchObject({ periodStartMs: Date.parse('2026-10-01T00:00:00Z'), periodEndMs: Date.parse('2026-11-01T00:00:00Z') });
		expect(resolvePlan({ subscription: null, override: override({ plan: 'premium', tier: 3 }), nowMs: NOW })).toMatchObject({ plan: 'premium', tier: 3 });
		expect(resolvePlan({ subscription: sub(), override: override({ until: new Date(NOW - 1) }), nowMs: NOW }).source).toBe('subscription');
		expect(resolvePlan({ subscription: null, override: override({ plan: null }), nowMs: NOW }).plan).toBe('basic');
	});
});

describe("the account's own KV overrides", () => {
	it('reads new stores a day and daily credits from user_config, and nothing from an unreadable entry', () => {
		expect(userLimitOverrides(JSON.stringify({ security: { rateLimit: { appCreation: { limit: 1000, dailyLimit: 1000 }, llmCalls: { limit: 900 } } } }))).toEqual({ newStoresPerDay: 1000, aiCreditsPerDay: 900 });
		expect(userLimitOverrides(JSON.stringify({ security: { rateLimit: { appCreation: { limit: 1000, dailyLimit: 50 } } } }))).toEqual({ newStoresPerDay: 50 });
		expect(userLimitOverrides(JSON.stringify({ sellerLimits: { pinnedLevel: 'new' } }))).toEqual({});
		expect(userLimitOverrides(null)).toEqual({});
		expect(userLimitOverrides('{not json')).toEqual({});
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

`worker/services/billing/credits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS } from '../rate-limit/config';
import { PERIOD_BUCKET_WINDOW_SECONDS, creditBucketFor, creditsUsed, recordCredits } from './credits';
import type { PlanLimits } from '../../../shared/types/plans';

const LLM = DEFAULT_RATE_LIMIT_SETTINGS.llmCalls;
const OCTOBER = Date.parse('2026-10-05T10:00:00Z');

function limits(overrides: Partial<PlanLimits>): PlanLimits {
	return { aiCredits: 200, aiCreditsWindow: 'day', newStoresPerDay: 3, liveStores: 1, ownDomainsPerLiveStore: 0, supplierCatalog: false, draftsPerStore: 5, ...overrides };
}

/** A counter per key that stops counting at its limit, as DORateLimitStore does. */
function fakeCounters(): Env {
	const counts = new Map<string, number>();
	const stub = {
		increment: async (key: string, config: { limit: number }, by: number) => {
			const count = counts.get(key) ?? 0;
			if (count >= config.limit) return { success: false, remainingLimit: 0 };
			counts.set(key, count + by);
			return { success: true, remainingLimit: Math.max(0, config.limit - count - by) };
		},
		getRemainingLimit: async (key: string, config: { limit: number }) => Math.max(0, config.limit - (counts.get(key) ?? 0)),
	};
	return { DORateLimitStore: { getByName: () => stub } } as unknown as Env;
}

describe('credit buckets', () => {
	it("meters Basic in today's daily bucket, as before billing", () => {
		const bucket = creditBucketFor({ userId: 'u1', limits: limits({ aiCredits: 250 }), periodStartMs: Date.parse('2026-10-19T00:00:00Z') }, LLM);
		expect(bucket.key).toBe('platform:llmCalls:user:u1');
		expect(bucket.window).toBe('day');
		expect(bucket.config).toMatchObject({ limit: 250, calendarDaily: true, period: 86_400 });
	});

	it('gives a monthly pool one bucket per period: a renewal starts fresh, an upgrade keeps what was used', () => {
		const pool = (aiCredits: number, periodStartMs: number) => creditBucketFor({ userId: 'u1', limits: limits({ aiCredits, aiCreditsWindow: 'period' }), periodStartMs }, LLM);
		const october = pool(20_000, OCTOBER);
		const upgraded = pool(100_000, OCTOBER);
		expect(october.key).toBe(`plan:credits:user:u1:${OCTOBER / 1000}`);
		expect(october.config).toMatchObject({ limit: 20_000, period: PERIOD_BUCKET_WINDOW_SECONDS, bucketSize: 3600 });
		expect(upgraded.key).toBe(october.key);
		expect(upgraded.config.limit).toBe(100_000);
		expect(pool(20_000, Date.parse('2026-11-05T10:00:00Z')).key).not.toBe(october.key);
	});

	it('counts a step that starts under the limit in full, then counts nothing more', async () => {
		const env = fakeCounters();
		const bucket = creditBucketFor({ userId: 'u1', limits: limits({ aiCredits: 20 }), periodStartMs: 0 }, LLM);
		expect(await recordCredits(env, bucket, 8)).toBe(8);
		expect(await recordCredits(env, bucket, 8)).toBe(16);
		expect(await recordCredits(env, bucket, 8)).toBe(20);
		expect(await recordCredits(env, bucket, 8)).toBe(20);
		expect(await creditsUsed(env, bucket)).toBe(20);
	});

	it('reads nothing used, and records nothing, when the counter fails', async () => {
		const env = { DORateLimitStore: { getByName: () => { throw new Error('counter unavailable'); } } } as unknown as Env;
		const bucket = creditBucketFor({ userId: 'u1', limits: limits({}), periodStartMs: 0 }, LLM);
		expect(await creditsUsed(env, bucket)).toBe(0);
		expect(await recordCredits(env, bucket, 8)).toBe(0);
	});
});
```

- [ ] **Step 2: Write the failing real-D1 test** `worker/services/billing/account.sql.test.ts`:

```ts
/** loadAccount on real SQL with the KV entries stood in: the plan, its period, grants, and the flag. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertSubscription, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { PlanAdminService } from '../../database/services/PlanAdminService';
import { loadAccount } from './account';

const NOW = Date.parse('2026-10-19T15:00:00Z');
let db: D1Database;

/** KV with only the owner's raised new-store override. */
const kv = { get: async (key: string) => (key === 'user_config:u_sub' ? JSON.stringify({ security: { rateLimit: { appCreation: { limit: 1000 } } } }) : null) };

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'u_sub');
	await insertUser(db, 'u_admin');
	await insertSubscription(db, { userId: 'u_sub', stripeSubscriptionId: 'sub_1', status: 'active', tier: 2, currentPeriodStart: new Date('2026-10-05T10:00:00Z'), currentPeriodEnd: new Date('2026-11-05T10:00:00Z') });
	await new PlanAdminService(envWith(db)).addGrant({ userId: 'u_sub', credits: 5_000, periodStart: new Date('2026-10-05T10:00:00Z'), adminUserId: 'u_admin', reason: 'Partner', now: new Date(NOW) });
});

describe('loadAccount', () => {
	it("resolves a subscriber's pool with this period's grants and their KV override", async () => {
		const account = await loadAccount(envWith(db, { BILLING: 'on', VibecoderStore: kv }), 'u_sub', NOW);
		expect(account).toMatchObject({
			billing: true,
			plan: 'premium',
			tier: 2,
			source: 'subscription',
			grantedCredits: 5_000,
			periodStartMs: Date.parse('2026-10-05T10:00:00Z'),
			creditsResetAt: Date.parse('2026-11-05T10:00:00Z'),
			limits: { aiCredits: 55_000, aiCreditsWindow: 'period', newStoresPerDay: 1000, liveStores: 10, supplierCatalog: true },
		});
	});

	it("treats everyone as today's Basic while billing is off, without reading the billing tables", async () => {
		const account = await loadAccount(envWith(db, { VibecoderStore: kv }), 'u_sub', NOW);
		expect(account).toMatchObject({ billing: false, plan: 'basic', source: 'free', subscription: null, grantedCredits: 0, limits: { aiCredits: 200, aiCreditsWindow: 'day', newStoresPerDay: 1000, liveStores: null, supplierCatalog: true } });
	});

	it('turns billing on only for the listed accounts', async () => {
		expect((await loadAccount(envWith(db, { BILLING_USER_IDS: 'someone-else', VibecoderStore: kv }), 'u_sub', NOW)).billing).toBe(false);
		expect((await loadAccount(envWith(db, { BILLING_USER_IDS: 'someone-else, u_sub', VibecoderStore: kv }), 'u_sub', NOW)).plan).toBe('premium');
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/account.test.ts worker/services/billing/credits.test.ts worker/services/billing/account.sql.test.ts`
Expected: FAIL, "Failed to resolve import ./account" and "./credits".

- [ ] **Step 4: Declare the environment.** In `worker/types/env.d.ts`, after `STRIPE_CONNECT_WEBHOOK_SECRET`:

```ts
		// "on" turns Premium billing and plan limits on for everyone.
		BILLING?: string;
		// Comma-separated user ids that get billing while BILLING isn't "on": the owner-only phase.
		BILLING_USER_IDS?: string;
		// JSON {"1":"price_...","2":"price_...","3":"price_...","4":"price_..."}: each Premium tier's price, in the Stripe key's mode.
		STRIPE_PREMIUM_PRICE_IDS?: string;
```

- [ ] **Step 5: Implement `flag.ts`.** `BILLING` compares trimmed and lowercased to `'on'`. `BILLING_USER_IDS` splits on commas, trims and drops empty entries. A null or empty user id is never listed.

- [ ] **Step 6: Implement `account.ts`**

```ts
/** Which plan an account is on and what it may use: its subscription, the grace period, admin overrides and grants. */

export const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayStart(ms: number): number {
	return Math.floor(ms / DAY_MS) * DAY_MS;
}

export function utcMonthBounds(ms: number): { startMs: number; endMs: number } {
	const day = new Date(ms);
	return { startMs: Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1), endMs: Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1) };
}

/** A failed renewal keeps Premium until 7 days after the period it couldn't pay for began. */
export function graceEndsAt(subscription: Pick<SubscriptionRecord, 'status' | 'currentPeriodStart'>): number | null {
	return subscription.status === 'past_due' ? subscription.currentPeriodStart.getTime() + GRACE_PERIOD_DAYS * DAY_MS : null;
}

function paysForPremium(subscription: SubscriptionRecord, nowMs: number): boolean {
	if (!isPremiumTierNumber(subscription.tier)) return false;
	if (subscription.status === 'active' || subscription.status === 'trialing') return true;
	const grace = graceEndsAt(subscription);
	return grace !== null && nowMs < grace;
}

export function resolvePlan(input: { subscription: SubscriptionRecord | null; override: PlanOverrideRecord | null; nowMs: number }): ResolvedPlan {
	const { subscription, override, nowMs } = input;
	const paying = subscription && paysForPremium(subscription, nowMs) ? subscription : null;
	const graceEndsAtMs = paying ? graceEndsAt(paying) : null;
	const day = { periodStartMs: utcDayStart(nowMs), periodEndMs: utcDayStart(nowMs) + DAY_MS };
	const billingPeriod = paying ? { periodStartMs: paying.currentPeriodStart.getTime(), periodEndMs: paying.currentPeriodEnd.getTime() } : null;
	const active = override && override.plan !== null && (override.until === null || override.until.getTime() > nowMs) ? override : null;
	if (active && active.plan !== null) {
		const month = utcMonthBounds(nowMs);
		const period = active.plan === 'basic' ? day : billingPeriod ?? { periodStartMs: month.startMs, periodEndMs: month.endMs };
		const tier = active.plan !== 'premium' ? null : isPremiumTierNumber(active.tier) ? active.tier : paying && isPremiumTierNumber(paying.tier) ? paying.tier : 1;
		let stored: unknown = null;
		try {
			stored = JSON.parse(active.limits);
		} catch {
			stored = null;
		}
		return { plan: active.plan, tier, source: 'override', ...period, graceEndsAtMs, overrideLimits: planLimitOverridesFrom(stored) };
	}
	if (paying && billingPeriod && isPremiumTierNumber(paying.tier)) {
		return { plan: 'premium', tier: paying.tier, source: 'subscription', ...billingPeriod, graceEndsAtMs, overrideLimits: null };
	}
	return { plan: 'basic', tier: null, source: 'free', ...day, graceEndsAtMs: null, overrideLimits: null };
}
```

**`userLimitOverrides(stored)`:**
- Parse the JSON and read `security.rateLimit.appCreation.limit`, `security.rateLimit.appCreation.dailyLimit` and `security.rateLimit.llmCalls.limit`.
- `newStoresPerDay` is the smaller of the non-negative integers present.
- `aiCreditsPerDay` is `llmCalls.limit` when it's a non-negative integer.
- Bad JSON gives `{}`.

**`loadAccount(env, userId, nowMs = Date.now())`:**
1. **Basic's live numbers:** read `getGlobalConfigurableSettings(env)` and the account's `user_config:{userId}` KV entry together. Pass `publicPlanFromSettings(settings.security.rateLimit)` through, falling back to `DEFAULT_RATE_LIMIT_SETTINGS.llmCalls.limit` and `.appCreation.limit` when a value is null.
2. **Billing off** (`!isBillingOn(env, userId)`): return Basic over the UTC day, without touching D1. That's `subscription: null`, `grantedCredits: 0`, and `limits: limitsFor({ billing: false, ... })`.
3. **Billing on:** read `new BillingService(env).subscriptionOf(userId)` and `new PlanAdminService(env).latestOverride(userId)` together. Call `resolvePlan`, then `grantedCredits(userId, new Date(resolved.periodStartMs))`, then `limitsFor` with the resolved plan, tier, `overrideLimits` and grants.
4. **Return** `{ billing, userId, plan, tier, limits, creditsResetAt: periodEndMs, source, periodStartMs, periodEndMs, graceEndsAtMs, grantedCredits, subscription }`.

- [ ] **Step 7: Implement `credits.ts`**

```ts
/** The AI credit meter: Basic's daily bucket as before billing, or one bucket per billing period for a monthly pool. */

/** Longer than any month, so one key's window covers its whole period; a new period is a new key. */
export const PERIOD_BUCKET_WINDOW_SECONDS = 32 * 24 * 60 * 60;
/** Hourly buckets keep a month's window to 768 reads. */
export const PERIOD_BUCKET_SIZE_SECONDS = 60 * 60;

export function creditBucketFor(account: Pick<BillingAccount, 'userId' | 'limits' | 'periodStartMs'>, llmCalls: LLMCallsRateLimitConfig): CreditBucket {
	if (account.limits.aiCreditsWindow === 'day') {
		return { key: RateLimitService.buildRateLimitKey(RateLimitType.LLM_CALLS, `user:${account.userId}`), window: 'day', config: { ...llmCalls, limit: account.limits.aiCredits } };
	}
	return {
		key: `plan:credits:user:${account.userId}:${Math.floor(account.periodStartMs / 1000)}`,
		window: 'period',
		config: { enabled: true, store: RateLimitStore.DURABLE_OBJECT, limit: account.limits.aiCredits, period: PERIOD_BUCKET_WINDOW_SECONDS, bucketSize: PERIOD_BUCKET_SIZE_SECONDS },
	};
}
```

**`creditsUsed`:**
- Call `env.DORateLimitStore.getByName(bucket.key).getRemainingLimit(bucket.key, { limit, period, bucketSize, dailyLimit, calendarDaily })` and answer `max(0, limit - remaining)`.
- On any error, log it and answer 0. The counter fails open, as `RateLimitService` does.

**`recordCredits`:**
- Return 0 when `!bucket.config.enabled` or `cost <= 0`.
- Otherwise `increment(bucket.key, sameConfig, cost)`. Answer `limit - (remainingLimit ?? 0)` on success, and `limit` when the store refused.
- On error, log it and answer 0.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/account.test.ts worker/services/billing/credits.test.ts worker/services/billing/account.sql.test.ts`
Expected: PASS (14 tests).

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add worker/services/billing/flag.ts worker/services/billing/account.ts worker/services/billing/credits.ts worker/services/billing/account.test.ts worker/services/billing/account.sql.test.ts worker/services/billing/credits.test.ts worker/types/env.d.ts shared/types/billing.ts
git commit -m "feat(billing): resolve an account's plan with grace, overrides and grants, behind the billing flag, and meter credits per period

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Stripe billing calls and the price setup script

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
  - from Task 1: `PremiumTierNumber`, `isPremiumTierNumber`, `PREMIUM_TIERS`;
  - from Task 2: `renewalDisclosure`, `PREMIUM_CHECKOUT_KIND`, `SubscriptionStatus`;
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
    - `StripeInvoice { id; customer: string | null; amount_paid: number; currency: string; hosted_invoice_url: string | null; number: string | null; billing_reason: string | null; parent: { type: string; subscription_details?: { subscription: string } | null } | null }`;
    - `SubscriptionCheckoutInput { customerId; priceId; userId; tier: PremiumTierNumber; priceCents; successUrl; cancelUrl; nowMs }`;
  - `StripeCheckoutSession` gains `mode?: 'payment' | 'subscription' | 'setup'`, `subscription?: string | null` and `customer?: string | null`;
  - new `StripeClient` methods:
    - `createCustomer(input: { userId: string; email: string }): Promise<StripeCustomer>`;
    - `createSubscriptionCheckoutSession(input: SubscriptionCheckoutInput): Promise<StripeCheckoutSession>`;
    - `retrieveSubscription(subscriptionId: string): Promise<StripeSubscription>` (the schedule expanded);
    - `changeSubscriptionPrice(input: { subscription: StripeSubscription; priceId: string; idempotencyKey: string }): Promise<StripeSubscription>`;
    - `scheduleSubscriptionPrice(input: { subscription: StripeSubscription; priceId: string; idempotencyKey: string }): Promise<StripeSubscriptionSchedule>`;
    - `releaseSubscriptionSchedule(scheduleId: string): Promise<void>`;
    - `cancelAtPeriodEnd(subscriptionId: string, idempotencyKey: string): Promise<StripeSubscription>`;
    - `resumeSubscription(subscription: StripeSubscription, idempotencyKey: string): Promise<StripeSubscription>`;
    - `createBillingPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>`.
  - `prices.ts`:
    - `PremiumPriceIds = Readonly<Record<PremiumTierNumber, string>>`;
    - `premiumPriceIds(value: string | undefined): PremiumPriceIds | null`;
    - `tierOfPrice(price: Pick<StripePrice, 'id' | 'metadata'>, ids: PremiumPriceIds | null): PremiumTierNumber | null`.
  - `scripts/stripe-billing-setup.ts`:
    - `PREMIUM_PRODUCT_ID = 'estori_premium'`;
    - `premiumLookupKey(tier): string` (`estori_premium_tier_<n>`);
    - `setUpPremium(input: { secretKey: string; mode: 'test' | 'live'; fetchImpl: typeof fetch }): Promise<BillingSetupResult>`, where `BillingSetupResult { mode; productId; priceIds: Record<PremiumTierNumber, string>; portalProblems: string[] }`.

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

const SUBSCRIPTION: StripeSubscription = {
	id: 'sub_1',
	customer: 'cus_1',
	status: 'active',
	created: 1,
	cancel_at_period_end: false,
	cancel_at: null,
	metadata: { estori_user_id: 'u1' },
	items: { data: [{ id: 'si_1', price: { id: 'price_t3', metadata: { estori_tier: '3' } }, current_period_start: 100, current_period_end: 200 }] },
	schedule: null,
};

const SCHEDULE = {
	id: 'sub_sched_1',
	status: 'active',
	subscription: 'sub_1',
	current_phase: { start_date: 100, end_date: 200 },
	phases: [{ start_date: 100, end_date: 200, items: [{ price: 'price_t3', quantity: 1 }], discounts: [{ coupon: null, discount: 'di_1', promotion_code: 'promo_1' }] }],
};

describe('Premium billing calls', () => {
	it('creates one customer per account, carrying the account id', async () => {
		const { calls, client } = recordingFetch({ id: 'cus_1', email: 'ana@example.test', metadata: { estori_user_id: 'u1' } });
		await client.createCustomer({ userId: 'u1', email: 'ana@example.test' });
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/customers', method: 'POST', key: 'billing-customer-u1' });
		expect(calls[0].params).toEqual(['email=ana@example.test', 'metadata[estori_user_id]=u1']);
	});

	it('opens a card-only subscription checkout for the tier price, with codes, the terms agreement and the renewal disclosure', async () => {
		const { calls, client } = recordingFetch({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
		const nowMs = 1_800_000_000_000;
		await client.createSubscriptionCheckoutSession({ customerId: 'cus_1', priceId: 'price_t2', userId: 'u1', tier: 2, priceCents: 19_900, successUrl: 'https://estori.app/settings/billing?checkout=success', cancelUrl: 'https://estori.app/settings/billing?checkout=cancelled', nowMs });
		expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
		expect(calls[0].key).toBe(`billing-checkout-u1-2-${Math.floor(nowMs / 600_000)}`);
		expect(calls[0].params).toEqual(
			expect.arrayContaining([
				'mode=subscription',
				'customer=cus_1',
				'client_reference_id=u1',
				'line_items[0][price]=price_t2',
				'line_items[0][quantity]=1',
				'payment_method_types[0]=card',
				'allow_promotion_codes=true',
				'subscription_data[metadata][estori_user_id]=u1',
				'metadata[kind]=estori_premium',
				'metadata[estori_user_id]=u1',
				'metadata[tier]=2',
				'consent_collection[terms_of_service]=required',
				'custom_text[submit][message]=Premium renews every month at $199 until you cancel. Cancel any time in Estori; it ends at the end of the period.',
				'success_url=https://estori.app/settings/billing?checkout=success',
				'cancel_url=https://estori.app/settings/billing?checkout=cancelled',
			]),
		);
	});

	it('reads a subscription with its schedule', async () => {
		const { calls, client } = recordingFetch(SUBSCRIPTION);
		await client.retrieveSubscription('sub_1');
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscriptions/sub_1?expand%5B0%5D=schedule', method: 'GET' });
	});

	it('upgrades now, prorated and charged, and refuses rather than leave an unpaid upgrade', async () => {
		const { calls, client } = recordingFetch(SUBSCRIPTION);
		await client.changeSubscriptionPrice({ subscription: SUBSCRIPTION, priceId: 'price_t4', idempotencyKey: 'billing-tier-u1-4-1' });
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscriptions/sub_1', key: 'billing-tier-u1-4-1' });
		expect(calls[0].params).toEqual(['items[0][id]=si_1', 'items[0][price]=price_t4', 'proration_behavior=always_invoice', 'payment_behavior=error_if_incomplete', 'expand[0]=schedule']);
	});

	it('schedules a downgrade for the renewal, keeping the discount and charging no proration', async () => {
		const { calls, client } = recordingFetch(SCHEDULE);
		await client.scheduleSubscriptionPrice({ subscription: SUBSCRIPTION, priceId: 'price_t2', idempotencyKey: 'billing-tier-u1-2-1' });
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscription_schedules', key: 'billing-tier-u1-2-1-create' });
		expect(calls[0].params).toEqual(['from_subscription=sub_1']);
		expect(calls[1]).toMatchObject({ url: 'https://api.stripe.com/v1/subscription_schedules/sub_sched_1', key: 'billing-tier-u1-2-1-phases' });
		expect(calls[1].params).toEqual([
			'end_behavior=release',
			'proration_behavior=none',
			'phases[0][items][0][price]=price_t3',
			'phases[0][items][0][quantity]=1',
			'phases[0][start_date]=100',
			'phases[0][end_date]=200',
			'phases[0][discounts][0][discount]=di_1',
			'phases[1][items][0][price]=price_t2',
			'phases[1][items][0][quantity]=1',
			'phases[1][duration][interval]=month',
			'phases[1][duration][interval_count]=1',
			'phases[1][proration_behavior]=none',
			'phases[1][discounts][0][discount]=di_1',
		]);
	});

	it('reuses a schedule already on the subscription', async () => {
		const { calls, client } = recordingFetch(SCHEDULE);
		await client.scheduleSubscriptionPrice({ subscription: { ...SUBSCRIPTION, schedule: 'sub_sched_1' }, priceId: 'price_t2', idempotencyKey: 'k' });
		expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET https://api.stripe.com/v1/subscription_schedules/sub_sched_1', 'POST https://api.stripe.com/v1/subscription_schedules/sub_sched_1']);
	});

	it('cancels at the period end, and resumes by clearing whichever end is set', async () => {
		const { calls, client } = recordingFetch(SUBSCRIPTION);
		await client.cancelAtPeriodEnd('sub_1', 'billing-cancel-u1-1');
		await client.resumeSubscription({ ...SUBSCRIPTION, cancel_at_period_end: true }, 'billing-resume-u1-1');
		await client.resumeSubscription({ ...SUBSCRIPTION, cancel_at: 200 }, 'billing-resume-u1-2');
		expect(calls.map((call) => call.params)).toEqual([['cancel_at_period_end=true'], ['cancel_at_period_end=false'], ['cancel_at=']]);
	});

	it('releases a schedule, and treats one already released as done', async () => {
		const released = recordingFetch(SCHEDULE);
		await released.client.releaseSubscriptionSchedule('sub_sched_1');
		expect(released.calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscription_schedules/sub_sched_1/release', method: 'POST' });
		const gone = recordingFetch({ error: { message: 'already released', type: 'invalid_request_error' } }, 400);
		await expect(gone.client.releaseSubscriptionSchedule('sub_sched_1')).resolves.toBeUndefined();
	});

	it("opens Stripe's customer portal for the customer", async () => {
		const { calls, client } = recordingFetch({ url: 'https://billing.stripe.com/p/session/1' });
		expect(await client.createBillingPortalSession({ customerId: 'cus_1', returnUrl: 'https://estori.app/settings/billing' })).toEqual({ url: 'https://billing.stripe.com/p/session/1' });
		expect(calls[0].params).toEqual(['customer=cus_1', 'return_url=https://estori.app/settings/billing']);
	});
});
```

`worker/services/billing/prices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { premiumPriceIds, tierOfPrice } from './prices';

describe('Premium prices', () => {
	it('reads the four price ids, and nothing from an incomplete or malformed value', () => {
		expect(premiumPriceIds('{"1":"price_a","2":"price_b","3":"price_c","4":"price_d"}')).toEqual({ 1: 'price_a', 2: 'price_b', 3: 'price_c', 4: 'price_d' });
		for (const bad of [undefined, '', 'nope', '{"1":"price_a"}', '{"1":"price_a","2":"price_b","3":"price_c","4":"prod_d"}', '[]']) expect(premiumPriceIds(bad)).toBeNull();
	});

	it("finds a price's tier from the configured ids, then from its metadata", () => {
		const ids = premiumPriceIds('{"1":"price_a","2":"price_b","3":"price_c","4":"price_d"}');
		expect(tierOfPrice({ id: 'price_c', metadata: null }, ids)).toBe(3);
		expect(tierOfPrice({ id: 'price_old', metadata: { estori_tier: '2' } }, ids)).toBe(2);
		expect(tierOfPrice({ id: 'price_x', metadata: { estori_tier: '9' } }, ids)).toBeNull();
		expect(tierOfPrice({ id: 'price_x', metadata: null }, null)).toBeNull();
	});
});
```

- [ ] **Step 2: Write the failing script test** `scripts/stripe-billing-setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PREMIUM_PRODUCT_ID, premiumLookupKey, setUpPremium } from './stripe-billing-setup';

type Route = (body: URLSearchParams) => Response;

function stripe(routes: Record<string, Route>) {
	const seen: string[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		const key = `${init?.method ?? 'GET'} ${url.pathname}`;
		seen.push(`${key}${url.search}`);
		const route = routes[key];
		if (!route) throw new Error(`unexpected ${key}`);
		return route(new URLSearchParams(String(init?.body ?? '')));
	};
	return { fetchImpl, seen };
}

const PORTAL_OK = () => Response.json({ data: [{ id: 'bpc_1', features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end' }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } } }] });

describe('setUpPremium', () => {
	it('creates the product and four monthly prices, tagged with their tier, on a first run', async () => {
		let next = 0;
		const { fetchImpl, seen } = stripe({
			[`GET /v1/products/${PREMIUM_PRODUCT_ID}`]: () => Response.json({ error: { code: 'resource_missing', message: 'No such product' } }, { status: 404 }),
			'POST /v1/products': (body) => Response.json({ id: body.get('id') }),
			'GET /v1/prices': () => Response.json({ data: [] }),
			'POST /v1/prices': (body) => {
				expect(body.get('recurring[interval]')).toBe('month');
				expect(body.get('currency')).toBe('usd');
				expect(body.get('metadata[estori_tier]')).toBe(String(next + 1));
				expect(body.get('lookup_key')).toBe(premiumLookupKey((next + 1) as 1 | 2 | 3 | 4));
				return Response.json({ id: `price_${++next}` });
			},
			'GET /v1/billing_portal/configurations': PORTAL_OK,
		});
		const result = await setUpPremium({ secretKey: 'sk_test_fake', mode: 'test', fetchImpl });
		expect(result).toEqual({ mode: 'test', productId: 'estori_premium', priceIds: { 1: 'price_1', 2: 'price_2', 3: 'price_3', 4: 'price_4' }, portalProblems: [] });
		expect(seen.filter((call) => call.startsWith('POST /v1/prices'))).toHaveLength(4);
	});

	it('reuses prices that already match, and reports a portal that lets sellers switch plans', async () => {
		const existing = [1, 2, 3, 4].map((tier, index) => ({ id: `price_old_${tier}`, lookup_key: `estori_premium_tier_${tier}`, unit_amount: [9_900, 19_900, 34_900, 59_900][index], active: true }));
		const { fetchImpl, seen } = stripe({
			[`GET /v1/products/${PREMIUM_PRODUCT_ID}`]: () => Response.json({ id: PREMIUM_PRODUCT_ID }),
			'GET /v1/prices': () => Response.json({ data: existing }),
			'GET /v1/billing_portal/configurations': () => Response.json({ data: [{ id: 'bpc_1', features: { subscription_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'immediately' }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } } }] }),
		});
		const result = await setUpPremium({ secretKey: 'sk_test_fake', mode: 'test', fetchImpl });
		expect(result.priceIds).toEqual({ 1: 'price_old_1', 2: 'price_old_2', 3: 'price_old_3', 4: 'price_old_4' });
		expect(seen.some((call) => call.startsWith('POST'))).toBe(false);
		expect(result.portalProblems).toEqual(['Turn off plan switching in the customer portal.', 'Set cancellations to happen at the end of the billing period.']);
	});

	it("refuses a key whose mode isn't the one asked for", async () => {
		const { fetchImpl } = stripe({});
		await expect(setUpPremium({ secretKey: 'sk_live_fake', mode: 'test', fetchImpl })).rejects.toThrow('The key is a live key, but --mode test was asked for.');
		await expect(setUpPremium({ secretKey: 'rk_test_fake', mode: 'live', fetchImpl })).rejects.toThrow('The key is a test key, but --mode live was asked for.');
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/payments/stripe-billing-client.test.ts worker/services/billing/prices.test.ts scripts/stripe-billing-setup.test.ts`
Expected: FAIL, "client.createCustomer is not a function" and failed imports.

- [ ] **Step 4: Add the client methods** to `createStripeClient`. Add the types from Interfaces first, and export `IDEMPOTENCY_BUCKET_MS`.

```ts
		// One customer per account; a double click within Stripe's 24-hour key window gets the same one.
		createCustomer: ({ userId, email }) =>
			request<StripeCustomer>('POST', '/customers', { email: email || undefined, metadata: { estori_user_id: userId } }, `billing-customer-${userId}`),
		// Card only: renewals and Smart Retries charge the card on file, and bank methods would settle days later.
		createSubscriptionCheckoutSession: (input) =>
			request<StripeCheckoutSession>(
				'POST',
				'/checkout/sessions',
				{
					mode: 'subscription',
					customer: input.customerId,
					client_reference_id: input.userId,
					line_items: [{ price: input.priceId, quantity: 1 }],
					payment_method_types: ['card'],
					allow_promotion_codes: true,
					subscription_data: { metadata: { estori_user_id: input.userId } },
					metadata: { kind: PREMIUM_CHECKOUT_KIND, estori_user_id: input.userId, tier: String(input.tier) },
					consent_collection: { terms_of_service: 'required' },
					custom_text: { submit: { message: renewalDisclosure(input.priceCents) } },
					success_url: input.successUrl,
					cancel_url: input.cancelUrl,
					expires_at: Math.floor(input.nowMs / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
				},
				`billing-checkout-${input.userId}-${input.tier}-${Math.floor(input.nowMs / IDEMPOTENCY_BUCKET_MS)}`,
			),
		retrieveSubscription: (subscriptionId) =>
			request<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}?${encodeForm({ expand: ['schedule'] })}`),
```

**`changeSubscriptionPrice`:**
- POSTs `/subscriptions/{id}` with `items: [{ id: firstItem.id, price: priceId }]`, `proration_behavior: 'always_invoice'`, `payment_behavior: 'error_if_incomplete'` and `expand: ['schedule']`, under the given key.
- It throws `Error('Subscription {id} has no items')` when there's no item.

**`scheduleSubscriptionPrice`:**
1. Use the attached schedule (a string id, or the expanded object's id) through `GET /subscription_schedules/{id}`. Without one, `POST /subscription_schedules { from_subscription }` with key `${idempotencyKey}-create`.
2. Then `POST /subscription_schedules/{id}` with key `${idempotencyKey}-phases`. The body:
   - `end_behavior: 'release'` and `proration_behavior: 'none'`;
   - phase 0 is the current price, quantity 1, from `current_phase.start_date` to `current_phase.end_date`;
   - phase 1 is the new price, quantity 1, for `duration: { interval: 'month', interval_count: 1 }`, with `proration_behavior: 'none'`;
   - both carry the current phase's `discounts`, mapped to `{ discount }` when a discount id is present, otherwise `{ coupon }`, and left out when there are none.
3. Find the current phase as the phase whose `start_date` equals `current_phase.start_date`. Keep the key order in the test.

**The rest:**
- **`releaseSubscriptionSchedule`:** POSTs `/subscription_schedules/{id}/release`. A `StripeApiError` with status 400 means already released or canceled, which counts as done; that's the same pattern as `expireCheckoutSession`.
- **`cancelAtPeriodEnd`:** POSTs `{ cancel_at_period_end: true }`.
- **`resumeSubscription`:** sends `{ cancel_at: '' }` when `cancel_at !== null && !cancel_at_period_end`, otherwise `{ cancel_at_period_end: false }`. An empty string unsets the field at Stripe.
- **`createBillingPortalSession`:** POSTs `/billing_portal/sessions { customer, return_url }`.

- [ ] **Step 5: Implement `prices.ts`.**
- **`premiumPriceIds`:**
  - parse the JSON object;
  - require keys "1" to "4", each a string starting with `price_`;
  - answer `null` otherwise.
- **`tierOfPrice`:**
  - look the id up in `ids` first;
  - then try `metadata.estori_tier` parsed as an integer, passing it through `isPremiumTierNumber`;
  - else null.

- [ ] **Step 6: Implement `scripts/stripe-billing-setup.ts`**

```ts
/**
 * Creates Estori Premium in Stripe: the product and its four monthly prices, each tagged with its tier, and checks the
 * customer portal. Rerunning reuses what exists. Prints the STRIPE_PREMIUM_PRICE_IDS value for the environment.
 * Usage: STRIPE_SECRET_KEY=sk_test_... bun scripts/stripe-billing-setup.ts --mode test
 */
```

**The mode check** comes first. The key's mode is test for `sk_test_` and `rk_test_` prefixes, live otherwise. A mismatch throws `The key is a {test|live} key, but --mode {mode} was asked for.`

**Requests** use `fetchImpl` with `Authorization: Bearer`, `Stripe-Version: STRIPE_API_VERSION` and `encodeForm` bodies, imported from `worker/services/payments/stripe-client.ts`.

**The product:**
1. `GET /v1/products/estori_premium`.
2. On 404, `POST /v1/products` with `{ id: 'estori_premium', name: 'Estori Premium', metadata: { estori_product: 'premium' } }`.

**The prices:**
1. `GET /v1/prices?lookup_keys[0..3]=...&active=true`.
2. For each tier, keep an active price with that lookup key and the same `unit_amount`.
3. Otherwise `POST /v1/prices` with:
   - `product: 'estori_premium'`, `currency: 'usd'`, `unit_amount: tier.priceCents`;
   - `recurring: { interval: 'month' }`, `nickname: '{credits} credits'`;
   - `lookup_key: premiumLookupKey(tier)` and `transfer_lookup_key: true`;
   - `metadata: { estori_tier: String(tier) }`.

**The portal:**
- Read `GET /v1/billing_portal/configurations?is_default=true`.
- These problems are reported, in this order, with the exact strings the test pins:
  - "Turn off plan switching in the customer portal." when `subscription_update.enabled`;
  - "Set cancellations to happen at the end of the billing period." when cancel is enabled but `mode !== 'at_period_end'`;
  - "Turn on cancelling in the customer portal." when cancel is off;
  - "Turn on card updates in the customer portal." when `payment_method_update` is off;
  - "Turn on invoice history in the customer portal." when `invoice_history` is off;
  - "Create the customer portal's default configuration in the Stripe Dashboard." when there's none.

**`main()`:**
- reads `--mode` and `STRIPE_SECRET_KEY`;
- prints the mode, the product id, `STRIPE_PREMIUM_PRICE_IDS=<json>` and each portal problem;
- exits 1 on an error;
- also prints "Also set a Terms of Service URL under Settings, Public details: Checkout requires it for the terms agreement.";
- runs only when `import.meta.main`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/payments/stripe-billing-client.test.ts worker/services/billing/prices.test.ts scripts/stripe-billing-setup.test.ts worker/services/payments/stripe-client.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add worker/services/payments/stripe-client.ts worker/services/payments/stripe-billing-client.test.ts worker/services/billing/prices.ts worker/services/billing/prices.test.ts scripts/stripe-billing-setup.ts scripts/stripe-billing-setup.test.ts
git commit -m "feat(billing): stripe calls for customers, subscription checkout, tier changes, cancelling and the portal, and the price setup script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Billing emails from Estori

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
  - from Task 1: `formatBillingDate`, `formatUsd`, `premiumTier`, `PLAN_LIMITS`, `PremiumTierNumber`;
  - from Task 2: `BILLING_PATH`, `BillingNoticeKind`;
  - existing: `renderEmail`, `createEmailSender`, `configuredBaseUrl`, `UserService.findUser`, `LEGAL_ENTITY`, `legalAddressLine`, `LEGAL_CONTACT`.
- **Produces:**
  - from `billing-templates.ts`, each answering an `OutgoingEmail`:
    - `premiumStartedEmail(to, { tier, renewsAt, billingLink })`;
    - `premiumReceiptEmail(to, { amountCents, currency, periodStart, periodEnd, invoiceNumber, invoiceUrl })`;
    - `tierUpgradedEmail(to, { tier, billingLink })`;
    - `downgradeScheduledEmail(to, { tier, at, billingLink })`;
    - `paymentFailedEmail(to, { graceEndsAt, billingLink })`;
    - `premiumEndingEmail(to, { endsAt, billingLink })`;
    - `premiumEndedEmail(to, { reason: 'cancelled' | 'payment-failed', pricingLink })`;
    - `creditsNoticeEmail(to, { percent: 80 | 100, credits, renewsAt, billingLink })`;
    - `enforcementNoticeEmail(to, { startsOn, aiCreditsPerDay, liveStores, sellsCatalog, pricingLink })`.
    - Links are `string | null`. Times are ms.
  - from `notices.ts`:
    - `BillingEmail`, a union discriminated by `kind`, one member per `BillingNoticeKind`, with the fields the matching template takes minus the links;
    - `PlannedNotice { key: string; email: BillingEmail }`;
    - `BillingMailDeps { sender: EmailSender | null; userEmail(userId: string): Promise<string | null>; baseUrl: string | null }`;
    - `billingEmail(to: string, email: BillingEmail, baseUrl: string | null): OutgoingEmail`;
    - `sendBillingEmails(deps: BillingMailDeps, userId: string, notices: readonly PlannedNotice[]): Promise<number>` (never throws; answers how many were sent);
    - `claimAndSendNotice(deps: BillingMailDeps & { claim(userId: string, key: string, kind: BillingNoticeKind): Promise<boolean> }, userId: string, notice: PlannedNotice): Promise<'sent' | 'already-sent' | 'not-sent'>` (never throws);
    - `creditNoticeDue(used: number, limit: number): 'credits_80' | 'credits_100' | null`;
    - `creditNoticeKey(kind: 'credits_80' | 'credits_100', periodStartMs: number): string` (`credits_80:<period start seconds>`);
    - `billingMailFromEnv(env: Env): BillingMailDeps`.

- [ ] **Step 1: Write the failing template test** `worker/services/email/billing-templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../../../src/routes/copy-rules';
import {
	creditsNoticeEmail,
	downgradeScheduledEmail,
	enforcementNoticeEmail,
	paymentFailedEmail,
	premiumEndedEmail,
	premiumEndingEmail,
	premiumReceiptEmail,
	premiumStartedEmail,
	tierUpgradedEmail,
} from './billing-templates';

const TO = 'ana@example.test';
const BILLING = 'https://estori.app/settings/billing';
const NOV_5 = Date.UTC(2026, 10, 5, 10);

const ALL = [
	premiumStartedEmail(TO, { tier: 2, renewsAt: NOV_5, billingLink: BILLING }),
	premiumReceiptEmail(TO, { amountCents: 17_000, currency: 'usd', periodStart: Date.UTC(2026, 9, 5), periodEnd: NOV_5, invoiceNumber: 'EST-0002', invoiceUrl: 'https://invoice.stripe.com/i/in_1' }),
	tierUpgradedEmail(TO, { tier: 3, billingLink: BILLING }),
	downgradeScheduledEmail(TO, { tier: 1, at: NOV_5, billingLink: BILLING }),
	paymentFailedEmail(TO, { graceEndsAt: NOV_5, billingLink: BILLING }),
	premiumEndingEmail(TO, { endsAt: NOV_5, billingLink: BILLING }),
	premiumEndedEmail(TO, { reason: 'payment-failed', pricingLink: 'https://estori.app/pricing' }),
	creditsNoticeEmail(TO, { percent: 80, credits: 50_000, renewsAt: NOV_5, billingLink: BILLING }),
	creditsNoticeEmail(TO, { percent: 100, credits: 50_000, renewsAt: NOV_5, billingLink: BILLING }),
	enforcementNoticeEmail(TO, { startsOn: Date.UTC(2026, 10, 1), aiCreditsPerDay: 200, liveStores: 2, sellsCatalog: true, pricingLink: 'https://estori.app/pricing' }),
];

describe('billing emails', () => {
	it('welcomes Premium with its pool, renewal date and price', () => {
		const [started] = ALL;
		expect(started.subject).toBe('Welcome to Estori Premium');
		expect(started.text).toContain('Your account now has 50,000 AI credits a month, up to 10 live stores, your own domains and the supplier catalog.');
		expect(started.text).toContain('Premium renews on November 5 at $199 a month until you cancel.');
		expect(started.text).toContain(`Manage billing: ${BILLING}`);
	});

	it('sends a receipt with the amount, the period, the invoice and the seller of record', () => {
		const receipt = ALL[1];
		expect(receipt.subject).toBe('Your Estori Premium receipt: $170.00');
		expect(receipt.text).toContain('We received $170.00 for Estori Premium, October 5 to November 5.');
		expect(receipt.text).toContain('View invoice: https://invoice.stripe.com/i/in_1');
		expect(receipt.text).toContain('Invoice number: EST-0002');
		expect(receipt.text).toContain('Sold by Globalink Commerce Technologies LLC');
	});

	it('explains each change in plain words', () => {
		expect(ALL[2]).toMatchObject({ subject: 'Your Premium pool is bigger now' });
		expect(ALL[2].text).toContain('You now have 100,000 AI credits a month. We charged the difference for the rest of this month; your receipt follows.');
		expect(ALL[3]).toMatchObject({ subject: 'Your Premium pool changes at renewal' });
		expect(ALL[3].text).toContain('On November 5 your pool moves to 20,000 AI credits a month at $99. Until then you keep your current pool.');
		expect(ALL[4]).toMatchObject({ subject: "Your Premium payment didn't go through" });
		expect(ALL[4].text).toContain("We couldn't charge your card for Estori Premium. Premium continues until November 5 while we retry. Update your card to keep it.");
		expect(ALL[4].text).toContain(`Update your card: ${BILLING}`);
		expect(ALL[5]).toMatchObject({ subject: 'Premium ends on November 5' });
		expect(ALL[5].text).toContain('You cancelled Premium. It stays on until November 5, then your account moves to Basic. Your stores stay live.');
		expect(ALL[6]).toMatchObject({ subject: 'Your account is on Basic now' });
		expect(ALL[6].text).toContain("We couldn't collect the payment for Premium, so it has ended. Your live stores and their domains keep working.");
	});

	it('warns at 80% and 100% of the monthly pool', () => {
		expect(ALL[7]).toMatchObject({ subject: "You've used 80% of this month's AI credits" });
		expect(ALL[7].text).toContain("You've used 80% of your 50,000 AI credits. They refill on November 5. Move to a bigger pool any time.");
		expect(ALL[8]).toMatchObject({ subject: "You've used this month's AI credits" });
		expect(ALL[8].text).toContain("You've used all 50,000 AI credits for this month. Move to a bigger pool now, or wait until November 5. A change already running always finishes.");
	});

	it('gives every seller a week of notice, and tells those over the new limits that their stores stay live', () => {
		const notice = ALL[9];
		expect(notice.subject).toBe('Plans and limits on Estori from November 1');
		expect(notice.text).toContain('From November 1, Basic includes 200 AI credits a day, 1 live store and no supplier catalog.');
		expect(notice.text).toContain('Your stores stay live; to publish more, get Premium.');
		const under = enforcementNoticeEmail(TO, { startsOn: Date.UTC(2026, 10, 1), aiCreditsPerDay: 200, liveStores: 1, sellsCatalog: false, pricingLink: null });
		expect(under.text).not.toContain('to publish more');
		expect(under.text).toContain('Your stores stay live.');
	});

	it('names no supplier and no AI assistant', () => {
		for (const email of ALL) {
			const words = `${email.subject} ${email.text}`.toLowerCase();
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(words, name).not.toContain(name);
		}
	});
});
```

- [ ] **Step 2: Write the failing notices test** `worker/services/billing/notices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEmailSender } from '../email/sender';
import type { OutgoingEmail } from '../email/types';
import { claimAndSendNotice, creditNoticeDue, creditNoticeKey, sendBillingEmails, type BillingMailDeps, type PlannedNotice } from './notices';

const STARTED: PlannedNotice = { key: 'premium_started:sub_1', email: { kind: 'premium_started', tier: 1, renewsAt: Date.UTC(2026, 10, 5) } };
const ENDING: PlannedNotice = { key: 'premium_ending:sub_1:1793872800', email: { kind: 'premium_ending', endsAt: Date.UTC(2026, 10, 5) } };

function mail(overrides: Partial<BillingMailDeps> = {}): { deps: BillingMailDeps; sent: OutgoingEmail[] } {
	const sent: OutgoingEmail[] = [];
	return { sent, deps: { sender: { send: async (email) => void sent.push(email) }, userEmail: async () => 'ana@example.test', baseUrl: 'https://estori.app', ...overrides } };
}

describe('sending billing emails', () => {
	it("sends each planned notice to the account's email", async () => {
		const { deps, sent } = mail();
		expect(await sendBillingEmails(deps, 'u1', [STARTED, ENDING])).toBe(2);
		expect(sent.map((email) => [email.to, email.subject])).toEqual([
			['ana@example.test', 'Welcome to Estori Premium'],
			['ana@example.test', 'Premium ends on November 5'],
		]);
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
		expect(delivered).toEqual([{ to: 'team@pluriza.com', subject: '[Staging] Welcome to Estori Premium' }]);
	});

	it('claims a notice before sending it, so it goes once', async () => {
		const claimed = new Set<string>();
		const { deps, sent } = mail();
		const claiming = { ...deps, claim: async (userId: string, key: string) => !claimed.has(`${userId}:${key}`) && Boolean(claimed.add(`${userId}:${key}`)) };
		expect(await claimAndSendNotice(claiming, 'u1', ENDING)).toBe('sent');
		expect(await claimAndSendNotice(claiming, 'u1', ENDING)).toBe('already-sent');
		expect(sent).toHaveLength(1);
	});
});

describe('credit warnings', () => {
	it('are due at 80% and at 100% of the pool', () => {
		expect(creditNoticeDue(15_999, 20_000)).toBeNull();
		expect(creditNoticeDue(16_000, 20_000)).toBe('credits_80');
		expect(creditNoticeDue(19_999, 20_000)).toBe('credits_80');
		expect(creditNoticeDue(20_000, 20_000)).toBe('credits_100');
		expect(creditNoticeDue(0, 0)).toBeNull();
		expect(creditNoticeKey('credits_80', Date.UTC(2026, 9, 5, 10))).toBe(`credits_80:${Date.UTC(2026, 9, 5, 10) / 1000}`);
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/email/billing-templates.test.ts worker/services/billing/notices.test.ts`
Expected: FAIL, failed imports.

- [ ] **Step 4: Implement `billing-templates.ts`.** First export `renderEmail` and `EmailContent` from `templates.ts`, unchanged. Then each template calls `renderEmail`. Use:
- `formatBillingDate` for dates;
- `formatUsd` for the monthly price;
- `new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() })` for receipt amounts.

When a link is null, leave the action out. The copy:

| Function | Subject | Body | Action | Details, footer |
| --- | --- | --- | --- | --- |
| `premiumStartedEmail` | Welcome to Estori Premium | "Your account now has {credits} AI credits a month, up to {PLAN_LIMITS.premium.liveStores} live stores, your own domains and the supplier catalog. Premium renews on {date} at {price} a month until you cancel." | Manage billing | footer "Cancel any time in Estori; Premium then runs to the end of the month you paid for." |
| `premiumReceiptEmail` | Your Estori Premium receipt: {amount} | "We received {amount} for Estori Premium, {start} to {end}." | View invoice (`invoiceUrl`) | details Amount, Period, Invoice number (when known); footer "Sold by {LEGAL_ENTITY.name}, {legalAddressLine()}. For help, email {LEGAL_CONTACT.support}." |
| `tierUpgradedEmail` | Your Premium pool is bigger now | "You now have {credits} AI credits a month. We charged the difference for the rest of this month; your receipt follows." | Manage billing | footer "Your stores stay live whatever plan you're on." |
| `downgradeScheduledEmail` | Your Premium pool changes at renewal | "On {date} your pool moves to {credits} AI credits a month at {price}. Until then you keep your current pool." | Manage billing | same footer |
| `paymentFailedEmail` | Your Premium payment didn't go through | "We couldn't charge your card for Estori Premium. Premium continues until {date} while we retry. Update your card to keep it." | Update your card | same footer |
| `premiumEndingEmail` | Premium ends on {date} | "You cancelled Premium. It stays on until {date}, then your account moves to Basic. Your stores stay live." | Keep Premium | footer "Changed your mind? Keep Premium from your billing page before {date}." |
| `premiumEndedEmail` | Your account is on Basic now | cancelled: "Premium has ended. Your live stores and their domains keep working." payment-failed: "We couldn't collect the payment for Premium, so it has ended. Your live stores and their domains keep working." Both continue: " To publish more stores or add catalog products, get Premium again." | See Premium (`pricingLink`) | same footer |
| `creditsNoticeEmail` 80 | You've used 80% of this month's AI credits | "You've used 80% of your {credits} AI credits. They refill on {date}. Move to a bigger pool any time." | See your pools | footer "We send this once a month." |
| `creditsNoticeEmail` 100 | You've used this month's AI credits | "You've used all {credits} AI credits for this month. Move to a bigger pool now, or wait until {date}. A change already running always finishes." | See your pools | same footer |
| `enforcementNoticeEmail` | Plans and limits on Estori from {date} | "From {date}, Basic includes {aiCreditsPerDay} AI credits a day, {PLAN_LIMITS.basic.liveStores} live store and no supplier catalog. Premium adds a monthly pool of AI credits, up to {premium live stores} live stores, your own domains and the catalog." Then " Your stores stay live; to publish more, get Premium." when `liveStores > PLAN_LIMITS.basic.liveStores` or `sellsCatalog`, else " Your stores stay live." | See plans (`pricingLink`) | footer "Building on Estori stays free." |

Credits use `credits.toLocaleString('en-US')`. Tier credits and prices come from `premiumTier(tier)`.

- [ ] **Step 5: Implement `notices.ts`**
- **`billingEmail`:** switches on `email.kind` and calls the matching template, with:
  - `billingLink`: the base url plus `BILLING_PATH`, or null without a base url;
  - `pricingLink`: the base url plus `/pricing`, or null without one.
- **`sendBillingEmails`:**
  - returns 0 without a sender;
  - looks the address up once;
  - sends each notice, catching and logging each failure (an allowlist block included) so the rest still go;
  - answers the count sent.
- **`claimAndSendNotice`:**
  - calls `deps.claim(userId, notice.key, notice.email.kind)` first;
  - answers `'already-sent'` when the claim fails;
  - otherwise sends through `sendBillingEmails` and answers `'sent'` or `'not-sent'`;
  - catches and logs everything else.
- **`creditNoticeDue`:**
  - null when `limit <= 0`;
  - `credits_100` when `used >= limit`;
  - `credits_80` when `used >= 0.8 * limit`.
- **`billingMailFromEnv`:**
  - `sender: createEmailSender(env)`;
  - `userEmail: async (id) => (await new UserService(env).findUser({ id }))?.email ?? null`;
  - `baseUrl: configuredBaseUrl(env)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/email/billing-templates.test.ts worker/services/billing/notices.test.ts worker/services/email/templates.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/services/email/templates.ts worker/services/email/billing-templates.ts worker/services/email/billing-templates.test.ts worker/services/billing/notices.ts worker/services/billing/notices.test.ts
git commit -m "feat(billing): estori's own emails for every subscription event and the credit warnings, sent once each

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The billing API

**Files:**
- Create:
  - `worker/services/billing/actions.ts`;
  - `worker/services/billing/view.ts`;
  - `worker/api/controllers/billing/controller.ts`;
  - `worker/api/routes/billingRoutes.ts`.
- Modify:
  - `shared/types/billing.ts` (the view and request types);
  - `worker/api/routes/index.ts`;
  - `src/api-types.ts`;
  - `src/lib/api-client.ts`;
  - `src/lib/query-keys.ts`.
- Test:
  - `worker/services/billing/actions.test.ts`;
  - `worker/api/controllers/billing/controller.sql.test.ts`;
  - `worker/api/controllers/billing/billing-routes-wiring.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 3: `loadAccount`, `creditBucketFor`, `creditsUsed`, `isBillingOn`, `BillingAccount`;
  - from Task 4: the new Stripe methods, `premiumPriceIds`, `IDEMPOTENCY_BUCKET_MS`, `StripeApiError`;
  - from Task 2: `BillingService`, `LIVE_SUBSCRIPTION_STATUSES`, `BILLING_PATH`;
  - existing: `appBaseUrl`, `stripeFromEnv`, `STRIPE_REQUEST_FAILED_MESSAGE`.
- **Produces:**
  - `shared/types/billing.ts`:
    - `BillingCreditsView { used: number; limit: number; granted: number; window: CreditsWindow; resetsAt: number }`;
    - `BillingView { enabled: boolean; plan: PlanId; tier: PremiumTierNumber | null; source: BillingSource; status: SubscriptionStatus | null; periodStart: number; periodEnd: number; cancelAtPeriodEnd: boolean; pendingTier: PremiumTierNumber | null; pendingTierAt: number | null; graceEndsAt: number | null; paymentFailing: boolean; credits: BillingCreditsView; limits: PlanLimits; canManageBilling: boolean }`;
    - `CheckoutStarted { url: string; sessionId: string }`, `BillingRedirect { url: string }`, `BillingChangeRequested { requested: true }`, `PremiumTierRequest { tier: PremiumTierNumber }`;
    - `BILLING_NOT_OPEN_MESSAGE = "Premium isn't open for your account yet."`;
  - `view.ts`: `billingView(account: BillingAccount, creditsUsed: number, hasCustomer: boolean): BillingView`;
  - `actions.ts`:
    - `BillingActionResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409 | 502 | 503; message: string }`;
    - `BillingActionDeps`, `BILLING_MESSAGES`;
    - `startCheckout(deps, user: { id: string; email: string }, tier: unknown)`;
    - `changeTier(deps, userId, tier: unknown)`, `cancelPremium(deps, userId)`, `resumePremium(deps, userId)`, `openPortal(deps, userId)`;
    - `billingActionDepsFromEnv(env: Env, request: Request): BillingActionDeps`;
  - routes (all `AuthConfig.authenticated`, acting only on `context.user`):
    - `GET /api/billing`;
    - `POST /api/billing/checkout`, `POST /api/billing/change-tier` (both `{ tier }`);
    - `POST /api/billing/cancel`, `POST /api/billing/resume`, `POST /api/billing/portal`;
  - `apiClient`: `getBilling()`, `startPremiumCheckout(tier)`, `changePremiumTier(tier)`, `cancelPremium()`, `resumePremium()`, `openBillingPortal()`;
  - `queryKeys.billing()`.

- [ ] **Step 1: Write the failing actions test** `worker/services/billing/actions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { StripeApiError, type StripeCheckoutSession, type StripeSubscription } from '../payments/stripe-client';
import { BILLING_MESSAGES, cancelPremium, changeTier, openPortal, resumePremium, startCheckout, type BillingActionDeps } from './actions';
import type { SubscriptionRecord } from '../../database/schema';

const USER = { id: 'u1', email: 'ana@example.test' };

function row(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: 'u1',
		stripeSubscriptionId: 'sub_1',
		status: 'active',
		tier: 2,
		currentPeriodStart: new Date('2026-10-05T10:00:00Z'),
		currentPeriodEnd: new Date('2026-11-05T10:00:00Z'),
		cancelAtPeriodEnd: false,
		pendingTier: null,
		pendingTierAt: null,
		stripeScheduleId: null,
		stripeCreatedAt: new Date('2026-10-05T10:00:00Z'),
		updatedAt: new Date('2026-10-05T10:00:00Z'),
		...overrides,
	};
}

const SUBSCRIPTION: StripeSubscription = {
	id: 'sub_1',
	customer: 'cus_1',
	status: 'active',
	created: 1,
	cancel_at_period_end: true,
	cancel_at: null,
	metadata: { estori_user_id: 'u1' },
	items: { data: [{ id: 'si_1', price: { id: 'price_t2' }, current_period_start: 1, current_period_end: 2 }] },
	schedule: null,
};

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
			retrieveSubscription: async (id) => {
				calls.push(`read:${id}`);
				return SUBSCRIPTION;
			},
			changeSubscriptionPrice: async ({ priceId }) => {
				if (state.failWith) throw state.failWith;
				calls.push(`upgrade:${priceId}`);
				return SUBSCRIPTION;
			},
			scheduleSubscriptionPrice: async ({ priceId }) => {
				calls.push(`schedule:${priceId}`);
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
		priceIds: { 1: 'price_t1', 2: 'price_t2', 3: 'price_t3', 4: 'price_t4' },
		baseUrl: 'https://estori.app',
		nowMs: Date.parse('2026-10-19T15:00:00Z'),
	};
	return { deps, calls };
}

describe('starting Premium', () => {
	it('makes the Stripe customer on the first checkout and reuses it after', async () => {
		const { deps, calls } = fake();
		expect(await startCheckout(deps, USER, 2)).toEqual({ ok: true, value: { url: 'https://checkout.stripe.com/c/cs_1', sessionId: 'cs_1' } });
		expect(await startCheckout(deps, USER, 3)).toMatchObject({ ok: true });
		expect(calls).toEqual(['customer:u1', 'saved:cus_new', 'checkout:cus_new:price_t2', 'checkout:cus_new:price_t3']);
	});

	it('refuses a second subscription, an unknown pool and a deployment without prices', async () => {
		for (const status of ['active', 'trialing', 'past_due'] as const) {
			expect(await startCheckout(fake({ row: row({ status }) }).deps, USER, 1)).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.alreadyPremium });
		}
		expect(await startCheckout(fake({ row: row({ status: 'canceled' }) }).deps, USER, 1)).toMatchObject({ ok: true });
		for (const tier of [0, 5, '2', null, 2.5]) expect(await startCheckout(fake().deps, USER, tier)).toMatchObject({ ok: false, status: 400 });
		expect(await startCheckout({ ...fake().deps, priceIds: null }, USER, 1)).toEqual({ ok: false, status: 503, message: BILLING_MESSAGES.notSetUp });
	});
});

describe('changing the pool', () => {
	it('upgrades now and downgrades at renewal', async () => {
		const up = fake({ row: row({ tier: 2 }) });
		expect(await changeTier(up.deps, 'u1', 4)).toEqual({ ok: true, value: { requested: true } });
		expect(up.calls).toEqual(['read:sub_1', 'upgrade:price_t4']);
		const down = fake({ row: row({ tier: 2 }) });
		expect(await changeTier(down.deps, 'u1', 1)).toMatchObject({ ok: true });
		expect(down.calls).toEqual(['read:sub_1', 'schedule:price_t1']);
	});

	it('refuses the same pool, a failing payment, an ending plan, no Premium, a second pending change and a declined card', async () => {
		expect(await changeTier(fake({ row: row() }).deps, 'u1', 2)).toEqual({ ok: false, status: 400, message: BILLING_MESSAGES.samePool });
		expect(await changeTier(fake({ row: row({ status: 'past_due' }) }).deps, 'u1', 3)).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.paymentFailing });
		expect(await changeTier(fake({ row: row({ cancelAtPeriodEnd: true }) }).deps, 'u1', 3)).toEqual({ ok: false, status: 409, message: 'Premium ends on November 5. Keep Premium first.' });
		expect(await changeTier(fake().deps, 'u1', 3)).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noPremium });
		const pending = row({ tier: 3, pendingTier: 1, pendingTierAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' });
		expect(await changeTier(fake({ row: pending }).deps, 'u1', 4)).toEqual({ ok: false, status: 409, message: 'You have a change scheduled for November 5. Keep your current pool first.' });
		const declined = fake({ row: row(), failWith: new StripeApiError('Your card was declined.', 402, 'card_declined', 'card_error') });
		expect(await changeTier(declined.deps, 'u1', 4)).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.declined });
	});

	it('cancels a pending downgrade when the seller picks their current pool again', async () => {
		const { deps, calls } = fake({ row: row({ tier: 3, pendingTier: 1, pendingTierAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' }) });
		expect(await changeTier(deps, 'u1', 3)).toMatchObject({ ok: true });
		expect(calls).toEqual(['release:sub_sched_1']);
	});
});

describe('cancelling, keeping Premium and managing billing', () => {
	it('drops a pending downgrade before cancelling at the period end, and refuses a second cancel', async () => {
		const { deps, calls } = fake({ row: row({ pendingTier: 1, pendingTierAt: new Date('2026-11-05T10:00:00Z'), stripeScheduleId: 'sub_sched_1' }) });
		expect(await cancelPremium(deps, 'u1')).toMatchObject({ ok: true });
		expect(calls).toEqual(['release:sub_sched_1', 'cancel:sub_1']);
		expect(await cancelPremium(fake({ row: row({ cancelAtPeriodEnd: true }) }).deps, 'u1')).toEqual({ ok: false, status: 409, message: 'Premium already ends on November 5.' });
	});

	it('keeps Premium only when it was set to end', async () => {
		expect(await resumePremium(fake({ row: row() }).deps, 'u1')).toEqual({ ok: false, status: 409, message: BILLING_MESSAGES.notEnding });
		const ending = fake({ row: row({ cancelAtPeriodEnd: true }) });
		expect(await resumePremium(ending.deps, 'u1')).toMatchObject({ ok: true });
		expect(ending.calls).toEqual(['read:sub_1', 'resume:sub_1']);
	});

	it("opens Stripe's portal once the account has billing details", async () => {
		expect(await openPortal(fake().deps, 'u1')).toEqual({ ok: false, status: 404, message: BILLING_MESSAGES.noCustomer });
		expect(await openPortal(fake({ customer: 'cus_1' }).deps, 'u1')).toEqual({ ok: true, value: { url: 'https://billing.stripe.com/p/1' } });
	});
});
```

- [ ] **Step 2: Write the failing controller test** `worker/api/controllers/billing/controller.sql.test.ts`:

```ts
/** The billing endpoints on real SQL, with Stripe stood in by fetch and the credit counter by a fake. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { DEFAULT_RATE_LIMIT_SETTINGS } from '../../../services/rate-limit/config';
import { BillingController } from './controller';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
const PRICES = JSON.stringify({ 1: 'price_t1', 2: 'price_t2', 3: 'price_t3', 4: 'price_t4' });

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_basic', 'u_paying', 'u_off']) await insertUser(db, id);
	await insertSubscription(db, { userId: 'u_paying', stripeSubscriptionId: 'sub_paying', status: 'active', tier: 2, currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000) });
});

afterEach(() => vi.restoreAllMocks());

function env(extra: Record<string, unknown> = {}): Env {
	const counter = { getRemainingLimit: async (_key: string, config: { limit: number }) => config.limit, increment: async () => ({ success: true }) };
	return envWith(db, {
		BILLING: 'on',
		STRIPE_SECRET_KEY: 'sk_test_fake',
		STRIPE_PREMIUM_PRICE_IDS: PRICES,
		CUSTOM_DOMAIN: 'estori.app',
		VibecoderStore: { get: async () => null },
		DORateLimitStore: { getByName: () => counter },
		...extra,
	});
}

function context(userId: string): RouteContext {
	return { user: { id: userId, email: `${userId}@example.test` }, sessionId: 's1', config: { security: { rateLimit: DEFAULT_RATE_LIMIT_SETTINGS } }, pathParams: {}, queryParams: new URLSearchParams() } as unknown as RouteContext;
}

function post(path: string, body: unknown = {}): Request {
	return new Request(`https://estori.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('the billing endpoints', () => {
	it("shows a Basic account today's credits, with billing on", async () => {
		const response = await BillingController.get(new Request('https://estori.app/api/billing'), env(), {} as ExecutionContext, context('u_basic'));
		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ enabled: true, plan: 'basic', tier: null, source: 'free', status: null, paymentFailing: false, credits: { used: 0, limit: 200, granted: 0, window: 'day' }, limits: { liveStores: 1, supplierCatalog: false }, canManageBilling: false });
	});

	it('starts a checkout, keeping the Stripe customer it made', async () => {
		const stripe = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const path = new URL(String(input)).pathname;
			if (path === '/v1/customers') return Response.json({ id: 'cus_basic', email: null, metadata: null });
			if (path === '/v1/checkout/sessions') return Response.json({ id: 'cs_9', url: 'https://checkout.stripe.com/c/cs_9' });
			throw new Error(`unexpected ${path}`);
		});
		const response = await BillingController.checkout(post('/api/billing/checkout', { tier: 2 }), env(), {} as ExecutionContext, context('u_basic'));
		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ url: 'https://checkout.stripe.com/c/cs_9', sessionId: 'cs_9' });
		expect(stripe).toHaveBeenCalledTimes(2);
		expect(await db.prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = 'u_basic'").first()).toEqual({ stripe_customer_id: 'cus_basic' });
	});

	it('answers 409 to a second checkout, and 403 when billing is off for the account', async () => {
		const paying = await BillingController.checkout(post('/api/billing/checkout', { tier: 1 }), env(), {} as ExecutionContext, context('u_paying'));
		expect(paying.status).toBe(409);
		const off = await BillingController.checkout(post('/api/billing/checkout', { tier: 1 }), env({ BILLING: undefined, BILLING_USER_IDS: 'someone-else' }), {} as ExecutionContext, context('u_off'));
		expect(off.status).toBe(403);
		expect((await off.json()).error.message).toBe("Premium isn't open for your account yet.");
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
		for (const path of ["'/api/billing'", "'/api/billing/checkout'", "'/api/billing/change-tier'", "'/api/billing/cancel'", "'/api/billing/resume'", "'/api/billing/portal'"]) {
			const start = routes.indexOf(path);
			expect(start, path).toBeGreaterThan(-1);
			expect(routes.slice(start, start + 160), path).toContain('setAuthLevel(AuthConfig.authenticated)');
		}
		expect(routes).not.toContain(':userId');
		expect(source('/worker/api/routes/index.ts')).toContain('setupBillingRoutes(app);');
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/actions.test.ts worker/api/controllers/billing/controller.sql.test.ts worker/api/controllers/billing/billing-routes-wiring.test.ts`
Expected: FAIL, failed imports.

- [ ] **Step 4: Implement `actions.ts`**

```ts
export const BILLING_MESSAGES = {
	notSetUp: "Premium isn't set up on this deployment yet.",
	pickTier: 'Pick one of the four credit pools.',
	alreadyPremium: 'You already have Premium. Change your pool on the billing page.',
	noPremium: "You don't have Premium.",
	paymentFailing: "Your last payment didn't go through. Update your card in Manage billing first.",
	samePool: "You're already on this pool.",
	declined: 'Your card was declined. Update it in Manage billing, then try again.',
	notEnding: "Premium isn't set to end.",
	noCustomer: "You don't have billing details yet.",
} as const;

export interface BillingActionDeps {
	stripe: Pick<StripeClient, 'createCustomer' | 'createSubscriptionCheckoutSession' | 'retrieveSubscription' | 'changeSubscriptionPrice' | 'scheduleSubscriptionPrice' | 'releaseSubscriptionSchedule' | 'cancelAtPeriodEnd' | 'resumeSubscription' | 'createBillingPortalSession'> | null;
	store: Pick<BillingService, 'customerOf' | 'saveCustomer' | 'subscriptionOf'>;
	priceIds: PremiumPriceIds | null;
	/** Estori's own address, for Stripe's return links. */
	baseUrl: string;
	nowMs: number;
}
```

**Common rules:**
- Answer 503 `notSetUp` when `stripe` or `priceIds` is null.
- A "live" row is one whose status is in `LIVE_SUBSCRIPTION_STATUSES`.
- Idempotency keys are `billing-{action}-{userId}-{tier or nothing}-{Math.floor(nowMs / IDEMPOTENCY_BUCKET_MS)}`.
- A `StripeApiError` whose `type` is `card_error` or whose status is 402 answers 409 `declined`. Any other `StripeApiError` answers 502 `STRIPE_REQUEST_FAILED_MESSAGE`. Other errors are rethrown.
- Dates use `formatBillingDate`.

**`startCheckout`:**
1. Check the tier with `isPremiumTierNumber`.
2. Answer 409 when the row is live.
3. Take the customer from `customerOf`, or else `createCustomer`, then `saveCustomer`.
4. Create the session for `priceIds[tier]`, at `premiumTier(tier).priceCents`. The URLs are `${baseUrl}${BILLING_PATH}?checkout=success` and `?checkout=cancelled`.
5. Answer `{ url, sessionId }`. A session without a url answers 502.

**`changeTier`,** in this order:
1. a bad tier answers 400;
2. no live row answers 404 `noPremium`;
3. `past_due` answers 409 `paymentFailing`;
4. cancelling answers 409 "Premium ends on {date}. Keep Premium first.";
5. a pending tier: the same tier as now releases `stripeScheduleId` and answers ok; any other tier answers 409 "You have a change scheduled for {date}. Keep your current pool first.";
6. the same tier answers 400 `samePool`;
7. otherwise retrieve the subscription. A higher tier calls `changeSubscriptionPrice`; a lower one calls `scheduleSubscriptionPrice`.

**`cancelPremium`:**
- no live row answers 404;
- already cancelling answers 409 "Premium already ends on {date}.";
- otherwise release `stripeScheduleId` when set, then `cancelAtPeriodEnd`.

**`resumePremium`:**
- no live row answers 404;
- not cancelling answers 409 `notEnding`;
- otherwise retrieve the subscription, then `resumeSubscription`.

**`openPortal`:**
- no customer answers 404 `noCustomer`;
- otherwise `createBillingPortalSession` with the return url `${baseUrl}${BILLING_PATH}`.

**`billingActionDepsFromEnv(env, request)`:** `{ stripe: stripeFromEnv(env), store: new BillingService(env), priceIds: premiumPriceIds(env.STRIPE_PREMIUM_PRICE_IDS), baseUrl: appBaseUrl(env, request), nowMs: Date.now() }`.

- [ ] **Step 5: Implement `view.ts`**

```ts
/** What the billing page shows: the account's plan, Stripe's status of its subscription, and this window's credits. */
export function billingView(account: BillingAccount, creditsUsed: number, hasCustomer: boolean): BillingView {
	const subscription = account.subscription;
	const pendingTier = subscription && isPremiumTierNumber(subscription.pendingTier) ? subscription.pendingTier : null;
	return {
		enabled: account.billing,
		plan: account.plan,
		tier: account.tier,
		source: account.source,
		status: subscription?.status ?? null,
		periodStart: account.periodStartMs,
		periodEnd: account.periodEndMs,
		cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
		pendingTier,
		pendingTierAt: pendingTier !== null ? subscription?.pendingTierAt?.getTime() ?? null : null,
		graceEndsAt: account.graceEndsAtMs,
		paymentFailing: subscription?.status === 'past_due' || subscription?.status === 'unpaid',
		credits: { used: creditsUsed, limit: account.limits.aiCredits, granted: account.grantedCredits, window: account.limits.aiCreditsWindow, resetsAt: account.creditsResetAt },
		limits: account.limits,
		canManageBilling: hasCustomer,
	};
}
```

- [ ] **Step 6: Implement the controller and the routes.** `BillingController extends BaseController`:
- **`get`:**
  1. `loadAccount(env, user.id)`;
  2. `creditsUsed(env, creditBucketFor(account, context.config.security.rateLimit.llmCalls))`;
  3. `new BillingService(env).customerOf(user.id)`;
  4. answer `billingView(...)`. It works with the flag off too, answering `enabled: false`.
- **Every `POST`:**
  - answers 401 without `context.user`;
  - answers 403 `BILLING_NOT_OPEN_MESSAGE` when `!isBillingOn(env, user.id)`;
  - reads `{ tier }` with `parseJsonBody` where it applies;
  - calls the action with `billingActionDepsFromEnv(env, request)`;
  - maps the result: ok is `createSuccessResponse(value)`, otherwise `createErrorResponse(message, status)`.
- **`setupBillingRoutes(app)`** registers the six routes with `setAuthLevel(AuthConfig.authenticated)`. Call it from `setupRoutes` in `worker/api/routes/index.ts`, just before `setupLimitsRoutes(app)`.

- [ ] **Step 7: The frontend client.**
- Re-export the new billing types and `BILLING_PATH` from `src/api-types.ts`.
- Add `billing: () => ['billing'] as const` to `queryKeys`.
- Add to `ApiClient`, following `getLimitsUsage`'s pattern:

```ts
	async getBilling(): Promise<ApiResponse<BillingView>> {
		return this.request<BillingView>('/api/billing');
	}

	async startPremiumCheckout(tier: PremiumTierNumber): Promise<ApiResponse<CheckoutStarted>> {
		return this.request<CheckoutStarted>('/api/billing/checkout', { method: 'POST', body: { tier } });
	}
```

  `changePremiumTier(tier)` POSTs `/api/billing/change-tier` with `{ tier }`. `cancelPremium()`, `resumePremium()` and `openBillingPortal()` POST their paths with no body.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/actions.test.ts worker/api/controllers/billing/controller.sql.test.ts worker/api/controllers/billing/billing-routes-wiring.test.ts`
Expected: PASS (12 tests).

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add shared/types/billing.ts worker/services/billing/actions.ts worker/services/billing/actions.test.ts worker/services/billing/view.ts worker/api/controllers/billing worker/api/routes/billingRoutes.ts worker/api/routes/index.ts src/api-types.ts src/lib/api-client.ts src/lib/query-keys.ts
git commit -m "feat(billing): the billing api to start premium, change the pool, cancel, keep it and manage the card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Subscription events in the webhook, and the daily repair

**Files:**
- Create:
  - `worker/services/billing/subscription-sync.ts`;
  - `worker/services/billing/events.ts`;
  - `worker/services/billing/repair.ts`;
  - `worker/services/billing/wiring.ts`.
- Modify:
  - `worker/api/controllers/payments/webhook.ts`;
  - `worker/services/payments/fulfill.ts` (no logic change; `StripeCheckoutSession` now carries `mode`);
  - `worker/services/alerts/platform-alerts.ts`;
  - `worker/index.ts`.
- Test:
  - `worker/services/billing/subscription-sync.test.ts`;
  - `worker/api/controllers/payments/webhook-billing.sql.test.ts`;
  - `worker/services/billing/repair.sql.test.ts`;
  - `worker/services/billing/wiring.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 2: `BillingService.eventSeen`, `userOfCustomer`, `subscriptionOf`, `sentNoticeKeys`, `recordEvent`, `subscriptionsToRepair`;
  - from Task 3: `graceEndsAt`, `DAY_MS`;
  - from Task 4: `retrieveSubscription`, `StripeSubscription`, `StripeInvoice`, `StripeSubscriptionSchedule`, `tierOfPrice`, `premiumPriceIds`;
  - from Task 5: `PlannedNotice`, `sendBillingEmails`, `billingMailFromEnv`;
  - existing: `platformAlertsFromEnv`, `CATALOG_HEALTH_CRON`, `isCheckoutSession`.
- **Produces:**
  - `subscription-sync.ts` (pure):
    - `recordFromSubscription(subscription, userId, tierOf: (price: Pick<StripePrice, 'id' | 'metadata'>) => PremiumTierNumber | null, nowMs): SubscriptionRecord | null`;
    - `decideRow(stored: SubscriptionRecord | null, incoming: SubscriptionRecord): 'write' | 'ignore' | 'duplicate'`;
    - `noticesFor(input: { previous: SubscriptionRecord | null; next: SubscriptionRecord; eventType: string; invoice: StripeInvoice | null }): PlannedNotice[]`;
    - `subscriptionIdOfInvoice(invoice: StripeInvoice): string | null`.
  - `events.ts`:
    - `BILLING_EVENT_TYPES` (the six from the spec plus the four schedule events);
    - `isBillingEvent(event: StripeEvent): boolean`;
    - `BillingTarget { subscriptionId: string; expectedUserId: string | null; invoice: StripeInvoice | null }`;
    - `billingTarget(event: StripeEvent): BillingTarget | null`;
    - `BillingEventDeps { stripe: Pick<StripeClient, 'retrieveSubscription'>; store: Pick<BillingService, 'eventSeen' | 'userOfCustomer' | 'subscriptionOf' | 'sentNoticeKeys' | 'recordEvent'>; tierOf; notify(userId: string, notices: readonly PlannedNotice[]): Promise<void>; alert(alert: PlatformAlert): Promise<void>; nowMs(): number }`;
    - `BillingEventOutcome = 'applied' | 'duplicate' | 'ignored' | 'refused'`;
    - `handleBillingEvent(deps, event): Promise<BillingEventOutcome>`;
    - `applySubscription(deps, input: { eventId: string; eventType: string } & BillingTarget): Promise<BillingEventOutcome>`.
  - `repair.ts`: `runBillingRepair(deps: BillingEventDeps & { store: BillingEventDeps['store'] & Pick<BillingService, 'subscriptionsToRepair'> }, nowMs: number): Promise<{ checked: number; failed: number }>`.
  - `wiring.ts`:
    - `billingEventDepsFromEnv(env: Env): BillingEventDeps & { store: BillingService }` (throws "Stripe is not configured" without a key);
    - `runBillingSchedule(cron: string, env: Env): Promise<void>`.
  - Alert kinds `billing-mismatch`, `billing-unknown-price` and `billing-duplicate-subscription`.

- [ ] **Step 1: Write the failing pure test** `worker/services/billing/subscription-sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decideRow, noticesFor, recordFromSubscription, subscriptionIdOfInvoice } from './subscription-sync';
import { tierOfPrice } from './prices';
import type { StripeInvoice, StripePrice, StripeSubscription, StripeSubscriptionSchedule } from '../payments/stripe-client';
import type { SubscriptionRecord } from '../../database/schema';

const IDS = { 1: 'price_t1', 2: 'price_t2', 3: 'price_t3', 4: 'price_t4' } as const;
const tierOf = (price: Pick<StripePrice, 'id' | 'metadata'>) => tierOfPrice(price, IDS);
const NOW = Date.parse('2026-10-19T15:00:00Z');
const START = Date.parse('2026-10-05T10:00:00Z') / 1000;
const END = Date.parse('2026-11-05T10:00:00Z') / 1000;

function subscription(overrides: Partial<StripeSubscription> = {}): StripeSubscription {
	return {
		id: 'sub_1',
		customer: 'cus_1',
		status: 'active',
		created: START,
		cancel_at_period_end: false,
		cancel_at: null,
		metadata: { estori_user_id: 'u1' },
		schedule: null,
		items: { data: [{ id: 'si_1', price: { id: 'price_t3' }, current_period_start: START, current_period_end: END }] },
		...overrides,
	};
}

function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	const base = recordFromSubscription(subscription(), 'u1', tierOf, NOW);
	if (!base) throw new Error('expected a record');
	return { ...base, ...overrides };
}

function invoice(overrides: Partial<StripeInvoice> = {}): StripeInvoice {
	return { id: 'in_1', customer: 'cus_1', amount_paid: 34_900, currency: 'usd', hosted_invoice_url: 'https://invoice.stripe.com/i/in_1', number: 'EST-1', billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } }, ...overrides };
}

describe('recordFromSubscription', () => {
	it("reads the tier, the period from the item, and the cancel state from Stripe's subscription", () => {
		expect(recordFromSubscription(subscription(), 'u1', tierOf, NOW)).toEqual({
			userId: 'u1',
			stripeSubscriptionId: 'sub_1',
			status: 'active',
			tier: 3,
			currentPeriodStart: new Date(START * 1000),
			currentPeriodEnd: new Date(END * 1000),
			cancelAtPeriodEnd: false,
			pendingTier: null,
			pendingTierAt: null,
			stripeScheduleId: null,
			stripeCreatedAt: new Date(START * 1000),
			updatedAt: new Date(NOW),
		});
	});

	it('counts a cancel date at the period end, or the cancel flag, as cancelling', () => {
		expect(recordFromSubscription(subscription({ cancel_at: END }), 'u1', tierOf, NOW)?.cancelAtPeriodEnd).toBe(true);
		expect(recordFromSubscription(subscription({ cancel_at_period_end: true }), 'u1', tierOf, NOW)?.cancelAtPeriodEnd).toBe(true);
	});

	it("reads a pending downgrade from the active schedule's next phase", () => {
		const schedule: StripeSubscriptionSchedule = {
			id: 'sub_sched_1',
			status: 'active',
			subscription: 'sub_1',
			current_phase: { start_date: START, end_date: END },
			phases: [
				{ start_date: START, end_date: END, items: [{ price: 'price_t3' }] },
				{ start_date: END, end_date: null, items: [{ price: 'price_t1' }] },
			],
		};
		expect(recordFromSubscription(subscription({ schedule }), 'u1', tierOf, NOW)).toMatchObject({ pendingTier: 1, pendingTierAt: new Date(END * 1000), stripeScheduleId: 'sub_sched_1' });
		expect(recordFromSubscription(subscription({ schedule: { ...schedule, status: 'released' } }), 'u1', tierOf, NOW)).toMatchObject({ pendingTier: null, stripeScheduleId: null });
	});

	it("answers null for a price that isn't one of Premium's", () => {
		const other = subscription({ items: { data: [{ id: 'si_1', price: { id: 'price_other' }, current_period_start: START, current_period_end: END }] } });
		expect(recordFromSubscription(other, 'u1', tierOf, NOW)).toBeNull();
	});
});

describe('decideRow', () => {
	it('writes the first subscription and any change to the same one', () => {
		expect(decideRow(null, record())).toBe('write');
		expect(decideRow(record(), record({ tier: 1, status: 'canceled' }))).toBe('write');
	});

	it("refuses a second live subscription and ignores an ended one's late event", () => {
		expect(decideRow(record(), record({ stripeSubscriptionId: 'sub_2', stripeCreatedAt: new Date(NOW) }))).toBe('duplicate');
		expect(decideRow(record({ stripeSubscriptionId: 'sub_new' }), record({ stripeSubscriptionId: 'sub_old', status: 'canceled' }))).toBe('ignore');
	});

	it('lets a newer subscription replace an ended one, and never an older one', () => {
		const ended = record({ status: 'canceled' });
		expect(decideRow(ended, record({ stripeSubscriptionId: 'sub_2', stripeCreatedAt: new Date(NOW) }))).toBe('write');
		expect(decideRow(ended, record({ stripeSubscriptionId: 'sub_0', status: 'incomplete_expired', stripeCreatedAt: new Date(0) }))).toBe('ignore');
	});
});

describe('noticesFor', () => {
	const kinds = (notices: ReturnType<typeof noticesFor>) => notices.map((notice) => notice.key);

	it('welcomes an active subscription, keyed once per subscription', () => {
		expect(kinds(noticesFor({ previous: null, next: record(), eventType: 'customer.subscription.created', invoice: null }))).toEqual(['premium_started:sub_1']);
		expect(kinds(noticesFor({ previous: null, next: record({ status: 'incomplete' }), eventType: 'customer.subscription.created', invoice: null }))).toEqual([]);
	});

	it('tells of an upgrade, a scheduled downgrade and a cancel', () => {
		expect(kinds(noticesFor({ previous: record({ tier: 1 }), next: record({ tier: 3 }), eventType: 'customer.subscription.updated', invoice: null }))).toEqual(['premium_started:sub_1', `tier_upgraded:sub_1:3:${START}`]);
		expect(kinds(noticesFor({ previous: record(), next: record({ pendingTier: 1, pendingTierAt: new Date(END * 1000) }), eventType: 'subscription_schedule.updated', invoice: null }))).toContain(`downgrade_scheduled:sub_1:1:${END}`);
		expect(kinds(noticesFor({ previous: record(), next: record({ cancelAtPeriodEnd: true }), eventType: 'customer.subscription.updated', invoice: null }))).toContain(`premium_ending:sub_1:${END}`);
	});

	it('sends a receipt for a paid invoice with money in it, and one payment-failed notice per invoice', () => {
		expect(kinds(noticesFor({ previous: record(), next: record(), eventType: 'invoice.paid', invoice: invoice() }))).toContain('receipt:in_1');
		expect(kinds(noticesFor({ previous: record(), next: record(), eventType: 'invoice.paid', invoice: invoice({ amount_paid: 0 }) }))).not.toContain('receipt:in_1');
		const failed = noticesFor({ previous: record(), next: record({ status: 'past_due' }), eventType: 'invoice.payment_failed', invoice: invoice({ id: 'in_2', amount_paid: 0 }) });
		expect(failed).toEqual([{ key: 'payment_failed:in_2', email: { kind: 'payment_failed', graceEndsAt: (START + 7 * 86_400) * 1000 } }]);
	});

	it('says whether Premium ended by cancelling or by an unpaid renewal', () => {
		expect(noticesFor({ previous: record({ status: 'past_due' }), next: record({ status: 'canceled' }), eventType: 'customer.subscription.deleted', invoice: null })).toEqual([{ key: 'premium_ended:sub_1', email: { kind: 'premium_ended', reason: 'payment-failed' } }]);
		expect(noticesFor({ previous: record({ cancelAtPeriodEnd: true }), next: record({ status: 'canceled', cancelAtPeriodEnd: true }), eventType: 'customer.subscription.deleted', invoice: null })[0]?.email).toEqual({ kind: 'premium_ended', reason: 'cancelled' });
	});
});

describe('subscriptionIdOfInvoice', () => {
	it("reads the subscription from the invoice's parent", () => {
		expect(subscriptionIdOfInvoice(invoice())).toBe('sub_1');
		expect(subscriptionIdOfInvoice(invoice({ parent: null }))).toBeNull();
		expect(subscriptionIdOfInvoice(invoice({ parent: { type: 'quote_details', subscription_details: null } }))).toBeNull();
	});
});
```

- [ ] **Step 2: Write the failing webhook test** `worker/api/controllers/payments/webhook-billing.sql.test.ts`:

```ts
/**
 * Billing events through the real webhook on real SQL. Payloads are signed. Stripe is stood in by a fetch that answers
 * each subscription as Stripe now has it, and emails are captured from the Email Service binding.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStripeWebhook } from './webhook';
import { envWith, insertBillingCustomer, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { loadAccount } from '../../../services/billing/account';
import { formatBillingDate } from '../../../../shared/types/plans';

const SECRET = 'whsec_billing_test';
const PRICES = { 1: 'price_t1', 2: 'price_t2', 3: 'price_t3', 4: 'price_t4' } as const;
const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const START = NOW - 14 * DAY;
const END = NOW + 16 * DAY;

let db: D1Database;
/** Stripe's current state of each subscription; tests change it between events. */
const stripeState = new Map<string, Record<string, unknown>>();
const emails: Array<{ to: string; subject: string; text: string }> = [];
let stripeDown = false;

function subscription(id: string, userId: string, overrides: Record<string, unknown> = {}, tier: 1 | 2 | 3 | 4 = 1): Record<string, unknown> {
	return {
		id,
		customer: `cus_${userId}`,
		status: 'active',
		created: START,
		cancel_at_period_end: false,
		cancel_at: null,
		metadata: { estori_user_id: userId },
		schedule: null,
		items: { data: [{ id: `si_${id}`, price: { id: PRICES[tier], metadata: { estori_tier: String(tier) } }, current_period_start: START, current_period_end: END }] },
		...overrides,
	};
}

function testEnv(): Env {
	return envWith(db, {
		STRIPE_WEBHOOK_SECRET: SECRET,
		STRIPE_SECRET_KEY: 'sk_test_fake',
		STRIPE_PREMIUM_PRICE_IDS: JSON.stringify(PRICES),
		BILLING: 'on',
		ENVIRONMENT: 'prod',
		CUSTOM_DOMAIN: 'estori.app',
		EMAIL: {
			send: async (message: { to: string; subject: string; text: string }) => {
				emails.push({ to: message.to, subject: message.subject, text: message.text });
				return { messageId: 'm1' };
			},
		},
		VibecoderStore: { get: async () => null, put: async () => undefined },
	});
}

async function signed(payload: string): Promise<string> {
	const timestamp = Math.floor(Date.now() / 1000);
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
	return `t=${timestamp},v1=${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function deliver(id: string, type: string, object: Record<string, unknown>): Promise<number> {
	const payload = JSON.stringify({ id, type, data: { object } });
	const request = new Request('https://estori.test/api/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': await signed(payload) }, body: payload });
	return (await handleStripeWebhook(request, testEnv())).status;
}

function subjectsTo(userId: string): string[] {
	return emails.filter((email) => email.to === `${userId}@example.test`).map((email) => email.subject);
}

async function rowOf(userId: string) {
	return db.prepare('SELECT stripe_subscription_id, status, tier, cancel_at_period_end, pending_tier FROM subscriptions WHERE user_id = ?').bind(userId).first();
}

async function resultOf(eventId: string) {
	return (await db.prepare('SELECT result FROM billing_events WHERE stripe_event_id = ?').bind(eventId).first())?.result ?? null;
}

function invoice(id: string, subscriptionId: string, userId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { id, customer: `cus_${userId}`, amount_paid: 9_900, currency: 'usd', hosted_invoice_url: `https://invoice.stripe.com/i/${id}`, number: id.toUpperCase(), billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: subscriptionId } }, ...overrides };
}

beforeAll(async () => {
	db = await migratedD1();
	// Users and their Stripe customers outlive each test; each test's own writes roll back after it.
	for (const id of ['u_new', 'u_rep', 'u_order', 'u_up', 'u_down', 'u_fail', 'u_cancel', 'u_del', 'u_bad', 'u_other', 'u_dup', 'u_late']) {
		await insertUser(db, id);
		await insertBillingCustomer(db, id, `cus_${id}`);
	}
});

beforeEach(() => {
	emails.length = 0;
	stripeDown = false;
	vi.restoreAllMocks();
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		if (stripeDown) return Response.json({ error: { message: 'Stripe is down', type: 'api_error' } }, { status: 500 });
		const state = stripeState.get(new URL(String(input)).pathname.replace('/v1/subscriptions/', ''));
		return state ? Response.json(state) : Response.json({ error: { message: 'No such subscription', code: 'resource_missing', type: 'invalid_request_error' } }, { status: 404 });
	});
});

describe('subscription events in the Stripe webhook', () => {
	it('records Premium from a completed checkout and then its subscription event, welcoming the seller once', async () => {
		stripeState.set('sub_new', subscription('sub_new', 'u_new'));
		const session = { id: 'cs_new', mode: 'subscription', payment_status: 'paid', client_reference_id: 'u_new', customer: 'cus_u_new', subscription: 'sub_new', metadata: { kind: 'estori_premium' } };
		expect(await deliver('evt_n1', 'checkout.session.completed', session)).toBe(200);
		expect(await deliver('evt_n2', 'customer.subscription.created', subscription('sub_new', 'u_new'))).toBe(200);
		expect(await rowOf('u_new')).toEqual({ stripe_subscription_id: 'sub_new', status: 'active', tier: 1, cancel_at_period_end: 0, pending_tier: null });
		expect(subjectsTo('u_new')).toEqual(['Welcome to Estori Premium']);
		expect([await resultOf('evt_n1'), await resultOf('evt_n2')]).toEqual(['applied', 'applied']);
		expect(await db.prepare("SELECT COUNT(*) AS n FROM template_purchases WHERE stripe_checkout_session_id = 'cs_new'").first()).toEqual({ n: 0 });
	});

	it('answers a repeated delivery without applying it again', async () => {
		stripeState.set('sub_rep', subscription('sub_rep', 'u_rep'));
		expect(await deliver('evt_r1', 'customer.subscription.created', subscription('sub_rep', 'u_rep'))).toBe(200);
		emails.length = 0;
		expect(await deliver('evt_r1', 'customer.subscription.created', subscription('sub_rep', 'u_rep'))).toBe(200);
		expect(await db.prepare("SELECT COUNT(*) AS n FROM billing_events WHERE stripe_event_id = 'evt_r1'").first()).toEqual({ n: 1 });
		expect(emails).toEqual([]);
	});

	it("converges on Stripe's state when the update arrives before the creation", async () => {
		stripeState.set('sub_order', subscription('sub_order', 'u_order', {}, 3));
		expect(await deliver('evt_o2', 'customer.subscription.updated', subscription('sub_order', 'u_order', {}, 3))).toBe(200);
		expect(await deliver('evt_o1', 'customer.subscription.created', subscription('sub_order', 'u_order', {}, 1))).toBe(200);
		expect(await rowOf('u_order')).toMatchObject({ tier: 3 });
		expect(subjectsTo('u_order')).toEqual(['Welcome to Estori Premium']);
	});

	it('applies an upgrade invoice: the bigger pool now, a note and a receipt', async () => {
		stripeState.set('sub_up', subscription('sub_up', 'u_up'));
		await deliver('evt_u1', 'customer.subscription.created', subscription('sub_up', 'u_up'));
		stripeState.set('sub_up', subscription('sub_up', 'u_up', {}, 3));
		emails.length = 0;
		expect(await deliver('evt_u2', 'invoice.paid', invoice('in_up', 'sub_up', 'u_up', { amount_paid: 17_000, billing_reason: 'subscription_update' }))).toBe(200);
		expect(await rowOf('u_up')).toMatchObject({ tier: 3 });
		expect(subjectsTo('u_up')).toEqual(['Your Premium pool is bigger now', 'Your Estori Premium receipt: $170.00']);
	});

	it('shows a scheduled downgrade, then moves to the smaller pool when it reaches its date', async () => {
		const schedule = { id: 'sub_sched_down', status: 'active', subscription: 'sub_down', current_phase: { start_date: START, end_date: END }, phases: [{ start_date: START, end_date: END, items: [{ price: PRICES[3] }] }, { start_date: END, end_date: null, items: [{ price: PRICES[2] }] }] };
		stripeState.set('sub_down', subscription('sub_down', 'u_down', { schedule }, 3));
		await deliver('evt_d1', 'subscription_schedule.updated', schedule);
		expect(await rowOf('u_down')).toMatchObject({ tier: 3, pending_tier: 2 });
		expect(subjectsTo('u_down')).toEqual(['Welcome to Estori Premium', 'Your Premium pool changes at renewal']);
		const renewed = subscription('sub_down', 'u_down', { items: { data: [{ id: 'si_sub_down', price: { id: PRICES[2] }, current_period_start: END, current_period_end: END + 30 * DAY }] } });
		stripeState.set('sub_down', renewed);
		await deliver('evt_d2', 'customer.subscription.updated', renewed);
		expect(await rowOf('u_down')).toMatchObject({ tier: 2, pending_tier: null });
	});

	it("keeps Premium through a failed renewal's grace, drops to Basic after it, and restores Premium on payment", async () => {
		stripeState.set('sub_fail', subscription('sub_fail', 'u_fail'));
		await deliver('evt_f0', 'customer.subscription.created', subscription('sub_fail', 'u_fail'));
		const renewal = NOW - 3 * DAY;
		const pastDue = subscription('sub_fail', 'u_fail', { status: 'past_due', items: { data: [{ id: 'si_f', price: { id: PRICES[1] }, current_period_start: renewal, current_period_end: renewal + 30 * DAY }] } });
		stripeState.set('sub_fail', pastDue);
		emails.length = 0;
		expect(await deliver('evt_f1', 'invoice.payment_failed', invoice('in_fail', 'sub_fail', 'u_fail', { amount_paid: 0 }))).toBe(200);
		const graceEnd = (renewal + 7 * DAY) * 1000;
		expect(subjectsTo('u_fail')).toEqual(["Your Premium payment didn't go through"]);
		expect(emails[0]?.text).toContain(`Premium continues until ${formatBillingDate(graceEnd)}`);
		expect((await loadAccount(testEnv(), 'u_fail', graceEnd - 1)).plan).toBe('premium');
		expect((await loadAccount(testEnv(), 'u_fail', graceEnd + DAY * 1000)).plan).toBe('basic');
		stripeState.set('sub_fail', { ...pastDue, status: 'active' });
		emails.length = 0;
		expect(await deliver('evt_f2', 'invoice.paid', invoice('in_fail', 'sub_fail', 'u_fail'))).toBe(200);
		expect((await loadAccount(testEnv(), 'u_fail', graceEnd + DAY * 1000)).plan).toBe('premium');
		expect(subjectsTo('u_fail')).toEqual(['Your Estori Premium receipt: $99.00']);
	});

	it('emails once when Premium is set to end, and clears it when the seller keeps Premium', async () => {
		stripeState.set('sub_cancel', subscription('sub_cancel', 'u_cancel', { cancel_at_period_end: true }));
		await deliver('evt_c1', 'customer.subscription.updated', subscription('sub_cancel', 'u_cancel'));
		await deliver('evt_c2', 'customer.subscription.updated', subscription('sub_cancel', 'u_cancel'));
		expect(await rowOf('u_cancel')).toMatchObject({ cancel_at_period_end: 1 });
		expect(subjectsTo('u_cancel')).toEqual(['Welcome to Estori Premium', `Premium ends on ${formatBillingDate(END * 1000)}`]);
		stripeState.set('sub_cancel', subscription('sub_cancel', 'u_cancel'));
		await deliver('evt_c3', 'customer.subscription.updated', subscription('sub_cancel', 'u_cancel'));
		expect(await rowOf('u_cancel')).toMatchObject({ cancel_at_period_end: 0 });
	});

	it('moves the account to Basic when the subscription is deleted, and says so', async () => {
		stripeState.set('sub_del', subscription('sub_del', 'u_del'));
		await deliver('evt_x1', 'customer.subscription.created', subscription('sub_del', 'u_del'));
		stripeState.set('sub_del', subscription('sub_del', 'u_del', { status: 'canceled' }));
		emails.length = 0;
		await deliver('evt_x2', 'customer.subscription.deleted', subscription('sub_del', 'u_del', { status: 'canceled' }));
		expect((await loadAccount(testEnv(), 'u_del')).plan).toBe('basic');
		expect(subjectsTo('u_del')).toEqual(['Your account is on Basic now']);
	});

	it("refuses a subscription whose account doesn't own its Stripe customer, and tells the team", async () => {
		stripeState.set('sub_bad', subscription('sub_bad', 'u_bad', { customer: 'cus_u_other' }));
		expect(await deliver('evt_b1', 'customer.subscription.created', subscription('sub_bad', 'u_bad'))).toBe(200);
		expect(await rowOf('u_bad')).toBeNull();
		expect(await resultOf('evt_b1')).toBe('refused');
		expect(emails.some((email) => email.subject.startsWith("Estori alert: A billing event didn't match its account"))).toBe(true);
	});

	it('refuses a second live subscription for one account, keeping the first and alerting the team', async () => {
		stripeState.set('sub_dup1', subscription('sub_dup1', 'u_dup'));
		await deliver('evt_p1', 'customer.subscription.created', subscription('sub_dup1', 'u_dup'));
		stripeState.set('sub_dup2', subscription('sub_dup2', 'u_dup', { created: NOW }));
		await deliver('evt_p2', 'customer.subscription.created', subscription('sub_dup2', 'u_dup'));
		expect(await rowOf('u_dup')).toMatchObject({ stripe_subscription_id: 'sub_dup1' });
		expect(await resultOf('evt_p2')).toBe('refused');
		expect(emails.some((email) => email.subject.startsWith('Estori alert: An account has two Premium subscriptions'))).toBe(true);
	});

	it('ignores a late event from an ended subscription once a newer one is live', async () => {
		stripeState.set('sub_late_new', subscription('sub_late_new', 'u_late', { created: NOW }));
		await deliver('evt_l1', 'customer.subscription.created', subscription('sub_late_new', 'u_late'));
		stripeState.set('sub_late_old', subscription('sub_late_old', 'u_late', { status: 'canceled', created: START - 60 * DAY }));
		emails.length = 0;
		await deliver('evt_l2', 'customer.subscription.deleted', subscription('sub_late_old', 'u_late'));
		expect(await rowOf('u_late')).toMatchObject({ stripe_subscription_id: 'sub_late_new', status: 'active' });
		expect(await resultOf('evt_l2')).toBe('ignored');
		expect(emails).toEqual([]);
	});

	it('answers 500 while Stripe is unreachable, recording nothing, so Stripe retries', async () => {
		stripeDown = true;
		expect(await deliver('evt_s1', 'customer.subscription.updated', subscription('sub_new', 'u_new'))).toBe(500);
		expect(await resultOf('evt_s1')).toBeNull();
	});
});
```

`worker/services/billing/repair.sql.test.ts`:

```ts
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertBillingCustomer, insertSubscription, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { runBillingRepair } from './repair';
import { billingEventDepsFromEnv } from './wiring';

let db: D1Database;
const NOW = Date.now();

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'u_repair');
	await insertBillingCustomer(db, 'u_repair', 'cus_u_repair');
	await insertSubscription(db, { userId: 'u_repair', stripeSubscriptionId: 'sub_repair', status: 'past_due', currentPeriodStart: new Date(NOW - 2 * 86_400_000), currentPeriodEnd: new Date(NOW + 28 * 86_400_000) });
});

describe('the daily billing repair', () => {
	it('re-reads a subscription past due for over a day, once a day', async () => {
		const start = Math.floor((NOW - 2 * 86_400_000) / 1000);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			Response.json({ id: 'sub_repair', customer: 'cus_u_repair', status: 'active', created: start, cancel_at_period_end: false, cancel_at: null, metadata: { estori_user_id: 'u_repair' }, schedule: null, items: { data: [{ id: 'si_r', price: { id: 'price_t1' }, current_period_start: start, current_period_end: start + 30 * 86_400 }] } }),
		);
		const env = envWith(db, { STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PREMIUM_PRICE_IDS: JSON.stringify({ 1: 'price_t1', 2: 'price_t2', 3: 'price_t3', 4: 'price_t4' }), VibecoderStore: { get: async () => null, put: async () => undefined } });
		expect(await runBillingRepair(billingEventDepsFromEnv(env), NOW)).toEqual({ checked: 1, failed: 0 });
		expect(await db.prepare("SELECT status FROM subscriptions WHERE user_id = 'u_repair'").first()).toEqual({ status: 'active' });
		const day = new Date(NOW).toISOString().slice(0, 10);
		expect(await db.prepare('SELECT result FROM billing_events WHERE stripe_event_id = ?').bind(`repair:sub_repair:${day}`).first()).toEqual({ result: 'applied' });
		expect(await runBillingRepair(billingEventDepsFromEnv(env), NOW)).toEqual({ checked: 0, failed: 0 });
	});
});
```

`worker/services/billing/wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { CATALOG_REFRESH_CRON } from '../catalog/scheduler';
import { CATALOG_HEALTH_CRON } from '../catalog/health';
import { runBillingSchedule } from './wiring';

describe('the billing schedule', () => {
	it('repairs on the daily run only, and only where Stripe is set up', async () => {
		const { d1, statements } = recordingD1();
		await runBillingSchedule(CATALOG_REFRESH_CRON, { DB: d1, STRIPE_SECRET_KEY: 'sk_test_fake' } as unknown as Env);
		await runBillingSchedule(CATALOG_HEALTH_CRON, { DB: d1 } as unknown as Env);
		expect(statements).toEqual([]);
		await runBillingSchedule(CATALOG_HEALTH_CRON, { DB: d1, STRIPE_SECRET_KEY: 'sk_test_fake' } as unknown as Env);
		expect(statements.some((entry) => entry.sql.includes('"subscriptions"'))).toBe(true);
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/subscription-sync.test.ts worker/services/billing/wiring.test.ts`
Expected: FAIL, failed imports.

Run: `rtk proxy bun run test -- worker/api/controllers/payments/webhook-billing.sql.test.ts worker/services/billing/repair.sql.test.ts`
Expected: FAIL. The billing events fall through to the purchase path, and `./repair` doesn't exist.

- [ ] **Step 4: Implement `subscription-sync.ts`.**

**`recordFromSubscription`:**
1. Take the first item. Its tier comes from `tierOf(item.price)`. Null when there's no item or no tier.
2. The schedule counts only when it's an expanded object with `status === 'active'`.
3. The pending change is the first schedule phase with `start_date * 1000 > nowMs` whose first item's price differs from the current one. Its tier comes from `tierOf({ id, metadata: null })` for a string price.
4. `cancelAtPeriodEnd = cancel_at_period_end || (cancel_at !== null && cancel_at <= item.current_period_end)`.
5. All times are seconds times 1000. `updatedAt` is `new Date(nowMs)`.

**`decideRow`:**

```ts
export function decideRow(stored: SubscriptionRecord | null, incoming: SubscriptionRecord): 'write' | 'ignore' | 'duplicate' {
	if (!stored || stored.stripeSubscriptionId === incoming.stripeSubscriptionId) return 'write';
	const storedLive = LIVE_SUBSCRIPTION_STATUSES.includes(stored.status);
	const incomingLive = LIVE_SUBSCRIPTION_STATUSES.includes(incoming.status);
	if (storedLive && incomingLive) return 'duplicate';
	if (storedLive) return 'ignore';
	if (incomingLive) return 'write';
	return incoming.stripeCreatedAt > stored.stripeCreatedAt ? 'write' : 'ignore';
}
```

**`noticesFor`** returns notices in this order. Every key embeds the subscription id `s`, and times in keys are seconds.
1. `premium_started:{s}` when `next.status` is `active` or `trialing`. Email `{ kind, tier, renewsAt: periodEnd }`.
2. `tier_upgraded:{s}:{tier}:{periodStart}` when `previous` is the same subscription and `next.tier > previous.tier`.
3. `downgrade_scheduled:{s}:{pendingTier}:{pendingAt}` when `next.pendingTier` and `next.pendingTierAt` are set.
4. `premium_ending:{s}:{periodEnd}` when `next.cancelAtPeriodEnd` and the status is live. Email `{ endsAt: periodEnd }`.
5. `premium_ended:{s}` when `next.status === 'canceled'`. The reason is `'payment-failed'` when `previous?.status` is `past_due` or `unpaid`, else `'cancelled'`.
6. `receipt:{invoice.id}` for `invoice.paid` with `amount_paid > 0`. The email carries `amount_paid`, `currency`, the row's period, `number` and `hosted_invoice_url`.
7. `payment_failed:{invoice.id}` for `invoice.payment_failed`. Email `{ graceEndsAt: currentPeriodStart + 7 days }`.

**`subscriptionIdOfInvoice`** returns `invoice.parent?.subscription_details?.subscription` when `parent.type === 'subscription_details'`, else null.

- [ ] **Step 5: Implement `events.ts`.**

```ts
export const BILLING_EVENT_TYPES: readonly string[] = [
	'customer.subscription.created',
	'customer.subscription.updated',
	'customer.subscription.deleted',
	'invoice.paid',
	'invoice.payment_failed',
	'subscription_schedule.created',
	'subscription_schedule.updated',
	'subscription_schedule.released',
	'subscription_schedule.canceled',
];
```

**`isBillingEvent`:** true for these types, and for `checkout.session.completed` whose object `isCheckoutSession` with `mode === 'subscription'`.

**`billingTarget`:**
- a subscription-mode checkout: `{ subscriptionId: session.subscription, expectedUserId: session.client_reference_id, invoice: null }`;
- `customer.subscription.*`: the object's `id`, when it starts `sub_`;
- `invoice.*`: `subscriptionIdOfInvoice(object)`, with the invoice, when the object is an invoice (`id` starts `in_`, `amount_paid` is a number);
- `subscription_schedule.*`: `object.subscription ?? object.released_subscription`;
- otherwise null.

Write small `isRecord`-style guards. No casts to `any`.

**`handleBillingEvent(deps, event)`:**
1. When the event was seen, answer `'duplicate'`.
2. With no target, record `{ result: 'ignored', userId: null, objectId }` with no row and no notices, and answer `'ignored'`.
3. Otherwise answer `applySubscription(deps, { eventId: event.id, eventType: event.type, ...target })`.

**`applySubscription`:**
1. When `eventSeen(eventId)`, answer `'duplicate'`.
2. `subscription = await deps.stripe.retrieveSubscription(subscriptionId)`. Errors propagate, so the webhook answers 500 and Stripe retries.
3. `claimed = subscription.metadata?.estori_user_id ?? null` and `owner = await store.userOfCustomer(subscription.customer)`.
4. When `!claimed || owner !== claimed || (expectedUserId !== null && expectedUserId !== claimed)`:
   - alert `{ kind: 'billing-mismatch', subject: subscription.id, message: "A billing event's account didn't match its Stripe customer, so it wasn't applied.", details: [['Event', eventId], ['Metadata account', claimed ?? 'none'], ['Customer owner', owner ?? 'none'], ['Checkout account', expectedUserId ?? 'none']] }`;
   - record `'refused'` and answer `'refused'`.
5. `incoming = recordFromSubscription(subscription, claimed, deps.tierOf, deps.nowMs())`. When null:
   - alert `billing-unknown-price`, naming the price id;
   - record `'refused'` and answer `'refused'`.
6. `stored = await store.subscriptionOf(claimed)`, then `decideRow(stored, incoming)`:
   - `'duplicate'`: alert `billing-duplicate-subscription` with both subscription ids and "Refund the newer one in the Stripe Dashboard and cancel it." Record `'refused'`.
   - `'ignore'`: record `'ignored'`.
7. `planned = noticesFor({ previous: stored, next: incoming, eventType, invoice })`. Drop the keys `sentNoticeKeys` already has.
8. `recordEvent({ event: { id, type, objectId: subscription.id, userId: claimed, result: 'applied' }, row: incoming, notices: fresh.map((notice) => ({ key: notice.key, kind: notice.email.kind })), now })`. A failed batch propagates, so the webhook answers 500 and the retry sees what landed.
9. `await deps.notify(claimed, fresh)`, then answer `'applied'`.

- [ ] **Step 6: Implement `repair.ts` and `wiring.ts`.**

**`runBillingRepair(deps, nowMs)`:**
- For each row from `subscriptionsToRepair(nowMs)`, call `applySubscription` with:
  - `eventId` set to `repair:{subscription id}:{YYYY-MM-DD of nowMs}`;
  - `eventType: 'repair'`;
  - `expectedUserId: row.userId`;
  - `invoice: null`.
- Count `checked` for each `'applied'`. Count `failed` for each throw, logging it.
- Skip outcomes are `'duplicate'`, `'ignored'` and `'refused'`; count them in neither.
- Log a warning with the counts when anything was checked or failed.

**`billingEventDepsFromEnv(env)`:**
- `stripe` is `stripeFromEnv(env)`. Throw `Error('Stripe is not configured')` when it's null.
- `store` is `new BillingService(env)`.
- `tierOf` is `(price) => tierOfPrice(price, premiumPriceIds(env.STRIPE_PREMIUM_PRICE_IDS))`.
- `notify` calls `sendBillingEmails(billingMailFromEnv(env), userId, notices)`.
- `alert` is `platformAlertsFromEnv(env)`.
- `nowMs` is `() => Date.now()`.

**`runBillingSchedule(cron, env)`:**
- returns unless `cron === CATALOG_HEALTH_CRON && env.STRIPE_SECRET_KEY`;
- runs the repair in a try/catch that logs.

**Alerts:** add the three kinds to `PLATFORM_ALERT_KINDS`, labelled:
- "A billing event didn't match its account";
- "A subscription has a price Estori doesn't know";
- "An account has two Premium subscriptions".

- [ ] **Step 7: Wire the webhook and the cron.** In `dispatchStripeEvent`, right after the Connect filter:

```ts
    // Premium subscriptions: rebuilt from Stripe's API, so retries and out-of-order events converge.
    if (isBillingEvent(event)) {
        const outcome = await handleBillingEvent(billingEventDepsFromEnv(env), event);
        logger.info('Billing event handled', { id: event.id, type: event.type, outcome });
        return;
    }
```

Also:
- add `mode?`, `subscription?` and `customer?` to `StripeCheckoutSession` if Task 4 didn't;
- extend the header comment of `webhook.ts` to name subscriptions;
- in `worker/index.ts`, add `ctx.waitUntil(runBillingSchedule(controller.cron, env));` after the shopper email schedule.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/subscription-sync.test.ts worker/services/billing/wiring.test.ts worker/services/billing/repair.sql.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- worker/api/controllers/payments/webhook-billing.sql.test.ts worker/api/controllers/payments/webhook.test.ts worker/api/controllers/payments/webhook-store.test.ts`
Expected: PASS. The store and purchase webhook tests are unchanged.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add worker/services/billing/subscription-sync.ts worker/services/billing/subscription-sync.test.ts worker/services/billing/events.ts worker/services/billing/repair.ts worker/services/billing/repair.sql.test.ts worker/services/billing/wiring.ts worker/services/billing/wiring.test.ts worker/api/controllers/payments/webhook.ts worker/api/controllers/payments/webhook-billing.sql.test.ts worker/services/payments/stripe-client.ts worker/services/alerts/platform-alerts.ts worker/index.ts
git commit -m "feat(billing): subscription events rebuild the account's row from stripe, once each and in any order, with a daily repair

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Credits enforced before every turn, the warnings, and the shared Upgrade dialog

**Files:**
- Create:
  - `worker/services/billing/gates.ts`;
  - `worker/services/billing/credit-notices.ts`;
  - `worker/services/billing/usage.ts`;
  - `src/lib/plan-limit-events.ts`;
  - `src/components/billing/upgrade-copy.ts`;
  - `src/components/billing/UpgradeDialog.tsx`.
- Modify:
  - worker, agents: `worker/agents/core/websocket.ts`, `worker/agents/think/ThinkAgent.ts`;
  - worker, API: `worker/api/websocketTypes.ts`, `worker/api/responses.ts`, `worker/api/controllers/baseController.ts`, `worker/api/controllers/agent/controller.ts`, `worker/api/controllers/limits/controller.ts`;
  - worker, services: `worker/services/rate-limit/usageChecker.ts` (export `UNLIMITED_USAGE`);
  - shared: `shared/types/plan.ts`, `shared/types/billing.ts`;
  - frontend: `src/App.tsx`, `src/lib/api-client.ts`, `src/hooks/use-limits.ts`, `src/utils/usage-limit-checker.tsx`, `src/components/usage-limits-badge.tsx`, `src/routes/chat/utils/handle-websocket-message.ts`.
- Test:
  - `worker/services/billing/gates.test.ts`;
  - `worker/services/billing/credit-notices.test.ts`;
  - `worker/services/billing/usage.test.ts`;
  - `worker/api/responses-plan-limit.test.ts`;
  - `worker/agents/core/websocket.test.ts`;
  - `worker/agents/think/model-wiring.test.ts`;
  - `src/components/billing/upgrade-copy.test.ts`;
  - `src/components/billing/plan-limit-guard.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 3: `loadAccount`, `BillingAccount`, `creditBucketFor`, `creditsUsed`, `recordCredits`, `isBillingOn`, `CreditBucket`;
  - from Task 1: `assertWithinLimit`, `isPlanLimitRefusal`, `PlanLimitRefusal`;
  - from Task 5: `claimAndSendNotice`, `creditNoticeDue`, `creditNoticeKey`, `billingMailFromEnv`;
  - from Task 2: `BillingService.claimNotice`, `PLAN_LIMIT_ERROR_CODE`, `BILLING_PATH`.
- **Produces:**
  - `gates.ts`:
    - `creditRefusal(env: Env, account: BillingAccount, llmCalls: LLMCallsRateLimitConfig): Promise<PlanLimitRefusal | null>`;
    - `PromptPlanCheck { billing: boolean; refusal: PlanLimitRefusal | null }`;
    - `checkPromptPlan(env: Env, userId: string): Promise<PromptPlanCheck>`.
  - `credit-notices.ts`:
    - `CreditUse { userId: string; window: CreditsWindow; used: number; limit: number; periodStartMs: number; renewsAt: number }`;
    - `noticeCreditUse(deps: CreditNoticeDeps, use: CreditUse, claimedHere: Set<string>): Promise<void>` (never throws);
    - `CreditNoticeDeps = BillingMailDeps & { claim(userId, key, kind): Promise<boolean> }`;
    - `creditNoticeDepsFromEnv(env): CreditNoticeDeps`.
  - `usage.ts`: `billingCreditsSummary(account: BillingAccount, used: number)`, answering `{ billing: UsageBilling; planLimit: PlanLimitRefusal | null; config; usage; limitCheck }` in the existing usage shape.
  - `shared/types/billing.ts`: `UsageBilling { plan: PlanId; tier: PremiumTierNumber | null; window: CreditsWindow; resetsAt: string }`.
  - `shared/types/plan.ts`: `PublicPlan extends PublicPlanLimits { billing: boolean }`, which `GET /api/limits/plan` answers.
  - `worker/api/responses.ts`:
    - `planLimitResponse(refusal): Response` (402);
    - `BaseErrorResponse` gains `code?: string` and `planLimit?: PlanLimitRefusal`.
  - `BaseController.createPlanLimitResponse<T>(refusal)`.
  - The WebSocket `ErrorMessage` gains `planLimit?: PlanLimitRefusal`.
  - `handleWebSocketMessage(agent, connection, message, usageCheck = checkUsageAndBalance, planCheck: typeof checkPromptPlan = checkPromptPlan)`.
  - `usageChecker.ts`: `UNLIMITED_USAGE: UsageCheckResult`.
  - Frontend:
    - `src/lib/plan-limit-events.ts`: `PLAN_LIMIT_EVENT`, `showPlanLimit(refusal)`, `onPlanLimit(listener): () => void`;
    - `src/components/billing/upgrade-copy.ts`: `UpgradeCopy { title: string; action: { label: string; to: string } | null }`, `upgradeCopy(refusal): UpgradeCopy`, `billingBadgeText(billing: UsageBilling, remaining: number): { usage: string; mobile: string; plan: string }`;
    - `UpgradeDialog({ refusal, onClose })` and `UpgradeDialogHost()`;
    - `PlanLimitError extends ApiError { refusal }`;
    - `UsageSummary` gains `billing?: UsageBilling | null` and `planLimit?: PlanLimitRefusal | null`.

- [ ] **Step 1: Write the failing worker tests.**

`worker/services/billing/gates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS } from '../rate-limit/config';
import { checkPromptPlan, creditRefusal } from './gates';
import type { BillingAccount } from './account';

const LLM = DEFAULT_RATE_LIMIT_SETTINGS.llmCalls;

function account(overrides: Partial<BillingAccount> = {}): BillingAccount {
	return {
		billing: true,
		userId: 'u1',
		plan: 'basic',
		tier: null,
		source: 'free',
		limits: { aiCredits: 200, aiCreditsWindow: 'day', newStoresPerDay: 3, liveStores: 1, ownDomainsPerLiveStore: 0, supplierCatalog: false, draftsPerStore: 5 },
		creditsResetAt: Date.UTC(2026, 9, 20),
		periodStartMs: Date.UTC(2026, 9, 19),
		periodEndMs: Date.UTC(2026, 9, 20),
		graceEndsAtMs: null,
		grantedCredits: 0,
		subscription: null,
		...overrides,
	};
}

function remaining(left: number): Env {
	return { DORateLimitStore: { getByName: () => ({ getRemainingLimit: async () => left }) } } as unknown as Env;
}

describe('the credit check before a turn', () => {
	it('lets a turn start while any credit is left, and refuses once the window is used up', async () => {
		expect(await creditRefusal(remaining(1), account(), LLM)).toBeNull();
		expect(await creditRefusal(remaining(0), account(), LLM)).toMatchObject({ code: 'plan_limit', limit: 'aiCredits', plan: 'basic', upgradeTo: 'premium' });
	});

	it('refuses nothing while billing is off', async () => {
		expect(await creditRefusal(remaining(0), account({ billing: false }), LLM)).toBeNull();
	});

	it('answers billing off without reading the database when the flag is off for the account', async () => {
		const env = {
			BILLING_USER_IDS: 'someone-else',
			get DB(): never {
				throw new Error('The plan check read the database while billing was off');
			},
		} as unknown as Env;
		expect(await checkPromptPlan(env, 'u1')).toEqual({ billing: false, refusal: null });
	});
});
```

`worker/services/billing/credit-notices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { noticeCreditUse, type CreditNoticeDeps } from './credit-notices';

function deps() {
	const claimed = new Set<string>();
	const subjects: string[] = [];
	let claims = 0;
	const value: CreditNoticeDeps = {
		sender: { send: async (email) => void subjects.push(email.subject) },
		userEmail: async () => 'ana@example.test',
		baseUrl: 'https://estori.app',
		claim: async (_userId, key) => {
			claims += 1;
			if (claimed.has(key)) return false;
			claimed.add(key);
			return true;
		},
	};
	return { value, subjects, claims: () => claims };
}

const USE = { userId: 'u1', window: 'period' as const, limit: 20_000, periodStartMs: Date.UTC(2026, 9, 5, 10), renewsAt: Date.UTC(2026, 10, 5, 10) };

describe('credit warnings while metering', () => {
	it("warns at 80% and at 100%, once each per period, even after the agent restarts", async () => {
		const { value, subjects } = deps();
		const here = new Set<string>();
		for (const used of [15_999, 16_000, 17_000, 20_000, 20_000]) await noticeCreditUse(value, { ...USE, used }, here);
		await noticeCreditUse(value, { ...USE, used: 20_000 }, new Set());
		expect(subjects).toEqual(["You've used 80% of this month's AI credits", "You've used this month's AI credits"]);
	});

	it('asks the database once per warning per agent', async () => {
		const { value, claims } = deps();
		const here = new Set<string>();
		for (const used of [16_000, 16_100, 16_200]) await noticeCreditUse(value, { ...USE, used }, here);
		expect(claims()).toBe(1);
	});

	it("never warns about Basic's daily allowance", async () => {
		const { value, subjects, claims } = deps();
		await noticeCreditUse(value, { ...USE, window: 'day', limit: 200, used: 200 }, new Set());
		expect(subjects).toEqual([]);
		expect(claims()).toBe(0);
	});
});
```

`worker/services/billing/usage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { billingCreditsSummary } from './usage';
import type { BillingAccount } from './account';

const RESET = Date.UTC(2026, 10, 5);

function account(overrides: Partial<BillingAccount>): BillingAccount {
	return {
		billing: true,
		userId: 'u1',
		plan: 'basic',
		tier: null,
		source: 'free',
		limits: { aiCredits: 200, aiCreditsWindow: 'day', newStoresPerDay: 3, liveStores: 1, ownDomainsPerLiveStore: 0, supplierCatalog: false, draftsPerStore: 5 },
		creditsResetAt: RESET,
		periodStartMs: 0,
		periodEndMs: RESET,
		graceEndsAtMs: null,
		grantedCredits: 0,
		subscription: null,
		...overrides,
	};
}

describe('the usage summary with billing on', () => {
	it("reports Premium's monthly pool, so the existing badge follows", () => {
		const premium = account({ plan: 'premium', tier: 1, source: 'subscription', limits: { aiCredits: 20_000, aiCreditsWindow: 'period', newStoresPerDay: 25, liveStores: 10, ownDomainsPerLiveStore: 1, supplierCatalog: true, draftsPerStore: 5 } });
		expect(billingCreditsSummary(premium, 5_000)).toEqual({
			billing: { plan: 'premium', tier: 1, window: 'period', resetsAt: '2026-11-05T00:00:00.000Z' },
			planLimit: null,
			config: { limit: { type: 'credits', window: 'monthly', maxValue: 20_000, enabled: true, resetAt: '2026-11-05T00:00:00.000Z' }, unlimited: false },
			usage: { credits: { monthly: 5_000 } },
			limitCheck: { withinLimits: true, exceededLimits: [], message: 'Within limits' },
		});
	});

	it('carries the refusal once the window is used up', () => {
		const summary = billingCreditsSummary(account({}), 200);
		expect(summary.planLimit).toMatchObject({ code: 'plan_limit', limit: 'aiCredits' });
		expect(summary.limitCheck).toEqual({ withinLimits: false, exceededLimits: [{ type: 'credits', window: 'daily', current: 200, max: 200, percentUsed: 100 }], message: 'Limit exceeded' });
	});
});
```

`worker/api/responses-plan-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planLimitResponse } from './responses';

describe('planLimitResponse', () => {
	it('answers 402 with the refusal under error, where the frontend looks for it', async () => {
		const refusal = { code: 'plan_limit' as const, limit: 'liveStores' as const, plan: 'basic' as const, upgradeTo: 'premium' as const, message: 'Basic includes 1 live store. Get Premium for up to 10.' };
		const response = planLimitResponse(refusal);
		expect(response.status).toBe(402);
		expect(await response.json()).toEqual({ success: false, error: { message: refusal.message, name: 'PlanLimit', code: 'plan_limit', planLimit: refusal }, message: refusal.message });
	});
});
```

In `worker/agents/core/websocket.test.ts`:
- give `fakes` a third parameter `behaviorType = 'phasic'` and set `state: { metadata: { userId: 'u1' }, behaviorType }`;
- import `type { checkPromptPlan } from '../../services/billing/gates'`;
- add:

```ts
const REFUSAL = { code: 'plan_limit', limit: 'aiCredits', plan: 'basic', upgradeTo: 'premium', message: "You've used today's free AI credits. They reset at midnight UTC, or get Premium for a monthly pool." } as const;
const plan = (billing: boolean, refusal: typeof REFUSAL | null = null): typeof checkPromptPlan => async () => ({ billing, refusal });
const suggestion = JSON.stringify({ type: 'user_suggestion', message: 'Make the header blue' });

describe('the plan check before a prompt', () => {
	it('refuses with the plan_limit popup, without asking the old check or the agent', async () => {
		const order: string[] = [];
		const { agent, connection, sent } = fakes({}, order);
		await handleWebSocketMessage(agent, connection, suggestion, recordingCheck(order, { allowed: true }), plan(true, REFUSAL));
		expect(sent).toEqual([{ type: 'error', error: REFUSAL.message, code: 'PLAN_LIMIT', showAsPopup: true, planLimit: REFUSAL }]);
		expect(order).toEqual([]);
	});

	it("skips the old balance check for a Think app once billing is on, since Think always runs on Estori's gateway", async () => {
		const order: string[] = [];
		const { agent, connection } = fakes({}, order, 'think');
		await handleWebSocketMessage(agent, connection, suggestion, recordingCheck(order, { allowed: false, reason: 'limit' }), plan(true));
		expect(order).toEqual(['input:Make the header blue']);
	});

	it('keeps the old check for older apps, and for every app while billing is off', async () => {
		for (const [behaviorType, billing] of [['phasic', true], ['think', false]] as const) {
			const order: string[] = [];
			const { agent, connection } = fakes({}, order, behaviorType);
			await handleWebSocketMessage(agent, connection, suggestion, recordingCheck(order, { allowed: true }), plan(billing));
			expect(order).toEqual(['usage-check', 'input:Make the header blue']);
		}
	});
});
```

In `worker/agents/think/model-wiring.test.ts`, extend the credit-cost test:

```ts
		expect(beforeTurn).toContain('loadAccount(');
		expect(beforeTurn).toContain('creditBucketFor(');
		expect(beforeStep).toContain('recordCredits(this.env, this.turnUsage.bucket, this.turnUsage.creditCost)');
		expect(beforeStep).toContain('noticeCreditUse(');
		expect(beforeStep).not.toContain('enforceLLMCallsRateLimit');
```

Add `worker/api/controllers/agent/plan-checks-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/controllers/agent/controller.ts'], { query: '?raw', import: 'default', eager: true });

describe('the plan checks when a store starts', () => {
	it('checks credits before reserving a new store, so a refused start costs nothing', () => {
		const controller = sources['/worker/api/controllers/agent/controller.ts'] ?? '';
		const credits = controller.indexOf('creditRefusal(');
		expect(credits).toBeGreaterThan(-1);
		expect(credits).toBeLessThan(controller.indexOf('enforceAppCreationRateLimit('));
		expect(controller).toContain('createPlanLimitResponse(');
		expect(controller).toContain("account.billing && behaviorType === 'think' ? UNLIMITED_USAGE");
	});
});
```

- [ ] **Step 2: Write the failing frontend tests.**

`src/components/billing/upgrade-copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { billingBadgeText, upgradeCopy } from './upgrade-copy';

const base = { code: 'plan_limit' as const, message: 'x' };

describe('the Upgrade dialog copy', () => {
	it('offers Basic Premium, Premium a bigger pool, and the largest plans a talk with sales', () => {
		expect(upgradeCopy({ ...base, limit: 'liveStores', plan: 'basic', upgradeTo: 'premium' })).toEqual({ title: 'Get Premium', action: { label: 'Get Premium', to: '/settings/billing' } });
		expect(upgradeCopy({ ...base, limit: 'aiCredits', plan: 'premium', upgradeTo: 'premium' })).toEqual({ title: 'Move to a bigger pool', action: { label: 'See your pools', to: '/settings/billing' } });
		expect(upgradeCopy({ ...base, limit: 'liveStores', plan: 'premium', upgradeTo: 'enterprise' })).toEqual({ title: 'Talk to us about Enterprise', action: { label: 'Talk to sales', to: '/contact?topic=enterprise' } });
		expect(upgradeCopy({ ...base, limit: 'liveStores', plan: 'enterprise', upgradeTo: null })).toEqual({ title: "You've reached your plan's limit", action: null });
	});

	it('words the usage badge for each plan', () => {
		expect(billingBadgeText({ plan: 'basic', tier: null, window: 'day', resetsAt: '' }, 120)).toEqual({ usage: '120 free credits left', mobile: '120 credits', plan: 'Basic' });
		expect(billingBadgeText({ plan: 'premium', tier: 2, window: 'period', resetsAt: '' }, 41_250)).toEqual({ usage: '41,250 credits left', mobile: '41,250 credits', plan: 'Premium' });
		expect(billingBadgeText({ plan: 'premium', tier: 2, window: 'period', resetsAt: '' }, 1)).toEqual({ usage: '1 credit left', mobile: '1 credit', plan: 'Premium' });
	});
});
```

`src/components/billing/plan-limit-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/lib/api-client.ts', '/src/App.tsx', '/src/routes/chat/utils/handle-websocket-message.ts', '/src/utils/usage-limit-checker.tsx', '/src/components/usage-limits-badge.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('one Upgrade dialog for every plan_limit refusal', () => {
	it('opens from any 402 refusal, any PLAN_LIMIT socket error, and the pre-send check', () => {
		const client = source('/src/lib/api-client.ts');
		expect(client).toContain('response.status === 402 && isPlanLimitRefusal(');
		expect(client).toContain('showPlanLimit(');
		expect(client).toContain('if (error instanceof PlanLimitError) throw error;');
		expect(source('/src/App.tsx')).toContain('<UpgradeDialogHost />');
		expect(source('/src/routes/chat/utils/handle-websocket-message.ts')).toContain('errorData.code === PLAN_LIMIT_ERROR_CODE');
		expect(source('/src/utils/usage-limit-checker.tsx')).toContain('<UpgradeDialog refusal={limitsData.planLimit}');
	});

	it('shows the usage badge for everyone once billing is on, without Cloudflare wording', () => {
		const badge = source('/src/components/usage-limits-badge.tsx');
		expect(badge).toContain('!data.cloudflareConnectEnabled && !data.billing');
		expect(badge).toContain('billingBadgeText(');
		expect(badge).toContain('BILLING_PATH');
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/billing/gates.test.ts worker/services/billing/credit-notices.test.ts worker/services/billing/usage.test.ts worker/api/responses-plan-limit.test.ts`
Expected: FAIL, failed imports.

Run: `rtk proxy bun run test -- worker/agents/core/websocket.test.ts worker/agents/think/model-wiring.test.ts worker/api/controllers/agent/plan-checks-guard.test.ts src/components/billing/upgrade-copy.test.ts src/components/billing/plan-limit-guard.test.ts`
Expected: FAIL. The new WebSocket tests fail, the guards find no matches, and `./upgrade-copy` doesn't exist.

- [ ] **Step 4: The worker side.**

**`gates.ts`:**
- `creditRefusal` returns null when `!account.billing`. Otherwise it answers `assertWithinLimit(account, 'aiCredits', await creditsUsed(env, creditBucketFor(account, llmCalls)))`.
- `checkPromptPlan` returns `{ billing: false, refusal: null }` when `!isBillingOn(env, userId)`, before anything else. Otherwise it loads `loadAccount(env, userId)` and `getUserConfigurableSettings(env, userId)` together, and answers `{ billing: true, refusal: await creditRefusal(env, account, settings.security.rateLimit.llmCalls) }`.

**`credit-notices.ts`:**

```ts
/** The 80% and 100% warnings for a monthly pool, claimed in billing_notices so each goes once per period. */
export async function noticeCreditUse(deps: CreditNoticeDeps, use: CreditUse, claimedHere: Set<string>): Promise<void> {
	if (use.window !== 'period') return;
	const kind = creditNoticeDue(use.used, use.limit);
	if (!kind) return;
	const key = creditNoticeKey(kind, use.periodStartMs);
	// Each agent asks the database once per warning; billing_notices keeps it to once across agents and restarts.
	if (claimedHere.has(key)) return;
	claimedHere.add(key);
	await claimAndSendNotice(deps, use.userId, { key, email: { kind, credits: use.limit, renewsAt: use.renewsAt } });
}
```

`creditNoticeDepsFromEnv(env)` returns `{ ...billingMailFromEnv(env), claim: (userId, key, kind) => new BillingService(env).claimNotice(userId, key, kind, new Date()) }`.

**`usage.ts`:** `billingCreditsSummary` builds the shape the test pins:
- `window` is `'daily'` for a day and `'monthly'` for a period;
- `resetAt` is the ISO form of `creditsResetAt`;
- the refusal comes from `assertWithinLimit(account, 'aiCredits', used)`;
- `percentUsed = limit > 0 ? Math.min(100, (used / limit) * 100) : 0`.

**`responses.ts`:**
- `planLimitResponse(refusal)` returns 402 with `{ success: false, error: { message: refusal.message, name: 'PlanLimit', code: PLAN_LIMIT_CODE, planLimit: refusal }, message: refusal.message }`;
- add `code?: string` and `planLimit?: PlanLimitRefusal` to `BaseErrorResponse`;
- `BaseController.createPlanLimitResponse<T = never>(refusal)` casts it like `createErrorResponse`.

**`usageChecker.ts`:** export `UNLIMITED_USAGE: UsageCheckResult = { allowed: true, shouldUseByok: false, withinLimits: true, remaining: Infinity, limit: Infinity, balance: null, hasUserToken: false }`. Return it from the disabled branch of `checkUsageAndBalance`.

**`websocket.ts`:** add the `planCheck` parameter (default `checkPromptPlan`) to `handleWebSocketMessage` and pass it to `ensureCanPrompt`. In `ensureCanPrompt`, before the existing usage check:

```ts
        const plan = await planCheck(env, userId);
        if (plan.refusal) {
            sendToConnection(connection, WebSocketMessageResponses.ERROR, { error: plan.refusal.message, code: PLAN_LIMIT_ERROR_CODE, showAsPopup: true, planLimit: plan.refusal });
            return false;
        }
        // Think always runs on Estori's gateway, so with billing on the plan check is the whole check.
        if (plan.billing && agent.state.behaviorType === 'think') return true;
```

Add `planLimit?: PlanLimitRefusal` to `ErrorMessage` in `websocketTypes.ts`.

**`agent/controller.ts`,** right after the `reuseSeed` block and before the `enforceAppCreationRateLimit` try:

```ts
            const account = await loadAccount(env, user.id);
            const creditsRefused = await creditRefusal(env, account, context.config.security.rateLimit.llmCalls);
            if (creditsRefused) return CodingAgentController.createPlanLimitResponse(creditsRefused);
```

Then make the usage check `const limitResult = account.billing && behaviorType === 'think' ? UNLIMITED_USAGE : await checkUsageAndBalance(env, user.id, request, userToken);`. Keep the guard's literal.

**`ThinkAgent.ts`:**
- `turnUsage` becomes `{ bucket: CreditBucket; creditCost: number; userId: string; billing: boolean; periodStartMs: number; renewsAt: number } | null`.
- Add `private readonly creditNoticesClaimed = new Set<string>();`.
- **`beforeTurn`:** keep the `creditCost` line. In the try, load `loadAccount(this.env, config.userId)` and `getUserConfigurableSettings(this.env, config.userId)` together, then set `this.turnUsage = { bucket: creditBucketFor(account, userConfig.security.rateLimit.llmCalls), creditCost, userId: config.userId, billing: account.billing, periodStartMs: account.periodStartMs, renewsAt: account.creditsResetAt }`.
- **`beforeStep`:**

```ts
		if (this.turnUsage && config) {
			const used = await recordCredits(this.env, this.turnUsage.bucket, this.turnUsage.creditCost);
			if (this.turnUsage.billing) {
				await noticeCreditUse(creditNoticeDepsFromEnv(this.env), { userId: this.turnUsage.userId, window: this.turnUsage.bucket.window, used, limit: this.turnUsage.bucket.config.limit, periodStartMs: this.turnUsage.periodStartMs, renewsAt: this.turnUsage.renewsAt }, this.creditNoticesClaimed);
			}
		}
```

- Remove the imports this leaves unused: `RateLimitService`, `hasCloudflareConfigured` and `RateLimitSettings`.
- A turn that started always finishes. `recordCredits` never throws and never stops a step. Only the next turn's check refuses.

**`limits/controller.ts`:**
- **`getPublicPlan`:** answers `{ ...publicPlanFromSettings(context.config.security.rateLimit), billing: isBillingOn(env, null) }`, typed `PublicPlan`.
- **`getUsage`:**
  - load `loadAccount(env, user.id)` alongside the existing three reads;
  - build today's body as `base`;
  - when `account.billing`, read `creditsUsed(env, creditBucketFor(account, context.config.security.rateLimit.llmCalls))` and answer `{ ...base, cloudflareConnectEnabled: false, ...billingCreditsSummary(account, used) }`;
  - otherwise answer `{ ...base, billing: null, planLimit: null }`;
  - keep the Set-Cookie echo.

- [ ] **Step 5: The frontend side.**

**`src/lib/plan-limit-events.ts`:**

```ts
/** The page-wide signal that a plan_limit refusal came back; UpgradeDialogHost listens. */
export const PLAN_LIMIT_EVENT = 'estori:plan-limit';

export function showPlanLimit(refusal: PlanLimitRefusal): void {
	window.dispatchEvent(new CustomEvent<PlanLimitRefusal>(PLAN_LIMIT_EVENT, { detail: refusal }));
}

export function onPlanLimit(listener: (refusal: PlanLimitRefusal) => void): () => void {
	const handle = (event: Event) => {
		const detail: unknown = (event as CustomEvent<unknown>).detail;
		if (isPlanLimitRefusal(detail)) listener(detail);
	};
	window.addEventListener(PLAN_LIMIT_EVENT, handle);
	return () => window.removeEventListener(PLAN_LIMIT_EVENT, handle);
}
```

**`upgrade-copy.ts`:**
- `upgradeCopy` gives exactly the four answers the test pins. Basic's and Premium's links go to `BILLING_PATH`; Enterprise's to `contactPath('enterprise')`.
- `billingBadgeText`:
  - formats `remaining.toLocaleString('en-US')`;
  - says "free " before "credits" on a daily window;
  - uses "credit" when exactly 1 is left;
  - `plan` is `planById(billing.plan).name`.

**`UpgradeDialog.tsx`:**
- Uses `@/components/ui/dialog` and `@/components/ui/button`, as `usage-limit-checker.tsx` does.
- The title is `copy.title`. The description is `refusal.message`.
- When `copy.action` is set, its button navigates to `action.to` through `useNavigate` after closing.
- A "Not now" outline button closes it.
- `UpgradeDialogHost` holds the latest refusal from `onPlanLimit` in state and renders `UpgradeDialog` while it's set. Mount it in `App.tsx` beside `<TermsGate />`.

**`api-client.ts`:**

```ts
/** A plan_limit refusal; the Upgrade dialog has already opened for it. */
export class PlanLimitError extends ApiError {
	constructor(endpoint: string, readonly refusal: PlanLimitRefusal) {
		super(402, 'Payment Required', refusal.message, endpoint);
		this.name = 'PlanLimitError';
	}
}
```

- In `requestRaw`'s non-OK branch, before `const errorData = data.error;`:

```ts
                const planLimit = data.error?.planLimit;
                if (response.status === 402 && isPlanLimitRefusal(planLimit)) {
                    showPlanLimit(planLimit);
                    throw new PlanLimitError(endpoint, planLimit);
                }
```

- `getPublicPlan` returns `ApiResponse<PublicPlan>`.
- In `createAgentSession`'s catch, add `if (error instanceof PlanLimitError) throw error;` before the toast. The dialog already explains.

**`usage-limit-checker.tsx`:** in `checkCanSendPrompt` (after the loading check) and in `getBackendLimitDialog` (after the null check):

```tsx
	if (limitsData.billing) {
		if (limitsData.limitCheck.withinLimits || !limitsData.planLimit) return { canProceed: true };
		return { canProceed: false, dialogComponent: <UpgradeDialog refusal={limitsData.planLimit} onClose={onClose} /> };
	}
```

The Cloudflare dialogs stay for deployments with billing off. Billing-on accounts never see "Connect your Cloudflare account".

**`usage-limits-badge.tsx`:**
- `hidden` becomes `!loading && Boolean(data && !data.cloudflareConnectEnabled && !data.billing)`.
- When `data.billing` is set:
  - the usage texts come from `billingBadgeText(data.billing, remaining)`;
  - the right-hand segment shows the plan name instead of Connect or credits;
  - the button navigates to `BILLING_PATH`;
  - none of the Cloudflare segments render.

**`handle-websocket-message.ts`:** add a first branch to the error handling:

```ts
                if (errorData.code === PLAN_LIMIT_ERROR_CODE && isPlanLimitRefusal(errorData.planLimit)) {
                    showPlanLimit(errorData.planLimit);
                } else if (errorData.showAsPopup && errorData.code === 'USAGE_LIMIT_EXCEEDED') {
```

**`use-limits.ts`:** add `billing?: UsageBilling | null` and `planLimit?: PlanLimitRefusal | null` to `UsageSummary`, imported from `@/api-types`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/billing/gates.test.ts worker/services/billing/credit-notices.test.ts worker/services/billing/usage.test.ts worker/api/responses-plan-limit.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- worker/agents/core/websocket.test.ts worker/agents/think/model-wiring.test.ts worker/api/controllers/agent/plan-checks-guard.test.ts worker/api/controllers/limits/plan-wiring.test.ts`
Expected: PASS, the existing `set_model` tests included.

Run: `rtk proxy bun run test -- src/components/billing/upgrade-copy.test.ts src/components/billing/plan-limit-guard.test.ts worker/services/rate-limit/rateLimits.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add worker/services/billing/gates.ts worker/services/billing/gates.test.ts worker/services/billing/credit-notices.ts worker/services/billing/credit-notices.test.ts worker/services/billing/usage.ts worker/services/billing/usage.test.ts worker/api/responses.ts worker/api/responses-plan-limit.test.ts worker/api/controllers/baseController.ts worker/api/websocketTypes.ts worker/agents/core/websocket.ts worker/agents/core/websocket.test.ts worker/agents/think/ThinkAgent.ts worker/agents/think/model-wiring.test.ts worker/api/controllers/agent/controller.ts worker/api/controllers/agent/plan-checks-guard.test.ts worker/api/controllers/limits/controller.ts worker/services/rate-limit/usageChecker.ts shared/types/plan.ts shared/types/billing.ts src/lib/plan-limit-events.ts src/components/billing src/App.tsx src/lib/api-client.ts src/hooks/use-limits.ts src/utils/usage-limit-checker.tsx src/components/usage-limits-badge.tsx src/routes/chat/utils/handle-websocket-message.ts
git commit -m "feat(billing): check ai credits by plan before every turn and new store, warn at 80 and 100 percent, and one upgrade dialog for every limit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: New stores, live stores, own domains and the catalog

**Files:**
- Modify:
  - worker: `worker/services/billing/gates.ts`, `worker/api/controllers/agent/controller.ts`, `worker/database/services/LiveStoreService.ts`, `worker/api/controllers/liveStores/controller.ts`, `worker/agents/think/catalog-tools.ts`, `worker/agents/think/ThinkAgent.ts`;
  - shared: `shared/types/live-stores.ts`;
  - space: `space/src/space/store-manifest.ts`, `space/src/space/deploy-engine.ts`, `space/src/space/drafts-store.ts`, `space/src/space/durable-object.ts`, `space/src/index.ts`.
- Test:
  - worker: `worker/services/billing/gates.test.ts`, `worker/database/services/live-stores.sql.test.ts`, `worker/api/controllers/liveStores/controller.sql.test.ts`, `worker/agents/think/catalog-tools.test.ts`, `worker/api/controllers/agent/plan-checks-guard.test.ts`, `worker/api/controllers/liveStores/catalog-mirror.test.ts`;
  - space: `space/test/live-deployment.test.ts`, `space/test/publish-catalog-wiring.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 3: `loadAccount`, `BillingAccount`;
  - from Task 1: `assertWithinLimit`;
  - from Task 8: `BaseController.createPlanLimitResponse`;
  - existing: `RateLimitService.enforce`, `RateLimitService.enforceAppCreationRateLimit`, `RateLimitType.APP_CREATION`.
- **Produces:**
  - `gates.ts`:
    - `withNewStoresPerDay(rateLimit: RateLimitSettings, perDay: number): RateLimitSettings`;
    - `reserveNewStore(env: Env, rateLimit: RateLimitSettings, account: BillingAccount, user: AuthUser, request: Request): Promise<PlanLimitRefusal | null>`. With billing off it throws `RateLimitExceededError` as today; with billing on it answers a refusal.
  - `LiveStoreService.liveStoreAppIdsOfUser(userId): Promise<string[]>` (live status only).
  - space:
    - `CATALOG_NEEDS_PLAN = "This version adds catalog products, which need Premium."`;
    - `catalogVariantIdsOf(manifest: string | null): string[]`;
    - `newCatalogVariants(sql: SqlStorage, branch: string): string[]`;
    - `PublishOptions { catalogFromLiveOnly?: boolean }`;
    - `SpaceDO.publishDraft(id?: string, options?: PublishOptions)`.
  - `shared/types/live-stores.ts`: `CATALOG_NEEDS_PLAN_ERROR`, the same string.
  - Catalog tools:
    - `CatalogToolDeps` gains `planNote(): Promise<string | null>`;
    - `CATALOG_PLAN_NOTE`;
    - `catalogToolDepsFromEnv(env, userId: string | null)`.

- [ ] **Step 1: Write the failing space tests.** Append to `space/test/live-deployment.test.ts`, importing `newCatalogVariants` from `../src/space/deploy-engine` and `catalogVariantIdsOf` from `../src/space/store-manifest`:

```ts
const manifest = (...catalogIds: string[]) =>
	JSON.stringify({ products: [{ id: 'mugs', name: 'Mugs', variants: [{ id: 'own', name: 'Own mug', priceCents: 1500 }, ...catalogIds.map((id, index) => ({ id: `cat-${index}`, name: 'Catalog mug', priceCents: 2500, catalogVariantId: id }))] }] });

describe('catalog products a publish would add', () => {
	it('reads every catalogVariantId in a manifest, and none from an unreadable one', () => {
		expect(catalogVariantIdsOf(manifest('cv_1', 'cv_2', 'cv_1'))).toEqual(['cv_1', 'cv_2']);
		for (const bad of [null, '', '{', '{"products":7}', '{"products":[{"variants":"x"}]}']) expect(catalogVariantIdsOf(bad)).toEqual([]);
	});

	it("lists the draft's catalog products that the live store doesn't sell yet", async () => {
		await runInDurableObject(uniqueStub('catalog'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			deployMain(sql, 'c1', manifest('cv_1'));
			expect(newCatalogVariants(sql, 'main')).toEqual(['cv_1']);
			publishLiveDeployment(sql, 10, 'main');
			expect(newCatalogVariants(sql, 'main')).toEqual([]);
			deployMain(sql, 'c2', manifest('cv_1', 'cv_9'));
			expect(newCatalogVariants(sql, 'main')).toEqual(['cv_9']);
			deployMain(sql, 'c3', manifest());
			expect(newCatalogVariants(sql, 'main')).toEqual([]);
		});
	});
});
```

`space/test/publish-catalog-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/space/src/space/durable-object.ts'], { query: '?raw', import: 'default', eager: true });

describe('publishing a draft on a plan without the catalog', () => {
	it('refuses new catalog products under the draft lock, before the live deployment moves', () => {
		const source = sources['/space/src/space/durable-object.ts'] ?? '';
		const publish = source.slice(source.indexOf('async publishDraft('), source.indexOf('async bringInLiveChanges('));
		const check = publish.indexOf('options.catalogFromLiveOnly && newCatalogVariants(sql, draft.branch).length > 0');
		expect(check).toBeGreaterThan(-1);
		expect(check).toBeLessThan(publish.indexOf('publishLiveDeployment('));
		expect(publish).toContain('return { error: CATALOG_NEEDS_PLAN }');
	});
});
```

- [ ] **Step 2: Write the failing worker tests.**

In `worker/services/billing/gates.test.ts`, add (importing `reserveNewStore`, `RateLimitExceededError` from `shared/types/errors`, and `type AuthUser`):

```ts
describe('reserving a new store', () => {
	const USER = { id: 'u1', email: 'ana@example.test' } as AuthUser;
	const request = new Request('https://estori.app/api/agent', { method: 'POST' });

	function counter(success: boolean) {
		const seen: Array<{ key: string; limit: number; dailyLimit?: number }> = [];
		const env = { DORateLimitStore: { getByName: () => ({ increment: async (key: string, config: { limit: number; dailyLimit?: number }) => { seen.push({ key, limit: config.limit, dailyLimit: config.dailyLimit }); return success ? { success } : { success, exceededLimit: 'daily', limitValue: config.limit }; } }) } } as unknown as Env;
		return { env, seen };
	}

	it("counts against the plan's number a day with billing on, and refuses with the plan's copy", async () => {
		const premium = account({ plan: 'premium', tier: 1, limits: { aiCredits: 20_000, aiCreditsWindow: 'period', newStoresPerDay: 25, liveStores: 10, ownDomainsPerLiveStore: 1, supplierCatalog: true, draftsPerStore: 5 } });
		const open = counter(true);
		expect(await reserveNewStore(open.env, DEFAULT_RATE_LIMIT_SETTINGS, premium, USER, request)).toBeNull();
		expect(open.seen).toEqual([{ key: 'platform:appCreation:user:u1', limit: 25, dailyLimit: 25 }]);
		expect(await reserveNewStore(counter(false).env, DEFAULT_RATE_LIMIT_SETTINGS, premium, USER, request)).toMatchObject({ limit: 'newStoresPerDay', message: "You've started 25 new stores today. Start more tomorrow, or talk to us about Enterprise." });
	});

	it("keeps today's counter and its 429 while billing is off", async () => {
		const closed = counter(false);
		await expect(reserveNewStore(closed.env, DEFAULT_RATE_LIMIT_SETTINGS, account({ billing: false }), USER, request)).rejects.toBeInstanceOf(RateLimitExceededError);
		expect(closed.seen).toEqual([{ key: 'platform:appCreation:user:u1', limit: 3, dailyLimit: 3 }]);
	});
});
```

In `worker/api/controllers/agent/plan-checks-guard.test.ts`, replace the `enforceAppCreationRateLimit(` ordering with:

```ts
		expect(credits).toBeLessThan(controller.indexOf('reserveNewStore('));
		expect(controller).not.toContain('enforceAppCreationRateLimit(');
```

In `worker/database/services/live-stores.sql.test.ts`, add:

```ts
	it("lists an owner's live stores, leaving out ones taken offline and other sellers' stores", async () => {
		await insertUser(db, 'seller_3');
		for (const id of ['app_live_a', 'app_live_b', 'app_offline']) await insertApp(db, { id, userId: 'seller_3' });
		const stores = new LiveStoreService(envWith(db));
		for (const id of ['app_live_a', 'app_live_b', 'app_offline']) await stores.publish({ appId: id, slug: id.replaceAll('_', '-'), commit: 'c1', now: NOW });
		await stores.publish({ appId: 'app_home', slug: 'lumen-home', commit: 'c1', now: NOW });
		await stores.setOffline('app_offline', NOW);
		expect((await stores.liveStoreAppIdsOfUser('seller_3')).sort()).toEqual(['app_live_a', 'app_live_b']);
	});
```

`worker/api/controllers/liveStores/catalog-mirror.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CATALOG_NEEDS_PLAN_ERROR } from '../../../../shared/types/live-stores';

const sources = import.meta.glob<string>(['/space/src/space/store-manifest.ts'], { query: '?raw', import: 'default', eager: true });

describe('the catalog refusal from SpaceDO', () => {
	it('is the same string on both sides, so the controller can answer it as plan_limit', () => {
		expect(sources['/space/src/space/store-manifest.ts']).toContain(JSON.stringify(CATALOG_NEEDS_PLAN_ERROR));
	});
});
```

Append to `worker/api/controllers/liveStores/controller.sql.test.ts`. Import `insertSubscription` and `CATALOG_NEEDS_PLAN_ERROR`:

```ts
describe('plan limits at publish', () => {
	beforeAll(async () => {
		for (const id of ['seller_basic', 'seller_premium']) await insertUser(db, id);
		for (const [id, owner] of [['app_b1', 'seller_basic'], ['app_b2', 'seller_basic'], ['app_p1', 'seller_premium'], ['app_p2', 'seller_premium']]) await insertApp(db, { id, userId: owner });
		for (const id of ['app_b1', 'app_p1']) {
			await db.prepare("INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES (?, ?, 'live', 'abc', 0, 0, 0)").bind(id, id.replace('_', '-')).run();
		}
		await insertSubscription(db, { userId: 'seller_premium', stripeSubscriptionId: 'sub_premium', status: 'active', currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000) });
	});

	/** SpaceDO recording each publish's options, refusing with `refusal` when given. */
	function recordingSpace(refusal?: string) {
		const options: unknown[] = [];
		const namespace = {
			idFromName: (name: string) => name,
			get: () => ({
				publishDraft: async (_draftId: string | undefined, opts: unknown) => {
					options.push(opts);
					return refusal ? { error: refusal } : { commitHash: 'c0ffee2', storeManifest: null, draftId: 'main', draftName: 'Main' };
				},
				getPublishContext: async () => ({ active: { id: 'main', name: 'Main', tip: 'c0ffee2' }, publishedDraft: null }),
				getStoreManifest: async () => null,
			}),
		};
		return { namespace, options };
	}

	function publishFor(userId: string, appId: string, namespace: unknown, extra: Record<string, unknown> = { BILLING: 'on' }) {
		const env = envWith(db, { STORES_DOMAIN: 'stores.example', CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod', JWT_SECRET: 'live-store-controller-test-secret-0123', SPACE_DO: namespace, VibecoderStore: { get: async () => null }, ...extra });
		const request = new Request(`https://estori.app/api/stores/${appId}/live/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: appId.replace('_', '-') }) });
		return LiveStoreController.publish(request, env, {} as ExecutionContext, { user: { id: userId, email: `${userId}@example.test` }, pathParams: { id: appId } } as unknown as RouteContext);
	}

	it("refuses Basic a second live store before publishing anything, but always republishes a live one", async () => {
		const refused = recordingSpace();
		const response = await publishFor('seller_basic', 'app_b2', refused.namespace);
		expect(response.status).toBe(402);
		expect((await response.json()).error.planLimit).toMatchObject({ limit: 'liveStores', plan: 'basic', message: 'Basic includes 1 live store. Get Premium for up to 10.' });
		expect(refused.options).toEqual([]);
		const republish = recordingSpace();
		expect((await publishFor('seller_basic', 'app_b1', republish.namespace)).status).toBe(200);
		expect(republish.options).toEqual([{ catalogFromLiveOnly: true }]);
	});

	it('lets Premium publish more stores, with any catalog product', async () => {
		const space = recordingSpace();
		expect((await publishFor('seller_premium', 'app_p2', space.namespace)).status).toBe(200);
		expect(space.options).toEqual([{ catalogFromLiveOnly: false }]);
	});

	it("answers SpaceDO's catalog refusal as plan_limit, saving nothing", async () => {
		const space = recordingSpace(CATALOG_NEEDS_PLAN_ERROR);
		const response = await publishFor('seller_basic', 'app_b1', space.namespace);
		expect(response.status).toBe(402);
		expect((await response.json()).error.planLimit).toMatchObject({ limit: 'supplierCatalog', message: 'Adding catalog products to your store comes with Premium. Products already live keep selling.' });
		expect(await db.prepare("SELECT published_commit FROM live_stores WHERE app_id = 'app_b1'").first()).toEqual({ published_commit: 'abc' });
	});

	it('enforces nothing new while billing is off', async () => {
		const space = recordingSpace();
		expect((await publishFor('seller_basic', 'app_b2', space.namespace, {})).status).toBe(200);
		expect(space.options).toEqual([{ catalogFromLiveOnly: false }]);
	});

	it('keeps own domains for Premium', async () => {
		const env = envWith(db, { BILLING: 'on', VibecoderStore: { get: async () => null }, STORES_DOMAIN: 'stores.example', CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod' });
		const add = (userId: string, appId: string) =>
			LiveStoreController.addDomain(new Request(`https://estori.app/api/stores/${appId}/live/domain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostname: 'shop.example.com' }) }), env, {} as ExecutionContext, { user: { id: userId, email: `${userId}@example.test` }, pathParams: { id: appId } } as unknown as RouteContext);
		const basic = await add('seller_basic', 'app_b1');
		expect(basic.status).toBe(402);
		expect((await basic.json()).error.planLimit).toMatchObject({ limit: 'ownDomainsPerLiveStore', message: 'Own domains come with Premium.' });
		expect((await add('seller_premium', 'app_p1')).status).not.toBe(402);
	});
});
```

Each test's writes roll back after it, so `app_b1` keeps the `abc` commit from `beforeAll`. A refused publish writes nothing.

In `worker/agents/think/catalog-tools.test.ts`:
- give the existing `tools` a `planNote: async () => null`;
- import `CATALOG_PLAN_NOTE`;
- add:

```ts
	it("tells the AI in plain words when the seller's plan doesn't include the catalog", async () => {
		const limited = createCatalogTools({ search: async () => [PRODUCT], get: async () => PRODUCT, planNote: async () => CATALOG_PLAN_NOTE });
		expect(JSON.parse(await run(limited.search_catalog, {})).note).toBe(CATALOG_PLAN_NOTE);
		expect(JSON.parse(await run(limited.get_catalog_product, { productId: 'cp_1' })).note).toBe(CATALOG_PLAN_NOTE);
		expect(JSON.parse(await run(tools.search_catalog, {})).note).toBeUndefined();
		expect(CATALOG_PLAN_NOTE).toContain('comes with Premium');
	});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `rtk proxy bun run test -- space/test/live-deployment.test.ts space/test/publish-catalog-wiring.test.ts`
Expected: FAIL, missing exports and no catalog check.

Run: `rtk proxy bun run test -- worker/services/billing/gates.test.ts worker/database/services/live-stores.sql.test.ts worker/api/controllers/liveStores/controller.sql.test.ts worker/api/controllers/liveStores/catalog-mirror.test.ts`
Expected: FAIL.

Run: `rtk proxy bun run test -- worker/agents/think/catalog-tools.test.ts worker/api/controllers/agent/plan-checks-guard.test.ts`
Expected: FAIL.

- [ ] **Step 4: SpaceDO.**

**`store-manifest.ts`:**

```ts
/** The publish refusal for catalog products a plan doesn't include. Mirrored as CATALOG_NEEDS_PLAN_ERROR in shared/types/live-stores.ts. */
export const CATALOG_NEEDS_PLAN = "This version adds catalog products, which need Premium."

/** Every catalogVariantId in a raw manifest, once each; an unreadable manifest has none. Validation happens in the worker. */
export function catalogVariantIdsOf(manifest: string | null): string[] {
  if (!manifest) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(manifest)
  } catch {
    return []
  }
  const products = typeof parsed === "object" && parsed !== null ? (parsed as { products?: unknown }).products : undefined
  if (!Array.isArray(products)) return []
  const ids = new Set<string>()
  for (const product of products) {
    const variants = typeof product === "object" && product !== null ? (product as { variants?: unknown }).variants : undefined
    if (!Array.isArray(variants)) continue
    for (const variant of variants) {
      const id = typeof variant === "object" && variant !== null ? (variant as { catalogVariantId?: unknown }).catalogVariantId : undefined
      if (typeof id === "string" && id.length > 0) ids.add(id)
    }
  }
  return [...ids]
}
```

**`deploy-engine.ts`:** `newCatalogVariants(sql, branch)` reads `store_manifest` for the branch and for `LIVE_BRANCH`, and answers the branch's ids that the live set lacks.

**`drafts-store.ts`:** add `export interface PublishOptions { catalogFromLiveOnly?: boolean }`. Export the type from `space/src/index.ts` next to `PublishDraftResult`.

**`durable-object.ts`:** in `publishDraft(id?: string, options: PublishOptions = {})`, right after the deploy-if-stale block and before `publishLiveDeployment(sql, ...)`:

```ts
      // On a plan without the catalog, only catalog products the live store already sells may go live again.
      if (options.catalogFromLiveOnly && newCatalogVariants(sql, draft.branch).length > 0) return { error: CATALOG_NEEDS_PLAN }
```

- [ ] **Step 5: The worker checks.**

**`shared/types/live-stores.ts`:** add `export const CATALOG_NEEDS_PLAN_ERROR = 'This version adds catalog products, which need Premium.';` with the mirror comment.

**`LiveStoreService.liveStoreAppIdsOfUser(userId)`:** selects `live_stores.app_id` joined to `apps` on `apps.user_id = userId`, where `status = 'live'`.

**`gates.ts`:**

```ts
/** The app-creation settings with the plan's number a day as both the window's limit and the daily limit. */
export function withNewStoresPerDay(rateLimit: RateLimitSettings, perDay: number): RateLimitSettings {
	const appCreation = rateLimit.appCreation;
	return {
		...rateLimit,
		appCreation: appCreation.store === RateLimitStore.DURABLE_OBJECT ? { ...appCreation, limit: perDay, dailyLimit: perDay } : { ...appCreation, limit: perDay },
	};
}
```

**`reserveNewStore`:**
- **Billing off:** `await RateLimitService.enforceAppCreationRateLimit(env, rateLimit, user, request)` and return null. It throws as today.
- **Billing on:**
  1. `key = RateLimitService.buildRateLimitKey(RateLimitType.APP_CREATION, await RateLimitService.getUserIdentifier(user))`.
  2. `result = await RateLimitService.enforce(env, key, withNewStoresPerDay(rateLimit, account.limits.newStoresPerDay), RateLimitType.APP_CREATION)`. The check and the increment happen together, so two starts can't both take the last slot.
  3. Answer `result.success ? null : assertWithinLimit(account, 'newStoresPerDay', account.limits.newStoresPerDay)`.
- Skip all of it when `rateLimit.appCreation.enabled` is false.

**`agent/controller.ts`:** replace the call in the `enforceAppCreationRateLimit` try block. Keep its catch, which still answers 429 with billing off.

```ts
            try {
                const refused = await reserveNewStore(env, context.config.security.rateLimit, account, user, request);
                if (refused) return CodingAgentController.createPlanLimitResponse(refused);
            } catch (error) {
```

**`liveStores/controller.ts`:**
- Extend `LiveSpaceStub.publishDraft(id?: string, options?: PublishOptions)`.
- In `publish`, after the slug-holder check and before the leftover-merge cleanup:

```ts
            // Plan limits apply to stores going live, never to stores already live: republishing always works.
            const account = context.user ? await loadAccount(env, context.user.id) : null;
            if (account?.billing && (await stores.getByApp(appId))?.status !== 'live') {
                const refusal = assertWithinLimit(account, 'liveStores', (await stores.liveStoreAppIdsOfUser(account.userId)).length);
                if (refusal) return this.createPlanLimitResponse<LiveStoreView>(refusal);
            }
```

- Call `space.publishDraft(draftId, { catalogFromLiveOnly: account?.billing === true && !account.limits.supplierCatalog })`.
- When `published.error === CATALOG_NEEDS_PLAN_ERROR` and `account`, answer `this.createPlanLimitResponse<LiveStoreView>(refusal)` with `refusal = assertWithinLimit(account, 'supplierCatalog')`. When that is null, fall through to `draftErrorStatus`.
- In `addDomain`, before `addStoreDomain`: load the account the same way, and answer `createPlanLimitResponse` when `assertWithinLimit(account, 'ownDomainsPerLiveStore', 0)` refuses.
- `removeDomain` and `checkDomain` stay open on every plan: a domain kept after a downgrade must stay manageable.

**`catalog-tools.ts`:**

```ts
/** For an account whose plan doesn't include the catalog: the AI tells the seller, and doesn't add catalog products. */
export const CATALOG_PLAN_NOTE =
	"This seller's plan doesn't include the supplier catalog. Tell them in plain words that adding catalog products to a store comes with Premium, and that catalog products already live keep selling. Don't add new catalog products to estori-store.json unless they get Premium.";
```

- Both tools read `deps.planNote()` alongside their lookup. They answer `{ note, products }` or `{ note, product }` when it isn't null, and the old shape otherwise.
- `catalogToolDepsFromEnv(env, userId)` gains `planNote: async () => (userId && assertWithinLimit(await loadAccount(env, userId), 'supplierCatalog') ? CATALOG_PLAN_NOTE : null)`.
- In `ThinkAgent.getTools()`, pass `this.getConfig<ThinkAgentConfig>()?.userId ?? null`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- space/test/live-deployment.test.ts space/test/publish-catalog-wiring.test.ts space/test/drafts-wiring.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- worker/services/billing/gates.test.ts worker/database/services/live-stores.sql.test.ts worker/api/controllers/liveStores/controller.sql.test.ts worker/api/controllers/liveStores/catalog-mirror.test.ts`
Expected: PASS. The old publish tests are unchanged: they pass no user, so no plan applies.

Run: `rtk proxy bun run test -- worker/agents/think/catalog-tools.test.ts worker/api/controllers/agent/plan-checks-guard.test.ts worker/api/controllers/liveStores/live-store-routes-wiring.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add space/src/space/store-manifest.ts space/src/space/deploy-engine.ts space/src/space/drafts-store.ts space/src/space/durable-object.ts space/src/index.ts space/test/live-deployment.test.ts space/test/publish-catalog-wiring.test.ts shared/types/live-stores.ts worker/services/billing/gates.ts worker/services/billing/gates.test.ts worker/api/controllers/agent/controller.ts worker/api/controllers/agent/plan-checks-guard.test.ts worker/database/services/LiveStoreService.ts worker/database/services/live-stores.sql.test.ts worker/api/controllers/liveStores/controller.ts worker/api/controllers/liveStores/controller.sql.test.ts worker/api/controllers/liveStores/catalog-mirror.test.ts worker/agents/think/catalog-tools.ts worker/agents/think/catalog-tools.test.ts worker/agents/think/ThinkAgent.ts
git commit -m "feat(billing): plan limits on new stores, stores going live, own domains and new catalog products, never on stores already live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: The billing page, Premium on the pricing page, and the banners

**Files:**
- Create:
  - `src/hooks/use-billing.ts`;
  - `src/components/billing/billing-copy.ts`;
  - `src/components/billing/BillingBanner.tsx`;
  - `src/components/pricing/premium-action.ts`;
  - `src/components/pricing/PremiumCheckoutButton.tsx`;
  - `src/routes/settings/billing.tsx`.
- Modify:
  - routes and layout: `src/routes.tsx`, `src/routes/settings/index.tsx`, `src/components/layout/app-layout.tsx`;
  - pricing: `src/components/pricing/PlanCards.tsx`, `src/routes/pricing.tsx`, `src/content/positioning.ts`.
- Test:
  - `src/components/billing/billing-copy.test.ts`;
  - `src/components/pricing/premium-action.test.ts`;
  - `src/routes/settings/billing-guard.test.ts`;
  - `src/routes/pricing-guard.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 6: `BillingView`, `apiClient.getBilling`, `startPremiumCheckout`, `changePremiumTier`, `cancelPremium`, `resumePremium`, `openBillingPortal`, `queryKeys.billing`;
  - from Task 8: `PublicPlan.billing`;
  - from Task 1: `PREMIUM_TIERS`, `premiumTier`, `formatBillingDate`, `formatUsd`.
- **Produces:**
  - `use-billing.ts`: `useBilling(enabled?: boolean)`, `useBillingOpen(): boolean`.
  - `billing-copy.ts`:
    - copy: `planHeadline(view)`, `planStatusLines(view): string[]`, `creditsLine(view)`, `grantedLine(view): string | null`;
    - tier buttons: `TierAction { kind: 'checkout' | 'change' | 'keep'; label: string; disabled: boolean; reason: string | null }`, `tierAction(view, tier): TierAction | null`;
    - waiting for a change: `PendingChange = { kind: 'checkout' } | { kind: 'tier'; tier: PremiumTierNumber } | { kind: 'cancel' } | { kind: 'resume' }`, `changeLanded(change, view): boolean`, `ConfirmState = 'idle' | 'waiting' | 'landed' | 'slow'`, `confirmState(input: { change: PendingChange | null; startedAtMs: number; nowMs: number; view: BillingView | undefined }): ConfirmState`, `CONFIRM_POLL_MS = 2_000`, `CONFIRM_TIMEOUT_MS = 30_000`, `confirmCopy(change, state): string | null`;
    - the banner: `billingBanner(view: BillingView | undefined): { text: string; action: { label: string; to: string } } | null`.
  - `premium-action.ts`: `premiumAction(input: { billingOpen: boolean; signedIn: boolean }): 'contact' | 'signup' | 'checkout'`, `tierFromParam(value: string | null): PremiumTierNumber`.
  - `positioning.ts`: `PRICING_FAQ_BILLING`, the FAQ once Premium is on sale.

- [ ] **Step 1: Write the failing tests.** `src/components/billing/billing-copy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BillingView } from '@/api-types';
import { billingBanner, changeLanded, confirmCopy, confirmState, creditsLine, grantedLine, planHeadline, planStatusLines, tierAction } from './billing-copy';

const NOV_5 = Date.UTC(2026, 10, 5, 10);

function view(overrides: Partial<BillingView> = {}): BillingView {
	return {
		enabled: true,
		plan: 'premium',
		tier: 2,
		source: 'subscription',
		status: 'active',
		periodStart: Date.UTC(2026, 9, 5, 10),
		periodEnd: NOV_5,
		cancelAtPeriodEnd: false,
		pendingTier: null,
		pendingTierAt: null,
		graceEndsAt: null,
		paymentFailing: false,
		credits: { used: 41_000, limit: 50_000, granted: 0, window: 'period', resetsAt: NOV_5 },
		limits: { aiCredits: 50_000, aiCreditsWindow: 'period', newStoresPerDay: 25, liveStores: 10, ownDomainsPerLiveStore: 1, supplierCatalog: true, draftsPerStore: 5 },
		canManageBilling: true,
		...overrides,
	};
}

const BASIC = view({ plan: 'basic', tier: null, source: 'free', status: null, credits: { used: 120, limit: 200, granted: 0, window: 'day', resetsAt: Date.UTC(2026, 9, 20) }, canManageBilling: false });

describe('the billing page copy', () => {
	it('names the plan and its state', () => {
		expect(planHeadline(view())).toBe('Premium, 50,000 AI credits a month');
		expect(planHeadline(BASIC)).toBe('Basic, free');
		expect(planStatusLines(view())).toEqual(['Renews on November 5 at $199 a month.']);
		expect(planStatusLines(view({ cancelAtPeriodEnd: true }))).toEqual(['Premium until November 5.']);
		expect(planStatusLines(view({ pendingTier: 1, pendingTierAt: NOV_5 }))).toEqual(['Renews on November 5 at $199 a month.', 'Moves to 20,000 AI credits a month on November 5.']);
		expect(planStatusLines(view({ status: 'past_due', paymentFailing: true, graceEndsAt: Date.UTC(2026, 9, 12, 10) }))).toEqual(["Your last payment didn't go through. Premium continues until October 12. Update your card to keep it."]);
		expect(planStatusLines(view({ plan: 'basic', tier: null, source: 'free', status: 'past_due', paymentFailing: true }))).toEqual(["Your last payment didn't go through, so your account is on Basic. Update your card to restore Premium."]);
		expect(planStatusLines(view({ plan: 'enterprise', tier: null, source: 'override' }))).toEqual(['Your plan is set by Estori.']);
	});

	it('counts credits for the day or the month, and names credits added by Estori', () => {
		expect(creditsLine(view())).toBe('41,000 of 50,000 AI credits used this month. They refill on November 5.');
		expect(creditsLine(BASIC)).toBe('120 of 200 AI credits used today. They reset at midnight UTC.');
		expect(grantedLine(view())).toBeNull();
		expect(grantedLine(view({ credits: { used: 0, limit: 55_000, granted: 5_000, window: 'period', resetsAt: NOV_5 } }))).toBe('Includes 5,000 added by Estori.');
	});

	it('offers each pool the action it can take, one change at a time', () => {
		expect(tierAction(BASIC, 1)).toEqual({ kind: 'checkout', label: 'Get Premium', disabled: false, reason: null });
		expect(tierAction(view(), 2)).toBeNull();
		expect(tierAction(view(), 3)).toEqual({ kind: 'change', label: 'Move up now', disabled: false, reason: null });
		expect(tierAction(view(), 1)).toEqual({ kind: 'change', label: 'Move down at renewal', disabled: false, reason: null });
		expect(tierAction(view({ pendingTier: 1, pendingTierAt: NOV_5 }), 2)).toEqual({ kind: 'keep', label: 'Keep 50,000 credits', disabled: false, reason: null });
		expect(tierAction(view({ pendingTier: 1, pendingTierAt: NOV_5 }), 4)).toMatchObject({ disabled: true, reason: 'Keep your current pool first.' });
		expect(tierAction(view({ paymentFailing: true, status: 'past_due' }), 4)).toMatchObject({ disabled: true, reason: 'Update your card first.' });
		expect(tierAction(view({ cancelAtPeriodEnd: true }), 4)).toMatchObject({ disabled: true, reason: 'Keep Premium first.' });
		expect(tierAction(view({ plan: 'basic', tier: null, source: 'free', status: 'past_due', paymentFailing: true }), 1)).toMatchObject({ kind: 'checkout', disabled: true, reason: 'Update your card in Manage billing to restore Premium.' });
		expect(tierAction(view({ plan: 'enterprise', tier: null, source: 'override' }), 1)).toBeNull();
	});

	it('waits for Stripe to confirm, every 2 seconds for up to 30', () => {
		const start = 1_000_000;
		expect(confirmState({ change: null, startedAtMs: start, nowMs: start, view: BASIC })).toBe('idle');
		expect(confirmState({ change: { kind: 'checkout' }, startedAtMs: start, nowMs: start + 4_000, view: BASIC })).toBe('waiting');
		expect(confirmState({ change: { kind: 'checkout' }, startedAtMs: start, nowMs: start + 30_000, view: BASIC })).toBe('slow');
		expect(confirmState({ change: { kind: 'checkout' }, startedAtMs: start, nowMs: start + 6_000, view: view() })).toBe('landed');
		expect(confirmCopy({ kind: 'checkout' }, 'waiting')).toBe('Confirming your payment…');
		expect(confirmCopy({ kind: 'checkout' }, 'slow')).toBe('Your payment is being confirmed. Refresh in a minute.');
		expect(confirmCopy({ kind: 'cancel' }, 'waiting')).toBe('Saving your change…');
		expect(confirmCopy({ kind: 'cancel' }, 'landed')).toBeNull();
	});

	it("knows when each change has landed in Stripe's state", () => {
		expect(changeLanded({ kind: 'tier', tier: 3 }, view({ tier: 3 }))).toBe(true);
		expect(changeLanded({ kind: 'tier', tier: 1 }, view({ pendingTier: 1 }))).toBe(true);
		expect(changeLanded({ kind: 'tier', tier: 2 }, view())).toBe(true);
		expect(changeLanded({ kind: 'tier', tier: 2 }, view({ pendingTier: 1 }))).toBe(false);
		expect(changeLanded({ kind: 'cancel' }, view({ cancelAtPeriodEnd: true }))).toBe(true);
		expect(changeLanded({ kind: 'resume' }, view({ cancelAtPeriodEnd: true }))).toBe(false);
	});

	it('shows a banner for a failing payment and for a pool past 80%, on every page', () => {
		expect(billingBanner(view({ paymentFailing: true, status: 'past_due', graceEndsAt: Date.UTC(2026, 9, 12, 10) }))).toEqual({ text: "Your Premium payment didn't go through. Update your card by October 12 to keep Premium.", action: { label: 'Update card', to: '/settings/billing' } });
		expect(billingBanner(view())).toEqual({ text: "You've used 82% of this month's AI credits.", action: { label: 'See your pools', to: '/settings/billing' } });
		expect(billingBanner(view({ credits: { used: 50_000, limit: 50_000, granted: 0, window: 'period', resetsAt: NOV_5 } }))?.text).toBe("You've used this month's AI credits.");
		expect(billingBanner(BASIC)).toBeNull();
		expect(billingBanner(view({ enabled: false }))).toBeNull();
		expect(billingBanner(undefined)).toBeNull();
	});
});
```

`src/components/pricing/premium-action.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { premiumAction, tierFromParam } from './premium-action';

describe("Premium's button on the pricing page", () => {
	it('leads to sales until billing opens, then to sign-up or checkout', () => {
		expect(premiumAction({ billingOpen: false, signedIn: true })).toBe('contact');
		expect(premiumAction({ billingOpen: true, signedIn: false })).toBe('signup');
		expect(premiumAction({ billingOpen: true, signedIn: true })).toBe('checkout');
	});

	it('comes back from sign-up with the pool the visitor picked', () => {
		expect(tierFromParam('3')).toBe(3);
		for (const bad of [null, '', '0', '5', 'x']) expect(tierFromParam(bad)).toBe(1);
	});
});
```

`src/routes/settings/billing-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/routes.tsx', '/src/routes/settings/billing.tsx', '/src/routes/settings/index.tsx', '/src/components/layout/app-layout.tsx', '/src/components/pricing/PremiumCheckoutButton.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the billing page', () => {
	it('is a signed-in page under settings', () => {
		const routes = source('/src/routes.tsx');
		const start = routes.indexOf("path: 'settings/billing'");
		expect(start).toBeGreaterThan(-1);
		expect(routes.slice(start, start + 200)).toContain('<ProtectedRoute>');
	});

	it('waits for Stripe after every change, and sends card and invoice work to Stripe', () => {
		const page = source('/src/routes/settings/billing.tsx');
		for (const piece of ['confirmState(', 'CONFIRM_POLL_MS', 'tierAction(', 'apiClient.openBillingPortal(', 'apiClient.cancelPremium(', 'apiClient.resumePremium(', 'apiClient.changePremiumTier(', "searchParams.get('checkout') === 'success'"]) {
			expect(page, piece).toContain(piece);
		}
	});

	it('is linked from settings only while billing is on for the account, and its banner shows on every app page', () => {
		const settings = source('/src/routes/settings/index.tsx');
		expect(settings).toContain('billing.data?.enabled');
		expect(settings).toContain('BILLING_PATH');
		expect(source('/src/components/layout/app-layout.tsx')).toContain('<BillingBanner />');
	});

	it('starts checkout from the server, sending signed-out visitors through sign-up and back', () => {
		const button = source('/src/components/pricing/PremiumCheckoutButton.tsx');
		expect(button).toContain('apiClient.startPremiumCheckout(tier)');
		expect(button).toContain('setIntendedUrl(`/pricing?tier=${tier}`)');
		expect(button).toContain('window.location.assign(');
		expect(button).not.toMatch(/priceCents|price_/);
	});
});
```

In `src/routes/pricing-guard.test.ts`:
- replace `"doesn't sell Premium before subscriptions exist"` with:

```ts
	it("sells Premium only once billing is open: before that it leads to sales, marked coming soon", () => {
		const cards = source(CARDS);
		expect(cards).toContain('premiumAction({ billingOpen, signedIn: isAuthenticated })');
		expect(cards).toContain("contactPath('premium', tier.credits)");
		expect(cards).toContain('{!billingOpen && <ComingSoon />}');
		expect(cards).toContain('Paid plans are coming soon');
		expect(cards).toContain('<PremiumCheckoutButton');
	});
```

- change the order list's last entry to `'<PublicFaq leading={billingOpen ? PRICING_FAQ_BILLING : PRICING_FAQ} />'`;
- add `'Can I change my Premium credits?'` and `'Is Premium available now?'` checks on `PRICING_FAQ_BILLING` in the credit-questions test, reading it from `positioning.ts`.

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- src/components/billing/billing-copy.test.ts src/components/pricing/premium-action.test.ts src/routes/settings/billing-guard.test.ts src/routes/pricing-guard.test.ts`
Expected: FAIL, missing modules and failed guards.

- [ ] **Step 3: Implement `billing-copy.ts` and `premium-action.ts`.** The copy is exactly what the tests pin.
- **`planHeadline`:** "Basic, free"; "Premium, {credits} AI credits a month"; "Enterprise".
- **`planStatusLines`,** in this order:
  - the override line, alone;
  - the failing-payment line, alone: the Premium-in-grace form uses `graceEndsAt`, the Basic form is used when `plan === 'basic'`;
  - "Premium until {periodEnd}." when cancelling;
  - otherwise "Renews on {periodEnd} at {price} a month." for a subscription;
  - "Moves to {credits} AI credits a month on {pendingTierAt}." when a downgrade is pending.
- **`tierAction`:**
  - null for an override or Enterprise;
  - checkout for Basic, disabled with "Update your card in Manage billing to restore Premium." when `status` is `past_due` or `unpaid`;
  - for a subscriber, null on the current pool unless a downgrade is pending, which offers "Keep {credits} credits";
  - otherwise disabled with the first reason that applies: "Update your card first." when the payment is failing, "Keep Premium first." when cancelling, "Keep your current pool first." when a change is pending;
  - else "Move up now" or "Move down at renewal".
- **`changeLanded`:**
  - checkout: `source === 'subscription'` and `status` is `active` or `trialing`;
  - tier: `view.tier === tier && view.pendingTier === null`, or `view.pendingTier === tier`;
  - cancel: `cancelAtPeriodEnd`; resume: `!cancelAtPeriodEnd`.
- **`confirmState`:** idle with no change; landed when `changeLanded`; slow from 30 seconds; else waiting.
- **`confirmCopy`:**
  - checkout: "Confirming your payment…" when waiting, "Your payment is being confirmed. Refresh in a minute." when slow;
  - other changes: "Saving your change…" when waiting, "Your change is being confirmed. Refresh in a minute." when slow;
  - null when idle or landed.
- **`billingBanner`:**
  - only when `view?.enabled`;
  - the failing payment first. When `graceEndsAt` is set it says "Update your card by {date} to keep Premium."; on Basic, "Your Premium payment didn't go through. Update your card to restore Premium.";
  - then a monthly pool at 80% or more, with the percent rounded down. At 100% it's "You've used this month's AI credits.";
  - every action is "See your pools" or "Update card" to `BILLING_PATH`.
- **`premiumAction`:** contact while billing is closed, else signup or checkout.
- **`tierFromParam`:** parses an integer with `isPremiumTierNumber`, defaulting to 1.

- [ ] **Step 4: The hooks, page and banner.**

**`use-billing.ts`:**

```ts
export function useBilling(enabled = true) {
	return useQuery({ queryKey: queryKeys.billing(), queryFn: () => unwrap(apiClient.getBilling(), "Couldn't load your plan"), enabled, staleTime: 30_000 });
}

/** Whether Premium is on sale to this visitor: on for everyone, or for this signed-in account. */
export function useBillingOpen(): boolean {
	const { isAuthenticated } = useAuth();
	const plan = usePublicPlan();
	const billing = useBilling(isAuthenticated);
	return Boolean(plan.data?.billing || billing.data?.enabled);
}
```

**`src/routes/settings/billing.tsx`** (default export `BillingPage`). It follows the settings page's look: Kumo `LayerCard`, `Button`, a `Dialog` for the cancel confirmation. Its sections, in order:
1. **Your plan:**
   - `planHeadline`, then each `planStatusLines` entry;
   - "Keep Premium" (`resumePremium`) when cancelling;
   - "Manage billing" when `canManageBilling`. It calls `openBillingPortal` and does `window.location.assign(url)`;
   - "Cancel Premium" for a live subscription that isn't cancelling. It confirms with "Premium stays on until {periodEnd}, then your account moves to Basic. Your stores stay live." and the buttons "Cancel Premium" and "Keep Premium".
2. **AI credits:** `creditsLine`, a progress bar at `used / limit`, and `grantedLine` when set.
3. **Credit pools:**
   - one row per `PREMIUM_TIERS` entry: credits a month, `formatUsd(priceCents)` a month, "Your pool" on the current one;
   - the `tierAction` button, with `reason` under a disabled one. Checkout calls `startPremiumCheckout` and assigns the url; change and keep call `changePremiumTier(tier)`;
   - not shown for an override, which just shows the status line.
- **Waiting for a change.** Each successful mutation sets a `PendingChange` and its start time, and refetches `useBilling` every `CONFIRM_POLL_MS` until `confirmState` is `'landed'` or `'slow'`. `confirmCopy` shows above the sections.
- **Back from checkout.** On load, `searchParams.get('checkout') === 'success'` starts a `{ kind: 'checkout' }` wait. `'cancelled'` shows "Checkout was cancelled. Nothing was charged."
- **Errors** from mutations show their message with `toast.error`. A `PlanLimitError` never reaches here.
- **Billing off** (`enabled: false`): the page says "Premium isn't open for your account yet." and shows the credits section only.

**`BillingBanner.tsx`:**
- reads `useBilling(isAuthenticated)`;
- renders `billingBanner(data)` as a thin amber bar, with the text and a link button;
- renders nothing when it's null.
- Mount it in `app-layout.tsx` right after `<GlobalHeader />`.

**`routes.tsx`:** add `{ path: 'settings/billing', element: (<ProtectedRoute><BillingPage /></ProtectedRoute>) }` after `settings`.

**`settings/index.tsx`:** add a "Plan and billing" `LayerCard` at the top. It shows `planHeadline(billing.data)` and a `LinkButton` to `BILLING_PATH`, rendered only when `billing.data?.enabled`, with `const billing = useBilling()`.

- [ ] **Step 5: The pricing page.**

**`PremiumCheckoutButton.tsx`:**

```tsx
/** Get Premium once billing is open: signed-out visitors sign up and come back; signed-in sellers go to Stripe's checkout. */
export function PremiumCheckoutButton({ tier, signedIn, className }: { tier: PremiumTierNumber; signedIn: boolean; className?: string }) {
	const navigate = useNavigate();
	const { setIntendedUrl } = useAuth();
	const checkout = useMutation({
		mutationFn: () => unwrap(apiClient.startPremiumCheckout(tier), "Couldn't start checkout"),
		onSuccess: ({ url }) => window.location.assign(url),
		onError: (error) => {
			if (error instanceof ApiError && error.status === 409) navigate(BILLING_PATH);
			else toast.error(error.message);
		},
	});
	const start = () => {
		if (signedIn) return checkout.mutate();
		setIntendedUrl(`/pricing?tier=${tier}`);
		navigate('/signup');
	};
	return (
		<button type="button" onClick={start} disabled={checkout.isPending} className={pillClass('charcoal', className)}>
			Get Premium
		</button>
	);
}
```

**`PlanCards.tsx` `PremiumPlan`:**
- `const billingOpen = useBillingOpen();` and `const { isAuthenticated } = useAuth();`;
- the initial pool comes from `tierFromParam(searchParams.get('tier'))`;
- `const action = premiumAction({ billingOpen, signedIn: isAuthenticated });`;
- the heading shows `{!billingOpen && <ComingSoon />}`;
- while `action === 'contact'`, keep today's contact link and "Paid plans are coming soon" note; otherwise render `<PremiumCheckoutButton tier={tier.tier} signedIn={isAuthenticated} className="mt-6" />` and the note "Billed monthly by card. Cancel any time.";
- select the pool by tier number.

**`positioning.ts`:** add `PRICING_FAQ_BILLING`, a copy of `PRICING_FAQ` with these answers:
- "What happens when I run out of credits?": "On Basic, building and chatting pause until your allowance refills at midnight UTC. On Premium, move to a bigger pool any time, or wait for your next month. A change already running always finishes, and your stores keep working."
- "Can I change my Premium credits?": "Yes. A bigger pool starts right away, and you pay the difference for the rest of the month. A smaller pool starts at your next renewal."
- "Is Premium available now?": "Yes. Pick a pool and pay by card; Premium starts as soon as the payment goes through."
- "Do unused credits roll over?": "No. Basic's allowance refills every day, and Premium's pool refills every month."

**`pricing.tsx`:** `const billingOpen = useBillingOpen();` and `<PublicFaq leading={billingOpen ? PRICING_FAQ_BILLING : PRICING_FAQ} />`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- src/components/billing/billing-copy.test.ts src/components/pricing/premium-action.test.ts src/routes/settings/billing-guard.test.ts src/routes/pricing-guard.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- src/lib/plans.test.ts src/routes/calculator-guard.test.ts src/brand/brand-guard.test.ts`
Expected: PASS.

Run: `bun run typecheck && npx eslint src/routes/settings src/components/billing src/components/pricing src/hooks/use-billing.ts src/content/positioning.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-billing.ts src/components/billing src/components/pricing src/routes/settings src/routes.tsx src/routes/pricing.tsx src/routes/pricing-guard.test.ts src/content/positioning.ts src/components/layout/app-layout.tsx
git commit -m "feat(billing): the billing page with pools, cancel and keep premium, checkout from pricing, and payment and credit banners

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Admin endpoints: billing read, plan overrides, credit grants, the test link and the enforcement notice

**Files:**
- Create:
  - `worker/api/controllers/admin/billing.ts`;
  - `worker/services/billing/admin-view.ts`;
  - `worker/services/billing/enforcement-notice.ts`.
- Modify:
  - `worker/api/routes/billingRoutes.ts`;
  - `worker/database/services/PlanAdminService.ts` (`sellersAfter`, `linkTestCustomer`);
  - `shared/types/billing.ts`;
  - `src/api-types.ts`.
- Test:
  - `worker/api/controllers/admin/billing.test.ts`;
  - `worker/api/controllers/admin/billing.sql.test.ts`;
  - `worker/services/billing/enforcement-notice.test.ts`;
  - `worker/api/controllers/billing/billing-routes-wiring.test.ts`.

**Interfaces:**
- **Consumes:**
  - from Task 3: `loadAccount`, `creditBucketFor`, `creditsUsed`;
  - from Task 6: `billingView`;
  - from Task 2: `PlanAdminService.addOverride`, `addGrant`, `latestOverride`, `grantsOf`, `BillingService.customerOf`, `subscriptionOf`;
  - from Task 8: `CreditNoticeDeps`, `creditNoticeDepsFromEnv`;
  - from Task 5: `claimAndSendNotice`;
  - from Task 9: `LiveStoreService.liveStoreAppIdsOfUser`;
  - existing: `parseStoreManifest`, `stripeModeOf`, `UserService.findUser`.
- **Produces:**
  - `shared/types/billing.ts`:
    - `PlanOverrideView { plan: PlanId | null; tier: PremiumTierNumber | null; limits: PlanLimitOverrides; until: number | null; reason: string; adminUserId: string; createdAt: number }`;
    - `CreditGrantView { credits: number; reason: string; adminUserId: string; createdAt: number }`;
    - `AdminBillingView { view: BillingView; stripeCustomerUrl: string | null; stripeSubscriptionUrl: string | null; override: PlanOverrideView | null; grants: CreditGrantView[] }`;
    - `EnforcementNoticeResult { sent: number; skipped: number; next: string | null }`.
  - `admin-view.ts`:
    - `stripeDashboardUrl(mode: 'test' | 'live' | null, kind: 'customers' | 'subscriptions', id: string | null): string | null`;
    - `adminBillingView(input: { account: BillingAccount; used: number; customerId: string | null; override: PlanOverrideRecord | null; grants: CreditGrantRecord[]; mode: 'test' | 'live' | null }): AdminBillingView`.
  - `admin/billing.ts`:
    - `ParsedPlanOverride`;
    - `parsePlanOverrideRequest(body: unknown, nowMs: number): ParsedPlanOverride | null`;
    - `parseCreditGrantRequest(body: unknown): { credits: number; reason: string } | null`;
    - `parseEnforcementNoticeRequest(body: unknown): { startsOn: number; after: string | null; limit: number; dryRun: boolean } | null`;
    - `BillingAdminController` with `getBilling`, `setPlan`, `grantCredits`, `linkTestCustomer` and `sendEnforcementNotices`.
  - `PlanAdminService`:
    - `sellersAfter(after: string | null, limit: number): Promise<Array<{ userId: string; email: string }>>`;
    - `linkTestCustomer(input: { userId; stripeCustomerId; adminUserId; now }): Promise<void>`.
  - `enforcement-notice.ts`:
    - `EnforcementNoticeDeps extends CreditNoticeDeps { sellersAfter; liveStoreAppIds(userId): Promise<string[]>; liveManifest(appId): Promise<string | null>; noticeSent(userId, key): Promise<boolean>; aiCreditsPerDay: number }`;
    - `sendEnforcementNotices(deps, input: { startsOn: number; after: string | null; limit: number; dryRun: boolean }): Promise<EnforcementNoticeResult>`;
    - `enforcementNoticeDepsFromEnv(env): Promise<EnforcementNoticeDeps>`.
  - Routes, all `AuthConfig.admin`:
    - `GET /api/admin/users/:userId/billing` (optional `?at=<ms>`, which evaluates the plan at that time for test clocks);
    - `PUT /api/admin/users/:userId/plan`, `POST /api/admin/users/:userId/credits`;
    - `PUT /api/admin/users/:userId/billing/test-customer`;
    - `POST /api/admin/billing/enforcement-notices`.

- [ ] **Step 1: Write the failing tests.** `worker/api/controllers/admin/billing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCreditGrantRequest, parseEnforcementNoticeRequest, parsePlanOverrideRequest } from './billing';

const NOW = Date.parse('2026-10-19T15:00:00Z');

describe('admin billing requests', () => {
	it('reads a plan override with its reason, an optional end date and custom limits', () => {
		expect(parsePlanOverrideRequest({ plan: 'enterprise', limits: { aiCredits: 500_000, liveStores: 50 }, reason: '  Signed contract  ' }, NOW)).toEqual({ plan: 'enterprise', tier: null, limits: { aiCredits: 500_000, liveStores: 50 }, until: null, reason: 'Signed contract' });
		expect(parsePlanOverrideRequest({ plan: 'premium', tier: 3, until: '2026-11-19T00:00:00Z', reason: 'Partner comp' }, NOW)).toMatchObject({ plan: 'premium', tier: 3, until: new Date('2026-11-19T00:00:00Z') });
		expect(parsePlanOverrideRequest({ plan: null, reason: 'Contract ended' }, NOW)).toMatchObject({ plan: null });
	});

	it('refuses an unknown plan, a tier off Premium, a past end, a missing reason and unknown fields', () => {
		for (const body of [
			{ plan: 'gold', reason: 'x'.repeat(5) },
			{ plan: 'basic', tier: 2, reason: 'Fix state' },
			{ plan: 'premium', tier: 7, reason: 'Fix state' },
			{ plan: 'premium', until: '2026-10-01T00:00:00Z', reason: 'Too late' },
			{ plan: 'premium', reason: 'no' },
			{ plan: 'premium', reason: 'Fine reason', limits: { draftsPerStore: 9 } },
			{ plan: 'premium', reason: 'Fine reason', extra: true },
			null,
		]) {
			expect(parsePlanOverrideRequest(body, NOW)).toBeNull();
		}
	});

	it('reads a credit grant and an enforcement-notice batch', () => {
		expect(parseCreditGrantRequest({ credits: 5_000, reason: 'Launch partner' })).toEqual({ credits: 5_000, reason: 'Launch partner' });
		for (const body of [{ credits: 0, reason: 'Nope nope' }, { credits: 1.5, reason: 'Nope nope' }, { credits: 2_000_000, reason: 'Too many' }, { credits: 10 }]) expect(parseCreditGrantRequest(body)).toBeNull();
		expect(parseEnforcementNoticeRequest({ startsOn: '2026-11-01' })).toEqual({ startsOn: Date.UTC(2026, 10, 1), after: null, limit: 25, dryRun: false });
		expect(parseEnforcementNoticeRequest({ startsOn: '2026-11-01', after: 'u_9', limit: 50, dryRun: true })).toEqual({ startsOn: Date.UTC(2026, 10, 1), after: 'u_9', limit: 50, dryRun: true });
		for (const body of [{ startsOn: 'soon' }, { startsOn: '2026-11-01', limit: 51 }, {}]) expect(parseEnforcementNoticeRequest(body)).toBeNull();
	});
});
```

`worker/services/billing/enforcement-notice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sendEnforcementNotices, type EnforcementNoticeDeps } from './enforcement-notice';

/** A valid store manifest (parseStoreManifest reads it) with one catalog product. */
const CATALOG = JSON.stringify({ version: 1, currency: 'usd', shipping: { countries: ['US'], flatRateCents: 500 }, products: [{ id: 'mug', name: 'Mug', variants: [{ id: 'mug-blue', name: 'Blue', priceCents: 2500, catalogVariantId: 'cv_1' }] }] });

function fake() {
	const sent = new Set<string>();
	const emails: Array<{ to: string; text: string }> = [];
	const deps: EnforcementNoticeDeps = {
		sender: { send: async (email) => void emails.push({ to: email.to, text: email.text }) },
		userEmail: async (userId) => `${userId}@example.test`,
		baseUrl: 'https://estori.app',
		claim: async (userId, key) => {
			if (sent.has(`${userId}:${key}`)) return false;
			sent.add(`${userId}:${key}`);
			return true;
		},
		noticeSent: async (userId, key) => sent.has(`${userId}:${key}`),
		sellersAfter: async (after, limit) => [{ userId: 'u1', email: 'u1@example.test' }, { userId: 'u2', email: 'u2@example.test' }, { userId: 'u3', email: 'u3@example.test' }].filter((seller) => after === null || seller.userId > after).slice(0, limit),
		liveStoreAppIds: async (userId) => ({ u1: ['app_a', 'app_b'], u2: ['app_c'], u3: [] as string[] })[userId] ?? [],
		liveManifest: async (appId) => (appId === 'app_c' ? CATALOG : null),
		aiCreditsPerDay: 200,
	};
	return { deps, emails };
}

const STARTS = Date.UTC(2026, 10, 1);

describe('the enforcement notice', () => {
	it('emails every seller once, adding a line for those over the new limits', async () => {
		const { deps, emails } = fake();
		expect(await sendEnforcementNotices(deps, { startsOn: STARTS, after: null, limit: 25, dryRun: false })).toEqual({ sent: 3, skipped: 0, next: null });
		const over = 'Your stores stay live; to publish more, get Premium.';
		expect(emails.map((email) => [email.to, email.text.includes(over)])).toEqual([
			['u1@example.test', true],
			['u2@example.test', true],
			['u3@example.test', false],
		]);
		expect(await sendEnforcementNotices(deps, { startsOn: STARTS, after: null, limit: 25, dryRun: false })).toEqual({ sent: 0, skipped: 3, next: null });
	});

	it('pages through sellers, and counts without sending on a dry run', async () => {
		const { deps, emails } = fake();
		expect(await sendEnforcementNotices(deps, { startsOn: STARTS, after: null, limit: 2, dryRun: true })).toEqual({ sent: 2, skipped: 0, next: 'u2' });
		expect(await sendEnforcementNotices(deps, { startsOn: STARTS, after: 'u2', limit: 2, dryRun: true })).toEqual({ sent: 1, skipped: 0, next: null });
		expect(emails).toEqual([]);
	});
});
```

`worker/api/controllers/admin/billing.sql.test.ts`:

```ts
/** The admin billing endpoints on real SQL: overrides and grants recorded with audit entries, and the plan following them. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { BillingAdminController } from './billing';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_admin', 'u_target', 'u_late']) await insertUser(db, id);
	await insertSubscription(db, { userId: 'u_late', stripeSubscriptionId: 'sub_late', status: 'past_due', currentPeriodStart: new Date('2026-10-10T00:00:00Z'), currentPeriodEnd: new Date('2026-11-10T00:00:00Z') });
});

function env(extra: Record<string, unknown> = {}): Env {
	const counter = { getRemainingLimit: async (_key: string, config: { limit: number }) => config.limit };
	return envWith(db, { BILLING: 'on', STRIPE_SECRET_KEY: 'sk_test_fake', VibecoderStore: { get: async () => null }, DORateLimitStore: { getByName: () => counter }, ...extra });
}

function call(method: 'GET' | 'PUT' | 'POST', path: string, userId: string, body?: unknown, query = ''): [Request, RouteContext] {
	const request = new Request(`https://estori.app${path}${query}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
	return [request, { user: { id: 'u_admin', email: 'u_admin@example.test' }, pathParams: { userId }, queryParams: new URLSearchParams(query) } as unknown as RouteContext];
}

describe('admin billing', () => {
	it('puts an account on Enterprise with custom limits, writes an audit entry, and the plan follows', async () => {
		const [request, context] = call('PUT', '/api/admin/users/u_target/plan', 'u_target', { plan: 'enterprise', limits: { aiCredits: 500_000, liveStores: 50 }, reason: 'Signed contract' });
		expect((await BillingAdminController.setPlan(request, env(), {} as ExecutionContext, context)).status).toBe(200);
		const [read, readContext] = call('GET', '/api/admin/users/u_target/billing', 'u_target');
		const body = await (await BillingAdminController.getBilling(read, env(), {} as ExecutionContext, readContext)).json();
		expect(body.data.view).toMatchObject({ plan: 'enterprise', source: 'override', limits: { aiCredits: 500_000, liveStores: 50 } });
		expect(body.data.override).toMatchObject({ plan: 'enterprise', reason: 'Signed contract', adminUserId: 'u_admin' });
		expect(await db.prepare("SELECT action FROM audit_logs WHERE entity_id = 'u_target'").all()).toMatchObject({ results: [{ action: 'plan_override' }] });
	});

	it('adds credits to the current window, shown as added by Estori', async () => {
		const [grant, grantContext] = call('POST', '/api/admin/users/u_target/credits', 'u_target', { credits: 5_000, reason: 'Launch partner' });
		expect((await BillingAdminController.grantCredits(grant, env(), {} as ExecutionContext, grantContext)).status).toBe(200);
		const [read, readContext] = call('GET', '/api/admin/users/u_target/billing', 'u_target');
		const body = await (await BillingAdminController.getBilling(read, env(), {} as ExecutionContext, readContext)).json();
		expect(body.data.view.credits).toMatchObject({ limit: 5_200, granted: 5_000, window: 'day' });
		expect(body.data.grants).toMatchObject([{ credits: 5_000, reason: 'Launch partner' }]);
	});

	it("reads the plan at a test clock's time", async () => {
		const at = (iso: string) => call('GET', '/api/admin/users/u_late/billing', 'u_late', undefined, `?at=${Date.parse(iso)}`);
		const [during, duringContext] = at('2026-10-16T00:00:00Z');
		expect((await (await BillingAdminController.getBilling(during, env(), {} as ExecutionContext, duringContext)).json()).data.view.plan).toBe('premium');
		const [after, afterContext] = at('2026-10-18T00:00:00Z');
		expect((await (await BillingAdminController.getBilling(after, env(), {} as ExecutionContext, afterContext)).json()).data).toMatchObject({ view: { plan: 'basic', paymentFailing: true }, stripeSubscriptionUrl: 'https://dashboard.stripe.com/test/subscriptions/sub_late' });
	});

	it('links a test-clock customer only with a test key, never to an account with a live subscription', async () => {
		const link = (userId: string) => call('PUT', `/api/admin/users/${userId}/billing/test-customer`, userId, { stripeCustomerId: 'cus_clock_1' });
		const [live, liveContext] = link('u_target');
		expect((await BillingAdminController.linkTestCustomer(live, env({ STRIPE_SECRET_KEY: 'sk_live_fake' }), {} as ExecutionContext, liveContext)).status).toBe(409);
		const [paying, payingContext] = link('u_late');
		expect((await BillingAdminController.linkTestCustomer(paying, env(), {} as ExecutionContext, payingContext)).status).toBe(409);
		const [ok, okContext] = link('u_target');
		expect((await BillingAdminController.linkTestCustomer(ok, env(), {} as ExecutionContext, okContext)).status).toBe(200);
		expect(await db.prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = 'u_target'").first()).toEqual({ stripe_customer_id: 'cus_clock_1' });
	});
});
```

In `billing-routes-wiring.test.ts`, add:

```ts
	it('keeps every admin billing route behind the admin check', () => {
		const routes = source('/worker/api/routes/billingRoutes.ts');
		for (const path of ["'/api/admin/users/:userId/billing'", "'/api/admin/users/:userId/plan'", "'/api/admin/users/:userId/credits'", "'/api/admin/users/:userId/billing/test-customer'", "'/api/admin/billing/enforcement-notices'"]) {
			const start = routes.indexOf(path);
			expect(start, path).toBeGreaterThan(-1);
			expect(routes.slice(start, start + 160), path).toContain('setAuthLevel(AuthConfig.admin)');
		}
	});
```

The first test's `expect(routes).not.toContain(':userId')` must now apply only to the seller routes. Narrow it: check the slice from `'/api/billing'` to the first `'/api/admin/'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/api/controllers/admin/billing.test.ts worker/services/billing/enforcement-notice.test.ts worker/api/controllers/admin/billing.sql.test.ts worker/api/controllers/billing/billing-routes-wiring.test.ts`
Expected: FAIL, failed imports and missing routes.

- [ ] **Step 3: Implement the parsers.** Accept only known keys, through `Object.hasOwn`.

**`parsePlanOverrideRequest`:**
- `plan` is a `PlanId` or null. `tier` is allowed only with `'premium'` and must pass `isPremiumTierNumber`; it's null otherwise.
- `limits` goes through `planLimitOverridesFrom`, `{}` when absent.
- `until` is an ISO string that parses to a time after `nowMs`, or null or absent.
- `reason` is trimmed and 3 to 500 characters.

**`parseCreditGrantRequest`:** an integer from 1 to 1,000,000 credits, with the same reason rule.

**`parseEnforcementNoticeRequest`:**
- `startsOn` must be `/^\d{4}-\d{2}-\d{2}$/` and parse with `Date.parse` + `T00:00:00Z`;
- `after` is a string or null;
- `limit` is an integer from 1 to 50, default 25;
- `dryRun` is a boolean, default false.

- [ ] **Step 4: Implement the services.**

**`admin-view.ts`:**
- `stripeDashboardUrl` answers `https://dashboard.stripe.com/${mode === 'test' ? 'test/' : ''}${kind}/${id}`, or null without a mode or id.
- `adminBillingView`:
  - `view` is `billingView(account, used, customerId !== null)`;
  - the dashboard links are for the customer and for `account.subscription?.stripeSubscriptionId`;
  - `override` is the latest row mapped to `PlanOverrideView` (limits through `planLimitOverridesFrom(JSON.parse(...)) ?? {}`), or null;
  - `grants` are mapped to `CreditGrantView`;
  - times are ms.

**`PlanAdminService`:**
- **`sellersAfter`:** `SELECT DISTINCT users.id, users.email FROM users JOIN apps ON apps.user_id = users.id WHERE users.deleted_at IS NULL AND users.id > ? ORDER BY users.id LIMIT ?`. Use `''` for a null `after`. Write it with drizzle's `selectDistinct`.
- **`linkTestCustomer`:** batches two rows:
  - a `billing_customers` upsert on `userId`;
  - an `audit_logs` row `{ entityType: 'billing_customer', action: 'link_test_customer', newValues: { stripeCustomerId } }`.

**`enforcement-notice.ts`:**
- The key is `enforcement_notice:{YYYY-MM-DD of startsOn}`.
- For each seller from `sellersAfter(after, limit)`:
  - **dry run:** `noticeSent` counts it as skipped, otherwise as sent. Nothing is sent or claimed.
  - **otherwise:**
    1. read `liveStoreAppIds`;
    2. `sellsCatalog` is any live manifest that `parseStoreManifest` reads as `ok` with a variant carrying `catalogVariantId`;
    3. `claimAndSendNotice(deps, userId, { key, email: { kind: 'enforcement_notice', startsOn, aiCreditsPerDay, liveStores: ids.length, sellsCatalog } })`;
    4. `'sent'` and `'not-sent'` count as sent, since the notice is claimed; `'already-sent'` counts as skipped.
- `next` is the last seller's id when the page came back full, else null.
- **`enforcementNoticeDepsFromEnv(env)`:**
  - spreads `creditNoticeDepsFromEnv(env)`;
  - `noticeSent` checks `BillingService.sentNoticeKeys`;
  - `liveStoreAppIds` comes from `LiveStoreService`;
  - `liveManifest` uses the SpaceDO stub's `getStoreManifest('live')`, as the live-store controller does;
  - `aiCreditsPerDay` is `publicPlanFromSettings((await getGlobalConfigurableSettings(env)).security.rateLimit).aiCreditsPerDay ?? 200`.

- [ ] **Step 5: Implement the controller and the routes.** `BillingAdminController extends BaseController`:
- Every method reads `context.pathParams.userId` and answers 404 "No user has this id" when `UserService.findUser({ id })` finds nobody. The enforcement batch has no user.
- **`getBilling`:**
  1. `nowMs` comes from a positive numeric `?at=`, else `Date.now()`;
  2. `account = await loadAccount(env, userId, nowMs)`;
  3. `used` from the target's own `getUserConfigurableSettings(env, userId)`;
  4. answer `adminBillingView` with `stripeModeOf(env)`.
- **`setPlan`:** parses (400 "Send a plan or null, a reason, and limits in range" when invalid), then `addOverride({ ...parsed, userId, adminUserId: context.user.id, now: new Date() })`. Answers `{ saved: true }`.
- **`grantCredits`:** parses (400 "Send 1 to 1,000,000 credits and a reason"), loads the account, and `addGrant({ ..., periodStart: new Date(account.periodStartMs) })`. Answers `{ saved: true, periodStart: account.periodStartMs }`.
- **`linkTestCustomer`:**
  - answers 409 "Test customers can be linked only with a Stripe test key." unless `stripeModeOf(env) === 'test'`;
  - answers 400 unless `stripeCustomerId` starts with `cus_`;
  - answers 409 "This account has a live subscription." when its row's status is live;
  - then `linkTestCustomer`.
- **`sendEnforcementNotices`:** parses (400 when invalid) and answers `sendEnforcementNotices(await enforcementNoticeDepsFromEnv(env), parsed)`.

Register the five routes in `setupBillingRoutes` with `setAuthLevel(AuthConfig.admin)`. Re-export the admin view types from `src/api-types.ts`; there's no admin page at launch.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/api/controllers/admin/billing.test.ts worker/services/billing/enforcement-notice.test.ts worker/api/controllers/admin/billing.sql.test.ts worker/api/controllers/billing/billing-routes-wiring.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add worker/api/controllers/admin/billing.ts worker/api/controllers/admin/billing.test.ts worker/api/controllers/admin/billing.sql.test.ts worker/services/billing/admin-view.ts worker/services/billing/enforcement-notice.ts worker/services/billing/enforcement-notice.test.ts worker/api/routes/billingRoutes.ts worker/api/controllers/billing/billing-routes-wiring.test.ts worker/database/services/PlanAdminService.ts shared/types/billing.ts src/api-types.ts
git commit -m "feat(billing): admin endpoints to read an account's billing, override its plan, grant credits and send the enforcement notice, each audited

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Terms, refunds and the terms version

**Files:**
- Modify:
  - `src/content/legal/terms.md`, `src/content/legal/refunds.md`, `src/content/legal/privacy.md`;
  - `shared/types/legal.ts`.
- Test: `src/content/legal/legal-documents.test.ts`.

**Interfaces:**
- **Consumes:** `renewalDisclosure` (Task 2), `GRACE_PERIOD_DAYS` (Task 1).
- **Produces:** `TERMS_VERSION = '2026-10-19'`. Every signed-in user accepts again through the existing `TermsGate`.

- [ ] **Step 1: Write the failing test.** In `legal-documents.test.ts`:
- change `expect(terms.version).toBe('2026-10-16')` to `'2026-10-19'`;
- import `renewalDisclosure` from `shared/types/billing` and `GRACE_PERIOD_DAYS` from `shared/types/plans`;
- add:

```ts
	it('covers Premium: monthly renewal until cancelled, cancelling to the period end, no partial refunds, credits without cash value, and notice of price changes', () => {
		const terms = LEGAL_DOCUMENTS.terms.body;
		for (const promise of [
			'### Premium subscriptions',
			'renews automatically every month at the price shown when you subscribed until you cancel',
			'Premium then stays on until the end of the month you paid for',
			"We don't refund part of a month",
			'A bigger pool starts right away',
			'A smaller pool starts at your next renewal',
			'have no cash value',
			"don't carry over from one month to the next",
			`Premium continues for ${GRACE_PERIOD_DAYS} days while we retry`,
			'Your published stores stay live whatever plan you are on',
			"at least 30 days' notice",
		]) {
			expect(terms, promise).toContain(promise);
		}
		expect(terms).not.toContain('Purchases are one-time payments');
		expect(terms).toContain('A paid site is a one-time payment in US dollars.');
	});

	it('says at checkout what the Terms say about renewing and cancelling', () => {
		const disclosure = renewalDisclosure(9_900);
		expect(disclosure).toBe('Premium renews every month at $99 until you cancel. Cancel any time in Estori; it ends at the end of the period.');
		expect(LEGAL_DOCUMENTS.terms.body).toContain('until you cancel');
		expect(LEGAL_DOCUMENTS.terms.body).toContain('You can cancel any time from your billing page in Estori');
	});

	it('refunds Premium only for a double charge or an account that could not use Estori, within 14 days', () => {
		const refunds = LEGAL_DOCUMENTS.refunds.body;
		expect(refunds).toContain('## Premium');
		expect(refunds).toContain('Premium payments are refundable only if you were charged twice, or if your account couldn\'t use Estori during the period you paid for.');
		expect(refunds).toContain('within 14 days of the payment');
	});

	it('names the billing data kept for Premium', () => {
		expect(LEGAL_DOCUMENTS.privacy.body).toContain('for Premium, your plan, its billing period and the identifier of your Stripe customer');
	});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy bun run test -- src/content/legal/legal-documents.test.ts shared/types/legal.test.ts`
Expected: FAIL. The version is still `2026-10-16` and the Premium wording is missing.

- [ ] **Step 3: Write the wording.** The headers of `terms.md`, `privacy.md` and `refunds.md` get `version: 2026-10-19` and `updated: October 19, 2026`. `TERMS_VERSION` becomes `'2026-10-19'`.

**In `terms.md`,** section 6: replace "Purchases are one-time payments in US dollars. Refunds follow our [Refund Policy](/refunds)." with "A paid site is a one-time payment in US dollars. Premium is a subscription, covered in section 8. Refunds follow our [Refund Policy](/refunds)."

**In `terms.md`,** section 8: add after the fee paragraph, before the Stripe paragraph:

```markdown
### Premium subscriptions

Premium is a monthly subscription to a pool of AI credits and the features our [pricing page](/pricing) lists for it. It renews automatically every month at the price shown when you subscribed until you cancel. We charge the card you gave at checkout at the start of each month.

You can cancel any time from your billing page in Estori, or in the billing portal it opens. Premium then stays on until the end of the month you paid for, and your account moves to Basic after that. We don't refund part of a month, including when you cancel or move to a smaller pool.

A bigger pool starts right away, and we charge the difference for the rest of the month. A smaller pool starts at your next renewal.

AI credits are part of the Service, not money: they have no cash value, can't be transferred, and don't carry over from one month to the next.

If a renewal payment fails, Premium continues for 7 days while we retry, and your account then moves to Basic until the payment goes through. Your published stores stay live whatever plan you are on.

We may change Premium's prices with at least 30 days' notice by email. A new price applies from your first renewal after the notice.
```

**In `refunds.md`:**
- The first paragraph becomes: "This policy covers purchases of paid sites and Premium subscriptions on Estori, sold by {{entity.name}} ("Globalink", "we") as merchant of record. Basic is free, so there's nothing to refund for it. Purchases from a store built on Estori are sold by that store's owner, and follow that store's own refund policy."
- Add before "## Chargebacks":

```markdown
## Premium

Premium payments are refundable only if you were charged twice, or if your account couldn't use Estori during the period you paid for. Email {{contact.support}} within 14 days of the payment, with the email address of your account. We don't refund part of a month, including when you cancel or move to a smaller pool; Premium stays on until the end of the month you paid for.
```

**In `privacy.md`:**
- The "Marketplace information" paragraph gains, before "Card numbers": "And, for Premium, your plan, its billing period and the identifier of your Stripe customer."
- The Stripe bullet becomes "payments, Premium subscriptions, seller onboarding and payouts".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- src/content/legal/legal-documents.test.ts shared/types/legal.test.ts src/components/auth/terms-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/legal/terms.md src/content/legal/refunds.md src/content/legal/privacy.md src/content/legal/legal-documents.test.ts shared/types/legal.ts
git commit -m "feat(billing): terms and refunds cover premium's monthly renewal, cancelling and credits, and everyone accepts the new terms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: The test-clock scenarios, the checklist, the notice script, and shipping

**Files:**
- Create:
  - `scripts/stripe-billing-scenarios.ts`, `scripts/stripe-billing-scenarios.test.ts`;
  - `scripts/billing-enforcement-notice.ts`, `scripts/billing-enforcement-notice.test.ts`;
  - `docs/estori/billing-test-scenarios.md`.
- Modify `README.md` (the dashboard-managed settings line).
- Test: the two script tests.

**Interfaces:**
- **Consumes:**
  - the seller endpoints from Task 6;
  - the admin endpoints from Task 11 (`?at=`, the test-customer link, the enforcement batch);
  - `encodeForm` and `STRIPE_API_VERSION` from `stripe-client.ts`;
  - `premiumPriceIds` from Task 4.
- **Produces:**
  - `stripe-billing-scenarios.ts`:
    - `ScenarioConfig { origin; stripeSecretKey; sellerApiKey; adminApiKey; sellerUserId; stagingGateKey: string | null; priceIds: PremiumPriceIds }`;
    - `ScenarioResult { name; ok; detail }`;
    - `assertTestKey(key: string): void`;
    - `waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, options: { timeoutMs: number; intervalMs: number; sleep(ms: number): Promise<void> }): Promise<T>`;
    - `runBillingScenarios(config, fetchImpl: FetchLike, sleep: (ms: number) => Promise<void>): Promise<ScenarioResult[]>`.
  - `billing-enforcement-notice.ts`: `sendAllEnforcementNotices(input: { origin; adminApiKey; stagingGateKey: string | null; startsOn: string; dryRun: boolean }, fetchImpl: FetchLike): Promise<{ sent: number; skipped: number }>`.

- [ ] **Step 1: Write the failing script tests.**

`scripts/stripe-billing-scenarios.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertTestKey, runBillingScenarios, waitFor } from './stripe-billing-scenarios';

describe('the billing scenarios', () => {
	it('run only against Stripe test mode', async () => {
		expect(() => assertTestKey('sk_test_1')).not.toThrow();
		expect(() => assertTestKey('rk_test_1')).not.toThrow();
		expect(() => assertTestKey('sk_live_1')).toThrow('The scenarios run only with a Stripe test key.');
		let calls = 0;
		const config = { origin: 'https://staging.estori.app', stripeSecretKey: 'sk_live_1', sellerApiKey: 'k1', adminApiKey: 'k2', sellerUserId: 'u1', stagingGateKey: null, priceIds: { 1: 'price_a', 2: 'price_b', 3: 'price_c', 4: 'price_d' } } as const;
		await expect(runBillingScenarios(config, async () => { calls += 1; return Response.json({}); }, async () => undefined)).rejects.toThrow('The scenarios run only with a Stripe test key.');
		expect(calls).toBe(0);
	});

	it('wait for a condition every interval, and say what they last saw when it never comes', async () => {
		let reads = 0;
		const slept: number[] = [];
		const sleep = async (ms: number) => void slept.push(ms);
		expect(await waitFor(async () => ++reads, (value) => value === 3, { timeoutMs: 10_000, intervalMs: 2_000, sleep })).toBe(3);
		expect(slept).toEqual([2_000, 2_000]);
		await expect(waitFor(async () => 'basic', (value) => value === 'premium', { timeoutMs: 4_000, intervalMs: 2_000, sleep })).rejects.toThrow('Timed out; last saw "basic"');
	});
});
```

`scripts/billing-enforcement-notice.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sendAllEnforcementNotices } from './billing-enforcement-notice';

describe('sending the enforcement notice', () => {
	it('pages through every seller with an admin token, adding up what was sent', async () => {
		const bodies: unknown[] = [];
		const pages = [{ sent: 25, skipped: 0, next: 'u_25' }, { sent: 3, skipped: 1, next: null }];
		const fetchImpl = async (url: string, init?: RequestInit) => {
			if (url.endsWith('/api/auth/exchange-api-key')) return Response.json({ success: true, data: { accessToken: 'token', expiresAt: '2099-01-01T00:00:00Z' } });
			expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
			bodies.push(JSON.parse(String(init?.body)));
			return Response.json({ success: true, data: pages.shift() });
		};
		expect(await sendAllEnforcementNotices({ origin: 'https://estori.app', adminApiKey: 'admin-key', stagingGateKey: null, startsOn: '2026-11-01', dryRun: false }, fetchImpl)).toEqual({ sent: 28, skipped: 1 });
		expect(bodies).toEqual([
			{ startsOn: '2026-11-01', after: null, limit: 25, dryRun: false },
			{ startsOn: '2026-11-01', after: 'u_25', limit: 25, dryRun: false },
		]);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- scripts/stripe-billing-scenarios.test.ts scripts/billing-enforcement-notice.test.ts`
Expected: FAIL, failed imports.

- [ ] **Step 3: Implement `scripts/stripe-billing-scenarios.ts`.**

**The header** says what it does and how to run it:

```
ESTORI_ORIGIN=https://staging.estori.app STRIPE_SECRET_KEY=sk_test_... ESTORI_SELLER_API_KEY=... ESTORI_ADMIN_API_KEY=... ESTORI_SELLER_USER_ID=... STRIPE_PREMIUM_PRICE_IDS='{...}' [STAGING_GATE_KEY=...] bun scripts/stripe-billing-scenarios.ts
```

**Setup:**
- `assertTestKey` runs first, before any request.
- Exchange each API key for a token through `POST {origin}/api/auth/exchange-api-key` with `Authorization: Bearer <key>`, and read `data.accessToken`.
- Estori requests send `Authorization: Bearer <token>`, and `x-estori-staging-key` when a gate key is set.
- Stripe requests send the secret key, `Stripe-Version: STRIPE_API_VERSION` and `encodeForm` bodies.
- `view(atMs)` reads `GET /api/admin/users/{sellerUserId}/billing?at={atMs}` with the admin token, and answers `data.view`.

**`advance(clockId, toSeconds)`:**
1. `POST /v1/test_helpers/test_clocks/{id}/advance { frozen_time }`;
2. then `waitFor` the clock's `status === 'ready'` (every 2 s, up to 120 s);
3. then wait 10 s for webhooks.

**`waitFor`:**
- reads, and answers as soon as `done` holds;
- otherwise sleeps `intervalMs` and reads again;
- counts elapsed time as the sum of its sleeps, so a test can pass a fake `sleep`;
- once that reaches `timeoutMs`, throws `Timed out; last saw ${JSON.stringify(last)}`.

**Every `waitFor` on the view** polls every 2 s for up to 60 s. Each scenario runs in its own try/catch and records `{ name, ok, detail }`. A failed scenario stops the later ones, since they share the subscription, and marks them "skipped".

| # | Scenario | Steps | Expected view (at the clock's time) |
| --- | --- | --- | --- |
| 9 | Expired checkout (runs first, before the test customer is linked) | `POST /api/billing/checkout { tier: 1 }` as the seller, then `POST /v1/checkout/sessions/{sessionId}/expire`, then a second checkout, also expired | plan `basic`; the second checkout answers 200, not 409 |
| 1 | Subscribe with 4242 | create a test clock at now; create a customer `{ test_clock, email: 'billing-scenarios@pluriza.com', metadata: { estori_user_id } }`; `PUT /api/admin/users/{id}/billing/test-customer`; attach `pm_card_visa` and make it `invoice_settings.default_payment_method`; `POST /v1/subscriptions { customer, items: [{ price: priceIds[1] }], metadata: { estori_user_id } }` | `premium`, tier 1, `credits.limit` 20,000, status `active` |
| 2 | Renew a month later | advance to `periodEnd + 3600` | `periodStart` moved to the old `periodEnd`; still `premium` tier 1 |
| 3 | Upgrade 1 to 3 mid-period | advance 10 days; `POST /api/billing/change-tier { tier: 3 }` | tier 3, `credits.limit` 100,000 |
| 4 | Downgrade 3 to 2 at renewal | `change-tier { tier: 2 }`; then advance to `periodEnd + 3600` | first `pendingTier` 2; after the advance tier 2, `pendingTier` null |
| 5 | Failed renewal with 0341, the grace, then a good card | attach `pm_card_chargeCustomerFail` as default; advance to `periodEnd + 3600`; read the view at the clock + 6 days and at the clock + 8 days; attach `pm_card_visa` as default; pay the open invoice (`GET /v1/invoices?subscription=...&status=open`, then `POST /v1/invoices/{id}/pay`) | `past_due` and `premium` at +6 d; `basic` with `paymentFailing` at +8 d; `premium`, `active` after paying |
| 7 | Cancel at the period's end | `POST /api/billing/cancel` | `cancelAtPeriodEnd` true, still `premium` |
| 8 | Resume before the end | `POST /api/billing/resume`; then cancel again and advance to `periodEnd + 3600` | `cancelAtPeriodEnd` false; after the second cancel and the advance, `basic` with status `canceled` |

At the end, `DELETE /v1/test_helpers/test_clocks/{id}` removes the clock's customer and subscriptions, even after a failure. `main()`:
- reads the environment;
- parses `STRIPE_PREMIUM_PRICE_IDS` with `premiumPriceIds`;
- prints one line per result;
- exits 1 when any failed.

- [ ] **Step 4: Implement `scripts/billing-enforcement-notice.ts`.**
- Exchange the admin key, then POST `{ startsOn, after, limit: 25, dryRun }` to `/api/admin/billing/enforcement-notices` until `next` is null. Send the staging gate header when set.
- Add up `sent` and `skipped`.
- `main()` reads `ESTORI_ORIGIN`, `ESTORI_ADMIN_API_KEY` and `STAGING_GATE_KEY`, plus the `--starts-on YYYY-MM-DD` and `--dry-run` flags.
- Print the totals, prefixed "Would send" on a dry run.

- [ ] **Step 5: Run the script tests**

Run: `rtk proxy bun run test -- scripts/stripe-billing-scenarios.test.ts scripts/billing-enforcement-notice.test.ts scripts/stripe-billing-setup.test.ts`
Expected: PASS.

- [ ] **Step 6: Write `docs/estori/billing-test-scenarios.md`.** Sections, in order:
1. **Setup, once per environment:**
   - run `scripts/stripe-billing-setup.ts --mode test` and set `STRIPE_PREMIUM_PRICE_IDS`;
   - set a Terms of Service URL in Stripe's Public details;
   - configure the customer portal: card updates, invoices, cancel at the period end, no plan switching. The setup script reports what's off;
   - turn on Smart Retries, up to 2 weeks;
   - turn off Stripe's customer emails for invoices and failed payments;
   - add the webhook events: `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`, `invoice.paid`, `invoice.payment_failed`, and `subscription_schedule.created`, `.updated`, `.released`, `.canceled`;
   - set `BILLING_USER_IDS` or `BILLING=on`;
   - create the scenario seller and an admin API key.
2. **Automated scenarios:** the table from Step 3 with each expected result, and the command.
3. **By eye on staging,** with a test card:
   - scenario 6, 3-D Secure (4000 0025 0000 3155), from the pricing page: the 3-D Secure prompt, then "Confirming your payment…", then Premium;
   - the Get Premium flow signed out (sign-up, then back to pricing with the pool kept);
   - each limit dialog: credits, a second live store, an own domain, a new catalog product (refused), and republishing a live store (always allowed);
   - the failing-payment and credits banners;
   - each email with its "[Staging]" prefix: started, receipt, upgraded, downgrade scheduled, payment failed, ending, ended, 80%, 100%.
4. **Before each release:** rerun the automated scenarios against staging, then the by-eye list.
5. **Launch day, the owner's steps:** spec section 14, with the schedule events added. Then:
   1. live-mode prices with `--mode live`;
   2. `BILLING_USER_IDS` with the owner only;
   3. the enforcement notice a week before `BILLING=on`, sent with `bun scripts/billing-enforcement-notice.ts --starts-on <date>` (try `--dry-run` first);
   4. a lawyer's review of the Terms wording.

In `README.md`'s dashboard-managed settings sentence, add `BILLING`, `BILLING_USER_IDS` and `STRIPE_PREMIUM_PRICE_IDS`, all unset by default. With them unset, billing is off.

- [ ] **Step 7: Commit**

```bash
git add scripts/stripe-billing-scenarios.ts scripts/stripe-billing-scenarios.test.ts scripts/billing-enforcement-notice.ts scripts/billing-enforcement-notice.test.ts docs/estori/billing-test-scenarios.md README.md
git commit -m "test(billing): stripe test-clock scenarios, the written checklist, and the enforcement notice script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: By eye on localhost.**
1. **Start everything:**
   - restart the dev server on port 8100 the way this checkout always runs it;
   - the person running it sets `BILLING_USER_IDS` to the test account's id, `STRIPE_PREMIUM_PRICE_IDS` (test prices) and the test Stripe keys in `.dev.vars`. Never read that file;
   - start `stripe listen --forward-to localhost:8100/api/stripe/webhook`, as in the local Stripe setup;
   - sign in with the test account from `.superpowers/realtest/local-accounts.md`, and never paste its password into chat.
2. **Basic:**
   - the usage badge shows "N free credits left" and links to the billing page;
   - with the account's daily credits used up, sending a prompt opens the Upgrade dialog ("Get Premium"), not a Cloudflare dialog;
   - publishing a second store opens it with "Basic includes 1 live store. Get Premium for up to 10.";
   - republishing the live store works;
   - adding a catalog product and publishing is refused with the catalog copy; the live store keeps selling its existing catalog products.
3. **Buy Premium from `/pricing`:**
   - pick 50,000, Get Premium;
   - Stripe's page shows the terms checkbox and the renewal disclosure;
   - pay with 4242, return to `/settings/billing`;
   - "Confirming your payment…" turns into Premium within seconds;
   - the welcome and receipt emails appear in the dev log.
4. **Change tiers:**
   - "Move up now" to 100,000: the pool grows after the poll, with an upgrade email and a receipt;
   - "Move down at renewal" to 20,000: the "Moves to 20,000…" line, with "Keep 100,000 credits" to undo it.
5. **Cancel and keep:** Cancel Premium shows "Premium until {date}", then Keep Premium clears it.
6. **Manage billing:** opens Stripe's portal; it has no plan switching.
7. **Flag off:** remove the account from `BILLING_USER_IDS` and restart. The pricing page shows "coming soon", `/settings` has no Plan and billing card, and a second store publishes as before.

- [ ] **Step 9: The CI steps**

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

- [ ] **Step 10: Final review.** Run the fresh whole-branch review the execution skill names, with this plan's Review Focus. Fix its Critical and Important findings with failing tests first.

- [ ] **Step 11: Open the PR into `main`.**
- Push the branch.
- Describe in the PR:
  - what was built;
  - the three rulings against the spec and the fifteen choices;
  - the migration number;
  - the owner steps from the checklist;
  - the localhost by-eye results;
  - the test totals.
- End the description with "Generated with [Claude Code](https://claude.com/claude-code)".
- Don't merge. The flag stays off in production until the owner turns it on.

- [ ] **Step 12: Staging, once the owner merges.** `main` auto-deploys staging, and billing stays off there until the flag is set.
1. With the owner, set the staging variables, run the setup script in test mode, and configure the webhook and the portal (checklist section 1).
2. Run `scripts/stripe-billing-scenarios.ts` against staging. All rows pass.
3. Walk the by-eye list in `docs/estori/billing-test-scenarios.md`, scenario 6 included.
4. Post the results on the PR. Fix anything they find with a failing test first, on a follow-up branch.

