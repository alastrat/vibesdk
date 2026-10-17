# Seller Levels, Limits and Risk Holds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit what a new or dishonest seller can cost Estori. Each seller has a level that sets their largest order, their weekly sales cap and their payout delay. The level rises with a good record, and admins can override it. Before Estori pays a supplier, orders whose payment Stripe's fraud screening (Radar) scores as risky wait for review.

**Architecture:**
- **The level rule.** A pure rule turns a seller's record into a level. Defaults live in a new `sellerLimits` block of the global config, and per-seller overrides use the existing `user_config:<userId>` KV entry.
- **Checkout.** It refuses an order over the largest-order limit, or one that would pass the weekly cap. The cap counts weighted checkout amounts stored on each checkout.
- **Level sync.** After each recorded sale and once a day, Estori re-evaluates the level and syncs Stripe's payout delay when it changes.
- **Risk holds.** The catalog order runner reads the charge's Radar risk level before placing. On `elevated` it holds the order for 24 hours. An admin can release it; otherwise its catalog items are refunded as `risk-declined`.

**Tech Stack:** Cloudflare Workers, D1 with Drizzle, KV, Durable Objects (the `CatalogOrderRunner`), the Stripe REST client, React 19 with `@cloudflare/kumo`, and Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-seller-risk-safeguards-design.md`. This plan implements:
- section 4: levels, enforcement, payout delay, and what the seller sees;
- section 7;
- the seller notices and the remaining alert kinds of section 8;
- the matching data in section 10.

**Depends on:**
- `2026-10-16-seller-payments-setup.md`: alerts, and `SellerReadiness`;
- `2026-10-16-seller-money-rules.md`:
  - `updatePayoutSchedule`, `scheduleOf` and `refundCatalogItems` with `'risk-declined'`;
  - `SellerChargeService`;
  - `seller-costs.ts`;
  - `settleSale`;
  - `disputeDepsFromEnv`.

## Global Constraints

- **Code and commits:**
  - Never use `any`, and no emojis.
  - Commit subjects are lowercase after the type prefix, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never commit `.dev.vars`, `bun.lockb`, `.superpowers/`, `src/routes/landing/LandingPage.tsx` or the local overrides in `wrangler.jsonc`.
- **Tests:** run `rtk proxy npx vitest run <paths>` in small batches, once TIME_WAIT is under 1500.
- **Migrations:** generate with `rtk proxy npm run db:generate -- --name <name>`, then apply locally with sqlite3, together with the `d1_migrations` row.
- **Levels (spec section 4):**
  - New: largest order $150, $500 per rolling 7 days, payout delay 10 business days.
  - Established: largest order $500, $5,000 per rolling 7 days, payout delay 5 business days.
  - Established needs 30+ days since the first paid order, 10+ completed orders, no lost dispute in 90 days, and a 90-day dispute rate under 1%.
- **Completed order:** a paid store order at least 14 days old, with no refund, no dispute, and every catalog item delivered.
- **Weekly weighting:**
  - Catalog lines and shipping count once, and the seller's own lines count twice.
  - Checkouts that are `creating`, `open` or `completed` count toward the cap.
- **Mode:** levels and limits count orders in the checkout's own mode (`test` or `live`).
- **Shopper messages:** `order_over_limit` reads "This store can't take an order this large yet.", and `store_paused` reads "This store isn't taking new orders right now. Try again later."
- **Risk hold:** 24 hours, then the catalog items are refunded with reason `risk-declined`.

## Review Focus

1. **Two shoppers checking out at once near the weekly cap.** Both checkouts are written as `creating` before Stripe is called, and the usage query counts `creating` rows. The second one sees the first. Task 3 pins this. Both may still pass if their reads interleave before either write. That is acceptable at this size, and the review should confirm it stays a small overshoot.
2. **A level change while the seller's Stripe account rejects the update,** for example a restricted account. Keep the old level and delay, alert `seller-level-sync-failed`, and retry next time. Never store a level Stripe doesn't have. Task 4 pins this.
3. **A risk-held order whose shopper also disputes the payment.** The dispute withholds the pending items (money-rules plan). The hold's 24-hour step must then find no pending items and refund nothing. Task 7 pins this.
4. **An admin pins a level, then the seller's record says otherwise.** The pin wins in both directions until it's cleared. Task 1 pins this.
5. **Existing runner states stored before this plan, with no `riskChecked` field.** They read as unchecked. Only an order still waiting for placement gets a risk check, and it happens once. Task 7 pins this.

## Rulings carried into this plan

- **Ruling: the weekly usage counts each checkout's weighted amount, stored when the checkout starts (`store_checkouts.weighted_cents`).**
  - Why: it is one query for paid and open checkouts, and the weighting never needs re-pricing.
  - Cost if wrong: checkouts before this migration count 0, and only test data exists today.
- **Ruling: Stripe's account-cost rates move into `sellerLimits.costs`, closing the money-rules plan's ruling.**
- **Ruling: the risk check reads `latest_charge.outcome.risk_level`, which `retrievePaymentIntent` already returns.**
  - Why: the charge is expanded for the transfer, so no extra call is needed.
- **Ruling: migration 0022.**

---

### Task 1: The level rule and its settings

**Files:**
- Create: `shared/types/seller-levels.ts`
- Modify: `worker/config/index.ts` (`GlobalConfigurableSettings.sellerLimits` and its defaults)
- Modify: `worker/services/payments/seller-costs.ts` (rates come from settings)
- Modify: the two callers of the seller-cost functions: the `payout.paid` branch of `worker/api/controllers/payments/webhook.ts`, and `loadStatus` in `connectController.ts`
- Modify: `src/api-types.ts`
- Test: `shared/types/seller-levels.test.ts`, `worker/services/payments/seller-costs.test.ts`

**Interfaces:**
- Produces:
  - `SELLER_LEVELS`, `SellerLevel`, `SellerLevelLimits`, `SellerLimitsSettings`, `DEFAULT_SELLER_LIMITS`, `SellerRecord`;
  - `sellerLevelOf(record: SellerRecord, settings: SellerLimitsSettings, nowMs: number): SellerLevel`;
  - `limitsFor(level: SellerLevel, settings: SellerLimitsSettings): SellerLevelLimits`;
  - `weightedCartCents(cart: { totalCents: number; lines: ReadonlyArray<{ kind: 'own' | 'catalog'; unitPriceCents: number; quantity: number }> }): number`;
  - `SellerLimitsData`.
- `chargesForPayout(input, costs)` and `estimatedMonthlyPayoutCostCents(volume, interval, costs)` gain a `costs: SellerLimitsSettings['costs']` parameter.

- [ ] **Step 1: Write the failing tests**

```ts
// shared/types/seller-levels.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SELLER_LIMITS, limitsFor, sellerLevelOf, weightedCartCents, type SellerRecord } from './seller-levels';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const GOOD: SellerRecord = { firstSaleAt: new Date(NOW - 30 * DAY), completedOrders: 10, ordersLast90Days: 200, disputesLast90Days: 1, lostDisputesLast90Days: 0 };

describe('sellerLevelOf', () => {
	it('makes a seller established at 30 days, 10 completed orders and disputes under 1%', () => {
		expect(sellerLevelOf(GOOD, DEFAULT_SELLER_LIMITS, NOW)).toBe('established');
	});

	it('keeps a seller new until every condition holds', () => {
		for (const record of [
			{ ...GOOD, firstSaleAt: new Date(NOW - 30 * DAY + 1) },
			{ ...GOOD, firstSaleAt: null },
			{ ...GOOD, completedOrders: 9 },
			{ ...GOOD, disputesLast90Days: 2 },
			{ ...GOOD, lostDisputesLast90Days: 1 },
		]) {
			expect(sellerLevelOf(record, DEFAULT_SELLER_LIMITS, NOW)).toBe('new');
		}
	});

	it('lets an admin pin a level either way', () => {
		expect(sellerLevelOf({ ...GOOD, completedOrders: 0 }, { ...DEFAULT_SELLER_LIMITS, pinnedLevel: 'established' }, NOW)).toBe('established');
		expect(sellerLevelOf(GOOD, { ...DEFAULT_SELLER_LIMITS, pinnedLevel: 'new' }, NOW)).toBe('new');
	});
});

describe('limitsFor', () => {
	it("gives each level its limits, with a seller's own numbers on top", () => {
		expect(limitsFor('new', DEFAULT_SELLER_LIMITS)).toEqual({ largestOrderCents: 15_000, weeklySalesCents: 50_000, payoutDelayDays: 10 });
		expect(limitsFor('established', DEFAULT_SELLER_LIMITS)).toEqual({ largestOrderCents: 50_000, weeklySalesCents: 500_000, payoutDelayDays: 5 });
		const custom = { ...DEFAULT_SELLER_LIMITS, overrides: { largestOrderCents: 30_000, weeklySalesCents: null, payoutDelayDays: null } };
		expect(limitsFor('new', custom)).toEqual({ largestOrderCents: 30_000, weeklySalesCents: 50_000, payoutDelayDays: 10 });
	});
});

