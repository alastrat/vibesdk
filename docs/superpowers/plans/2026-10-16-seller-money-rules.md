# Seller Money Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers pay for their own refunds, disputes, extra card fees and Stripe account costs. Estori never fronts that money, and sellers choose how often they're paid.

**Architecture:**
- **Money moves through transfer reversals.** Every amount a seller owes comes back from their sale's Stripe transfer. A transfer is the whole charge, so a reversal can take back up to the whole sale. Reversals are free, and each one is keyed so it happens at most once.
- **Recording before and after moving money.** A refund the seller starts first checks their Stripe balance. Amounts that can't come from one sale become `seller_charges`, which are taken from the seller's next sales.
- **Webhooks.** Disputes arrive on the platform webhook. Payouts arrive as Connect events, verified with a second signing secret.

**Tech Stack:** Cloudflare Workers, D1 with Drizzle, the Stripe REST client (`worker/services/payments/stripe-client.ts`), React 19 with `@cloudflare/kumo`, and Vitest.

**Spec:** `docs/superpowers/specs/2026-10-16-seller-risk-safeguards-design.md`. This plan covers:
- section 3, "Card fees above the domestic rate";
- section 4, "Payout frequency" and "Stripe's seller-account costs";
- sections 5 and 6;
- the matching data in section 10.

**Depends on:** `2026-10-16-seller-payments-setup.md`, which provides:
- `PLATFORM_ALERT_KINDS` and `platformAlertsFromEnv` (Task 7);
- `SellerFlags.cardPaymentsActive`;
- migration 0020.

## Global Constraints

- **Code rules:**
  - Never use `any`. Frontend imports shared types from `@/api-types`.
  - No emojis in code or copy.
- **Commits:** subjects are lowercase after the type prefix, and end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:**
  - `.dev.vars`, `bun.lockb` or anything in `.superpowers/`;
  - `src/routes/landing/LandingPage.tsx`;
  - the local overrides in `wrangler.jsonc`.
- **Tests:** run `rtk proxy npx vitest run <paths>` in small batches, once TIME_WAIT is under 1500.
- **Migrations:** run `rtk proxy npm run db:generate -- --name <name>`, then apply locally with sqlite3, adding the `d1_migrations` row in one transaction.
- **Idempotency.** Every Stripe call that moves money has an idempotency key derived from stable ids, never from time:
  - `store-refund-<requestId>-<lineNo>` and `store-reversal-<requestId>-<lineNo>` (seller refunds of own lines);
  - `catalog-refund-<itemId>` and `catalog-reversal-<itemId>` (existing);
  - `fee-difference-<orderId>`;
  - `seller-charge-<chargeId>-<orderId>`;
  - `dispute-reversal-<disputeId>`, `dispute-return-<disputeId>` and `dispute-fee-return-<disputeId>`.
- **What a reversal may take.** A reversal never takes more than what is left of the seller's share of that sale: the transfer amount, minus the application fee, minus what was already reversed. The exceptions are a seller refund and a dispute, which may take back the item's or the disputed amount, up to the transfer's reversible amount.
- **Stripe's account costs:** $2 per month with a payout, plus 0.25% + 25¢ per payout (spec section 4).
- **Shoppers never see an internal reason.** Sellers see plain messages.

## Review Focus

1. **The same webhook event delivered twice, or two in parallel.** Examples are `charge.dispute.created` or `payout.paid` arriving twice. The money must move once and the charge must be recorded once. Task 2 pins this with unique indexes, Task 7 with idempotency keys, and Task 8 with the payout charge source ids.
2. **A seller refund raced by a second refund request for the same line.** The `(request_id, line_no)` unique index and the already-refunded check must stop a second refund. A new `requestId` for an already-refunded line must refuse, not refund again. Task 5 pins this.
3. **A seller whose balance is exactly the amount needed.** The refund goes through. One cent short refuses with `shortCents: 1`. Task 4 pins both.
4. **A dispute on an order whose transfer was already partly reversed by a refund.** The dispute reversal takes only what's left. Any remainder becomes a `dispute-shortfall` charge. Task 7 pins this.
5. **A payout on a Connect account Estori doesn't know**, for example a deleted seller. Answer 200 and record nothing, because Stripe would otherwise retry forever. Task 8 pins this.

## Rulings carried into this plan

- **Ruling: own-product refunds use an explicit transfer reversal per line, not `reverse_transfer: true` as the spec says.**
  - Why: it matches the catalog refunds. The balance check can then plan the exact amount, and the line has its own idempotency key.
  - Cost if wrong: none. Stripe's proportional reversal would take the same amount, because the transfer is the whole charge.
- **Ruling: Stripe's account-cost rates are constants in `worker/services/payments/seller-costs.ts`, not `sellerLimits` config values.**
  - Why: the `sellerLimits` config block arrives in the levels plan, which moves these rates into it.
  - Cost if wrong: until then, changing a rate needs a code change.
- **Ruling: disputed catalog items that were never placed get a new item status, `withheld`, instead of `rejected` with a reason.**
  - Why: `rejected` items are refunded by the runner, and the dispute already returned the money. `withheld` is skipped by both placement and refunds.
  - Cost if wrong: one more status value.
- **Ruling: migration 0021 holds this plan's tables.**

---

### Task 1: Stripe calls on connected accounts, transfers, payout schedules and charge fees

**Files:**
- Modify: `worker/services/payments/stripe-client.ts`
- Test: `worker/services/payments/stripe-client.test.ts`

**Interfaces:**
- Produces, on `StripeClient`:
  - `retrieveBalance(accountId: string): Promise<{ availableCents: number; pendingCents: number }>` (USD only);
  - `createTransfer(input: { destination: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string; amount: number }>`;
  - `updatePayoutSchedule(accountId: string, schedule: PayoutSchedule): Promise<StripeAccount>`;
  - `retrievePaymentIntent` now also expands `latest_charge.balance_transaction`, so `StripeChargeSummary` gains `balance_transaction?: { id: string; fee: number } | string | null`.
- Produces the type:
  - `PayoutSchedule = { interval: 'daily' | 'weekly' | 'monthly'; weeklyAnchor: Weekday | null; monthlyAnchor: number | null; delayDays: number | null }`;
  - `Weekday = 'monday' | ... | 'friday'`.

- [ ] **Step 1: Write the failing tests**

Add to `worker/services/payments/stripe-client.test.ts`. It already has a `recordingFetch(body)` helper that returns `{ calls, fakeFetch }`.

```ts
describe('connected-account calls', () => {
	it('reads the seller balance as the seller, in USD only', async () => {
		const { calls, fakeFetch } = recordingFetch({
			available: [{ amount: 1500, currency: 'usd' }, { amount: 900, currency: 'eur' }],
			pending: [{ amount: 2500, currency: 'usd' }],
		});
		expect(await createStripeClient('sk_test_fake', fakeFetch).retrieveBalance('acct_1')).toEqual({ availableCents: 1500, pendingCents: 2500 });
		expect(calls[0].url).toBe('https://api.stripe.com/v1/balance');
		expect(new Headers(calls[0].init.headers).get('Stripe-Account')).toBe('acct_1');
	});

	it('transfers to a seller with a stable key', async () => {
		const { calls, fakeFetch } = recordingFetch({ id: 'tr_9', amount: 4099 });
		await createStripeClient('sk_test_fake', fakeFetch).createTransfer({ destination: 'acct_1', amountCents: 4099, idempotencyKey: 'dispute-return-dp_1', metadata: { disputeId: 'dp_1' } });
		const body = decodeURIComponent(String(calls[0].init.body));
		expect(calls[0].url).toBe('https://api.stripe.com/v1/transfers');
		expect(body).toContain('destination=acct_1');
		expect(body).toContain('amount=4099');
		expect(body).toContain('currency=usd');
		expect(new Headers(calls[0].init.headers).get('Idempotency-Key')).toBe('dispute-return-dp_1');
	});

	it('sets the payout schedule and lets Stripe debit the bank for a negative balance', async () => {
		const { calls, fakeFetch } = recordingFetch({ id: 'acct_1', details_submitted: true, charges_enabled: true, payouts_enabled: true });
		await createStripeClient('sk_test_fake', fakeFetch).updatePayoutSchedule('acct_1', { interval: 'weekly', weeklyAnchor: 'monday', monthlyAnchor: null, delayDays: 10 });
		const body = decodeURIComponent(String(calls[0].init.body));
		expect(calls[0].url).toBe('https://api.stripe.com/v1/accounts/acct_1');
		for (const part of ['settings[payouts][schedule][interval]=weekly', 'settings[payouts][schedule][weekly_anchor]=monday', 'settings[payouts][schedule][delay_days]=10', 'settings[payouts][debit_negative_balances]=true']) {
			expect(body).toContain(part);
		}
		expect(body).not.toContain('monthly_anchor');
	});

	it('expands the charge fee with the transfer', async () => {
		const { calls, fakeFetch } = recordingFetch({ id: 'pi_1', latest_charge: null });
		await createStripeClient('sk_test_fake', fakeFetch).retrievePaymentIntent('pi_1');
		const url = decodeURIComponent(calls[0].url);
		expect(url).toContain('expand[0]=latest_charge.transfer');
		expect(url).toContain('expand[1]=latest_charge.balance_transaction');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/payments/stripe-client.test.ts`
Expected: FAIL. `retrieveBalance`, `createTransfer` and `updatePayoutSchedule` are not functions, and the expand list is missing the balance transaction.

- [ ] **Step 3: Implement**

In `worker/services/payments/stripe-client.ts`:

1. Give `request` an options object for the connected account, keeping the existing positional parameters:

```ts
	async function request<T>(
		method: 'GET' | 'POST',
		path: string,
		params?: Record<string, FormValue>,
		idempotencyKey?: string,
		stripeAccount?: string,
	): Promise<T> {
```

   Inside, after the idempotency header, add `if (stripeAccount) headers['Stripe-Account'] = stripeAccount;`.

2. Add the types:

```ts
export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

export interface PayoutSchedule {
	interval: 'daily' | 'weekly' | 'monthly';
	weeklyAnchor: Weekday | null;
	monthlyAnchor: number | null;
	/** Days a sale waits before payout; null leaves Stripe's current value. */
	delayDays: number | null;
}

interface StripeBalance {
	available: Array<{ amount: number; currency: string }>;
	pending: Array<{ amount: number; currency: string }>;
}
```

3. On the charge summary type, which already has `transfer`, add `balance_transaction?: { id: string; fee: number } | string | null;`.

4. Add to the `StripeClient` interface:

```ts
	retrieveBalance(accountId: string): Promise<{ availableCents: number; pendingCents: number }>;
	createTransfer(input: { destination: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string; amount: number }>;
	updatePayoutSchedule(accountId: string, schedule: PayoutSchedule): Promise<StripeAccount>;
```

5. Implement them in `createStripeClient`, and change the `retrievePaymentIntent` expand list:

```ts
		retrievePaymentIntent: (paymentIntentId) =>
			request<StripePaymentIntent>('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}?${encodeForm({ expand: ['latest_charge.transfer', 'latest_charge.balance_transaction'] })}`),
		retrieveBalance: async (accountId) => {
			const balance = await request<StripeBalance>('GET', '/balance', undefined, undefined, accountId);
			const usd = (entries: StripeBalance['available']) => entries.filter((entry) => entry.currency === 'usd').reduce((sum, entry) => sum + entry.amount, 0);
			return { availableCents: usd(balance.available), pendingCents: usd(balance.pending) };
		},
		createTransfer: (input) =>
			request<{ id: string; amount: number }>('POST', '/transfers', { destination: input.destination, amount: input.amountCents, currency: 'usd', metadata: input.metadata }, input.idempotencyKey),
		// The platform owns these accounts' losses, so it sets their payout timing and lets Stripe debit their bank when negative.
		updatePayoutSchedule: (accountId, schedule) =>
			request<StripeAccount>('POST', `/accounts/${encodeURIComponent(accountId)}`, {
				settings: {
					payouts: {
						schedule: {
							interval: schedule.interval,
							weekly_anchor: schedule.interval === 'weekly' ? schedule.weeklyAnchor : undefined,
							monthly_anchor: schedule.interval === 'monthly' ? schedule.monthlyAnchor : undefined,
							delay_days: schedule.delayDays ?? undefined,
						},
						debit_negative_balances: true,
					},
				},
			}),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/payments/stripe-client.test.ts`
Expected: PASS.

Every fake that implements `StripeClient` in full, or picks its methods, must still typecheck. Run: `rtk proxy npx tsc -p tsconfig.worker.json --noEmit`
Expected: no errors. Fakes use `Pick<StripeClient, ...>`, so new methods don't break them.

- [ ] **Step 5: Commit**

```bash
git add worker/services/payments/stripe-client.ts worker/services/payments/stripe-client.test.ts
git commit -m "feat(payments): stripe calls for seller balances, transfers, payout schedules and charge fees"
```

### Task 2: The money-rules tables

**Files:**
- Modify: `worker/database/schema.ts`
- Modify: `shared/types/catalog.ts` (`CATALOG_ITEM_STATUSES` gains `'withheld'`)
- Modify: `shared/types/store-payments.ts` (`STORE_REFUND_INITIATORS`)
- Create: `migrations/0021_seller_money_rules.sql` (generated)
- Test: `worker/database/seller-money-schema.test.ts`

**Interfaces:**
- Produces the Drizzle tables:
  - `storeRefunds` (`store_refunds`);
  - `storeDisputes` (`store_disputes`);
  - `sellerCharges` (`seller_charges`);
  - `sellerChargeCollections` (`seller_charge_collections`);
  - `storeFeeAdjustments` (`store_fee_adjustments`).
- Produces the columns `stripeConnectAccounts.payoutInterval` (default `'weekly'`) and `stripeConnectAccounts.payoutAnchor` (default `'monday'`).
- Produces the types:
  - `SellerChargeKind = 'dispute-fee' | 'dispute-shortfall' | 'payout-fee' | 'active-account-fee'`;
  - `StoreRefundInitiator = 'seller' | 'estori'`.

- [ ] **Step 1: Write the failing test**

```ts
// worker/database/seller-money-schema.test.ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { CATALOG_ITEM_STATUSES } from '../../shared/types/catalog';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

function uniqueIndex(table: Parameters<typeof getTableConfig>[0], name: string): boolean {
	return getTableConfig(table).indexes.find((index) => index.config.name === name)?.config.unique === true;
}

