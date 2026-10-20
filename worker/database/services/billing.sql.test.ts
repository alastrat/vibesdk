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
	for (const id of ['u_pay', 'u_two', 'u_admin', 'u_due', 'u_fresh', 'u_ending', 'u_stores', 'u_nocap', 'u_old']) await insertUser(db, id);
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

	it("refreshes an open period's pool in the event's batch, so neither is written without the other", async () => {
		const billing = new BillingService(envWith(db));
		await insertUser(db, 'u_pool');
		await db.prepare("INSERT INTO credit_periods (user_id, period_key, period_start, period_end, pool, used) VALUES ('u_pool', 'sub:sub_pool:1', 1, 2, 0, 3000)").run();
		const now = at('2026-10-19T00:00:00Z');
		const input = (notices: Array<{ key: string; kind: 'receipt' }>) => ({
			event: { id: 'evt_pool', type: 'invoice.paid', objectId: 'sub_pool', userId: 'u_pool', result: 'applied' as const },
			row: row({ userId: 'u_pool', stripeSubscriptionId: 'sub_pool' }),
			pool: { periodKey: 'sub:sub_pool:1', pool: 20_000 },
			notices,
			now,
		});
		const pool = () => db.prepare("SELECT pool FROM credit_periods WHERE user_id = 'u_pool'").first('pool');
		await billing.claimNotice('u_pool', 'receipt:in_pool', 'receipt', now);
		await expect(billing.recordEvent(input([{ key: 'receipt:in_pool', kind: 'receipt' }]))).rejects.toThrow();
		expect(await billing.eventSeen('evt_pool')).toBe(false);
		expect(await pool()).toBe(0);
		await billing.recordEvent(input([]));
		expect(await billing.eventSeen('evt_pool')).toBe(true);
		expect(await pool()).toBe(20_000);
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

	it('starts counting a new account at one when there is no cap', async () => {
		const billing = new BillingService(envWith(db));
		expect(await billing.reserveStore('u_nocap', null, at('2026-10-19T00:00:00Z'))).toEqual({ reserved: true, started: 1 });
		expect(await billing.reserveStore('u_nocap', null, at('2026-10-19T00:00:01Z'))).toEqual({ reserved: true, started: 2 });
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