describe('weightedCartCents', () => {
	it("counts the seller's own lines twice, and catalog lines and shipping once", () => {
		const cart = {
			totalCents: 7099,
			lines: [
				{ kind: 'catalog' as const, unitPriceCents: 4099, quantity: 1 },
				{ kind: 'own' as const, unitPriceCents: 1000, quantity: 2 },
			],
		};
		expect(weightedCartCents(cart)).toBe(9099);
	});
});
```

In `worker/services/payments/seller-costs.test.ts`, pass `DEFAULT_SELLER_LIMITS.costs` as the new last argument in each existing call. Import it from `'../../../shared/types/seller-levels'`. Add one case that changes the rates:

```ts
	it("uses Stripe's rates from settings, so a price change needs no code change", () => {
		expect(chargesForPayout({ stripeAccountId: 'acct_1', payoutId: 'po_1', amountCents: 100_000, arrivalDate: new Date('2026-10-19T00:00:00Z') }, { monthlyActiveCents: 300, payoutPercent: 0.5, payoutFixedCents: 30 })).toEqual([
			{ kind: 'payout-fee', sourceId: 'po_1', amountCents: 530 },
			{ kind: 'active-account-fee', sourceId: 'acct_1-2026-10', amountCents: 300 },
		]);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run shared/types/seller-levels.test.ts worker/services/payments/seller-costs.test.ts`
Expected: FAIL. The module is missing, and the functions don't take rates yet.

- [ ] **Step 3: Implement**

```ts
// shared/types/seller-levels.ts
/** Seller levels: how large a store's orders and weekly sales can be, and how long its payouts wait (spec section 4). */

export const SELLER_LEVELS = ['new', 'established'] as const;
export type SellerLevel = (typeof SELLER_LEVELS)[number];

export interface SellerLevelLimits {
	largestOrderCents: number;
	weeklySalesCents: number;
	/** Business days in the US. */
	payoutDelayDays: number;
}

export interface SellerLimitsSettings {
	levels: Record<SellerLevel, SellerLevelLimits>;
	graduation: { daysSinceFirstSale: number; completedOrders: number; maxDisputeRatePercent: number };
	/** Stripe's charges for each seller account, passed to the seller. */
	costs: { monthlyActiveCents: number; payoutPercent: number; payoutFixedCents: number };
	/** Set per seller by an admin: this level, whatever the record says. */
	pinnedLevel: SellerLevel | null;
	/** Set per seller by an admin: numbers that replace the level's; null keeps the level's. */
	overrides: { largestOrderCents: number | null; weeklySalesCents: number | null; payoutDelayDays: number | null };
}

export const DEFAULT_SELLER_LIMITS: SellerLimitsSettings = {
	levels: {
		new: { largestOrderCents: 15_000, weeklySalesCents: 50_000, payoutDelayDays: 10 },
		established: { largestOrderCents: 50_000, weeklySalesCents: 500_000, payoutDelayDays: 5 },
	},
	graduation: { daysSinceFirstSale: 30, completedOrders: 10, maxDisputeRatePercent: 1 },
	costs: { monthlyActiveCents: 200, payoutPercent: 0.25, payoutFixedCents: 25 },
	pinnedLevel: null,
	overrides: { largestOrderCents: null, weeklySalesCents: null, payoutDelayDays: null },
};

export interface SellerRecord {
	firstSaleAt: Date | null;
	completedOrders: number;
	ordersLast90Days: number;
	disputesLast90Days: number;
	lostDisputesLast90Days: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function sellerLevelOf(record: SellerRecord, settings: SellerLimitsSettings, nowMs: number): SellerLevel {
	if (settings.pinnedLevel) return settings.pinnedLevel;
	const rules = settings.graduation;
	const oldEnough = record.firstSaleAt !== null && nowMs - record.firstSaleAt.getTime() >= rules.daysSinceFirstSale * DAY_MS;
	const disputeRate = record.ordersLast90Days === 0 ? 0 : (record.disputesLast90Days / record.ordersLast90Days) * 100;
	const established = oldEnough && record.completedOrders >= rules.completedOrders && record.lostDisputesLast90Days === 0 && disputeRate < rules.maxDisputeRatePercent;
	return established ? 'established' : 'new';
}

export function limitsFor(level: SellerLevel, settings: SellerLimitsSettings): SellerLevelLimits {
	const base = settings.levels[level];
	return {
		largestOrderCents: settings.overrides.largestOrderCents ?? base.largestOrderCents,
		weeklySalesCents: settings.overrides.weeklySalesCents ?? base.weeklySalesCents,
		payoutDelayDays: settings.overrides.payoutDelayDays ?? base.payoutDelayDays,
	};
}

/** What a cart counts toward the weekly cap: the seller's own lines twice, since Estori can't prove their delivery. */
export function weightedCartCents(cart: { totalCents: number; lines: ReadonlyArray<{ kind: 'own' | 'catalog'; unitPriceCents: number; quantity: number }> }): number {
	return cart.totalCents + cart.lines.filter((line) => line.kind === 'own').reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

export interface SellerLimitsData {
	level: SellerLevel;
	largestOrderCents: number;
	weeklySalesCents: number;
	weeklySalesUsedCents: number;
	payoutDelayDays: number;
	/** What's left before the next level; null at the top level or when an admin pinned the level. */
	nextLevel: { completedOrders: number; completedOrdersNeeded: number; daysSinceFirstSale: number; daysNeeded: number } | null;
}
```

In `worker/config/index.ts`:
- Import `DEFAULT_SELLER_LIMITS` and `type SellerLimitsSettings`.
- Add `sellerLimits: SellerLimitsSettings;` to `GlobalConfigurableSettings`.
- Add `sellerLimits: DEFAULT_SELLER_LIMITS,` to `defaultConfig` in `getGlobalConfigurableSettings`.

`deepMerge` keeps `null` values from a stored override, which is how an admin clears a pin.

In `worker/services/payments/seller-costs.ts`:
- Delete `SELLER_ACCOUNT_COSTS`.
- Give `payoutFeeCents(amountCents, costs)`, `chargesForPayout(input, costs)` and `estimatedMonthlyPayoutCostCents(volume, interval, costs)` a `costs: SellerLimitsSettings['costs']` parameter, and use it in place of the constant.

Callers:
- In the webhook's `payout.paid` branch, pass `(await getGlobalConfigurableSettings(env)).sellerLimits.costs`.
- In `connectController.loadStatus`, pass `(await getUserConfigurableSettings(env, userId)).sellerLimits.costs`.

Re-export `SellerLevel`, `SellerLimitsData` and `DEFAULT_SELLER_LIMITS` from `src/api-types.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run shared/types/seller-levels.test.ts worker/services/payments worker/api/controllers/payments worker/config`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.worker.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add shared/types/seller-levels.ts shared/types/seller-levels.test.ts worker/config/index.ts worker/services/payments/ worker/api/controllers/payments/ src/api-types.ts
git commit -m "feat(payments): seller levels with their limits, overridable per seller"
```

### Task 2: The seller's record, and where it's stored

**Files:**
- Modify: `worker/database/schema.ts` (`stripeConnectAccounts.sellerLevel` and `payoutDelayDays`, `storeCheckouts.weightedCents`)
- Modify: `shared/types/catalog.ts` (`CATALOG_ORDER_STATUSES` gains `'risk-hold'`)
- Modify: `worker/services/store-payments/store.ts` (`StoreCheckoutRecord.weightedCents`)
- Modify: `worker/database/services/StoreOrderService.ts` (`sellerRecord`, `activeSellerIds`)
- Modify: `worker/database/services/StoreCheckoutService.ts` (`weeklyUsage`)
- Modify: `worker/database/services/StripeConnectService.ts` (`saveLevel`)
- Create: `migrations/0022_seller_levels.sql` (generated)
- Test: `worker/database/seller-levels-schema.test.ts`, `worker/database/services/StoreOrderService.test.ts`, `worker/database/services/StoreCheckoutService.test.ts`

**Interfaces:**
- Consumes: `SellerRecord` (Task 1).
- Produces:
  - `StoreOrderService.sellerRecord(sellerUserId: string, mode: StoreMode, nowMs: number): Promise<SellerRecord>`;
  - `StoreOrderService.activeSellerIds(since: Date): Promise<string[]>`;
  - `StoreCheckoutService.weeklyUsage(sellerUserId: string, mode: StoreMode, since: Date): Promise<number>`;
  - `StripeConnectService.saveLevel(userId: string, level: SellerLevel, payoutDelayDays: number): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/database/seller-levels-schema.test.ts
import { describe, expect, it } from 'vitest';
import * as schema from './schema';
import { CATALOG_ORDER_STATUSES } from '../../shared/types/catalog';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('seller levels schema', () => {
	it('starts every seller new, with no payout delay set yet', () => {
		expect(schema.stripeConnectAccounts.sellerLevel.default).toBe('new');
		expect(schema.stripeConnectAccounts.payoutDelayDays.notNull).toBe(false);
	});

	it("stores each checkout's weight toward the weekly cap", () => {
		expect(schema.storeCheckouts.weightedCents.default).toBe(0);
	});

	it('holds catalog orders whose payment looks risky', () => {
		expect(CATALOG_ORDER_STATUSES).toContain('risk-hold');
	});

	it('ships the columns in a migration', () => {
		expect(allMigrationSql).toContain('ALTER TABLE `stripe_connect_accounts` ADD `seller_level` text');
		expect(allMigrationSql).toContain('ALTER TABLE `stripe_connect_accounts` ADD `payout_delay_days` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `store_checkouts` ADD `weighted_cents` integer');
	});
});
```

Add to `worker/database/services/StoreCheckoutService.test.ts`, creating the file with the `recordingD1` imports if it doesn't exist:

```ts
describe('StoreCheckoutService.weeklyUsage', () => {
	it("sums the weight of the seller's paid, open and starting checkouts in this mode since the given time", async () => {
		const { d1, statements } = recordingD1([[12_500]]);
		const usage = await new StoreCheckoutService({ DB: d1 } as unknown as Env).weeklyUsage('u1', 'test', new Date(1_800_000_000_000));
		expect(usage).toBe(12_500);
		const select = statements[0];
		expect(select.sql).toContain('sum("store_checkouts"."weighted_cents")');
		expect(select.sql).toContain('"store_checkouts"."status" in');
		expect(select.params).toEqual(expect.arrayContaining(['u1', 'test', 'creating', 'open', 'completed']));
	});
});
```

Add to `worker/database/services/StoreOrderService.test.ts`:

```ts
describe('StoreOrderService.sellerRecord', () => {
	it("reads the seller's first sale, completed orders and 90-day disputes in one mode", async () => {
		const rows = (sql: string): unknown[][] => {
			const lower = sql.toLowerCase();
			if (lower.includes('min(')) return [[1_790_000_000]];
			if (lower.includes('store_disputes')) return [[3, 1]];
			if (lower.includes('not exists')) return [[12]];
			return [[150]];
		};
		const { d1 } = recordingD1(rows);
		const record = await new StoreOrderService({ DB: d1 } as unknown as Env).sellerRecord('u1', 'live', 1_800_000_000_000);
		expect(record).toEqual({ firstSaleAt: new Date(1_790_000_000_000), completedOrders: 12, ordersLast90Days: 150, disputesLast90Days: 3, lostDisputesLast90Days: 1 });
	});
});
```

The `min()` row is in seconds, because `created_at` is a timestamp-mode integer.

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/database/seller-levels-schema.test.ts worker/database/services/StoreCheckoutService.test.ts worker/database/services/StoreOrderService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Schema:
- In `stripeConnectAccounts`, add:

```ts
    sellerLevel: text('seller_level', { enum: SELLER_LEVELS }).notNull().default('new'),
    /** The payout delay last set on Stripe; null until Estori first sets it. */
    payoutDelayDays: integer('payout_delay_days'),
```

- In `storeCheckouts`, add:

```ts
    /** What this checkout counts toward the seller's weekly cap: own lines twice, the rest once. */
    weightedCents: integer('weighted_cents').notNull().default(0),
```

- Add `'risk-hold'` to `CATALOG_ORDER_STATUSES`, and `weightedCents: number` to `StoreCheckoutRecord`.

`StoreCheckoutService.weeklyUsage`:

```ts
    async weeklyUsage(sellerUserId: string, mode: StoreMode, since: Date): Promise<number> {
        const row = await this.database
            .select({ used: sql<number>`COALESCE(sum(${schema.storeCheckouts.weightedCents}), 0)` })
            .from(schema.storeCheckouts)
            .where(and(
                eq(schema.storeCheckouts.sellerUserId, sellerUserId),
                eq(schema.storeCheckouts.mode, mode),
                inArray(schema.storeCheckouts.status, ['creating', 'open', 'completed']),
                gte(schema.storeCheckouts.createdAt, since),
            ))
            .get();
        return row?.used ?? 0;
    }
```

`StoreOrderService.sellerRecord` runs four reads. The first sale and the 90-day order count come from `store_orders`. The disputes come from `store_disputes` joined to `store_orders`. Completed orders are paid orders at least 14 days old with no catalog item undelivered:

```ts
    async sellerRecord(sellerUserId: string, mode: StoreMode, nowMs: number): Promise<SellerRecord> {
        const orders = schema.storeOrders;
        const mine = and(eq(orders.sellerUserId, sellerUserId), eq(orders.mode, mode));
        const ninetyDaysAgo = new Date(nowMs - 90 * 24 * 60 * 60 * 1000);
        const fourteenDaysAgo = new Date(nowMs - 14 * 24 * 60 * 60 * 1000);
        const first = await this.database.select({ at: sql<number | null>`min(${orders.createdAt})` }).from(orders).where(mine).get();
        const recent = await this.database.select({ count: sql<number>`count(*)` }).from(orders).where(and(mine, gte(orders.createdAt, ninetyDaysAgo))).get();
        const disputes = await this.database
            .select({ total: sql<number>`count(*)`, lost: sql<number>`sum(case when ${schema.storeDisputes.status} = 'lost' then 1 else 0 end)` })
            .from(schema.storeDisputes)
            .innerJoin(orders, eq(orders.id, schema.storeDisputes.orderId))
            .where(and(mine, gte(schema.storeDisputes.createdAt, ninetyDaysAgo)))
            .get();
        const completed = await this.database
            .select({ count: sql<number>`count(*)` })
            .from(orders)
            .where(and(
                mine,
                eq(orders.paymentStatus, 'paid'),
                lte(orders.createdAt, fourteenDaysAgo),
                sql`not exists (select 1 from ${schema.catalogOrders} co join ${schema.catalogOrderItems} ci on ci.order_id = co.id where co.stripe_checkout_session_id = ${orders.stripeCheckoutSessionId} and ci.status != 'delivered')`,
            ))
            .get();
        return {
            firstSaleAt: first?.at ? new Date(first.at * 1000) : null,
            completedOrders: completed?.count ?? 0,
            ordersLast90Days: recent?.count ?? 0,
            disputesLast90Days: disputes?.total ?? 0,
            lostDisputesLast90Days: disputes?.lost ?? 0,
        };
    }

    /** Sellers with a store order since this time, for the daily level check. */
    async activeSellerIds(since: Date): Promise<string[]> {
        const rows = await this.database.selectDistinct({ id: schema.storeOrders.sellerUserId }).from(schema.storeOrders).where(gte(schema.storeOrders.createdAt, since)).limit(1000).all();
        return rows.map((row) => row.id);
    }
```

`paymentStatus = 'paid'` excludes refunded, partly refunded, disputed and lost orders. That matches "no refund, no dispute".

`StripeConnectService.saveLevel`:

```ts
    async saveLevel(userId: string, level: SellerLevel, payoutDelayDays: number): Promise<void> {
        await this.database.update(schema.stripeConnectAccounts).set({ sellerLevel: level, payoutDelayDays, updatedAt: new Date() }).where(eq(schema.stripeConnectAccounts.userId, userId));
    }
```

Set `weightedCents: 0` in every existing `StoreCheckoutRecord` fixture so `tsc` passes. Task 3 computes the real value.

- [ ] **Step 4: Generate and apply the migration, then run the tests**

Run: `rtk proxy npm run db:generate -- --name seller_levels`
Expected: `migrations/0022_seller_levels.sql` with three `ALTER TABLE ... ADD` statements.

Apply it locally.

Run: `rtk proxy npx vitest run worker/database worker/services/store-payments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/database/ shared/types/catalog.ts worker/services/store-payments/ migrations/0022_seller_levels.sql migrations/meta/
git commit -m "feat(payments): store seller levels, payout delays and checkout weights"
```

### Task 3: Checkout enforces the seller's limits

**Files:**
- Modify: `shared/types/store-payments.ts` (`order_over_limit`, `store_paused`)
- Modify: `worker/services/store-payments/checkout.ts`
- Modify: `worker/api/handlers/store-platform.ts` (deps)
- Create: `worker/services/alerts/seller-notices.ts`
- Modify: `worker/services/email/templates.ts` (`sellerLimitReachedEmail`)
- Modify: `worker/services/alerts/platform-alerts.ts` (kinds)
- Test: `worker/services/store-payments/checkout.test.ts`, `worker/services/alerts/seller-notices.test.ts`

**Interfaces:**
- Consumes: `limitsFor`, `weightedCartCents` (Task 1); `weeklyUsage` (Task 2).
- Produces:
  - `StartCheckoutDeps` gains:
    - `sellerLimits(): Promise<{ largestOrderCents: number; weeklySalesCents: number }>`;
    - `weeklyUsage(): Promise<number>`;
    - `limitReached(): Promise<void>`;
  - `sendSellerNotice(deps: SellerNoticeDeps, notice: SellerNotice): Promise<'sent' | 'throttled' | 'not-sent'>`;
  - `sellerNoticesFromEnv(env): (notice: SellerNotice) => Promise<void>`;
  - alert kinds `risk-hold`, `seller-limit-reached`, `seller-level-changed`, `seller-level-sync-failed` and `seller-charge-unpaid`.

- [ ] **Step 1: Write the failing tests**

In `worker/services/store-payments/checkout.test.ts`, add to the default `fakeDeps`:

```ts
		sellerLimits: async () => ({ largestOrderCents: 15_000, weeklySalesCents: 50_000 }),
		weeklyUsage: async () => 0,
		limitReached: async () => {
			limits.push('reached');
		},
```

Declare `const limits: string[] = [];` and return it. Then add:

```ts
	it("refuses an order larger than the seller's largest, without saving it", async () => {
		const { deps, saved, sessions } = fakeDeps({ sellerLimits: async () => ({ largestOrderCents: 4599, weeklySalesCents: 50_000 }) });
		expect(await startStoreCheckout(deps, INPUT)).toEqual({ ok: false, reason: 'order_over_limit', message: "This store can't take an order this large yet." });
		expect(saved).toHaveLength(0);
		expect(sessions).toHaveLength(0);
	});

	it('pauses the store when this order would pass the weekly cap, and says so once to the seller', async () => {
		// The cart is two own mugs at $20 plus $6 shipping: $46.00, weighted $86.00.
		const { deps, limits } = fakeDeps({ weeklyUsage: async () => 50_000 - 8599 });
		expect(await startStoreCheckout(deps, INPUT)).toEqual({ ok: false, reason: 'store_paused', message: "This store isn't taking new orders right now. Try again later." });
		expect(limits).toEqual(['reached']);

		const fits = fakeDeps({ weeklyUsage: async () => 50_000 - 8600 });
		expect(await startStoreCheckout(fits.deps, INPUT)).toMatchObject({ ok: true });
	});

	it("saves the checkout's weight, so the next checkout counts it", async () => {
		const { deps, saved } = fakeDeps();
		await startStoreCheckout(deps, INPUT);
		expect(saved[0].weightedCents).toBe(8600);
	});
```

```ts
// worker/services/alerts/seller-notices.test.ts
import { describe, expect, it } from 'vitest';
import { sendSellerNotice, type SellerNoticeDeps } from './seller-notices';
import type { OutgoingEmail } from '../email/types';

function fakeDeps(email: string | null = 'seller@example.test') {
	const kv = new Map<string, string>();
	const sent: OutgoingEmail[] = [];
	const deps: SellerNoticeDeps = {
		throttle: { get: async (key) => kv.get(key) ?? null, put: async (key, value) => void kv.set(key, value) },
		sender: { send: async (message) => void sent.push(message) },
		sellerEmail: async () => email,
	};
	return { deps, kv, sent };
}

describe('sendSellerNotice', () => {
	it("tells the seller their store hit its weekly cap, once a day", async () => {
		const { deps, sent } = fakeDeps();
		const notice = { sellerUserId: 'u1', kind: 'limit-reached' as const, weeklySalesCents: 50_000 };
		expect(await sendSellerNotice(deps, notice)).toBe('sent');
		expect(await sendSellerNotice(deps, notice)).toBe('throttled');
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('seller@example.test');
		expect(sent[0].text).toContain('$500.00');
	});

	it('sends nothing when the seller has no email', async () => {
		const { deps, sent } = fakeDeps(null);
		expect(await sendSellerNotice(deps, { sellerUserId: 'u1', kind: 'limit-reached', weeklySalesCents: 50_000 })).toBe('not-sent');
		expect(sent).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/store-payments/checkout.test.ts worker/services/alerts/seller-notices.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `shared/types/store-payments.ts`:
- Add `| 'order_over_limit' | 'store_paused'` to `StoreCheckoutRefusal`.
- Add these messages to `STORE_CHECKOUT_MESSAGES`:

```ts
	order_over_limit: "This store can't take an order this large yet.",
	store_paused: "This store isn't taking new orders right now. Try again later.",
```

In `checkout.ts`:
- Add the three deps to `StartCheckoutDeps`, each with a comment.
- After `if (!priced.ok) return refusal(priced.reason);`, add:

```ts
	const limits = await deps.sellerLimits();
	if (priced.cart.totalCents > limits.largestOrderCents) return refusal('order_over_limit');
	const weightedCents = weightedCartCents(priced.cart);
	if ((await deps.weeklyUsage()) + weightedCents > limits.weeklySalesCents) {
		await deps.limitReached();
		return refusal('store_paused');
	}
```

- Pass `weightedCents` into `saveCheckout`.

The checkout is saved as `creating` before Stripe is called. A second checkout's usage read therefore counts this one.

```ts
// worker/services/alerts/seller-notices.ts
/** Emails to sellers about their store: a reached limit, or items Estori refunded. Once a day per kind and subject. */

import { createEmailSender } from '../email/sender';
import { sellerItemsRefundedEmail, sellerLimitReachedEmail } from '../email/templates';
import type { EmailSender } from '../email/types';
import { UserService } from '../../database';
import { createLogger } from '../../logger';

export type SellerNotice =
	| { sellerUserId: string; kind: 'limit-reached'; weeklySalesCents: number }
	| { sellerUserId: string; kind: 'items-refunded'; orderId: string; itemCount: number; reason: 'supplier' | 'risk' };

export interface SellerNoticeDeps {
	throttle: { get(key: string): Promise<string | null>; put(key: string, value: string, options: { expirationTtl: number }): Promise<void> };
	sender: EmailSender | null;
	sellerEmail(sellerUserId: string): Promise<string | null>;
}

const DAY_SECONDS = 24 * 60 * 60;

export async function sendSellerNotice(deps: SellerNoticeDeps, notice: SellerNotice): Promise<'sent' | 'throttled' | 'not-sent'> {
	const subject = notice.kind === 'limit-reached' ? notice.sellerUserId : notice.orderId;
	const key = `seller-notice:${notice.kind}:${subject}`;
	if (await deps.throttle.get(key)) return 'throttled';
	const to = await deps.sellerEmail(notice.sellerUserId);
	if (!deps.sender || !to) return 'not-sent';
	await deps.sender.send(notice.kind === 'limit-reached' ? sellerLimitReachedEmail(to, notice.weeklySalesCents) : sellerItemsRefundedEmail(to, notice.itemCount, notice.reason));
	await deps.throttle.put(key, '1', { expirationTtl: DAY_SECONDS });
	return 'sent';
}

const logger = createLogger('SellerNotices');

export function sellerNoticesFromEnv(env: Env): (notice: SellerNotice) => Promise<void> {
	const deps: SellerNoticeDeps = {
		throttle: env.VibecoderStore,
		sender: createEmailSender(env),
		sellerEmail: async (userId) => (await new UserService(env).findUser({ id: userId }))?.email ?? null,
	};
	return async (notice) => {
		try {
			await sendSellerNotice(deps, notice);
		} catch (error) {
			logger.error('Could not email a seller notice', { notice, error });
		}
	};
}
```

Check `UserService.findUser`'s option shape in `worker/database/services/UserService.ts:33`. If it isn't `{ id }`, use the shape it takes.

In `worker/services/email/templates.ts`:

```ts
/** To a seller whose store reached its weekly sales cap. */
export function sellerLimitReachedEmail(to: string, weeklySalesCents: number): OutgoingEmail {
	return renderEmail({
		to,
		subject: 'Your store reached its weekly sales limit',
		heading: 'Your store paused new orders',
		body: `Your store reached its limit of $${(weeklySalesCents / 100).toFixed(2)} in sales over 7 days, so it isn't taking new orders until the oldest sales leave that window. Limits grow as your store builds a record of delivered orders.`,
		footer: 'You can see your limits under Profile, Paid listings, Get paid with Stripe.',
	});
}

/** To a seller whose order had items Estori refunded to the shopper. */
export function sellerItemsRefundedEmail(to: string, itemCount: number, reason: 'supplier' | 'risk'): OutgoingEmail {
	const why = reason === 'supplier' ? 'they could not be shipped' : 'the payment looked risky and could not be confirmed in time';
	return renderEmail({
		to,
		subject: 'We refunded items from an order in your store',
		heading: 'Items refunded',
		body: `We refunded ${itemCount} item${itemCount === 1 ? '' : 's'} from an order in your store because ${why}. Your share of those items was taken back, and the shopper got their money for them.`,
		footer: 'The order shows each item as refunded.',
	});
}
```

In `platform-alerts.ts`, add these kinds and labels:
- `risk-hold`: "A payment looks risky"
- `seller-limit-reached`: "A store reached its weekly limit"
- `seller-level-changed`: "A seller's level changed"
- `seller-level-sync-failed`: "A seller's payout delay couldn't be set"
- `seller-charge-unpaid`: "A seller owes Estori"

In `store-platform.ts`'s `serveCheckout` deps, the target's seller is `target.previewUserId`:

```ts
			sellerLimits: async () => {
				const settings = (await getUserConfigurableSettings(env, target.previewUserId)).sellerLimits;
				const level = settings.pinnedLevel ?? (await new StripeConnectService(env).getByUser(target.previewUserId))?.sellerLevel ?? 'new';
				return limitsFor(level, settings);
			},
			weeklyUsage: () => checkouts.weeklyUsage(target.previewUserId, 'test', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
			limitReached: async () => {
				const settings = (await getUserConfigurableSettings(env, target.previewUserId)).sellerLimits;
				const level = settings.pinnedLevel ?? (await new StripeConnectService(env).getByUser(target.previewUserId))?.sellerLevel ?? 'new';
				const weeklySalesCents = limitsFor(level, settings).weeklySalesCents;
				await platformAlertsFromEnv(env)({ kind: 'seller-limit-reached', subject: target.previewUserId, message: `A store reached its weekly limit of $${(weeklySalesCents / 100).toFixed(2)}.` });
				await sellerNoticesFromEnv(env)({ sellerUserId: target.previewUserId, kind: 'limit-reached', weeklySalesCents });
			},
```

The stored level is kept current by Task 4, and a pin wins over it.

The mode is `'test'` because previews take test-mode payments only. Live stores will pass their own mode.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/store-payments worker/services/alerts worker/services/email`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.worker.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add shared/types/store-payments.ts worker/services/store-payments/ worker/api/handlers/store-platform.ts worker/services/alerts/ worker/services/email/templates.ts
git commit -m "feat(store-payments): checkout keeps each store within its largest order and weekly sales"
```

### Task 4: Keeping each seller's level and payout delay current

**Files:**
- Create: `worker/services/payments/seller-level-sync.ts`
- Modify: `worker/services/store-payments/wiring.ts` (sync after each sale, and after a lost dispute)
- Modify: `worker/api/controllers/payments/connectController.ts` (a new account starts at the New level's delay)
- Modify: `worker/services/catalog/scheduler.ts` (the daily sync of active sellers)
- Test: `worker/services/payments/seller-level-sync.test.ts`

**Interfaces:**
- Consumes:
  - `sellerLevelOf` and `limitsFor` (Task 1);
  - `sellerRecord`, `saveLevel` and `activeSellerIds` (Task 2);
  - `updatePayoutSchedule` and `scheduleOf` (money-rules plan).
- Produces:
  - `syncSellerLevel(deps: LevelSyncDeps, sellerUserId: string, nowMs: number): Promise<'unchanged' | 'changed' | 'failed' | 'no-account'>`;
  - `syncSellerLevelFromEnv(env: Env, sellerUserId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/services/payments/seller-level-sync.test.ts
import { describe, expect, it } from 'vitest';
import { syncSellerLevel, type LevelSyncDeps } from './seller-level-sync';
import { DEFAULT_SELLER_LIMITS, type SellerRecord } from '../../../shared/types/seller-levels';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ESTABLISHED: SellerRecord = { firstSaleAt: new Date(NOW - 60 * DAY), completedOrders: 20, ordersLast90Days: 20, disputesLast90Days: 0, lostDisputesLast90Days: 0 };
const NEW: SellerRecord = { ...ESTABLISHED, completedOrders: 2 };

function fakeDeps(input: { record: SellerRecord; stored?: { level: 'new' | 'established'; payoutDelayDays: number | null } | null; stripeFails?: boolean }) {
	const calls: string[] = [];
	const deps: LevelSyncDeps = {
		record: async () => input.record,
		settings: async () => DEFAULT_SELLER_LIMITS,
		stored: async () => (input.stored === null ? null : { stripeAccountId: 'acct_1', level: input.stored?.level ?? 'new', payoutDelayDays: input.stored?.payoutDelayDays ?? null, payoutInterval: 'weekly', payoutAnchor: 'monday' }),
		updateSchedule: async (accountId, schedule) => {
			if (input.stripeFails) throw new Error('Account restricted');
			calls.push(`stripe ${accountId} ${schedule.interval} ${schedule.weeklyAnchor} ${schedule.delayDays}`);
		},
		saveLevel: async (level, delay) => void calls.push(`save ${level} ${delay}`),
		alert: async (alert) => void calls.push(`alert ${alert.kind}`),
	};
	return { deps, calls };
}

describe('syncSellerLevel', () => {
	it('does nothing when the level and delay already match', async () => {
		const { deps, calls } = fakeDeps({ record: NEW, stored: { level: 'new', payoutDelayDays: 10 } });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('unchanged');
		expect(calls).toEqual([]);
	});

	it("moves a seller up: Stripe's delay first, keeping their payout day, then the stored level, then an alert", async () => {
		const { deps, calls } = fakeDeps({ record: ESTABLISHED, stored: { level: 'new', payoutDelayDays: 10 } });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('changed');
		expect(calls).toEqual(['stripe acct_1 weekly monday 5', 'save established 5', 'alert seller-level-changed']);
	});

	it("sets the delay on a seller's first sync without calling it a level change", async () => {
		const { deps, calls } = fakeDeps({ record: NEW, stored: { level: 'new', payoutDelayDays: null } });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('changed');
		expect(calls).toEqual(['stripe acct_1 weekly monday 10', 'save new 10']);
	});

	it("keeps the old level when Stripe refuses, and alerts", async () => {
		const { deps, calls } = fakeDeps({ record: ESTABLISHED, stored: { level: 'new', payoutDelayDays: 10 }, stripeFails: true });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('failed');
		expect(calls).toEqual(['alert seller-level-sync-failed']);
	});

	it('skips a seller with no Stripe account', async () => {
		const { deps } = fakeDeps({ record: NEW, stored: null });
		expect(await syncSellerLevel(deps, 'u1', NOW)).toBe('no-account');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/payments/seller-level-sync.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement**

```ts
// worker/services/payments/seller-level-sync.ts
/** Re-evaluates a seller's level from their record, and sets Stripe's payout delay to match when it changes. */

import { limitsFor, sellerLevelOf, type SellerLevel, type SellerLimitsSettings, type SellerRecord } from '../../../shared/types/seller-levels';
import type { PayoutInterval } from '../../../shared/types/store-payments';
import type { PayoutSchedule } from './stripe-client';
import { scheduleOf } from '../../api/controllers/payments/payout-request';
import type { PlatformAlert } from '../alerts/platform-alerts';

export interface LevelSyncDeps {
	record(): Promise<SellerRecord>;
	settings(): Promise<SellerLimitsSettings>;
	stored(): Promise<{ stripeAccountId: string; level: SellerLevel; payoutDelayDays: number | null; payoutInterval: PayoutInterval; payoutAnchor: string } | null>;
	updateSchedule(stripeAccountId: string, schedule: PayoutSchedule): Promise<void>;
	saveLevel(level: SellerLevel, payoutDelayDays: number): Promise<void>;
	alert(alert: PlatformAlert): Promise<void>;
}

export async function syncSellerLevel(deps: LevelSyncDeps, sellerUserId: string, nowMs: number): Promise<'unchanged' | 'changed' | 'failed' | 'no-account'> {
	const stored = await deps.stored();
	if (!stored) return 'no-account';
	const settings = await deps.settings();
	const level = sellerLevelOf(await deps.record(), settings, nowMs);
	const delay = limitsFor(level, settings).payoutDelayDays;
	if (level === stored.level && delay === stored.payoutDelayDays) return 'unchanged';
	try {
		await deps.updateSchedule(stored.stripeAccountId, { ...scheduleOf({ interval: stored.payoutInterval, anchor: stored.payoutAnchor }), delayDays: delay });
	} catch (error) {
		await deps.alert({ kind: 'seller-level-sync-failed', subject: sellerUserId, message: `Stripe refused a payout delay of ${delay} days: ${error instanceof Error ? error.message : String(error)}` });
		return 'failed';
	}
	await deps.saveLevel(level, delay);
	if (level !== stored.level) await deps.alert({ kind: 'seller-level-changed', subject: sellerUserId, message: `The seller is now ${level}, with payouts after ${delay} business days.` });
	return 'changed';
}
```

`scheduleOf` lives in the controller folder (money-rules Task 9). Move it, together with `parsePayoutRequest`, to `worker/services/payments/payout-schedule.ts`, so a service doesn't import from a controller. Update the controller's import, and import from there in this file.

`syncSellerLevelFromEnv(env, sellerUserId)` goes in the same file:
- `record` reads `new StoreOrderService(env).sellerRecord(sellerUserId, mode, Date.now())`, where `mode` is `stripeMode(env) === 'live' ? 'live' : 'test'`. Use the existing helper that reads the Stripe key's mode in `worker/services/payments/config.ts`.
- `settings` reads `(await getUserConfigurableSettings(env, sellerUserId)).sellerLimits`.
- `stored` reads `StripeConnectService.getByUser` and maps the row.
- `updateSchedule` calls `stripe.updatePayoutSchedule`.
- `saveLevel` calls `StripeConnectService.saveLevel`.
- `alert` is `platformAlertsFromEnv(env)`.
- With no Stripe key, the function returns without doing anything.
- The whole function never throws: catch, then log with `createLogger('SellerLevelSync')`.

Hooks:
- In `wiring.ts`'s `settleSale`, after `settleSale(...)`, add `await syncSellerLevelFromEnv(env, order.sellerUserId);`.
- In `disputeDepsFromEnv`'s `setOrderStatus`, after `setPaymentStatus`, add `if (status === 'dispute_lost' && order) await syncSellerLevelFromEnv(env, order.sellerUserId);`. Keep the found order in a closure variable next to `orderId`.
- In `connectController.startOnboarding`, the default schedule for a new account becomes the New level's delay:

```ts
                const settings = (await getUserConfigurableSettings(env, user.id)).sellerLimits;
                const delay = limitsFor('new', settings).payoutDelayDays;
                await stripe.updatePayoutSchedule(created.id, { interval: 'weekly', weeklyAnchor: 'monday', monthlyAnchor: null, delayDays: delay });
                await accounts.saveLevel(user.id, 'new', delay);
```

  Keep these inside the existing try/catch that logs a warning.
- In `scheduler.ts`, the `CATALOG_HEALTH_CRON` branch also syncs active sellers:

```ts
		const sellers = await new StoreOrderService(env).activeSellerIds(new Date(Date.now() - 120 * 24 * 60 * 60 * 1000));
		for (const sellerUserId of sellers) await syncSellerLevelFromEnv(env, sellerUserId);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/payments worker/services/store-payments worker/services/catalog/health.test.ts worker/api/controllers/payments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/payments/ worker/services/store-payments/wiring.ts worker/api/controllers/payments/ worker/services/catalog/scheduler.ts
git commit -m "feat(payments): keep each seller's level and payout delay current"
```

### Task 5: The seller sees their level and limits

**Files:**
- Modify: `worker/api/controllers/stores/controller.ts` (`limits`), `worker/api/routes/storeRoutes.ts`
- Modify: `src/lib/api-client.ts`, `src/hooks/use-payments.ts`
- Create: `src/components/payments/SellerLimits.tsx`
- Modify: `src/components/payments/PayoutsCard.tsx`
- Test: `worker/api/controllers/stores/limits-view.test.ts`, `src/components/payments/payments-setup.test.ts`

**Interfaces:**
- Consumes: `sellerLevelOf`, `limitsFor` and `SellerLimitsData` (Task 1); `sellerRecord` and `weeklyUsage` (Task 2).
- Produces:
  - `limitsView(input: { record: SellerRecord; settings: SellerLimitsSettings; storedLevel: SellerLevel; weeklySalesUsedCents: number; nowMs: number }): SellerLimitsData`;
  - `GET /api/stores/limits` (authenticated);
  - `apiClient.getSellerLimits()` and `useSellerLimits()`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/api/controllers/stores/limits-view.test.ts
import { describe, expect, it } from 'vitest';
import { limitsView } from './limits-view';
import { DEFAULT_SELLER_LIMITS } from '../../../../shared/types/seller-levels';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe('limitsView', () => {
	it("shows a new seller's limits, this week's use, and what's left to reach Established", () => {
		const view = limitsView({ record: { firstSaleAt: new Date(NOW - 12 * DAY), completedOrders: 4, ordersLast90Days: 6, disputesLast90Days: 0, lostDisputesLast90Days: 0 }, settings: DEFAULT_SELLER_LIMITS, storedLevel: 'new', weeklySalesUsedCents: 12_000, nowMs: NOW });
		expect(view).toEqual({
			level: 'new',
			largestOrderCents: 15_000,
			weeklySalesCents: 50_000,
			weeklySalesUsedCents: 12_000,
			payoutDelayDays: 10,
			nextLevel: { completedOrders: 4, completedOrdersNeeded: 10, daysSinceFirstSale: 12, daysNeeded: 30 },
		});
	});

	it('has no next level for an established seller, or for a pinned one', () => {
		const record = { firstSaleAt: new Date(NOW - 90 * DAY), completedOrders: 40, ordersLast90Days: 40, disputesLast90Days: 0, lostDisputesLast90Days: 0 };
		expect(limitsView({ record, settings: DEFAULT_SELLER_LIMITS, storedLevel: 'established', weeklySalesUsedCents: 0, nowMs: NOW }).nextLevel).toBeNull();
		expect(limitsView({ record: { ...record, completedOrders: 0 }, settings: { ...DEFAULT_SELLER_LIMITS, pinnedLevel: 'new' }, storedLevel: 'new', weeklySalesUsedCents: 0, nowMs: NOW }).nextLevel).toBeNull();
	});
});
```

In `payments-setup.test.ts`, add `'/src/components/payments/SellerLimits.tsx'` to the glob, then:

```ts
	it("shows the seller's level, their two limits with this week's use, and the way up", () => {
		const limits = source('/src/components/payments/SellerLimits.tsx');
		for (const text of ['Largest order', 'Sales this week', 'Payouts wait', 'completed orders', 'useSellerLimits(']) expect(limits).toContain(text);
		expect(source('/src/components/payments/PayoutsCard.tsx')).toContain('<SellerLimits />');
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/api/controllers/stores/limits-view.test.ts src/components/payments/payments-setup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// worker/api/controllers/stores/limits-view.ts
import { limitsFor, type SellerLevel, type SellerLimitsData, type SellerLimitsSettings, type SellerRecord } from '../../../../shared/types/seller-levels';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stored level is what Stripe's payout delay matches; a pin shows as that level with no way up. */
export function limitsView(input: { record: SellerRecord; settings: SellerLimitsSettings; storedLevel: SellerLevel; weeklySalesUsedCents: number; nowMs: number }): SellerLimitsData {
	const level = input.settings.pinnedLevel ?? input.storedLevel;
	const limits = limitsFor(level, input.settings);
	const days = input.record.firstSaleAt ? Math.floor((input.nowMs - input.record.firstSaleAt.getTime()) / DAY_MS) : 0;
	return {
		level,
		...limits,
		weeklySalesUsedCents: input.weeklySalesUsedCents,
		nextLevel:
			level === 'established' || input.settings.pinnedLevel
				? null
				: { completedOrders: input.record.completedOrders, completedOrdersNeeded: input.settings.graduation.completedOrders, daysSinceFirstSale: days, daysNeeded: input.settings.graduation.daysSinceFirstSale },
	};
}
```

In the stores controller, add a `limits` method for the signed-in user:
- `mode` is `stripeMode(env) === 'live' ? 'live' : 'test'`.
- Load the record with `StoreOrderService.sellerRecord(userId, mode, now)`, the settings from `getUserConfigurableSettings`, the stored level from `StripeConnectService.getByUser`, defaulting to `'new'`, and the usage from `StoreCheckoutService.weeklyUsage(userId, mode, now - 7 days)`.
- Return `limitsView(...)`, and 500 on errors with the message "Failed to load your store limits".

The route goes in `storeRoutes.ts` before the `:id` routes:

```ts
    app.get('/api/stores/limits', setAuthLevel(AuthConfig.authenticated), adaptController(StoreOrdersController, StoreOrdersController.limits));
```

Client and hook:

```ts
	async getSellerLimits(): Promise<ApiResponse<SellerLimitsData>> {
		return this.request<SellerLimitsData>('/api/stores/limits');
	}
```

```ts
export function useSellerLimits() {
	const { user } = useAuth();
	return useQuery({
		queryKey: [...queryKeys.account.payments.status(user?.id), 'limits'],
		queryFn: () => unwrap(apiClient.getSellerLimits(), 'Failed to load your store limits'),
		enabled: !!user,
	});
}
```

```tsx
// src/components/payments/SellerLimits.tsx
import { Badge } from '@cloudflare/kumo';
import { useSellerLimits } from '@/hooks/use-payments';

function dollars(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** The seller's level, their two store limits with this week's use, and what's left before the next level. */
export function SellerLimits() {
	const limits = useSellerLimits();
	if (!limits.data) return null;
	const data = limits.data;
	return (
		<div className="grid gap-1 text-sm text-kumo-default">
			<div className="flex items-center gap-2">
				<span className="font-medium">Store limits</span>
				<Badge variant={data.level === 'established' ? 'success' : 'info'}>{data.level === 'established' ? 'Established seller' : 'New seller'}</Badge>
			</div>
			<span>Largest order: {dollars(data.largestOrderCents)}</span>
			<span>
				Sales this week: {dollars(data.weeklySalesUsedCents)} of {dollars(data.weeklySalesCents)}
			</span>
			<span>Payouts wait {data.payoutDelayDays} business days after each sale.</span>
			{data.nextLevel && (
				<span className="text-kumo-subtle">
					Limits grow at {data.nextLevel.completedOrdersNeeded} completed orders and {data.nextLevel.daysNeeded} days of selling. You have {data.nextLevel.completedOrders} completed orders and {data.nextLevel.daysSinceFirstSale} days.
				</span>
			)}
		</div>
	);
}
```

In `PayoutsCard`'s `step === null` branch, render `<SellerLimits />` after `<PayoutFrequency status={data} />`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/api/controllers/stores src/components/payments`
Expected: PASS.

Run both `tsc` configs.
Expected: clean, apart from the 4 `artifacts-viewer` errors.

- [ ] **Step 5: Commit**

```bash
git add worker/api/controllers/stores/ worker/api/routes/storeRoutes.ts src/lib/api-client.ts src/hooks/use-payments.ts src/components/payments/
git commit -m "feat(stores): sellers see their level, limits and the way up"
```

### Task 6: Admins override a seller's limits

**Files:**
- Create: `worker/api/controllers/admin/seller-limits.ts`
- Modify: `worker/api/routes/storeRoutes.ts` (admin route)
- Test: `worker/api/controllers/admin/seller-limits.test.ts`

**Interfaces:**
- Consumes: `syncSellerLevelFromEnv` (Task 4); `SellerLimitsSettings` (Task 1).
- Produces:
  - `parseSellerLimitsOverride(body: unknown): SellerLimitsOverride | null`;
  - `mergeSellerLimitsOverride(stored: string | null, override: SellerLimitsOverride): string`, which returns the new KV JSON;
  - `PUT /api/admin/sellers/:userId/limits` (admin).

- [ ] **Step 1: Write the failing test**

```ts
// worker/api/controllers/admin/seller-limits.test.ts
import { describe, expect, it } from 'vitest';
import { mergeSellerLimitsOverride, parseSellerLimitsOverride } from './seller-limits';

describe('seller limits overrides', () => {
	it('accepts a pinned level, or null to clear it, and numbers in range', () => {
		expect(parseSellerLimitsOverride({ pinnedLevel: 'established', largestOrderCents: 30_000 })).toEqual({ pinnedLevel: 'established', largestOrderCents: 30_000 });
		expect(parseSellerLimitsOverride({ pinnedLevel: null, payoutDelayDays: null })).toEqual({ pinnedLevel: null, payoutDelayDays: null });
	});

	it('refuses unknown levels, out-of-range numbers and unknown fields', () => {
		for (const body of [{ pinnedLevel: 'vip' }, { largestOrderCents: 50 }, { weeklySalesCents: 20_000_000 }, { payoutDelayDays: 1 }, { payoutDelayDays: 32 }, { costs: {} }, {}]) {
			expect(parseSellerLimitsOverride(body)).toBeNull();
		}
	});

	it("keeps the rest of the user's stored config and replaces only what was sent", () => {
		const stored = JSON.stringify({ security: { rateLimit: { appCreation: { limit: 1000 } } }, sellerLimits: { pinnedLevel: 'new', overrides: { largestOrderCents: 20_000 } } });
		const merged = JSON.parse(mergeSellerLimitsOverride(stored, { payoutDelayDays: 7 }));
		expect(merged.security.rateLimit.appCreation.limit).toBe(1000);
		expect(merged.sellerLimits).toEqual({ pinnedLevel: 'new', overrides: { largestOrderCents: 20_000, payoutDelayDays: 7 } });
		expect(JSON.parse(mergeSellerLimitsOverride(null, { pinnedLevel: 'established' }))).toEqual({ sellerLimits: { pinnedLevel: 'established', overrides: {} } });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/api/controllers/admin/seller-limits.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// worker/api/controllers/admin/seller-limits.ts
/** Admins pin a seller's level or set their own limits; stored in the seller's user_config KV entry. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { SELLER_LEVELS, type SellerLevel } from '../../../../shared/types/seller-levels';
import { syncSellerLevelFromEnv } from '../../../services/payments/seller-level-sync';

export interface SellerLimitsOverride {
	pinnedLevel?: SellerLevel | null;
	largestOrderCents?: number | null;
	weeklySalesCents?: number | null;
	payoutDelayDays?: number | null;
}

const RANGES: Readonly<Record<'largestOrderCents' | 'weeklySalesCents' | 'payoutDelayDays', readonly [number, number]>> = {
	largestOrderCents: [100, 10_000_000],
	weeklySalesCents: [100, 10_000_000],
	payoutDelayDays: [2, 31],
};

export function parseSellerLimitsOverride(body: unknown): SellerLimitsOverride | null {
	if (typeof body !== 'object' || body === null) return null;
	const entries = Object.entries(body as Record<string, unknown>);
	if (entries.length === 0) return null;
	const override: SellerLimitsOverride = {};
	for (const [key, value] of entries) {
		if (key === 'pinnedLevel') {
			if (value !== null && !(SELLER_LEVELS as readonly unknown[]).includes(value)) return null;
			override.pinnedLevel = value as SellerLevel | null;
		} else if (key in RANGES) {
			const [min, max] = RANGES[key as keyof typeof RANGES];
			if (value !== null && (!Number.isInteger(value) || (value as number) < min || (value as number) > max)) return null;
			override[key as keyof typeof RANGES] = value as number | null;
		} else {
			return null;
		}
	}
	return override;
}

export function mergeSellerLimitsOverride(stored: string | null, override: SellerLimitsOverride): string {
	const config = stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
	const current = (config.sellerLimits ?? {}) as { pinnedLevel?: SellerLevel | null; overrides?: Record<string, number | null> };
	const { pinnedLevel, ...numbers } = override;
	const next = {
		pinnedLevel: pinnedLevel !== undefined ? pinnedLevel : (current.pinnedLevel ?? null),
		overrides: { ...(current.overrides ?? {}), ...numbers },
	};
	return JSON.stringify({ ...config, sellerLimits: next });
}

export class SellerLimitsAdminController extends BaseController {
	static async setLimits(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ saved: true }>>> {
		const userId = context.pathParams.userId;
		const body = await SellerLimitsAdminController.parseJsonBody<unknown>(request);
		const override = userId && body.success ? parseSellerLimitsOverride(body.data) : null;
		if (!userId || !override) return SellerLimitsAdminController.createErrorResponse('Send a level to pin (or null) and limits in range', 400);
		const key = `user_config:${userId}`;
		await env.VibecoderStore.put(key, mergeSellerLimitsOverride(await env.VibecoderStore.get(key), override));
		await syncSellerLevelFromEnv(env, userId);
		return SellerLimitsAdminController.createSuccessResponse({ saved: true });
	}
}
```

The test's last expectation is `{ pinnedLevel: 'established', overrides: {} }` for an empty store. With `pinnedLevel` given, `next.pinnedLevel` is `'established'` and `overrides` is `{}`, which matches.

Route, in `storeRoutes.ts`:

```ts
    app.put('/api/admin/sellers/:userId/limits', setAuthLevel(AuthConfig.admin), adaptController(SellerLimitsAdminController, SellerLimitsAdminController.setLimits));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/api/controllers/admin/seller-limits.test.ts worker/config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/api/controllers/admin/seller-limits.ts worker/api/controllers/admin/seller-limits.test.ts worker/api/routes/storeRoutes.ts
git commit -m "feat(admin): pin a seller's level or set their own limits"
```

### Task 7: Holding risky payments before buying from the supplier

**Files:**
- Modify: `worker/services/catalog/runner.ts`
- Modify: `worker/services/catalog/CatalogOrderRunner.ts` (`release()`, deps)
- Modify: `worker/services/catalog/store.ts` (`CatalogOrderRow.sellerUserId`), `worker/database/services/CatalogOrderService.ts` (select it), `worker/services/catalog/test-support.ts` (memory store)
- Modify: `worker/services/payments/stripe-client.ts` (`outcome` on the charge summary)
- Modify: `worker/api/controllers/catalog/controller.ts`, `worker/api/routes/catalogRoutes.ts` (release route)
- Test: `worker/services/catalog/runner.test.ts`

**Interfaces:**
- Consumes: `refundCatalogItems` with `'risk-declined'` (money-rules plan); `SellerNotice` (Task 3).
- Produces:
  - `RunnerState` gains `riskChecked?: boolean`, `riskHoldUntil?: number | null`, and `placement: 'due' | 'done' | 'needs-attention' | 'risk-hold'`;
  - `RunnerDeps` gains `paymentRisk(paymentIntentId: string): Promise<'normal' | 'elevated' | 'highest' | 'unknown'>`, and `notifySeller(notice: SellerNotice): Promise<void>`;
  - `RISK_HOLD_MS = 24 * 60 * 60 * 1000`;
  - `releaseRiskHold(state: RunnerState, nowMs: number): RunnerState`;
  - `CatalogOrderRunner.release()`;
  - `POST /api/admin/catalog/orders/:id/release`.

- [ ] **Step 1: Write the failing tests**

In `runner.test.ts`:
- Extend `deps(...)` with a `risk` parameter that defaults to `'normal'`, plus `paymentRisk: async () => risk` and `notifySeller: async (notice) => void notices.push(notice.kind)`.
- Declare `const notices: string[] = [];` and return it.
- Import `RISK_HOLD_MS` and `releaseRiskHold`.
- Add:

```ts
	it('holds an elevated-risk order before buying, and places it once an admin releases it', async () => {
		const store = await storeWithOrder();
		let placed = 0;
		const { runnerDeps, alerts } = deps(store, [{ ok: true, supplierOrderId: 'cj_1' }], [], 'elevated');
		const original = runnerDeps.adapters.cjdropshipping.placeOrder;
		runnerDeps.adapters.cjdropshipping.placeOrder = async (input) => {
			placed += 1;
			return original(input);
		};

		const held = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		expect(held.state).toMatchObject({ placement: 'risk-hold', riskChecked: true, riskHoldUntil: NOW + RISK_HOLD_MS });
		expect(held.nextAlarmAt).toBe(NOW + RISK_HOLD_MS);
		expect(placed).toBe(0);
		expect(alerts).toContain('risk-hold');
		expect(store.orders.get('co_1')?.status).toBe('risk-hold');

		const released = await runnerStep(releaseRiskHold(held.state, NOW + 1000), runnerDeps, NOW + 1000);
		expect(placed).toBe(1);
		expect(released.state.placement).toBe('done');
	});

	it("refunds an unreviewed risky order's catalog items after 24 hours and tells the seller", async () => {
		const store = await storeWithOrder();
		const { runnerDeps, refunds, notices } = deps(store, [], [], 'elevated');
		const held = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		const after = await runnerStep(held.state, runnerDeps, NOW + RISK_HOLD_MS);
		expect(refunds.sort()).toEqual([4000, 5000]);
		expect(after.state.placement).toBe('done');
		expect(notices).toEqual(['items-refunded']);
		expect(store.orders.get('co_1')?.items.every((item) => item.status === 'refunded')).toBe(true);
	});

	it('finds nothing to refund when a dispute already withheld the items', async () => {
		const store = await storeWithOrder();
		const { runnerDeps, refunds } = deps(store, [], [], 'elevated');
		const held = await runnerStep(initialRunnerState('co_1', NOW), runnerDeps, NOW);
		await store.patchItems([{ itemId: 'ci_mug', status: 'withheld' }, { itemId: 'ci_cap', status: 'withheld' }]);
		await runnerStep(held.state, runnerDeps, NOW + RISK_HOLD_MS);
		expect(refunds).toEqual([]);
	});

	it('checks the payment once, including for a runner state saved before risk checks existed', async () => {
		const store = await storeWithOrder();
		let checks = 0;
		const { runnerDeps } = deps(store, [{ ok: true, supplierOrderId: 'cj_1' }]);
		runnerDeps.paymentRisk = async () => {
			checks += 1;
			return 'normal';
		};
		const { riskChecked: _unused, ...legacy } = { ...initialRunnerState('co_1', NOW), riskChecked: undefined };
		const first = await runnerStep(legacy, runnerDeps, NOW);
		await runnerStep(first.state, runnerDeps, NOW + RUNNER_SYNC_INTERVAL_MS);
		expect(checks).toBe(1);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/catalog/runner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `stripe-client.ts`, add `outcome?: { risk_level?: string } | null;` to the charge summary type.

In `store.ts`, `CatalogOrderService` and the memory store in `test-support.ts`:
- add `sellerUserId: string` to `CatalogOrderRow` and select or keep it;
- make `updateOrder`'s `status` accept `'risk-hold'` (it is already typed as `CatalogOrderStatus`).

In `runner.ts`:

```ts
export const RISK_HOLD_MS = 24 * 60 * 60 * 1000;

export interface RunnerState {
	orderId: string;
	placement: 'due' | 'done' | 'needs-attention' | 'risk-hold';
	nextPlacementAt: number;
	refundFailures: number;
	nextRefundAt: number;
	nextSyncAt: number | null;
	startedAt: number;
	/** The payment's risk was read; states saved before risk checks lack it and read as unchecked. */
	riskChecked?: boolean;
	/** While held: when an unreviewed hold refunds the catalog items. */
	riskHoldUntil?: number | null;
}

/** An admin cleared a held order: place it now. */
export function releaseRiskHold(state: RunnerState, nowMs: number): RunnerState {
	if (state.placement !== 'risk-hold') return state;
	return { ...state, placement: 'due', riskChecked: true, riskHoldUntil: null, nextPlacementAt: nowMs };
}
```

Keep the existing fields as they are; only add the two optional fields and the new placement value.

Extract the refund deps the `refund` step builds into `function refundDepsOf(deps: RunnerDeps): RefundItemsDeps | null`, which returns null without Stripe. Then rework `place`:

```ts
async function place(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	if (state.placement === 'risk-hold') return expireRiskHold(state, deps, nowMs);
	if (state.placement !== 'due' || nowMs < state.nextPlacementAt) return state;
	if (!state.riskChecked) {
		const order = await deps.store.getOrder(state.orderId);
		const risk = order ? await deps.paymentRisk(order.paymentIntentId) : 'unknown';
		if (order && (risk === 'elevated' || risk === 'highest')) {
			await deps.store.updateOrder(order.id, { status: 'risk-hold', placementAttempts: order.placementAttempts, lastError: `The payment's risk is ${risk}` });
			await deps.alert({ kind: 'risk-hold', orderId: state.orderId, message: `The payment's risk is ${risk}. Release the order within 24 hours, or its catalog items are refunded.` });
			return { ...state, placement: 'risk-hold', riskChecked: true, riskHoldUntil: nowMs + RISK_HOLD_MS };
		}
		state = { ...state, riskChecked: true };
	}
	// ...the existing placement switch, unchanged, using `state`.
}

async function expireRiskHold(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	if (nowMs < (state.riskHoldUntil ?? 0)) return state;
	const order = await deps.store.getOrder(state.orderId);
	const pending = order?.items.filter((item) => item.status === 'pending').map((item) => item.id) ?? [];
	const refundDeps = refundDepsOf(deps);
	if (order && pending.length > 0) {
		if (!refundDeps) return { ...state, riskHoldUntil: nowMs + STRIPE_MISSING_RETRY_MS };
		await refundCatalogItems(refundDeps, { orderId: order.id, itemIds: pending, reason: 'risk-declined' });
		await deps.notifySeller({ sellerUserId: order.sellerUserId, kind: 'items-refunded', orderId: order.id, itemCount: pending.length, reason: 'risk' });
	}
	if (order) await deps.store.updateOrder(order.id, { status: 'placement-done', placementAttempts: order.placementAttempts, lastError: 'Not released within 24 hours' });
	return { ...state, placement: 'done', riskHoldUntil: null, nextSyncAt: null };
}
```

`place` reassigns `state`, so make the parameter a `let`, or copy it into a local `let current = state`.

In the `refund` step, after rejected items are refunded, tell the seller once per order:

```ts
		await deps.notifySeller({ sellerUserId: order.sellerUserId, kind: 'items-refunded', orderId: order.id, itemCount: totals.refundedItemIds.length, reason: 'supplier' });
```

Do this only when `totals.refundedItemIds.length > 0`.

In `runnerStep`'s `times`, add the hold's expiry:

```ts
	const times = [
		next.placement === 'due' ? next.nextPlacementAt : null,
		next.placement === 'risk-hold' ? (next.riskHoldUntil ?? null) : null,
		refundDue ? next.nextRefundAt : null,
		next.nextSyncAt,
	].filter((time): time is number => time !== null);
```

In `CatalogOrderRunner.ts`:
- `runnerDeps` gains:

```ts
		paymentRisk: async (paymentIntentId) => {
			const stripe = stripeFromEnv(env);
			if (!stripe) return 'unknown';
			const charge = (await stripe.retrievePaymentIntent(paymentIntentId)).latest_charge;
			const level = typeof charge === 'object' && charge !== null ? charge.outcome?.risk_level : undefined;
			return level === 'normal' || level === 'elevated' || level === 'highest' ? level : 'unknown';
		},
		notifySeller: sellerNoticesFromEnv(env),
```

- Add a `release()` method:

```ts
	/** Admin: place a risk-held order now. */
	async release(): Promise<boolean> {
		const state = await this.state();
		if (!state || state.placement !== 'risk-hold') return false;
		const now = Date.now();
		await this.ctx.storage.put(STATE_KEY, releaseRiskHold(state, now));
		await new CatalogOrderService(this.env).updateOrder(state.orderId, { status: 'awaiting-placement', placementAttempts: 0, lastError: null });
		await this.ctx.storage.setAlarm(now);
		return true;
	}
```

Add the admin route and controller method, following `retryOrder`:

```ts
    app.post('/api/admin/catalog/orders/:id/release', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.releaseOrder));
```

```ts
    static async releaseOrder(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ released: boolean }>>> {
        const orderId = context.pathParams.id;
        if (!orderId) return CatalogController.createErrorResponse('Missing order id', 400);
        return CatalogController.createSuccessResponse({ released: await CatalogController.runner(env, orderId).release() });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/catalog worker/api/controllers/catalog`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.worker.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/ worker/services/payments/stripe-client.ts worker/database/services/CatalogOrderService.ts worker/api/controllers/catalog/ worker/api/routes/catalogRoutes.ts
git commit -m "feat(catalog): hold risky payments for review before buying from the supplier"
```

### Task 8: The daily check for charges sellers haven't paid

**Files:**
- Modify: `worker/database/services/SellerChargeService.ts` (`unpaidSince`)
- Modify: `worker/services/catalog/health.ts` and `worker/services/catalog/scheduler.ts`
- Test: `worker/services/catalog/health.test.ts`

**Interfaces:**
- Consumes: `SellerChargeService` (money-rules plan); `CatalogHealthDeps` (setup plan, Task 8).
- Produces:
  - `SellerChargeService.unpaidSince(before: Date): Promise<Array<{ sellerUserId: string; owedCents: number }>>`;
  - `CatalogHealthDeps` gains `unpaidCharges(before: Date): Promise<Array<{ sellerUserId: string; owedCents: number }>>`.

- [ ] **Step 1: Write the failing test**

In `health.test.ts`, give `fakeDeps` the default `unpaidCharges: async () => []`. Then add:

```ts
	it('alerts once per seller whose charges are unpaid after 60 days', async () => {
		const asked: number[] = [];
		const { deps, alerts } = fakeDeps({
			unpaidCharges: async (before) => {
				asked.push(before.getTime());
				return [{ sellerUserId: 'u1', owedCents: 1500 }];
			},
		});
		await runCatalogHealth(deps, NOW);
		expect(asked).toEqual([NOW - 60 * DAY]);
		expect(alerts.filter((alert) => alert.kind === 'seller-charge-unpaid').map((alert) => [alert.subject, alert.message])).toEqual([['u1', 'The seller has owed $15.00 for more than 60 days.']]);
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/services/catalog/health.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `health.ts`:
- add the dep and `export const SELLER_CHARGE_UNPAID_AFTER_MS = 60 * DAY_MS;`;
- in `runCatalogHealth`, before sending the alerts, add:

```ts
	for (const unpaid of await deps.unpaidCharges(new Date(nowMs - SELLER_CHARGE_UNPAID_AFTER_MS))) {
		alerts.push({ kind: 'seller-charge-unpaid', subject: unpaid.sellerUserId, message: `The seller has owed $${(unpaid.owedCents / 100).toFixed(2)} for more than 60 days.` });
	}
```

`SellerChargeService.unpaidSince`:

```ts
	async unpaidSince(before: Date): Promise<Array<{ sellerUserId: string; owedCents: number }>> {
		return this.database
			.select({ sellerUserId: schema.sellerCharges.sellerUserId, owedCents: sql<number>`sum(${schema.sellerCharges.amountCents} - ${schema.sellerCharges.collectedCents})` })
			.from(schema.sellerCharges)
			.where(and(lt(schema.sellerCharges.createdAt, before), lt(schema.sellerCharges.collectedCents, schema.sellerCharges.amountCents)))
			.groupBy(schema.sellerCharges.sellerUserId)
			.limit(100)
			.all();
	}
```

In `scheduler.ts`'s health branch, pass `unpaidCharges: (before) => new SellerChargeService(env).unpaidSince(before)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/catalog worker/database/services/SellerChargeService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/health.ts worker/services/catalog/health.test.ts worker/services/catalog/scheduler.ts worker/database/services/SellerChargeService.ts
git commit -m "feat(payments): alert on seller charges unpaid after 60 days"
```

---

## Finish

- Run the whole suite in batches, plus both `tsc` configs.
- Local checks on port 8100 (Stripe test mode):
  1. Set the test seller's override `largestOrderCents` to 4000 with the admin endpoint. A $40.99 feeder order is then refused with "This store can't take an order this large yet". Clear the override.
  2. Set `weeklySalesCents` to the week's usage plus $10. A second order pauses the store, the alert is logged, and the seller notice goes to the dev log.
  3. Pay with Stripe's elevated-risk test card `4000000000009235`. The runner holds the catalog order. `POST /api/admin/catalog/orders/:id/release` then places it in the CJ sandbox.
  4. After a sale, the seller's Stripe test account shows the New level's payout delay, 10 days.
- Ledger every deviation as a `Ruling:` line.
- Then run the final whole-branch review across all three plans (executing-plans, "Final Review").
