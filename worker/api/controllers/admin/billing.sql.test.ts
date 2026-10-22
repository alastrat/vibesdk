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
		expect((await response.json()).data).toMatchObject({ plan: 'enterprise', source: 'override', limits: { aiCredits: 500_000, liveStores: 40, newStoresPerDay: null }, override: { plan: 'enterprise', reason: 'Signed Enterprise contract' } });
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
		expect((await BillingAdminController.grantCredits(request('POST', { credits: 10_000, reason: 'Launch partner' }), env({ BILLING: undefined }), {} as ExecutionContext, context('u_seller'))).status).toBe(409);
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

describe('admin billing endpoints, edges', () => {
	const call = (run: typeof BillingAdminController.setPlan, method: string, body: unknown, userId = 'u_seller', extra: Record<string, unknown> = {}) =>
		run.call(BillingAdminController, request(method, body), env(extra), {} as ExecutionContext, context(userId));

	it('answers 404 for an account that does not exist', async () => {
		expect((await call(BillingAdminController.get, 'GET', undefined, 'u_nobody')).status).toBe(404);
		expect((await call(BillingAdminController.setPlan, 'PUT', { plan: 'pro', reason: 'Partner comp' }, 'u_nobody')).status).toBe(404);
		expect((await call(BillingAdminController.grantCredits, 'POST', { credits: 1_000, reason: 'Partner comp' }, 'u_nobody')).status).toBe(404);
		expect((await call(BillingAdminController.linkTestCustomer, 'PUT', { stripeCustomerId: 'cus_clock' }, 'u_nobody')).status).toBe(404);
	});

	it('ends an override with a null plan, so the account runs on what it pays for again', async () => {
		await call(BillingAdminController.setPlan, 'PUT', { plan: 'premium', reason: 'A free month for a partner' });
		const ended = await call(BillingAdminController.setPlan, 'PUT', { plan: null, reason: 'The free month is over' });
		expect((await ended.json()).data).toMatchObject({ plan: 'basic', source: 'free', override: null });
	});

	it('holds an override until a future date, and refuses a date that has passed', async () => {
		// Dates are stored in whole seconds.
		const until = new Date(Math.floor((Date.now() + 30 * DAY) / 1000) * 1000).toISOString();
		const held = await call(BillingAdminController.setPlan, 'PUT', { plan: 'premium', until, reason: 'A free month for a partner' });
		expect((await held.json()).data).toMatchObject({ plan: 'premium', override: { plan: 'premium', until: Date.parse(until) } });
		expect((await call(BillingAdminController.setPlan, 'PUT', { plan: 'premium', until: '2020-01-01', reason: 'A free month for a partner' })).status).toBe(400);
	});

	it('refuses grants that are not whole credits in range or have no reason, and records the admin on the ones it makes', async () => {
		for (const body of [{ credits: 0, reason: 'Launch partner' }, { credits: 10_000_001, reason: 'Launch partner' }, { credits: 1.5, reason: 'Launch partner' }, { credits: '500', reason: 'Launch partner' }, { credits: 500, reason: 'no' }, { credits: 500 }]) {
			expect((await call(BillingAdminController.grantCredits, 'POST', body)).status, JSON.stringify(body)).toBe(400);
		}
		expect((await call(BillingAdminController.grantCredits, 'POST', { credits: 500, reason: '  Launch partner  ' })).status).toBe(200);
		expect(await db.prepare("SELECT user_id, action FROM audit_logs WHERE entity_id = 'u_seller' AND entity_type = 'credit_grant'").first()).toEqual({ user_id: 'u_admin', action: 'credit_grant' });
		expect(await db.prepare("SELECT reason FROM credit_grants WHERE user_id = 'u_seller'").first('reason')).toBe('Launch partner');
	});

	it('records a linked test customer with the one it replaced, and refuses a customer another account has', async () => {
		await insertBillingCustomer(db, 'u_seller', 'cus_old');
		await insertBillingCustomer(db, 'u_admin', 'cus_admins');
		expect((await call(BillingAdminController.linkTestCustomer, 'PUT', { stripeCustomerId: 'cus_admins' })).status).toBe(409);
		expect(await db.prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = 'u_seller'").first('stripe_customer_id')).toBe('cus_old');
		expect((await call(BillingAdminController.linkTestCustomer, 'PUT', { stripeCustomerId: 'clock' })).status).toBe(400);
		expect((await call(BillingAdminController.linkTestCustomer, 'PUT', { stripeCustomerId: 'cus_clock' })).status).toBe(200);
		const audit = await db.prepare("SELECT user_id, old_values, new_values FROM audit_logs WHERE entity_type = 'billing_customer' AND action = 'link_test_customer'").first<{ user_id: string; old_values: string; new_values: string }>();
		expect(audit?.user_id).toBe('u_admin');
		expect(JSON.parse(audit?.old_values ?? 'null')).toEqual({ stripeCustomerId: 'cus_old' });
		expect(JSON.parse(audit?.new_values ?? 'null')).toEqual({ stripeCustomerId: 'cus_clock' });
	});

	it("still shows an account outside the billing flag, with its subscription's Stripe page", async () => {
		const response = await call(BillingAdminController.get, 'GET', undefined, 'u_paying', { BILLING: undefined });
		expect((await response.json()).data).toMatchObject({ enabled: false, plan: 'basic', credits: null, stripeSubscriptionUrl: 'https://dashboard.stripe.com/test/subscriptions/sub_paying' });
	});
});