describe('seller money schema', () => {
	it('records each refund once per request and line, and each Stripe refund once', () => {
		expect(uniqueIndex(schema.storeRefunds, 'store_refunds_request_line_unique_idx')).toBe(true);
		expect(schema.storeRefunds.initiatedBy.enumValues).toEqual(['seller', 'estori']);
	});

	it('keeps one charge per kind and source, so a redelivered event charges once', () => {
		expect(uniqueIndex(schema.sellerCharges, 'seller_charges_kind_source_unique_idx')).toBe(true);
		expect(schema.sellerCharges.kind.enumValues).toEqual(['dispute-fee', 'dispute-shortfall', 'payout-fee', 'active-account-fee']);
		expect(schema.sellerCharges.collectedCents.default).toBe(0);
		expect(uniqueIndex(schema.sellerChargeCollections, 'seller_charge_collections_unique_idx')).toBe(true);
	});

	it('keys disputes and fee adjustments by their Stripe dispute and store order', () => {
		expect(getTableConfig(schema.storeDisputes).columns.find((column) => column.name === 'id')?.primary).toBe(true);
		expect(getTableConfig(schema.storeFeeAdjustments).columns.find((column) => column.name === 'order_id')?.primary).toBe(true);
	});

	it('pays sellers weekly on Monday unless they choose otherwise', () => {
		expect(schema.stripeConnectAccounts.payoutInterval.default).toBe('weekly');
		expect(schema.stripeConnectAccounts.payoutAnchor.default).toBe('monday');
	});

	it('withholds catalog items a dispute already paid back', () => {
		expect(CATALOG_ITEM_STATUSES).toContain('withheld');
	});

	it('ships the tables in a migration', () => {
		for (const table of ['store_refunds', 'store_disputes', 'seller_charges', 'seller_charge_collections', 'store_fee_adjustments']) {
			expect(allMigrationSql).toContain(`CREATE TABLE \`${table}\``);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run worker/database/seller-money-schema.test.ts`
Expected: FAIL, because `schema.storeRefunds` is undefined.

- [ ] **Step 3: Implement**

In `shared/types/catalog.ts`, make the item statuses:

```ts
/** `withheld`: never placed, because a dispute already returned the payment; neither placed nor refunded. */
export const CATALOG_ITEM_STATUSES = ['pending', 'placed', 'rejected', 'shipped', 'delivered', 'refunded', 'withheld'] as const;
```

In `shared/types/store-payments.ts`, add:

```ts
export const STORE_REFUND_INITIATORS = ['seller', 'estori'] as const;
export type StoreRefundInitiator = (typeof STORE_REFUND_INITIATORS)[number];
export const SELLER_CHARGE_KINDS = ['dispute-fee', 'dispute-shortfall', 'payout-fee', 'active-account-fee'] as const;
export type SellerChargeKind = (typeof SELLER_CHARGE_KINDS)[number];
export const PAYOUT_INTERVALS = ['daily', 'weekly', 'monthly'] as const;
export type PayoutInterval = (typeof PAYOUT_INTERVALS)[number];
```

In `worker/database/schema.ts`:
- Import the new constants.
- In `stripeConnectAccounts`, add:

```ts
    /** How often the seller is paid; they choose, and pay Stripe's per-payout cost. */
    payoutInterval: text('payout_interval', { enum: PAYOUT_INTERVALS }).notNull().default('weekly'),
    /** A weekday for weekly payouts, or a day of the month (as text) for monthly ones. */
    payoutAnchor: text('payout_anchor').notNull().default('monday'),
```

- After the store tables, add:

```ts
/** Every refund of a store order line, by whoever started it; Stripe's refund id is the key. */
export const storeRefunds = sqliteTable('store_refunds', {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull().references(() => storeOrders.id),
    lineNo: integer('line_no').notNull(),
    amountCents: integer('amount_cents').notNull(),
    requestId: text('request_id').notNull(),
    initiatedBy: text('initiated_by', { enum: STORE_REFUND_INITIATORS }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    requestLineUnique: uniqueIndex('store_refunds_request_line_unique_idx').on(table.requestId, table.lineNo),
    orderIdx: index('store_refunds_order_idx').on(table.orderId),
}));

/** A shopper's dispute of a store order, and what Estori took back from the seller for it. */
export const storeDisputes = sqliteTable('store_disputes', {
    id: text('id').primaryKey(),
    orderId: text('order_id').notNull().references(() => storeOrders.id),
    amountCents: integer('amount_cents').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull(),
    reversalId: text('reversal_id'),
    reversedCents: integer('reversed_cents').notNull().default(0),
    feeCents: integer('fee_cents').notNull().default(0),
    returnedCents: integer('returned_cents').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

/** What a seller owes Estori outside one sale; taken from their next sales. */
export const sellerCharges = sqliteTable('seller_charges', {
    id: text('id').primaryKey(),
    sellerUserId: text('seller_user_id').notNull().references(() => users.id),
    kind: text('kind', { enum: SELLER_CHARGE_KINDS }).notNull(),
    sourceId: text('source_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    collectedCents: integer('collected_cents').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    kindSourceUnique: uniqueIndex('seller_charges_kind_source_unique_idx').on(table.kind, table.sourceId),
    openIdx: index('seller_charges_seller_idx').on(table.sellerUserId, table.createdAt),
}));

export const sellerChargeCollections = sqliteTable('seller_charge_collections', {
    chargeId: text('charge_id').notNull().references(() => sellerCharges.id),
    orderId: text('order_id').notNull().references(() => storeOrders.id),
    reversalId: text('reversal_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    chargeOrderUnique: uniqueIndex('seller_charge_collections_unique_idx').on(table.chargeId, table.orderId),
}));

/** The card fee Stripe charged above what the sale collected, taken back from the seller once per order. */
export const storeFeeAdjustments = sqliteTable('store_fee_adjustments', {
    orderId: text('order_id').primaryKey().references(() => storeOrders.id),
    collectedCents: integer('collected_cents').notNull(),
    actualFeeCents: integer('actual_fee_cents').notNull(),
    reversalId: text('reversal_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

Use the names this file already imports from `drizzle-orm/sqlite-core` (`sqliteTable`, `text`, `integer`, `index`, `uniqueIndex`), and add any that are missing.

- [ ] **Step 4: Generate and apply the migration**

Run: `rtk proxy npm run db:generate -- --name seller_money_rules`
Expected: `migrations/0021_seller_money_rules.sql` with five `CREATE TABLE` statements, their indexes, and two `ALTER TABLE stripe_connect_accounts ADD` statements.

Apply it locally with sqlite3, together with its `d1_migrations` row.

- [ ] **Step 5: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/database/seller-money-schema.test.ts worker/database/catalog-schema.test.ts`
Expected: PASS. If `catalog-schema.test.ts` pins the old status list, add `'withheld'` there.

- [ ] **Step 6: Commit**

```bash
git add worker/database/schema.ts shared/types/catalog.ts shared/types/store-payments.ts worker/database/seller-money-schema.test.ts worker/database/catalog-schema.test.ts migrations/0021_seller_money_rules.sql migrations/meta/
git commit -m "feat(payments): tables for store refunds, disputes, seller charges and card fee adjustments"
```

### Task 3: Settling each sale: the card fee difference and the seller's charges

**Files:**
- Create: `worker/services/store-payments/settle.ts`
- Create: `worker/database/services/SellerChargeService.ts`
- Modify: `worker/database/services/StoreOrderService.ts` (view fields), `worker/services/store-payments/store.ts` (`StoreOrderView`)
- Modify: `worker/services/store-payments/fulfill.ts` (`settleSale` dep), `worker/services/store-payments/wiring.ts`
- Modify: `worker/database/index.ts`
- Test: `worker/services/store-payments/settle.test.ts`, `worker/database/services/SellerChargeService.test.ts`, `worker/services/store-payments/fulfill.test.ts`

**Interfaces:**
- Consumes: `retrievePaymentIntent` with `balance_transaction`, and `createTransferReversal` (Task 1); the tables (Task 2); `processingFeeCents` from `shared/types/catalog.ts`.
- Produces:
  - `settleSale(deps: SettleSaleDeps, order: SettleOrder): Promise<{ feeDifferenceCents: number; collectedCents: number }>`;
  - `SellerChargeService`:
    - `add(input: { sellerUserId; kind; sourceId; amountCents; now }): Promise<'added' | 'exists'>`;
    - `open(sellerUserId: string): Promise<OpenSellerCharge[]>`, oldest first, where `OpenSellerCharge = { id; amountCents; collectedCents }`;
    - `recordCollection(input: { chargeId; orderId; reversalId; amountCents; now }): Promise<void>`;
    - `setAmount(chargeId: string, amountCents: number, now: Date): Promise<void>`;
  - `StoreOrderView` gains `sellerUserId`, `sellerStripeAccountId`, `stripePaymentIntentId`, `refundedCents`;
  - `RecordStoreOrderDeps.settleSale(orderId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/store-payments/settle.test.ts
import { describe, expect, it } from 'vitest';
import { settleSale, type SettleSaleDeps, type SettleOrder } from './settle';

const ORDER: SettleOrder = { id: 'ord_1', sellerUserId: 'u1', paymentIntentId: 'pi_1', totalCents: 4099, applicationFeeCents: 2177 };

function fakeDeps(input: { fee?: number; reversed?: number; charges?: Array<{ id: string; amountCents: number; collectedCents: number }>; adjusted?: boolean } = {}) {
	const reversals: Array<{ amountCents: number; idempotencyKey: string }> = [];
	const collections: Array<{ chargeId: string; amountCents: number }> = [];
	const adjustments: Array<{ collectedCents: number; actualFeeCents: number; reversalId: string | null }> = [];
	const deps: SettleSaleDeps = {
		stripe: {
			retrievePaymentIntent: async (id) => ({
				id,
				latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 4099, amount_reversed: input.reversed ?? 0 }, balance_transaction: { id: 'txn_1', fee: input.fee ?? 149 } },
			}),
			createTransferReversal: async (reversal) => {
				reversals.push({ amountCents: reversal.amountCents, idempotencyKey: reversal.idempotencyKey });
				return { id: `trr_${reversals.length}`, amount: reversal.amountCents };
			},
		},
		feeAdjusted: async () => input.adjusted ?? false,
		recordFeeAdjustment: async (adjustment) => void adjustments.push(adjustment),
		openCharges: async () => input.charges ?? [],
		recordCollection: async (collection) => void collections.push({ chargeId: collection.chargeId, amountCents: collection.amountCents }),
		now: () => new Date(1_800_000_000_000),
	};
	return { deps, reversals, collections, adjustments };
}

describe('settleSale', () => {
	it('takes nothing when the card cost what the sale collected and nothing is owed', async () => {
		const { deps, reversals, adjustments } = fakeDeps();
		expect(await settleSale(deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(reversals).toEqual([]);
		expect(adjustments).toEqual([{ collectedCents: 149, actualFeeCents: 149, reversalId: null }]);
	});

	it("takes the extra card fee from the seller's share, once", async () => {
		const { deps, reversals, adjustments } = fakeDeps({ fee: 210 });
		expect(await settleSale(deps, ORDER)).toEqual({ feeDifferenceCents: 61, collectedCents: 0 });
		expect(reversals).toEqual([{ amountCents: 61, idempotencyKey: 'fee-difference-ord_1' }]);
		expect(adjustments[0]).toMatchObject({ collectedCents: 149, actualFeeCents: 210, reversalId: 'trr_1' });

		const again = fakeDeps({ fee: 210, adjusted: true });
		expect(await settleSale(again.deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(again.reversals).toEqual([]);
	});

	it("collects open charges oldest first, never past the seller's share of the sale", async () => {
		// Seller's share: 4099 - 2177 = 1922, less 22 already reversed = 1900.
		const { deps, reversals, collections } = fakeDeps({
			reversed: 22,
			charges: [
				{ id: 'sc_1', amountCents: 1500, collectedCents: 0 },
				{ id: 'sc_2', amountCents: 800, collectedCents: 100 },
			],
		});
		expect(await settleSale(deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 1900 });
		expect(reversals).toEqual([
			{ amountCents: 1500, idempotencyKey: 'seller-charge-sc_1-ord_1' },
			{ amountCents: 400, idempotencyKey: 'seller-charge-sc_2-ord_1' },
		]);
		expect(collections).toEqual([
			{ chargeId: 'sc_1', amountCents: 1500 },
			{ chargeId: 'sc_2', amountCents: 400 },
		]);
	});

	it('leaves a sale with no transfer alone', async () => {
		const { deps, reversals } = fakeDeps();
		deps.stripe.retrievePaymentIntent = async (id) => ({ id, latest_charge: null });
		expect(await settleSale(deps, ORDER)).toEqual({ feeDifferenceCents: 0, collectedCents: 0 });
		expect(reversals).toEqual([]);
	});
});
```

```ts
// worker/database/services/SellerChargeService.test.ts
import { describe, expect, it } from 'vitest';
import { SellerChargeService } from './SellerChargeService';
import { recordingD1 } from '../test-support/recording-d1';

describe('SellerChargeService', () => {
	it('adds a charge keyed by kind and source', async () => {
		const { d1, statements } = recordingD1();
		const charges = new SellerChargeService({ DB: d1 } as unknown as Env);
		expect(await charges.add({ sellerUserId: 'u1', kind: 'dispute-fee', sourceId: 'dp_1', amountCents: 1500, now: new Date(0) })).toBe('added');
		const insert = statements.find((entry) => entry.sql.toLowerCase().startsWith('insert into "seller_charges"'));
		expect(insert?.params).toEqual(expect.arrayContaining(['u1', 'dispute-fee', 'dp_1', 1500]));
		expect(insert?.sql.toLowerCase()).toContain('on conflict');
	});

	it('records a collection and adds it to the charge in one batch', async () => {
		const { d1, batches } = recordingD1();
		await new SellerChargeService({ DB: d1 } as unknown as Env).recordCollection({ chargeId: 'sc_1', orderId: 'ord_1', reversalId: 'trr_1', amountCents: 400, now: new Date(0) });
		expect(batches).toHaveLength(1);
		expect(batches[0].map((entry) => entry.sql.split(' ').slice(0, 3).join(' ').toLowerCase())).toEqual(['insert into "seller_charge_collections"', 'update "seller_charges" set']);
	});
});
```

In `worker/services/store-payments/fulfill.test.ts`:
- In `fakeDeps`, add `const settled: string[] = [];`.
- Add `settleSale: async (orderId) => void settled.push(orderId),` to `deps`.
- Return `settled` with the other values.
- Add these tests:

```ts
	it('settles the sale after recording it, and again on a repeated delivery', async () => {
		const first = fakeDeps();
		await recordStoreOrder(first.deps, PAID);
		expect(first.settled).toEqual(['ord_ab12']);

		const again = fakeDeps('already-recorded');
		await recordStoreOrder(again.deps, PAID);
		expect(again.settled).toEqual(['ord_ab12']);
	});

	it('keeps the recorded order when settling fails, for the next delivery to retry', async () => {
		const { deps } = fakeDeps();
		deps.settleSale = async () => {
			throw new Error('Stripe is unavailable');
		};
		expect((await recordStoreOrder(deps, PAID)).result).toBe('recorded');
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/store-payments/settle.test.ts worker/database/services/SellerChargeService.test.ts worker/services/store-payments/fulfill.test.ts`
Expected: FAIL. The modules are missing, and `settleSale` is never called.

- [ ] **Step 3: Implement**

```ts
// worker/services/store-payments/settle.ts
/**
 * After a store sale is recorded: take back any card fee above what the sale collected, then the seller's open
 * charges, all from this sale's transfer and never past the seller's share of it. Safe to run again: each reversal
 * has a stable key, and the fee adjustment is recorded once per order.
 */

import { processingFeeCents } from '../../../shared/types/catalog';
import type { StripeClient, StripePaymentIntent } from '../payments/stripe-client';

export interface SettleOrder {
	id: string;
	sellerUserId: string;
	paymentIntentId: string;
	totalCents: number;
	applicationFeeCents: number;
}

export interface SettleSaleDeps {
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createTransferReversal'>;
	feeAdjusted(orderId: string): Promise<boolean>;
	recordFeeAdjustment(adjustment: { orderId: string; collectedCents: number; actualFeeCents: number; reversalId: string | null; now: Date }): Promise<void>;
	openCharges(sellerUserId: string): Promise<Array<{ id: string; amountCents: number; collectedCents: number }>>;
	recordCollection(collection: { chargeId: string; orderId: string; reversalId: string; amountCents: number; now: Date }): Promise<void>;
	now(): Date;
}

function chargeOf(intent: StripePaymentIntent): { transferId: string; reversibleCents: number; feeCents: number | null } | null {
	const charge = intent.latest_charge;
	if (typeof charge !== 'object' || charge === null) return null;
	const transfer = charge.transfer;
	if (typeof transfer !== 'object' || transfer === null) return null;
	const balance = charge.balance_transaction;
	return {
		transferId: transfer.id,
		reversibleCents: transfer.amount - transfer.amount_reversed,
		feeCents: typeof balance === 'object' && balance !== null ? balance.fee : null,
	};
}

export async function settleSale(deps: SettleSaleDeps, order: SettleOrder): Promise<{ feeDifferenceCents: number; collectedCents: number }> {
	const charge = chargeOf(await deps.stripe.retrievePaymentIntent(order.paymentIntentId));
	if (!charge) return { feeDifferenceCents: 0, collectedCents: 0 };
	// The seller's share left in this sale: the transfer is the whole charge, and Estori's fee was taken from it.
	let sellerShare = charge.reversibleCents - order.applicationFeeCents;
	const metadata = { storeOrderId: order.id };

	let feeDifferenceCents = 0;
	if (charge.feeCents !== null && !(await deps.feeAdjusted(order.id))) {
		const collectedCents = processingFeeCents(order.totalCents);
		const difference = Math.min(Math.max(charge.feeCents - collectedCents, 0), Math.max(sellerShare, 0));
		let reversalId: string | null = null;
		if (difference > 0) {
			const reversal = await deps.stripe.createTransferReversal({ transferId: charge.transferId, amountCents: difference, idempotencyKey: `fee-difference-${order.id}`, metadata });
			reversalId = reversal.id;
			sellerShare -= difference;
			feeDifferenceCents = difference;
		}
		await deps.recordFeeAdjustment({ orderId: order.id, collectedCents, actualFeeCents: charge.feeCents, reversalId, now: deps.now() });
	}

	let collectedCents = 0;
	for (const open of await deps.openCharges(order.sellerUserId)) {
		if (sellerShare <= 0) break;
		const amount = Math.min(open.amountCents - open.collectedCents, sellerShare);
		if (amount <= 0) continue;
		const reversal = await deps.stripe.createTransferReversal({
			transferId: charge.transferId,
			amountCents: amount,
			idempotencyKey: `seller-charge-${open.id}-${order.id}`,
			metadata: { ...metadata, sellerChargeId: open.id },
		});
		await deps.recordCollection({ chargeId: open.id, orderId: order.id, reversalId: reversal.id, amountCents: amount, now: deps.now() });
		sellerShare -= amount;
		collectedCents += amount;
	}
	return { feeDifferenceCents, collectedCents };
}
```

```ts
// worker/database/services/SellerChargeService.ts
/** What sellers owe Estori outside a single sale, and what each later sale collected. */

import { and, asc, eq, lt, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import type { SellerChargeKind } from '../../../shared/types/store-payments';

export interface OpenSellerCharge {
	id: string;
	amountCents: number;
	collectedCents: number;
}

export class SellerChargeService extends BaseService {
	/** 'exists' when this kind and source were already charged, as on a redelivered event. */
	async add(input: { sellerUserId: string; kind: SellerChargeKind; sourceId: string; amountCents: number; now: Date }): Promise<'added' | 'exists'> {
		const rows = await this.database
			.insert(schema.sellerCharges)
			.values({ id: `sc_${generateId()}`, sellerUserId: input.sellerUserId, kind: input.kind, sourceId: input.sourceId, amountCents: input.amountCents, createdAt: input.now, updatedAt: input.now })
			.onConflictDoNothing()
			.returning({ id: schema.sellerCharges.id });
		return rows.length > 0 ? 'added' : 'exists';
	}

	async open(sellerUserId: string): Promise<OpenSellerCharge[]> {
		return this.database
			.select({ id: schema.sellerCharges.id, amountCents: schema.sellerCharges.amountCents, collectedCents: schema.sellerCharges.collectedCents })
			.from(schema.sellerCharges)
			.where(and(eq(schema.sellerCharges.sellerUserId, sellerUserId), lt(schema.sellerCharges.collectedCents, schema.sellerCharges.amountCents)))
			.orderBy(asc(schema.sellerCharges.createdAt))
			.limit(50)
			.all();
	}

	/** Records what one sale collected for one charge; repeated for the same charge and order, it changes nothing. */
	async recordCollection(input: { chargeId: string; orderId: string; reversalId: string; amountCents: number; now: Date }): Promise<void> {
		await this.database.batch([
			this.database
				.insert(schema.sellerChargeCollections)
				.values({ chargeId: input.chargeId, orderId: input.orderId, reversalId: input.reversalId, amountCents: input.amountCents, createdAt: input.now })
				.onConflictDoNothing(),
			this.database
				.update(schema.sellerCharges)
				.set({
					collectedCents: sql`(SELECT COALESCE(SUM(${schema.sellerChargeCollections.amountCents}), 0) FROM ${schema.sellerChargeCollections} WHERE ${schema.sellerChargeCollections.chargeId} = ${input.chargeId})`,
					updatedAt: input.now,
				})
				.where(eq(schema.sellerCharges.id, input.chargeId)),
		]);
	}

	async setAmount(chargeId: string, amountCents: number, now: Date): Promise<void> {
		await this.database.update(schema.sellerCharges).set({ amountCents, updatedAt: now }).where(eq(schema.sellerCharges.id, chargeId)).run();
	}

	async findBySource(kind: SellerChargeKind, sourceId: string): Promise<(OpenSellerCharge & { sellerUserId: string }) | null> {
		const row = await this.database
			.select({ id: schema.sellerCharges.id, amountCents: schema.sellerCharges.amountCents, collectedCents: schema.sellerCharges.collectedCents, sellerUserId: schema.sellerCharges.sellerUserId })
			.from(schema.sellerCharges)
			.where(and(eq(schema.sellerCharges.kind, kind), eq(schema.sellerCharges.sourceId, sourceId)))
			.get();
		return row ?? null;
	}
}
```

The collected total is recomputed from the collections table, so a replayed batch can't count a collection twice.

`StoreOrderService` and `StoreOrderView`:
- Add `sellerUserId: string`, `sellerStripeAccountId: string`, `stripePaymentIntentId: string | null` and `refundedCents: number` to `StoreOrderView`, and map them in `ordersWhere` from the row.
- Add `findByPaymentIntent(paymentIntentId: string): Promise<StoreOrderView | null>`, using `eq(schema.storeOrders.stripePaymentIntentId, paymentIntentId)` through `ordersWhere`.
- Add the two fee-adjustment methods:

```ts
    async feeAdjusted(orderId: string): Promise<boolean> {
        const row = await this.database.select({ orderId: schema.storeFeeAdjustments.orderId }).from(schema.storeFeeAdjustments).where(eq(schema.storeFeeAdjustments.orderId, orderId)).get();
        return row !== undefined;
    }

    async recordFeeAdjustment(input: { orderId: string; collectedCents: number; actualFeeCents: number; reversalId: string | null; now: Date }): Promise<void> {
        await this.database
            .insert(schema.storeFeeAdjustments)
            .values({ orderId: input.orderId, collectedCents: input.collectedCents, actualFeeCents: input.actualFeeCents, reversalId: input.reversalId, createdAt: input.now })
            .onConflictDoNothing()
            .run();
    }
```

In `fulfill.ts`:
- Add to `RecordStoreOrderDeps`:

```ts
	/** Takes back any card fee above what was collected, and the seller's open charges. Safe to repeat. */
	settleSale(orderId: string): Promise<void>;
```

- In `recordStoreOrder`, after the order is recorded with `recorded` or `already-recorded`, call `await deps.settleSale(orderId)` right after `handOffCatalogLines`. A thrown settle must not undo the recording. Wrap it so the result is still returned, and log through the caller's logger: `try { await deps.settleSale(orderId); } catch { /* retried on the next delivery */ }`. Add a one-line comment saying a webhook redelivery or the return page retries it.

In `wiring.ts`, add to `recordStoreOrderDeps`:

```ts
		settleSale: async (orderId) => {
			const stripe = stripeFromEnv(env);
			const order = await orders.getOrder(orderId);
			if (!stripe || !order?.stripePaymentIntentId) return;
			const charges = new SellerChargeService(env);
			await settleSale(
				{
					stripe,
					feeAdjusted: (id) => orders.feeAdjusted(id),
					recordFeeAdjustment: (adjustment) => orders.recordFeeAdjustment(adjustment),
					openCharges: (sellerUserId) => charges.open(sellerUserId),
					recordCollection: (collection) => charges.recordCollection(collection),
					now: () => new Date(),
				},
				{ id: order.id, sellerUserId: order.sellerUserId, paymentIntentId: order.stripePaymentIntentId, totalCents: order.totalCents, applicationFeeCents: order.applicationFeeCents },
			);
		},
```

Export `SellerChargeService` from `worker/database/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/store-payments worker/database/services/SellerChargeService.test.ts worker/database/services/StoreOrderService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/ worker/database/services/SellerChargeService.ts worker/database/services/SellerChargeService.test.ts worker/database/services/StoreOrderService.ts worker/database/index.ts
git commit -m "feat(store-payments): take extra card fees and open seller charges from each sale"
```

### Task 4: Seller refunds need the seller's balance first

**Files:**
- Modify: `worker/services/catalog/refund-items.ts`, `worker/services/catalog/refunds.ts` (reason `'risk-declined'`)
- Modify: `worker/services/catalog/CatalogOrderRunner.ts` (deps)
- Test: `worker/services/catalog/refund-items.test.ts`

**Interfaces:**
- Consumes: `retrieveBalance` (Task 1).
- Produces:
  - `RefundItemsDeps` gains `sellerBalance(): Promise<{ availableCents: number; pendingCents: number }>`, which only seller refunds call;
  - `RefundItemsDeps` gains `recordRefund(entry: { catalogItemId: string; refundId: string; amountCents: number; reason: RefundReason }): Promise<void>`;
  - `SellerBalanceShortError { shortCents: number }`;
  - `RefundExceedsTransferError` is removed;
  - `RefundReason` adds `'risk-declined'`, which splits like `'supplier-rejected'`.

- [ ] **Step 1: Write the failing tests**

In `worker/services/catalog/refund-items.test.ts`:

1. Import `SellerBalanceShortError` and `type RefundItemsDeps` in place of `RefundExceedsTransferError`.

2. The fake transfer is too small. With an application fee, Stripe transfers the whole charge, as the E2E transfers showed: `tr_3URAC9...` was 6599. Replace the constant and its comment:

```ts
/** A $90 payment: with an application fee, Stripe transfers the whole charge and takes the fee back separately. */
const TRANSFERRED_CENTS = 9000;
```

3. Add after `fakeStripe`:

```ts
function depsOf(store: RefundItemsDeps['store'], stripe: RefundItemsDeps['stripe'], balance = { availableCents: 100_000, pendingCents: 0 }) {
	const recorded: Array<{ catalogItemId: string; refundId: string; amountCents: number }> = [];
	const deps: RefundItemsDeps = {
		store,
		stripe,
		sellerBalance: async () => balance,
		recordRefund: async (entry) => void recorded.push({ catalogItemId: entry.catalogItemId, refundId: entry.refundId, amountCents: entry.amountCents }),
	};
	return { deps, recorded };
}
```

4. Replace every `refundCatalogItems({ store, stripe }, ` with `refundCatalogItems(depsOf(store, stripe).deps, `.

5. Replace the test "takes back no more than is left of the seller's transfer when every item is rejected; Estori pays the rest" with:

```ts
	it("takes back the seller's share of every rejected item, and Estori returns the catalog prices", async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		const totals = await refundCatalogItems(depsOf(store, stripe).deps, { orderId: 'co_1', itemIds: ['ci_mug', 'ci_cap'], reason: 'supplier-rejected' });
		expect(refunds.map((refund) => refund.amountCents)).toEqual([4000, 5000]);
		expect(reversals.map((reversal) => reversal.amountCents)).toEqual([2800, 2600]);
		expect(totals).toEqual({ refundedItemIds: ['ci_cap', 'ci_mug'], shopperCents: 9000, sellerCents: 5400, estoriCents: 3600 });
	});
```

6. In "remembers a refund whose reversal failed...", change the expected `ci_mug` reversal from `TRANSFERRED_CENTS - 2800` to `2600`.

7. Replace "refuses a seller refund larger than what the seller received, before any money moves" with:

```ts
	it("refunds a seller's refund when their Stripe balance covers it exactly, and refuses one cent short before any money moves", async () => {
		const store = await storeWithOrder();
		const { stripe, refunds, reversals } = fakeStripe();

		const short = depsOf(store, stripe, { availableCents: 4000, pendingCents: 999 });
		const error = await refundCatalogItems(short.deps, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'seller-refund' }).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(SellerBalanceShortError);
		expect((error as SellerBalanceShortError).shortCents).toBe(1);
		expect(refunds).toHaveLength(0);
		expect(reversals).toHaveLength(0);

		const exact = depsOf(store, stripe, { availableCents: 4000, pendingCents: 1000 });
		expect(await refundCatalogItems(exact.deps, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'seller-refund' })).toMatchObject({ shopperCents: 5000, sellerCents: 5000 });
	});

	it("doesn't ask for the seller's balance when Estori owes the refund", async () => {
		const store = await storeWithOrder();
		const { stripe } = fakeStripe();
		const { deps } = depsOf(store, stripe);
		deps.sellerBalance = async () => {
			throw new Error('The balance was asked for');
		};
		await refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		await refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_mug'], reason: 'risk-declined' });
	});

	it('records each refund for the store order', async () => {
		const store = await storeWithOrder();
		const { stripe } = fakeStripe();
		const { deps, recorded } = depsOf(store, stripe);
		await refundCatalogItems(deps, { orderId: 'co_1', itemIds: ['ci_cap'], reason: 'supplier-rejected' });
		expect(recorded).toEqual([{ catalogItemId: 'ci_cap', refundId: 're_1', amountCents: 4000 }]);
	});
```

8. In `worker/services/catalog/refunds.test.ts`, add:

```ts
	it('returns the catalog price for a risk decline, as for a supplier rejection', () => {
		expect(itemRefundSplit({ reason: 'risk-declined', retailCents: 4000, catalogCents: 1200, supplierRefunded: false })).toEqual({ shopperCents: 4000, sellerCents: 2800, estoriCents: 1200 });
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/catalog/refund-items.test.ts worker/services/catalog/refunds.test.ts`
Expected: FAIL. `SellerBalanceShortError` isn't exported, and `recordRefund` is never called.

- [ ] **Step 3: Implement**

In `refunds.ts`, change `export type RefundReason = 'supplier-rejected' | 'seller-refund' | 'risk-declined';`. In `itemRefundSplit`, treat `'risk-declined'` like `'supplier-rejected'`:

```ts
	const estoriReturnsCatalogPrice = input.reason === 'supplier-rejected' || input.reason === 'risk-declined' || input.supplierRefunded;
	const estoriCents = estoriReturnsCatalogPrice ? catalogCents : 0;
```

Change the file header to: "Who pays for a refunded catalog item. Stripe keeps its processing fee on refunds; Estori's application fee already collected it."

In `refund-items.ts`:
- Replace `RefundExceedsTransferError` with:

```ts
/** The seller's Stripe balance can't cover a refund they started; nothing was refunded. */
export class SellerBalanceShortError extends Error {
	constructor(readonly orderId: string, readonly shortCents: number) {
		super(`The seller's Stripe balance is ${shortCents} cents short to refund catalog order ${orderId}`);
		this.name = 'SellerBalanceShortError';
	}
}
```

- Add to `RefundItemsDeps`:

```ts
	/** The seller's Stripe balance; asked only before a refund the seller started. */
	sellerBalance(): Promise<{ availableCents: number; pendingCents: number }>;
	/** Records each shopper refund against the store order. */
	recordRefund(entry: { catalogItemId: string; refundId: string; amountCents: number; reason: RefundReason }): Promise<void>;
```

- Replace the header comment's "and Estori pays the rest" with "and a refund the seller started first needs their Stripe balance to cover it".
- Replace the misleading comment and the `RefundExceedsTransferError` check with:

```ts
	// The transfer is the whole charge, so it can always cover the seller's share; what must cover it is their balance.
	let reversible = transfer.reversibleCents - sumOf(owed.map((item) => item.sellerReversalDueCents));
	const planned = toRefund.map((item: CatalogOrderItemRow) => {
		const split = itemRefundSplit({ reason: input.reason, retailCents: item.unitPriceCents * item.quantity, catalogCents: item.catalogPriceCents * item.quantity, supplierRefunded: item.supplierRefunded });
		const sellerCents = Math.min(split.sellerCents, Math.max(reversible, 0));
		reversible -= sellerCents;
		return { itemId: item.id, shopperCents: split.shopperCents, sellerCents };
	});
	if (input.reason === 'seller-refund') {
		const balance = await deps.sellerBalance();
		const needed = sumOf(planned.map((item) => item.sellerCents)) + sumOf(owed.map((item) => item.sellerReversalDueCents));
		const short = needed - (balance.availableCents + balance.pendingCents);
		if (short > 0) throw new SellerBalanceShortError(order.id, short);
	}
```

- In the refund loop, after `createRefund` returns, call `await deps.recordRefund({ catalogItemId: item.itemId, refundId: refund.id, amountCents: item.shopperCents, reason: input.reason });`, capturing the result as `refund`.

In `CatalogOrderRunner.ts`'s `runnerDeps`:
- Pass `sellerBalance` as a function that throws `new Error('Runner refunds never start from the seller')`. The runner only refunds `supplier-rejected` and `risk-declined` items.
- Pass `recordRefund` as a no-op for now. Task 5 wires it to `store_refunds`.

Adjust every other caller of `refundCatalogItems` so `tsc` passes: the admin controller and the tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/catalog`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.worker.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/ worker/api/controllers/catalog/
git commit -m "feat(catalog): a seller's refund needs their stripe balance to cover it"
```

### Task 5: Refunding store lines, and keeping the order's refund total

**Files:**
- Create: `worker/services/store-payments/refund-lines.ts`
- Create: `worker/database/services/StoreRefundService.ts`
- Modify: `worker/database/services/StoreOrderService.ts` (`applyRefunds`)
- Modify: `worker/services/catalog/CatalogOrderRunner.ts` (`recordRefund` wiring)
- Test: `worker/services/store-payments/refund-lines.test.ts`, `worker/database/services/StoreRefundService.test.ts`

**Interfaces:**
- Consumes: `refundCatalogItems` and `SellerBalanceShortError` (Task 4); `retrieveBalance` (Task 1); `StoreOrderView` with seller fields (Task 3).
- Produces:
  - `refundStoreLines(deps: RefundLinesDeps, input: { order: StoreOrderView; lineNos: readonly number[]; requestId: string }): Promise<RefundLinesResult>`, where `RefundLinesResult = { ok: true; refundedCents: number } | { ok: false; reason: 'seller_balance_short'; shortCents: number } | { ok: false; reason: 'nothing_to_refund' }`;
  - `StoreRefundService.record(entry: { refundId; orderId; lineNo; amountCents; requestId; initiatedBy; now }): Promise<void>`;
  - `StoreRefundService.refundedLines(orderId: string): Promise<Set<number>>`;
  - `StoreRefundService.recordForCatalogItem(entry: { checkoutSessionId; catalogVariantId; refundId; amountCents; now }): Promise<void>`;
  - `StoreOrderService.applyRefunds(orderId: string, now: Date): Promise<void>`, which sets `refunded_cents` and `payment_status` from `store_refunds`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/store-payments/refund-lines.test.ts
import { describe, expect, it } from 'vitest';
import { refundStoreLines, type RefundLinesDeps } from './refund-lines';
import type { StoreOrderView } from './store';

const ORDER: StoreOrderView = {
	id: 'ord_1', orderNumber: 1, mode: 'test', appId: 'app_1', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
	subtotalCents: 6599, shippingCents: 0, totalCents: 6599, applicationFeeCents: 2249, currency: 'usd',
	customerEmail: null, customerName: null, shippingAddress: null, note: null, needsAttention: null,
	stripeCheckoutSessionId: 'cs_1', createdAt: new Date(0),
	sellerUserId: 'u1', sellerStripeAccountId: 'acct_1', stripePaymentIntentId: 'pi_1', refundedCents: 0,
	items: [
		{ lineNo: 1, kind: 'catalog', productId: 'feeder', variantId: 'feeder-blue', name: 'Feeder, Blue', quantity: 1, unitPriceCents: 4099, catalogVariantId: 'cv_feeder', lockedCatalogPriceCents: 2028 },
		{ lineNo: 2, kind: 'own', productId: 'gift', variantId: 'gift-25', name: 'Gift Card', quantity: 1, unitPriceCents: 2500, catalogVariantId: null, lockedCatalogPriceCents: null },
	],
};

function fakeDeps(input: { balance?: number; refunded?: number[] } = {}) {
	const calls: string[] = [];
	const recorded: Array<{ lineNo: number; amountCents: number; initiatedBy: string }> = [];
	const deps: RefundLinesDeps = {
		stripe: {
			retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 6599, amount_reversed: 0 } } }),
			createRefund: async (refund) => {
				calls.push(`refund ${refund.amountCents} ${refund.idempotencyKey}`);
				return { id: `re_${calls.length}`, amount: refund.amountCents, status: 'succeeded' };
			},
			createTransferReversal: async (reversal) => {
				calls.push(`reversal ${reversal.amountCents} ${reversal.idempotencyKey}`);
				return { id: `trr_${calls.length}`, amount: reversal.amountCents };
			},
		},
		sellerBalance: async () => ({ availableCents: input.balance ?? 100_000, pendingCents: 0 }),
		refundedLines: async () => new Set(input.refunded ?? []),
		refundCatalogLines: async (lineNos) => {
			calls.push(`catalog ${lineNos.join(',')}`);
			return { ok: true, refundedCents: 4099 };
		},
		recordRefund: async (entry) => void recorded.push({ lineNo: entry.lineNo, amountCents: entry.amountCents, initiatedBy: entry.initiatedBy }),
		applyRefunds: async () => void calls.push('apply'),
		now: () => new Date(0),
	};
	return { deps, calls, recorded };
}

describe('refundStoreLines', () => {
	it("refunds an own line in full and takes it back from the seller's transfer, then updates the order", async () => {
		const { deps, calls, recorded } = fakeDeps();
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' })).toEqual({ ok: true, refundedCents: 2500 });
		expect(calls).toEqual(['refund 2500 store-refund-rq_1-2', 'reversal 2500 store-reversal-rq_1-2', 'apply']);
		expect(recorded).toEqual([{ lineNo: 2, amountCents: 2500, initiatedBy: 'seller' }]);
	});

	it('hands catalog lines to the catalog refund', async () => {
		const { deps, calls } = fakeDeps();
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [1, 2], requestId: 'rq_1' })).toEqual({ ok: true, refundedCents: 6599 });
		expect(calls[0]).toBe('catalog 1');
	});

	it("refuses when the seller's balance is short, before any money moves", async () => {
		const { deps, calls } = fakeDeps({ balance: 2499 });
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_1' })).toEqual({ ok: false, reason: 'seller_balance_short', shortCents: 1 });
		expect(calls).toEqual([]);
	});

	it('never refunds a line twice, whatever the request id', async () => {
		const { deps, calls } = fakeDeps({ refunded: [2] });
		expect(await refundStoreLines(deps, { order: ORDER, lineNos: [2], requestId: 'rq_2' })).toEqual({ ok: false, reason: 'nothing_to_refund' });
		expect(calls).toEqual([]);
	});
});
```

```ts
// worker/database/services/StoreRefundService.test.ts
import { describe, expect, it } from 'vitest';
import { StoreRefundService } from './StoreRefundService';
import { recordingD1 } from '../test-support/recording-d1';

describe('StoreRefundService', () => {
	it('records a refund once per Stripe refund', async () => {
		const { d1, statements } = recordingD1();
		await new StoreRefundService({ DB: d1 } as unknown as Env).record({ refundId: 're_1', orderId: 'ord_1', lineNo: 2, amountCents: 2500, requestId: 'rq_1', initiatedBy: 'seller', now: new Date(0) });
		const insert = statements.find((entry) => entry.sql.toLowerCase().startsWith('insert into "store_refunds"'));
		expect(insert?.params).toEqual(expect.arrayContaining(['re_1', 'ord_1', 2, 2500, 'rq_1', 'seller']));
		expect(insert?.sql.toLowerCase()).toContain('on conflict');
	});

	it('lists the lines already refunded', async () => {
		const { d1 } = recordingD1([[1], [2]]);
		expect([...(await new StoreRefundService({ DB: d1 } as unknown as Env).refundedLines('ord_1'))]).toEqual([1, 2]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/store-payments/refund-lines.test.ts worker/database/services/StoreRefundService.test.ts`
Expected: FAIL, because the modules aren't found.

- [ ] **Step 3: Implement**

```ts
// worker/services/store-payments/refund-lines.ts
/**
 * A seller refunds lines of a store order. Own lines: the shopper gets the line total back and the seller's transfer
 * gives it back. Catalog lines go through the catalog refund. Nothing moves unless the seller's Stripe balance covers it.
 */

import type { StripeClient, StripePaymentIntent } from '../payments/stripe-client';
import type { StoreRefundInitiator } from '../../../shared/types/store-payments';
import type { StoreOrderView } from './store';

export type RefundLinesResult = { ok: true; refundedCents: number } | { ok: false; reason: 'seller_balance_short'; shortCents: number } | { ok: false; reason: 'nothing_to_refund' };

export interface RefundLinesDeps {
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createRefund' | 'createTransferReversal'>;
	sellerBalance(): Promise<{ availableCents: number; pendingCents: number }>;
	refundedLines(orderId: string): Promise<Set<number>>;
	/** The catalog refund for these lines, with reason 'seller-refund'; it checks the balance itself. */
	refundCatalogLines(lineNos: readonly number[]): Promise<RefundLinesResult>;
	recordRefund(entry: { refundId: string; orderId: string; lineNo: number; amountCents: number; requestId: string; initiatedBy: StoreRefundInitiator; now: Date }): Promise<void>;
	applyRefunds(orderId: string): Promise<void>;
	now(): Date;
}

function transferIdOf(intent: StripePaymentIntent): string | null {
	const charge = intent.latest_charge;
	if (typeof charge !== 'object' || charge === null) return null;
	return typeof charge.transfer === 'object' && charge.transfer !== null ? charge.transfer.id : null;
}

export async function refundStoreLines(deps: RefundLinesDeps, input: { order: StoreOrderView; lineNos: readonly number[]; requestId: string }): Promise<RefundLinesResult> {
	const done = await deps.refundedLines(input.order.id);
	const lines = input.order.items.filter((item) => input.lineNos.includes(item.lineNo) && !done.has(item.lineNo));
	if (lines.length === 0 || !input.order.stripePaymentIntentId) return { ok: false, reason: 'nothing_to_refund' };
	const own = lines.filter((item) => item.kind === 'own');
	const catalog = lines.filter((item) => item.kind === 'catalog');

	const ownCents = own.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
	if (own.length > 0) {
		const balance = await deps.sellerBalance();
		const short = ownCents - (balance.availableCents + balance.pendingCents);
		if (short > 0) return { ok: false, reason: 'seller_balance_short', shortCents: short };
	}

	let refundedCents = 0;
	if (catalog.length > 0) {
		const result = await deps.refundCatalogLines(catalog.map((item) => item.lineNo));
		if (!result.ok) return result;
		refundedCents += result.refundedCents;
	}
	if (own.length > 0) {
		const transferId = transferIdOf(await deps.stripe.retrievePaymentIntent(input.order.stripePaymentIntentId));
		if (!transferId) throw new Error(`Store order ${input.order.id} has no transfer to take the refund back from`);
		const metadata = { storeOrderId: input.order.id, refundRequestId: input.requestId };
		for (const line of own) {
			const amount = line.unitPriceCents * line.quantity;
			const refund = await deps.stripe.createRefund({ paymentIntentId: input.order.stripePaymentIntentId, amountCents: amount, idempotencyKey: `store-refund-${input.requestId}-${line.lineNo}`, metadata });
			await deps.recordRefund({ refundId: refund.id, orderId: input.order.id, lineNo: line.lineNo, amountCents: amount, requestId: input.requestId, initiatedBy: 'seller', now: deps.now() });
			await deps.stripe.createTransferReversal({ transferId, amountCents: amount, idempotencyKey: `store-reversal-${input.requestId}-${line.lineNo}`, metadata });
			refundedCents += amount;
		}
	}
	await deps.applyRefunds(input.order.id);
	return { ok: true, refundedCents };
}
```

```ts
// worker/database/services/StoreRefundService.ts
/** Refunds of store order lines, by the seller or by Estori, and the order's refund total they add up to. */

import { and, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { StoreOrderService } from './StoreOrderService';
import type { StoreRefundInitiator } from '../../../shared/types/store-payments';

export class StoreRefundService extends BaseService {
	async record(entry: { refundId: string; orderId: string; lineNo: number; amountCents: number; requestId: string; initiatedBy: StoreRefundInitiator; now: Date }): Promise<void> {
		await this.database
			.insert(schema.storeRefunds)
			.values({ id: entry.refundId, orderId: entry.orderId, lineNo: entry.lineNo, amountCents: entry.amountCents, requestId: entry.requestId, initiatedBy: entry.initiatedBy, createdAt: entry.now })
			.onConflictDoNothing()
			.run();
	}

	async refundedLines(orderId: string): Promise<Set<number>> {
		const rows = await this.database.selectDistinct({ lineNo: schema.storeRefunds.lineNo }).from(schema.storeRefunds).where(eq(schema.storeRefunds.orderId, orderId)).all();
		return new Set(rows.map((row) => row.lineNo));
	}

	/** A catalog item the runner refunded, recorded on its store order line: found by the Checkout session and catalog variant. */
	async recordForCatalogItem(entry: { checkoutSessionId: string; catalogVariantId: string; refundId: string; amountCents: number; now: Date }): Promise<void> {
		const line = await this.database
			.select({ orderId: schema.storeOrderItems.orderId, lineNo: schema.storeOrderItems.lineNo })
			.from(schema.storeOrderItems)
			.innerJoin(schema.storeOrders, eq(schema.storeOrders.id, schema.storeOrderItems.orderId))
			.where(and(eq(schema.storeOrders.stripeCheckoutSessionId, entry.checkoutSessionId), eq(schema.storeOrderItems.catalogVariantId, entry.catalogVariantId)))
			.get();
		if (!line) return;
		await this.record({ refundId: entry.refundId, orderId: line.orderId, lineNo: line.lineNo, amountCents: entry.amountCents, requestId: `catalog-${entry.refundId}`, initiatedBy: 'estori', now: entry.now });
		await new StoreOrderService(this.env).applyRefunds(line.orderId, entry.now);
	}
}
```

The `refundedLines` test hands `recordingD1` the rows `[[1], [2]]`. Drizzle's D1 driver reads selected fields through `raw()`, as `StoreOrderService.test.ts`'s `max()` read does.

`StoreOrderService.applyRefunds(orderId, now)` runs one statement:

```ts
    async applyRefunds(orderId: string, now: Date): Promise<void> {
        const refunded = sql`(SELECT COALESCE(SUM(${schema.storeRefunds.amountCents}), 0) FROM ${schema.storeRefunds} WHERE ${schema.storeRefunds.orderId} = ${orderId})`;
        await this.database
            .update(schema.storeOrders)
            .set({
                refundedCents: refunded,
                paymentStatus: sql`CASE WHEN ${refunded} >= ${schema.storeOrders.totalCents} THEN 'refunded' WHEN ${refunded} > 0 THEN 'partially_refunded' ELSE ${schema.storeOrders.paymentStatus} END`,
                revision: sql`${schema.storeOrders.revision} + 1`,
                updatedAt: now,
            })
            .where(eq(schema.storeOrders.id, orderId))
            .run();
    }
```

Wire the runner. In `CatalogOrderRunner.ts`'s `runnerDeps`, replace the no-op `recordRefund` with:

```ts
		recordRefund: async (entry) => {
			const store = new CatalogOrderService(env);
			const located = await store.locateItem(entry.catalogItemId);
			if (!located) return;
			await new StoreRefundService(env).recordForCatalogItem({ checkoutSessionId: located.checkoutSessionId, catalogVariantId: located.catalogVariantId, refundId: entry.refundId, amountCents: entry.amountCents, now: new Date() });
		},
```

Add `CatalogOrderService.locateItem(itemId)`:

```ts
    /** The Checkout session and catalog variant of one catalog item, for recording its refund on the store order. */
    async locateItem(itemId: string): Promise<{ checkoutSessionId: string; catalogVariantId: string } | null> {
        const row = await this.database
            .select({ checkoutSessionId: schema.catalogOrders.stripeCheckoutSessionId, catalogVariantId: schema.catalogOrderItems.catalogVariantId })
            .from(schema.catalogOrderItems)
            .innerJoin(schema.catalogOrders, eq(schema.catalogOrders.id, schema.catalogOrderItems.orderId))
            .where(eq(schema.catalogOrderItems.id, itemId))
            .get();
        return row ?? null;
    }
```

Export `StoreRefundService` from the database barrel.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/store-payments worker/database/services/StoreRefundService.test.ts worker/services/catalog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/refund-lines.ts worker/services/store-payments/refund-lines.test.ts worker/database/services/ worker/database/index.ts worker/services/catalog/
git commit -m "feat(store-payments): refund store lines from the seller's share and keep the order's refund total"
```

### Task 6: The seller's refund endpoint

**Files:**
- Modify: `worker/api/controllers/stores/controller.ts`, `worker/api/routes/storeRoutes.ts`
- Modify: `shared/types/store-payments.ts` (request and response types), `src/api-types.ts`, `src/lib/api-client.ts`
- Test: `worker/api/controllers/stores/store-routes-wiring.test.ts`, `worker/api/controllers/stores/refund-request.test.ts`

**Interfaces:**
- Consumes: `refundStoreLines` (Task 5); `refundCatalogItems` and `SellerBalanceShortError` (Task 4).
- Produces:
  - `POST /api/stores/:id/orders/:orderId/refunds`, owner-only, with body `StoreRefundRequest = { lineNos: number[]; requestId: string }` and response `StoreRefundResponse = { refundedCents: number }`;
  - on a short balance: HTTP 409 with the message `Your Stripe balance is $X.XX short for this refund. It can go through once more sales come in.`;
  - `parseStoreRefundRequest(body: unknown): StoreRefundRequest | null`, which accepts 1–50 positive integer line numbers and a `requestId` of 8–64 characters from `[A-Za-z0-9_-]`;
  - `apiClient.refundStoreOrder(appId, orderId, request)`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/api/controllers/stores/refund-request.test.ts
import { describe, expect, it } from 'vitest';
import { parseStoreRefundRequest, shortBalanceMessage } from './refund-request';

describe('parseStoreRefundRequest', () => {
	it('accepts line numbers and a request id', () => {
		expect(parseStoreRefundRequest({ lineNos: [1, 2], requestId: 'rq_12345678' })).toEqual({ lineNos: [1, 2], requestId: 'rq_12345678' });
	});

	it('refuses amounts, bad lines and bad ids', () => {
		for (const body of [
			{ lineNos: [1], requestId: 'rq_12345678', amountCents: 100 },
			{ lineNos: [], requestId: 'rq_12345678' },
			{ lineNos: [0], requestId: 'rq_12345678' },
			{ lineNos: [1.5], requestId: 'rq_12345678' },
			{ lineNos: [1], requestId: 'short' },
			{ lineNos: [1], requestId: 'has spaces in it' },
			null,
		]) {
			expect(parseStoreRefundRequest(body)).toBeNull();
		}
	});

	it('tells the seller how short their balance is', () => {
		expect(shortBalanceMessage(1)).toBe('Your Stripe balance is $0.01 short for this refund. It can go through once more sales come in.');
	});
});
```

In `store-routes-wiring.test.ts`, add:

```ts
	it("lets only the store's owner refund its orders", () => {
		const routes = source('/worker/api/routes/storeRoutes.ts');
		expect(routes).toContain("app.post('/api/stores/:id/orders/:orderId/refunds', setAuthLevel(AuthConfig.ownerOnly)");
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/api/controllers/stores`
Expected: FAIL. `./refund-request` isn't found, and the route is missing.

- [ ] **Step 3: Implement**

```ts
// worker/api/controllers/stores/refund-request.ts
/** The seller's refund request: line numbers and a client-made id, never an amount. */

import type { StoreRefundRequest } from '../../../../shared/types/store-payments';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function parseStoreRefundRequest(body: unknown): StoreRefundRequest | null {
	if (typeof body !== 'object' || body === null) return null;
	const { lineNos, requestId, ...rest } = body as Record<string, unknown>;
	if (Object.keys(rest).length > 0) return null;
	if (!Array.isArray(lineNos) || lineNos.length === 0 || lineNos.length > 50) return null;
	if (!lineNos.every((line) => Number.isInteger(line) && (line as number) > 0)) return null;
	if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return null;
	return { lineNos: lineNos as number[], requestId };
}

export function shortBalanceMessage(shortCents: number): string {
	return `Your Stripe balance is $${(shortCents / 100).toFixed(2)} short for this refund. It can go through once more sales come in.`;
}
```

In `shared/types/store-payments.ts`, add:

```ts
export interface StoreRefundRequest {
	lineNos: number[];
	/** Made once per refund attempt by the client, so a retried request refunds once. */
	requestId: string;
}
export interface StoreRefundResponse {
	refundedCents: number;
}
```

In `worker/api/controllers/stores/controller.ts`, add a `refund` method, with imports from the database barrel, the Stripe config, `refund-lines`, `refund-items` and `./refund-request`:

```ts
    /** The owner refunds lines of an order; nothing moves unless their Stripe balance covers it. */
    static async refund(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<StoreRefundResponse>>> {
        try {
            const appId = context.pathParams.id;
            const orderId = context.pathParams.orderId;
            const body = await StoreOrdersController.parseJsonBody<unknown>(request);
            const refundRequest = body.success ? parseStoreRefundRequest(body.data) : null;
            if (!refundRequest) return StoreOrdersController.createErrorResponse<StoreRefundResponse>('Send the lines to refund and a request id', 400);
            const stripe = stripeFromEnv(env);
            if (!stripe) return StoreOrdersController.createErrorResponse<StoreRefundResponse>(PAYMENTS_NOT_CONFIGURED_MESSAGE, 400);
            const orders = new StoreOrderService(env);
            const order = await orders.getOrder(orderId);
            if (!order || order.appId !== appId) return StoreOrdersController.createErrorResponse<StoreRefundResponse>('Order not found', 404);

            const refunds = new StoreRefundService(env);
            const catalog = new CatalogOrderService(env);
            const sellerBalance = () => stripe.retrieveBalance(order.sellerStripeAccountId);
            const now = () => new Date();
            const result = await refundStoreLines(
                {
                    stripe,
                    sellerBalance,
                    refundedLines: (id) => refunds.refundedLines(id),
                    recordRefund: (entry) => refunds.record(entry),
                    applyRefunds: (id) => orders.applyRefunds(id, now()),
                    now,
                    refundCatalogLines: async (lineNos) => {
                        const catalogOrder = order.stripeCheckoutSessionId ? await catalog.getOrderBySession(order.stripeCheckoutSessionId) : null;
                        if (!catalogOrder) return { ok: false, reason: 'nothing_to_refund' };
                        const variants = new Set(order.items.filter((item) => lineNos.includes(item.lineNo)).map((item) => item.catalogVariantId));
                        const itemIds = catalogOrder.items.filter((item) => variants.has(item.catalogVariantId)).map((item) => item.id);
                        try {
                            const totals = await refundCatalogItems(
                                {
                                    store: catalog,
                                    stripe,
                                    sellerBalance,
                                    recordRefund: (entry) => refunds.recordForCatalogItem({ checkoutSessionId: order.stripeCheckoutSessionId as string, catalogVariantId: catalogOrder.items.find((item) => item.id === entry.catalogItemId)?.catalogVariantId ?? '', refundId: entry.refundId, amountCents: entry.amountCents, now: now() }),
                                },
                                { orderId: catalogOrder.id, itemIds, reason: 'seller-refund' },
                            );
                            return { ok: true, refundedCents: totals.shopperCents };
                        } catch (error) {
                            if (error instanceof SellerBalanceShortError) return { ok: false, reason: 'seller_balance_short', shortCents: error.shortCents };
                            throw error;
                        }
                    },
                },
                { order, lineNos: refundRequest.lineNos, requestId: refundRequest.requestId },
            );
            if (result.ok) return StoreOrdersController.createSuccessResponse<StoreRefundResponse>({ refundedCents: result.refundedCents });
            if (result.reason === 'seller_balance_short') return StoreOrdersController.createErrorResponse<StoreRefundResponse>(shortBalanceMessage(result.shortCents), 409);
            return StoreOrdersController.createErrorResponse<StoreRefundResponse>('These lines were already refunded', 400);
        } catch (error) {
            this.logger.error('Error refunding a store order', error);
            return StoreOrdersController.createErrorResponse<StoreRefundResponse>('Failed to refund the order', 500);
        }
    }
```

Add `CatalogOrderService.getOrderBySession(checkoutSessionId)`. It does what `getOrder` does, with the condition on `stripe_checkout_session_id`; refactor `getOrder`'s body into a private `orderWhere(condition)` that both call.

Read the route params the way `list` already does in this controller. If it reads `context.pathParams.id`, keep that; if it uses another accessor, use the same one for `orderId`.

Route, in `storeRoutes.ts`:

```ts
    app.post('/api/stores/:id/orders/:orderId/refunds', setAuthLevel(AuthConfig.ownerOnly), adaptController(StoreOrdersController, StoreOrdersController.refund));
```

`ownerOnly` checks the `:id` app's owner, the same as the orders list.

Client, in `src/lib/api-client.ts`:

```ts
	async refundStoreOrder(appId: string, orderId: string, request: StoreRefundRequest): Promise<ApiResponse<StoreRefundResponse>> {
		return this.request<StoreRefundResponse>(`/api/stores/${encodeURIComponent(appId)}/orders/${encodeURIComponent(orderId)}/refunds`, { method: 'POST', body: JSON.stringify(request) });
	}
```

Re-export the two types from `src/api-types.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/api/controllers/stores`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.worker.json --noEmit` and `rtk proxy npx tsc -p tsconfig.app.json --noEmit`
Expected: clean, apart from the 4 `artifacts-viewer` errors.

- [ ] **Step 5: Commit**

```bash
git add worker/api/controllers/stores/ worker/api/routes/storeRoutes.ts shared/types/store-payments.ts src/api-types.ts src/lib/api-client.ts
git commit -m "feat(stores): the seller refunds order lines, paid from their stripe balance"
```

### Task 7: Disputes taken back from the seller

**Files:**
- Create: `worker/services/store-payments/disputes.ts`
- Create: `worker/database/services/StoreDisputeService.ts`
- Modify: `worker/database/services/CatalogOrderService.ts` (`withholdPending`)
- Modify: `worker/api/controllers/payments/webhook.ts`
- Modify: `worker/services/alerts/platform-alerts.ts` (kinds `dispute-opened`, `dispute-closed`)
- Test: `worker/services/store-payments/disputes.test.ts`, `worker/api/controllers/payments/payments-wiring.test.ts`

**Interfaces:**
- Consumes:
  - `SellerChargeService.add`, `findBySource`, `setAmount` (Task 3);
  - `createTransferReversal`, `createTransfer` and `retrievePaymentIntent` (Task 1);
  - alerts (plan 1, Task 7).
- Produces:
  - `StripeDispute = { id; amount; charge; payment_intent: string | null; reason; status; balance_transactions: Array<{ fee: number }> }`;
  - `isStripeDispute(object: unknown): object is StripeDispute`;
  - `handleDisputeOpened(deps: DisputeDeps, dispute: StripeDispute): Promise<'recorded' | 'not-ours'>`;
  - `handleDisputeClosed(deps: DisputeDeps, dispute: StripeDispute): Promise<'won' | 'lost' | 'not-ours'>`;
  - `CatalogOrderService.withholdPending(checkoutSessionId: string): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/store-payments/disputes.test.ts
import { describe, expect, it } from 'vitest';
import { handleDisputeClosed, handleDisputeOpened, type DisputeDeps, type StripeDispute } from './disputes';

const DISPUTE: StripeDispute = { id: 'dp_1', amount: 6599, charge: 'ch_1', payment_intent: 'pi_1', reason: 'fraudulent', status: 'needs_response', balance_transactions: [{ fee: 1500 }] };

function fakeDeps(input: { reversed?: number; stored?: { reversedCents: number; feeCents: number } | null; known?: boolean; reversalFails?: boolean } = {}) {
	const calls: string[] = [];
	const deps: DisputeDeps = {
		findOrder: async () => (input.known === false ? null : { id: 'ord_1', sellerUserId: 'u1', sellerStripeAccountId: 'acct_1', checkoutSessionId: 'cs_1' }),
		stripe: {
			retrievePaymentIntent: async (id) => ({ id, latest_charge: { id: 'ch_1', transfer: { id: 'tr_1', amount: 6599, amount_reversed: input.reversed ?? 0 } } }),
			createTransferReversal: async (reversal) => {
				if (input.reversalFails) throw new Error('Stripe refused');
				calls.push(`reversal ${reversal.amountCents} ${reversal.idempotencyKey}`);
				return { id: 'trr_1', amount: reversal.amountCents };
			},
			createTransfer: async (transfer) => {
				calls.push(`transfer ${transfer.amountCents} ${transfer.idempotencyKey}`);
				return { id: 'tr_9', amount: transfer.amountCents };
			},
		},
		storedDispute: async () => input.stored ?? null,
		saveDispute: async (row) => void calls.push(`save ${row.status} reversed=${row.reversedCents} fee=${row.feeCents}`),
		addCharge: async (charge) => void calls.push(`charge ${charge.kind} ${charge.amountCents}`),
		setFeeCharge: async (amountCents) => void calls.push(`fee charge ${amountCents}`),
		withholdCatalog: async () => void calls.push('withhold'),
		setOrderStatus: async (status) => void calls.push(`order ${status}`),
		alert: async (alert) => void calls.push(`alert ${alert.kind}`),
		now: () => new Date(0),
	};
	return { deps, calls };
}

describe('handleDisputeOpened', () => {
	it('takes the disputed amount back, charges the fee, holds unplaced catalog items and alerts', async () => {
		const { deps, calls } = fakeDeps();
		expect(await handleDisputeOpened(deps, DISPUTE)).toBe('recorded');
		expect(calls).toEqual(['reversal 6599 dispute-reversal-dp_1', 'charge dispute-fee 1500', 'withhold', 'order disputed', 'save needs_response reversed=6599 fee=1500', 'alert dispute-opened']);
	});

	it('takes only what is left of a partly refunded transfer, and charges the rest', async () => {
		const { deps, calls } = fakeDeps({ reversed: 2500 });
		await handleDisputeOpened(deps, DISPUTE);
		expect(calls).toContain('reversal 4099 dispute-reversal-dp_1');
		expect(calls).toContain('charge dispute-shortfall 2500');
	});

	it('charges the whole amount when Stripe refuses the reversal', async () => {
		const { deps, calls } = fakeDeps({ reversalFails: true });
		await handleDisputeOpened(deps, DISPUTE);
		expect(calls).toContain('charge dispute-shortfall 6599');
	});

	it('ignores disputes on payments that are not store orders', async () => {
		const { deps, calls } = fakeDeps({ known: false });
		expect(await handleDisputeOpened(deps, DISPUTE)).toBe('not-ours');
		expect(calls).toEqual([]);
	});
});

describe('handleDisputeClosed', () => {
	it('returns what was taken when the seller wins, and the fee if Stripe returned it', async () => {
		const { deps, calls } = fakeDeps({ stored: { reversedCents: 6599, feeCents: 1500 } });
		expect(await handleDisputeClosed(deps, { ...DISPUTE, status: 'won', balance_transactions: [{ fee: 1500 }, { fee: -1500 }] })).toBe('won');
		expect(calls).toEqual(['transfer 6599 dispute-return-dp_1', 'fee charge 0', 'order paid', 'save won reversed=6599 fee=0', 'alert dispute-closed']);
	});

	it('keeps what was taken when the dispute is lost', async () => {
		const { deps, calls } = fakeDeps({ stored: { reversedCents: 6599, feeCents: 1500 } });
		expect(await handleDisputeClosed(deps, { ...DISPUTE, status: 'lost' })).toBe('lost');
		expect(calls).toEqual(['order dispute_lost', 'save lost reversed=6599 fee=1500', 'alert dispute-closed']);
	});
});
```

In `worker/api/controllers/payments/payments-wiring.test.ts`, which already reads `webhook.ts` as raw text, add:

```ts
	it('routes disputes on store payments to the dispute handlers', () => {
		const webhook = source('/worker/api/controllers/payments/webhook.ts');
		expect(webhook).toContain("event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed'");
		expect(webhook).toContain('handleDisputeOpened(deps, object)');
		expect(webhook).toContain('handleDisputeClosed(deps, object)');
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/store-payments/disputes.test.ts worker/api/controllers/payments/payments-wiring.test.ts`
Expected: FAIL, because `./disputes` isn't found.

- [ ] **Step 3: Implement**

```ts
// worker/services/store-payments/disputes.ts
/**
 * A shopper disputes a store payment: Stripe takes the amount and its fee from Estori, so Estori takes the amount back
 * from the seller's transfer at once, charges the fee to the seller, and holds catalog items not yet bought. A won
 * dispute returns what was taken, and the fee if Stripe returned it.
 */

import type { StripeClient } from '../payments/stripe-client';
import type { PlatformAlert } from '../alerts/platform-alerts';
import type { SellerChargeKind, StorePaymentStatus } from '../../../shared/types/store-payments';

export interface StripeDispute {
	id: string;
	amount: number;
	charge: string;
	payment_intent: string | null;
	reason: string;
	status: string;
	balance_transactions: Array<{ fee: number }>;
}

export function isStripeDispute(object: unknown): object is StripeDispute {
	if (typeof object !== 'object' || object === null) return false;
	const candidate = object as Partial<StripeDispute>;
	return typeof candidate.id === 'string' && candidate.id.startsWith('dp_') && typeof candidate.amount === 'number' && Array.isArray(candidate.balance_transactions);
}

export interface DisputeDeps {
	findOrder(paymentIntentId: string): Promise<{ id: string; sellerUserId: string; sellerStripeAccountId: string; checkoutSessionId: string | null } | null>;
	stripe: Pick<StripeClient, 'retrievePaymentIntent' | 'createTransferReversal' | 'createTransfer'>;
	storedDispute(disputeId: string): Promise<{ reversedCents: number; feeCents: number } | null>;
	saveDispute(row: { id: string; orderId: string; amountCents: number; reason: string; status: string; reversalId: string | null; reversedCents: number; feeCents: number; returnedCents: number; now: Date }): Promise<void>;
	addCharge(charge: { sellerUserId: string; kind: SellerChargeKind; sourceId: string; amountCents: number; now: Date }): Promise<void>;
	/** Sets the dispute-fee charge to this amount; a collected excess is paid back by the caller's transfer. */
	setFeeCharge(amountCents: number): Promise<void>;
	withholdCatalog(checkoutSessionId: string): Promise<void>;
	setOrderStatus(status: StorePaymentStatus): Promise<void>;
	alert(alert: PlatformAlert): Promise<void>;
	now(): Date;
}

const feeOf = (dispute: StripeDispute): number => Math.max(dispute.balance_transactions.reduce((sum, entry) => sum + entry.fee, 0), 0);

export async function handleDisputeOpened(deps: DisputeDeps, dispute: StripeDispute): Promise<'recorded' | 'not-ours'> {
	if (!dispute.payment_intent) return 'not-ours';
	const order = await deps.findOrder(dispute.payment_intent);
	if (!order) return 'not-ours';
	const now = deps.now();
	const charge = (await deps.stripe.retrievePaymentIntent(dispute.payment_intent)).latest_charge;
	const transfer = typeof charge === 'object' && charge !== null && typeof charge.transfer === 'object' ? charge.transfer : null;
	const reversible = transfer ? transfer.amount - transfer.amount_reversed : 0;
	let reversedCents = Math.min(dispute.amount, Math.max(reversible, 0));
	let reversalId: string | null = null;
	if (transfer && reversedCents > 0) {
		try {
			reversalId = (await deps.stripe.createTransferReversal({ transferId: transfer.id, amountCents: reversedCents, idempotencyKey: `dispute-reversal-${dispute.id}`, metadata: { disputeId: dispute.id, storeOrderId: order.id } })).id;
		} catch {
			reversedCents = 0;
		}
	}
	const feeCents = feeOf(dispute);
	if (feeCents > 0) await deps.addCharge({ sellerUserId: order.sellerUserId, kind: 'dispute-fee', sourceId: dispute.id, amountCents: feeCents, now });
	if (dispute.amount > reversedCents) await deps.addCharge({ sellerUserId: order.sellerUserId, kind: 'dispute-shortfall', sourceId: dispute.id, amountCents: dispute.amount - reversedCents, now });
	if (order.checkoutSessionId) await deps.withholdCatalog(order.checkoutSessionId);
	await deps.setOrderStatus('disputed');
	await deps.saveDispute({ id: dispute.id, orderId: order.id, amountCents: dispute.amount, reason: dispute.reason, status: dispute.status, reversalId, reversedCents, feeCents, returnedCents: 0, now });
	await deps.alert({ kind: 'dispute-opened', subject: order.id, message: `A shopper disputed ${(dispute.amount / 100).toFixed(2)} USD (${dispute.reason}). Answer it in the Stripe Dashboard.` });
	return 'recorded';
}

export async function handleDisputeClosed(deps: DisputeDeps, dispute: StripeDispute): Promise<'won' | 'lost' | 'not-ours'> {
	if (!dispute.payment_intent) return 'not-ours';
	const order = await deps.findOrder(dispute.payment_intent);
	const stored = await deps.storedDispute(dispute.id);
	if (!order || !stored) return 'not-ours';
	const now = deps.now();
	const won = dispute.status === 'won';
	const feeCents = feeOf(dispute);
	let returnedCents = 0;
	if (won && stored.reversedCents > 0) {
		await deps.stripe.createTransfer({ destination: order.sellerStripeAccountId, amountCents: stored.reversedCents, idempotencyKey: `dispute-return-${dispute.id}`, metadata: { disputeId: dispute.id, storeOrderId: order.id } });
		returnedCents = stored.reversedCents;
	}
	if (feeCents < stored.feeCents) await deps.setFeeCharge(feeCents);
	await deps.setOrderStatus(won ? 'paid' : 'dispute_lost');
	await deps.saveDispute({ id: dispute.id, orderId: order.id, amountCents: dispute.amount, reason: dispute.reason, status: dispute.status, reversalId: null, reversedCents: stored.reversedCents, feeCents, returnedCents, now });
	await deps.alert({ kind: 'dispute-closed', subject: order.id, message: won ? 'The dispute was decided for the seller; what was taken back was returned.' : 'The dispute was lost; the seller keeps paying the amount and the fee.' });
	return won ? 'won' : 'lost';
}
```

On close, `saveDispute` must not overwrite the stored `reversal_id` with null. `StoreDisputeService.save` upserts, and only sets `reversal_id` when it is not null (use `COALESCE(excluded.reversal_id, store_disputes.reversal_id)`).

A returned excess leaves `collected_cents` above `amount_cents` on that charge. That is the record of what was collected, and `open()` never lists the charge again.

```ts
// worker/database/services/StoreDisputeService.ts
/** Shoppers' disputes of store payments, and what Estori took back and returned for each. */

import { eq, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';

export class StoreDisputeService extends BaseService {
	async get(disputeId: string): Promise<{ reversedCents: number; feeCents: number } | null> {
		const row = await this.database.select({ reversedCents: schema.storeDisputes.reversedCents, feeCents: schema.storeDisputes.feeCents }).from(schema.storeDisputes).where(eq(schema.storeDisputes.id, disputeId)).get();
		return row ?? null;
	}

	/** Upserts by dispute id; a later save without a reversal keeps the stored one. */
	async save(row: { id: string; orderId: string; amountCents: number; reason: string; status: string; reversalId: string | null; reversedCents: number; feeCents: number; returnedCents: number; now: Date }): Promise<void> {
		await this.database
			.insert(schema.storeDisputes)
			.values({ id: row.id, orderId: row.orderId, amountCents: row.amountCents, reason: row.reason, status: row.status, reversalId: row.reversalId, reversedCents: row.reversedCents, feeCents: row.feeCents, returnedCents: row.returnedCents, createdAt: row.now, updatedAt: row.now })
			.onConflictDoUpdate({
				target: schema.storeDisputes.id,
				set: {
					status: row.status,
					reversalId: sql`COALESCE(excluded.reversal_id, ${schema.storeDisputes.reversalId})`,
					reversedCents: row.reversedCents,
					feeCents: row.feeCents,
					returnedCents: row.returnedCents,
					updatedAt: row.now,
				},
			})
			.run();
	}
}
```

`CatalogOrderService.withholdPending`:

```ts
    /** A disputed order's catalog items not yet bought: neither placed nor refunded, since the dispute returned the money. */
    async withholdPending(checkoutSessionId: string): Promise<void> {
        await this.database
            .update(schema.catalogOrderItems)
            .set({ status: 'withheld', updatedAt: new Date() })
            .where(and(
                eq(schema.catalogOrderItems.status, 'pending'),
                inArray(schema.catalogOrderItems.orderId, this.database.select({ id: schema.catalogOrders.id }).from(schema.catalogOrders).where(eq(schema.catalogOrders.stripeCheckoutSessionId, checkoutSessionId))),
            ))
            .run();
    }
```

`StoreOrderService.setPaymentStatus`:

```ts
    async setPaymentStatus(orderId: string, status: StorePaymentStatus, now: Date): Promise<void> {
        await this.database
            .update(schema.storeOrders)
            .set({ paymentStatus: status, revision: sql`${schema.storeOrders.revision} + 1`, updatedAt: now })
            .where(eq(schema.storeOrders.id, orderId))
            .run();
    }
```

`disputeDepsFromEnv`, in `worker/services/store-payments/wiring.ts`:

```ts
export function disputeDepsFromEnv(env: Env, dispute: StripeDispute): DisputeDeps {
	const stripe = stripeFromEnv(env);
	if (!stripe) throw new Error('Stripe is not configured');
	const orders = new StoreOrderService(env);
	const disputes = new StoreDisputeService(env);
	const charges = new SellerChargeService(env);
	let orderId: string | null = null;
	return {
		findOrder: async (paymentIntentId) => {
			const order = await orders.findByPaymentIntent(paymentIntentId);
			orderId = order?.id ?? null;
			return order ? { id: order.id, sellerUserId: order.sellerUserId, sellerStripeAccountId: order.sellerStripeAccountId, checkoutSessionId: order.stripeCheckoutSessionId } : null;
		},
		stripe,
		storedDispute: (disputeId) => disputes.get(disputeId),
		saveDispute: (row) => disputes.save(row),
		addCharge: async (charge) => {
			await charges.add(charge);
		},
		setFeeCharge: async (amountCents) => {
			const charge = await charges.findBySource('dispute-fee', dispute.id);
			const order = dispute.payment_intent ? await orders.findByPaymentIntent(dispute.payment_intent) : null;
			if (!charge || !order) return;
			const excess = charge.collectedCents - amountCents;
			if (excess > 0) {
				await stripe.createTransfer({ destination: order.sellerStripeAccountId, amountCents: excess, idempotencyKey: `dispute-fee-return-${dispute.id}`, metadata: { disputeId: dispute.id } });
			}
			await charges.setAmount(charge.id, amountCents, new Date());
		},
		withholdCatalog: (checkoutSessionId) => new CatalogOrderService(env).withholdPending(checkoutSessionId),
		setOrderStatus: async (status) => {
			if (orderId) await orders.setPaymentStatus(orderId, status, new Date());
		},
		alert: platformAlertsFromEnv(env),
		now: () => new Date(),
	};
}
```

Add `'dispute-opened'` and `'dispute-closed'` to `PLATFORM_ALERT_KINDS`, with these labels:
- "A shopper disputed a payment"
- "A dispute was decided"

Webhook, in `dispatchStripeEvent`, before the `account.updated` branch:

```ts
    if ((event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') && isStripeDispute(object)) {
        const deps = disputeDepsFromEnv(env, object);
        const result = event.type === 'charge.dispute.created' ? await handleDisputeOpened(deps, object) : await handleDisputeClosed(deps, object);
        logger.info('Dispute handled', { id: object.id, type: event.type, result });
        return;
    }
```

`disputeDepsFromEnv(env, dispute)` lives in `worker/services/store-payments/wiring.ts`. It builds the deps from the services above, `stripeFromEnv(env)` and `platformAlertsFromEnv(env)`. It throws when Stripe isn't configured, so the webhook answers 500 and Stripe retries.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/store-payments worker/api/controllers/payments worker/database/services worker/services/alerts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/ worker/database/services/ worker/database/index.ts worker/api/controllers/payments/ worker/services/alerts/platform-alerts.ts
git commit -m "feat(store-payments): disputes are taken back from the seller and returned if won"
```

### Task 8: Connect events, and Stripe's account costs charged to sellers

**Files:**
- Modify: `worker/services/payments/webhook.ts` (`StripeEvent.account`)
- Modify: `worker/api/controllers/payments/webhook.ts` (two signing secrets, `payout.paid`)
- Create: `worker/services/payments/seller-costs.ts`
- Modify: `worker/types/env.d.ts` (`STRIPE_CONNECT_WEBHOOK_SECRET?: string`)
- Test: `worker/services/payments/seller-costs.test.ts`, `worker/services/payments/webhook.test.ts`, `worker/api/controllers/payments/webhook-store.test.ts`

**Interfaces:**
- Consumes: `SellerChargeService.add` (Task 3).
- Produces:
  - `StripeEvent.account?: string`;
  - `SELLER_ACCOUNT_COSTS = { monthlyActiveCents: 200, payoutPercent: 0.25, payoutFixedCents: 25 }`;
  - `payoutFeeCents(amountCents: number): number`;
  - `chargesForPayout(input: { stripeAccountId: string; payoutId: string; amountCents: number; arrivalDate: Date }): Array<{ kind: 'payout-fee' | 'active-account-fee'; sourceId: string; amountCents: number }>`;
  - `estimatedMonthlyPayoutCostCents(monthlyVolumeCents: number, interval: PayoutInterval): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/payments/seller-costs.test.ts
import { describe, expect, it } from 'vitest';
import { chargesForPayout, estimatedMonthlyPayoutCostCents, payoutFeeCents } from './seller-costs';

describe("Stripe's seller account costs", () => {
	it('charges 0.25% plus 25 cents per payout, rounded to the cent', () => {
		expect(payoutFeeCents(100_000)).toBe(275);
		expect(payoutFeeCents(1_999)).toBe(30);
	});

	it('charges the monthly fee once per account per calendar month, keyed so redeliveries charge once', () => {
		expect(chargesForPayout({ stripeAccountId: 'acct_1', payoutId: 'po_1', amountCents: 100_000, arrivalDate: new Date('2026-10-19T00:00:00Z') })).toEqual([
			{ kind: 'payout-fee', sourceId: 'po_1', amountCents: 275 },
			{ kind: 'active-account-fee', sourceId: 'acct_1-2026-10', amountCents: 200 },
		]);
	});

	it('estimates a month of payouts by frequency', () => {
		expect(estimatedMonthlyPayoutCostCents(100_000, 'daily')).toBe(1000);
		expect(estimatedMonthlyPayoutCostCents(100_000, 'weekly')).toBe(550);
		expect(estimatedMonthlyPayoutCostCents(100_000, 'monthly')).toBe(475);
		expect(estimatedMonthlyPayoutCostCents(0, 'weekly')).toBe(0);
	});
});
```

The daily estimate is 22 payouts: $2.00 + $2.50 + 22 × $0.25 = $10.00. The weekly estimate is 4 payouts: $2.00 + $2.50 + $1.00 = $5.50. The monthly estimate is $2.00 + $2.50 + $0.25 = $4.75. With no sales there are no payouts and nothing to pay.

In `worker/services/payments/webhook.test.ts`, add:

```ts
	it('keeps the connected account a Connect event came from', () => {
		expect(parseStripeEvent(JSON.stringify({ id: 'evt_1', type: 'payout.paid', account: 'acct_1', data: { object: { id: 'po_1' } } }))?.account).toBe('acct_1');
		expect(parseStripeEvent(JSON.stringify({ id: 'evt_2', type: 'charge.dispute.created', data: { object: {} } }))?.account).toBeUndefined();
	});
```

In `worker/api/controllers/payments/webhook-store.test.ts`:
1. Generalize the signing helper to `async function signatureFor(payload: string, secret = SECRET): Promise<string>`, using `secret` in `importKey`.
2. Add:

```ts
	it('accepts a Connect event signed with the Connect secret, and charges nothing for an account it does not know', async () => {
		const connectSecret = 'whsec_connect_test';
		const payload = JSON.stringify({ id: 'evt_9', type: 'payout.paid', account: 'acct_unknown', data: { object: { id: 'po_1', amount: 100_000, arrival_date: 1_800_000_000 } } });
		const { d1, statements } = recordingD1();
		const env = { DB: d1, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_CONNECT_WEBHOOK_SECRET: connectSecret, STRIPE_SECRET_KEY: 'sk_test_fake' } as unknown as Env;
		const request = (signature: string) => new Request('https://estori.test/api/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': signature }, body: payload });

		expect((await handleStripeWebhook(request(await signatureFor(payload, connectSecret)), env)).status).toBe(200);
		expect(statements.some((entry) => entry.sql.toLowerCase().startsWith('insert into "seller_charges"'))).toBe(false);
		expect((await handleStripeWebhook(request(await signatureFor(payload, 'whsec_other')), env)).status).toBe(400);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/payments/seller-costs.test.ts worker/services/payments/webhook.test.ts worker/api/controllers/payments/webhook-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// worker/services/payments/seller-costs.ts
/** What Stripe charges Estori for each seller account, passed to the seller (spec section 4). */

import type { PayoutInterval } from '../../../shared/types/store-payments';

export const SELLER_ACCOUNT_COSTS = { monthlyActiveCents: 200, payoutPercent: 0.25, payoutFixedCents: 25 } as const;
const PAYOUTS_PER_MONTH: Readonly<Record<PayoutInterval, number>> = { daily: 22, weekly: 4, monthly: 1 };

export function payoutFeeCents(amountCents: number): number {
	return Math.round((amountCents * SELLER_ACCOUNT_COSTS.payoutPercent) / 100) + SELLER_ACCOUNT_COSTS.payoutFixedCents;
}

export function chargesForPayout(input: { stripeAccountId: string; payoutId: string; amountCents: number; arrivalDate: Date }) {
	const month = input.arrivalDate.toISOString().slice(0, 7);
	return [
		{ kind: 'payout-fee' as const, sourceId: input.payoutId, amountCents: payoutFeeCents(input.amountCents) },
		{ kind: 'active-account-fee' as const, sourceId: `${input.stripeAccountId}-${month}`, amountCents: SELLER_ACCOUNT_COSTS.monthlyActiveCents },
	];
}

export function estimatedMonthlyPayoutCostCents(monthlyVolumeCents: number, interval: PayoutInterval): number {
	if (monthlyVolumeCents <= 0) return 0;
	const payouts = PAYOUTS_PER_MONTH[interval];
	return SELLER_ACCOUNT_COSTS.monthlyActiveCents + Math.round((monthlyVolumeCents * SELLER_ACCOUNT_COSTS.payoutPercent) / 100) + payouts * SELLER_ACCOUNT_COSTS.payoutFixedCents;
}
```

`active-account-fee` is keyed per account and month. `SellerChargeService.add` ignores a second insert with the same kind and source, so the monthly fee is charged once however many payouts arrive that month.

In `worker/services/payments/webhook.ts`:
- Add `account?: string;` to `StripeEvent`.
- In `parseStripeEvent`, return `account: typeof event.account === 'string' ? event.account : undefined`. Extend the parsed shape with `account?: unknown`.

In `worker/api/controllers/payments/webhook.ts`:
- Verify against both secrets:

```ts
    const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((value): value is string => typeof value === 'string' && value.length > 0);
    // ...replace the single verify with:
    const now = Math.floor(Date.now() / 1000);
    let valid = false;
    for (const candidate of secrets) valid = valid || (await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), candidate, now));
```

- Keep the missing-secret error for when `STRIPE_WEBHOOK_SECRET` is unset.
- In `dispatchStripeEvent`, add:

```ts
    if (event.type === 'payout.paid' && event.account && isStripePayout(object)) {
        const seller = await new StripeConnectService(env).getByAccountId(event.account);
        if (!seller) return; // Not one of Estori's sellers, or deleted since: nothing to charge.
        const charges = new SellerChargeService(env);
        for (const charge of chargesForPayout({ stripeAccountId: event.account, payoutId: object.id, amountCents: object.amount, arrivalDate: new Date(object.arrival_date * 1000) })) {
            await charges.add({ sellerUserId: seller.userId, ...charge, now: new Date() });
        }
        return;
    }
```

`isStripePayout(object)` is a small guard in `worker/services/payments/fulfill.ts` beside `isStripeAccount`. It checks that `id` starts with `po_`, and that `amount` and `arrival_date` are numbers.

Add `STRIPE_CONNECT_WEBHOOK_SECRET?: string;` to `worker/types/env.d.ts`, next to `STRIPE_WEBHOOK_SECRET`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/payments worker/api/controllers/payments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/services/payments/ worker/api/controllers/payments/ worker/types/env.d.ts
git commit -m "feat(payments): verify connect events and charge sellers stripe's account and payout costs"
```

### Task 9: The seller chooses how often they're paid

**Files:**
- Modify: `worker/api/controllers/payments/connectController.ts` (`setPayoutSchedule`, status fields, default schedule at account creation)
- Modify: `worker/database/services/StripeConnectService.ts` (`setPayoutSchedule`)
- Modify: `worker/database/services/StoreOrderService.ts` (`salesVolumeSince`)
- Modify: `worker/api/controllers/payments/types.ts`, `worker/api/routes/paymentsRoutes.ts`, `src/lib/api-client.ts`, `src/hooks/use-payments.ts`
- Create: `src/components/payments/PayoutFrequency.tsx`
- Modify: `src/components/payments/PayoutsCard.tsx`
- Test: `worker/api/controllers/payments/payout-request.test.ts`, `src/components/payments/payments-setup.test.ts`

**Interfaces:**
- Consumes: `updatePayoutSchedule` (Task 1); `estimatedMonthlyPayoutCostCents` (Task 8); `PayoutInterval` (Task 2).
- Produces:
  - `PUT /api/stripe/connect/payouts` with body `{ interval: PayoutInterval; anchor: string }`, returning `StripeConnectStatusData`;
  - `StripeConnectStatusData` gains `payoutInterval: PayoutInterval`, `payoutAnchor: string`, and `payoutCostEstimates: Record<PayoutInterval, number>`, which are cents per month at the last 30 days of paid store sales;
  - `parsePayoutRequest(body: unknown): { interval: PayoutInterval; anchor: string } | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/api/controllers/payments/payout-request.test.ts
import { describe, expect, it } from 'vitest';
import { parsePayoutRequest, scheduleOf } from './payout-request';

describe('parsePayoutRequest', () => {
	it('accepts daily, weekly on a weekday, and monthly on a day from 1 to 28', () => {
		expect(parsePayoutRequest({ interval: 'daily', anchor: '' })).toEqual({ interval: 'daily', anchor: '' });
		expect(parsePayoutRequest({ interval: 'weekly', anchor: 'friday' })).toEqual({ interval: 'weekly', anchor: 'friday' });
		expect(parsePayoutRequest({ interval: 'monthly', anchor: '15' })).toEqual({ interval: 'monthly', anchor: '15' });
	});

	it('refuses manual payouts, weekends and impossible days', () => {
		for (const body of [{ interval: 'manual', anchor: '' }, { interval: 'weekly', anchor: 'sunday' }, { interval: 'monthly', anchor: '31' }, { interval: 'monthly', anchor: 'x' }, null]) {
			expect(parsePayoutRequest(body)).toBeNull();
		}
	});

	it('turns the choice into the schedule Stripe expects, leaving the delay alone', () => {
		expect(scheduleOf({ interval: 'weekly', anchor: 'friday' })).toEqual({ interval: 'weekly', weeklyAnchor: 'friday', monthlyAnchor: null, delayDays: null });
		expect(scheduleOf({ interval: 'monthly', anchor: '15' })).toEqual({ interval: 'monthly', weeklyAnchor: null, monthlyAnchor: 15, delayDays: null });
	});
});
```

Add to `src/components/payments/payments-setup.test.ts`:

```ts
	it('lets the seller pick how often they are paid, with the cost of each choice', () => {
		const frequency = source('/src/components/payments/PayoutFrequency.tsx');
		for (const label of ['Daily', 'Weekly', 'Monthly', 'a month in Stripe fees']) expect(frequency).toContain(label);
		expect(frequency).toContain('payoutCostEstimates');
		expect(source('/src/components/payments/PayoutsCard.tsx')).toContain('<PayoutFrequency');
	});
```

Add `'/src/components/payments/PayoutFrequency.tsx'` to that file's glob list.

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/api/controllers/payments/payout-request.test.ts src/components/payments/payments-setup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`worker/api/controllers/payments/payout-request.ts`:

```ts
import { PAYOUT_INTERVALS, type PayoutInterval } from '../../../../shared/types/store-payments';
import type { PayoutSchedule, Weekday } from '../../../services/payments/stripe-client';

const WEEKDAYS: readonly Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

export function parsePayoutRequest(body: unknown): { interval: PayoutInterval; anchor: string } | null {
	if (typeof body !== 'object' || body === null) return null;
	const { interval, anchor } = body as { interval?: unknown; anchor?: unknown };
	if (typeof interval !== 'string' || !(PAYOUT_INTERVALS as readonly string[]).includes(interval) || typeof anchor !== 'string') return null;
	if (interval === 'weekly' && !(WEEKDAYS as readonly string[]).includes(anchor)) return null;
	if (interval === 'monthly' && !/^([1-9]|1\d|2[0-8])$/.test(anchor)) return null;
	return { interval: interval as PayoutInterval, anchor: interval === 'daily' ? '' : anchor };
}

export function scheduleOf(choice: { interval: PayoutInterval; anchor: string }): PayoutSchedule {
	return {
		interval: choice.interval,
		weeklyAnchor: choice.interval === 'weekly' ? (choice.anchor as Weekday) : null,
		monthlyAnchor: choice.interval === 'monthly' ? Number(choice.anchor) : null,
		delayDays: null,
	};
}
```

Days 29–31 are refused because Stripe moves them in short months. Keeping to 1–28 gives the same day every month.

In `worker/api/controllers/payments/connectController.ts`, add:

```ts
    /** The seller picks daily, weekly or monthly payouts; Stripe's per-payout cost is theirs. */
    static async setPayoutSchedule(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<StripeConnectStatusData>>> {
        try {
            const body = await StripeConnectController.parseJsonBody<unknown>(request);
            const choice = body.success ? parsePayoutRequest(body.data) : null;
            if (!choice) return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Choose daily, weekly on a weekday, or monthly on a day from 1 to 28', 400);
            const stripe = stripeFromEnv(env);
            if (!stripe) return StripeConnectController.createErrorResponse<StripeConnectStatusData>(PAYMENTS_NOT_CONFIGURED_MESSAGE, 400);
            const accounts = new StripeConnectService(env);
            const stored = await accounts.getByUser(context.user!.id);
            if (!stored) return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Connect Stripe first', 400);
            await stripe.updatePayoutSchedule(stored.stripeAccountId, scheduleOf(choice));
            await accounts.setPayoutSchedule(context.user!.id, choice.interval, choice.anchor);
            return StripeConnectController.createSuccessResponse(await StripeConnectController.loadStatus(env, context.user!.id));
        } catch (error) {
            if (error instanceof StripeApiError) return StripeConnectController.createErrorResponse<StripeConnectStatusData>(STRIPE_REQUEST_FAILED_MESSAGE, 502);
            this.logger.error('Error setting the payout schedule', error);
            return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Failed to change how often you are paid', 500);
        }
    }
```

In `loadStatus`:
- read `payoutInterval` and `payoutAnchor` from `stored`, using `'weekly'` and `'monday'` when there's no stored row;
- compute the volume, then the estimates:

```ts
        const volume = await new StoreOrderService(env).salesVolumeSince(userId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
        const payoutCostEstimates = Object.fromEntries(PAYOUT_INTERVALS.map((interval) => [interval, estimatedMonthlyPayoutCostCents(volume, interval)])) as Record<PayoutInterval, number>;
```

`statusOf` gains a third parameter, `payouts: { payoutInterval; payoutAnchor; payoutCostEstimates }`, spread into the returned object.

In `startOnboarding`, after `accounts.create(...)` succeeds:

```ts
                try {
                    await stripe.updatePayoutSchedule(created.id, { interval: 'weekly', weeklyAnchor: 'monday', monthlyAnchor: null, delayDays: null });
                } catch (error) {
                    this.logger.warn('Could not set the default payout schedule', error);
                }
```

`StripeConnectService.setPayoutSchedule`:

```ts
    async setPayoutSchedule(userId: string, interval: PayoutInterval, anchor: string): Promise<void> {
        await this.database.update(schema.stripeConnectAccounts).set({ payoutInterval: interval, payoutAnchor: anchor, updatedAt: new Date() }).where(eq(schema.stripeConnectAccounts.userId, userId));
    }
```

`StoreOrderService.salesVolumeSince`:

```ts
    /** The seller's share of their paid sales since this time: what their payouts carry. */
    async salesVolumeSince(sellerUserId: string, since: Date): Promise<number> {
        const row = await this.database
            .select({ volume: sql<number>`COALESCE(SUM(${schema.storeOrders.totalCents} - ${schema.storeOrders.applicationFeeCents} - ${schema.storeOrders.refundedCents}), 0)` })
            .from(schema.storeOrders)
            .where(and(eq(schema.storeOrders.sellerUserId, sellerUserId), gte(schema.storeOrders.createdAt, since)))
            .get();
        return row?.volume ?? 0;
    }
```

Route:

```ts
    app.put('/api/stripe/connect/payouts', setAuthLevel(AuthConfig.authenticated), adaptController(StripeConnectController, StripeConnectController.setPayoutSchedule));
```

Frontend. In `src/lib/api-client.ts`:

```ts
	async setPayoutSchedule(choice: { interval: PayoutInterval; anchor: string }): Promise<ApiResponse<StripeConnectStatusData>> {
		return this.request<StripeConnectStatusData>('/api/stripe/connect/payouts', { method: 'PUT', body: JSON.stringify(choice) });
	}
```

In `src/hooks/use-payments.ts`:

```ts
export function useSetPayoutSchedule() {
	const queryClient = useQueryClient();
	const { user } = useAuth();
	return useMutation({
		mutationFn: (choice: { interval: PayoutInterval; anchor: string }) => unwrap(apiClient.setPayoutSchedule(choice), 'Failed to change how often you are paid'),
		onSuccess: (status) => queryClient.setQueryData(queryKeys.account.payments.status(user?.id), status),
	});
}
```

```tsx
// src/components/payments/PayoutFrequency.tsx
import { toast } from 'sonner';
import type { PayoutInterval, StripeConnectStatusData } from '@/api-types';
import { useSetPayoutSchedule } from '@/hooks/use-payments';

const LABELS: Readonly<Record<PayoutInterval, string>> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

function dollars(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** How often the seller is paid, each choice with what Stripe's account and payout fees would cost them a month. */
export function PayoutFrequency({ status }: { status: StripeConnectStatusData }) {
	const setSchedule = useSetPayoutSchedule();
	const choose = (interval: PayoutInterval, anchor: string) =>
		setSchedule.mutate({ interval, anchor }, { onError: (error) => toast.error(error.message) });
	const estimate = (interval: PayoutInterval) =>
		status.payoutCostEstimates[interval] > 0
			? `about ${dollars(status.payoutCostEstimates[interval])} a month in Stripe fees`
			: "$2.00 a month in Stripe fees, plus 0.25% and 25¢ per payout, once you're paid";

	return (
		<fieldset className="grid gap-2" disabled={setSchedule.isPending}>
			<legend className="text-sm font-medium text-kumo-default">How often you're paid</legend>
			{(['daily', 'weekly', 'monthly'] as const).map((interval) => (
				<label key={interval} className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
					<input
						type="radio"
						name="payout-interval"
						checked={status.payoutInterval === interval}
						onChange={() => choose(interval, interval === 'weekly' ? 'monday' : interval === 'monthly' ? '1' : '')}
					/>
					<span>
						{LABELS[interval]}: {estimate(interval)}
					</span>
					{interval === 'weekly' && status.payoutInterval === 'weekly' && (
						<select aria-label="Payout day" value={status.payoutAnchor} onChange={(event) => choose('weekly', event.target.value)} className="rounded border border-kumo-hairline bg-transparent px-1">
							{WEEKDAYS.map((day) => (
								<option key={day} value={day}>
									{day[0].toUpperCase() + day.slice(1)}
								</option>
							))}
						</select>
					)}
					{interval === 'monthly' && status.payoutInterval === 'monthly' && (
						<select aria-label="Payout day of the month" value={status.payoutAnchor} onChange={(event) => choose('monthly', event.target.value)} className="rounded border border-kumo-hairline bg-transparent px-1">
							{Array.from({ length: 28 }, (_, index) => String(index + 1)).map((day) => (
								<option key={day} value={day}>
									{day}
								</option>
							))}
						</select>
					)}
				</label>
			))}
		</fieldset>
	);
}
```

In `PayoutsCard`, inside the `step === null` branch, wrap the existing badge row and `<PayoutFrequency status={data} />` in a `grid gap-3` div. Re-export `PayoutInterval` from `src/api-types.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/api/controllers/payments src/components/payments`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.app.json --noEmit` and `rtk proxy npx tsc -p tsconfig.worker.json --noEmit`
Expected: clean, apart from the `artifacts-viewer` errors.

- [ ] **Step 5: Commit**

```bash
git add worker/api/controllers/payments/ worker/api/routes/paymentsRoutes.ts worker/database/services/ src/lib/api-client.ts src/hooks/use-payments.ts src/components/payments/
git commit -m "feat(payments): sellers choose how often they're paid and see what each choice costs"
```

---

## Finish

- Run the whole suite in batches, plus `tsc` for both configs.
- Local check in Stripe test mode:
  - restart `stripe listen` with `--forward-connect-to localhost:8100/api/stripe/webhook` as well;
  - a sale paid with Stripe's Brazil test card `4000000760000002` reverses the fee difference;
  - a seller refund with a short test balance is refused, and goes through once the balance covers it;
  - the disputed test card `4000000000000259` reverses the sale and records the fee charge, and the next sale collects it;
  - `stripe trigger payout.paid` on a connected test account records the two charges once.
- Ledger every deviation as a `Ruling:` line, then hand off to `2026-10-16-seller-levels-and-limits.md`.
