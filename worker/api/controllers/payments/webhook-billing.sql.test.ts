/**
 * Billing webhooks on real SQL: signed deliveries, Stripe's API stood in by fetch serving each object's latest copy,
 * and Estori's emails captured. Each test's writes roll back after it.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertBillingCustomer, insertPurchase, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { BillingService } from '../../../database/services/BillingService';
import { CreditLedgerService } from '../../../database/services/CreditLedgerService';
import { PLATFORM_ALERT_EMAILS } from '../../../services/alerts/platform-alerts';
import { applyCreditRefund, type BillingEventDeps } from '../../../services/billing/events';
import { billingEventDepsFromEnv } from '../../../services/billing/wiring';
import { idempotencyBucket, type StripeSubscription } from '../../../services/payments/stripe-client';
import { handleStripeWebhook } from './webhook';

const SECRET = 'whsec_billing_test';
const PRICES = { pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' };
const DAY = 86_400;
const START = Date.parse('2026-10-05T10:00:00Z') / 1000;
const END = Date.parse('2026-11-05T10:00:00Z') / 1000;

let db: D1Database;
const sent: Array<{ to: string; subject: string; text: string }> = [];

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

function env(extra: Record<string, unknown> = {}): Env {
	return envWith(db, {
		STRIPE_WEBHOOK_SECRET: SECRET,
		STRIPE_SECRET_KEY: 'sk_test_fake',
		STRIPE_PRICE_IDS: JSON.stringify(PRICES),
		CUSTOM_DOMAIN: 'estori.app',
		ENVIRONMENT: 'prod',
		EMAIL: {
			send: async (message: { to: string; subject: string; text: string }) => {
				sent.push({ to: message.to, subject: message.subject, text: message.text });
				return { messageId: 'm1' };
			},
		},
		VibecoderStore: { get: async () => null, put: async () => undefined },
		...extra,
	});
}

/** The database, refusing any write made outside a batch, so a test can show an event's changes commit with the event. */
function writesOnlyInBatches(): D1Database {
	const real = new WeakMap<object, D1PreparedStatement>();
	const wrap = (sql: string, statement: D1PreparedStatement): D1PreparedStatement => {
		if (!/^\s*(insert|update|delete)\b/i.test(sql)) return statement;
		const refuse = async (): Promise<never> => {
			throw new Error(`A write outside a batch: ${sql}`);
		};
		const wrapper = { bind: (...values: unknown[]) => wrap(sql, statement.bind(...values)), run: refuse, all: refuse, raw: refuse, first: refuse };
		real.set(wrapper, statement);
		return wrapper as unknown as D1PreparedStatement;
	};
	const wrapped = {
		prepare: (sql: string) => wrap(sql, db.prepare(sql)),
		batch: (statements: D1PreparedStatement[]) => db.batch(statements.map((statement) => real.get(statement) ?? statement)),
		exec: (query: string) => db.exec(query),
	};
	return wrapped as unknown as D1Database;
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

/** What Estori asked Stripe to change, in order, as "path body". */
function stripeWrites(): string[] {
	return vi
		.mocked(globalThis.fetch)
		.mock.calls.filter(([, init]) => init?.method === 'POST')
		.map(([input, init]) => `${new URL(String(input)).pathname} ${decodeURIComponent(String(init?.body ?? ''))}`);
}

/** The idempotency key of each write Estori sent Stripe, in order. */
function stripeWriteKeys(): Array<string | null> {
	return vi
		.mocked(globalThis.fetch)
		.mock.calls.filter(([, init]) => init?.method === 'POST')
		.map(([, init]) => new Headers(init?.headers).get('Idempotency-Key'));
}

async function deliver(id: string, type: string, object: unknown, extra: Record<string, unknown> = {}): Promise<number> {
	const payload = JSON.stringify({ id, type, data: { object } });
	const request = new Request('https://estori.app/api/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': await signatureFor(payload) }, body: payload });
	return (await handleStripeWebhook(request, env(extra))).status;
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

/** A failed invoice as Stripe reads it back, with the payment it declined as `pi_{invoice id}`. */
function declinedInvoice(invoice: { id: string }): Record<string, unknown> {
	return { ...invoice, status: 'open', payments: { data: [{ status: 'open', payment: { type: 'payment_intent', payment_intent: `pi_${invoice.id}` } }] } };
}

const DECLINED_INTENT = { id: 'pi_declined', status: 'requires_payment_method', last_payment_error: { code: 'card_declined' }, latest_charge: null };

async function seller(userId: string): Promise<string> {
	await insertUser(db, userId);
	await insertBillingCustomer(db, userId, `cus_${userId}`);
	return `cus_${userId}`;
}

const rowOf = (userId: string) =>
	db.prepare('SELECT stripe_subscription_id AS id, status, plan, cancel_at_period_end AS ending, pending_plan AS pending FROM subscriptions WHERE user_id = ?').bind(userId).first();
const resultOf = (eventId: string) => db.prepare('SELECT result FROM billing_events WHERE stripe_event_id = ?').bind(eventId).first('result');
const subjects = () => sent.filter((email) => !PLATFORM_ALERT_EMAILS.includes(email.to)).map((email) => email.subject);
const customerEmails = () => sent.filter((email) => !PLATFORM_ALERT_EMAILS.includes(email.to));
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
		const failed = { id: 'in_due', customer, amount_paid: 0, currency: 'usd', hosted_invoice_url: null, number: 'EST-0003', billing_reason: 'subscription_cycle', attempt_count: 1, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_due' } } };
		const stripe = stripeServes({ sub_u_due: subscription('u_due', customer, { status: 'past_due' }), in_due: declinedInvoice(failed), pi_in_due: DECLINED_INTENT });
		await deliver('evt_f1', 'invoice.payment_failed', failed);
		await deliver('evt_f2', 'invoice.payment_failed', { ...failed, attempt_count: 2 });
		expect(await rowOf('u_due')).toMatchObject({ status: 'past_due', plan: 'pro' });
		stripe.sub_u_due = subscription('u_due', customer);
		await deliver('evt_paid', 'invoice.paid', { ...failed, amount_paid: 4_900 });
		expect(await rowOf('u_due')).toMatchObject({ status: 'active' });
		expect(subjects()).toEqual(["Your Pro payment didn't go through", 'Your Estori receipt: $49.00', 'Your AI credits are renewed']);
	});

	it('an action-required invoice sends a payment failed notice that asks to confirm', async () => {
		const customer = await seller('u_sca');
		await insertSubscription(db, { userId: 'u_sca', stripeSubscriptionId: 'sub_u_sca', status: 'active', currentPeriodStart: new Date((START - 31 * DAY) * 1000), currentPeriodEnd: new Date(START * 1000) });
		stripeServes({ sub_u_sca: subscription('u_sca', customer, { status: 'past_due' }) });
		const invoice = { id: 'in_sca', customer, amount_paid: 0, currency: 'usd', hosted_invoice_url: null, number: 'EST-0020', billing_reason: 'subscription_cycle', attempt_count: 1, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_sca' } } };
		expect(await deliver('evt_sca', 'invoice.payment_action_required', invoice)).toBe(200);
		expect(await resultOf('evt_sca')).toBe('applied');
		expect(await rowOf('u_sca')).toMatchObject({ status: 'past_due' });
		expect(subjects()).toEqual(["Your Pro payment didn't go through"]);
		expect(customerEmails()[0].text).toContain('Your bank asked you to confirm this payment. Open billing and choose Pay now.');
		expect(customerEmails()[0].text).not.toContain('declined');
	});

	it('asks to confirm when the bank wants it, though Stripe sends payment_failed before payment_action_required, and sends nothing more for the second', async () => {
		const customer = await seller('u_first');
		await insertSubscription(db, { userId: 'u_first', stripeSubscriptionId: 'sub_u_first', status: 'active', currentPeriodStart: new Date((START - 31 * DAY) * 1000), currentPeriodEnd: new Date(START * 1000) });
		const invoice = { id: 'in_first', customer, amount_paid: 0, currency: 'usd', hosted_invoice_url: null, number: 'EST-0021', billing_reason: 'subscription_cycle', attempt_count: 1, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_first' } } };
		stripeServes({
			sub_u_first: subscription('u_first', customer, { status: 'past_due' }),
			in_first: { ...invoice, status: 'open', payments: { data: [{ status: 'open', payment: { type: 'payment_intent', payment_intent: 'pi_first' } }] } },
			pi_first: { id: 'pi_first', status: 'requires_action', last_payment_error: null, latest_charge: null },
		});
		await deliver('evt_first_failed', 'invoice.payment_failed', invoice);
		await deliver('evt_first_action', 'invoice.payment_action_required', invoice);
		expect(customerEmails()).toHaveLength(1);
		expect(customerEmails()[0].text).toContain('Your bank asked you to confirm this payment. Open billing and choose Pay now.');
		expect(customerEmails()[0].text).not.toContain('declined');
	});

	it('asks to confirm when the payment failed for want of authentication, and says declined when the card was declined', async () => {
		const cases = [
			{ userId: 'u_auth', error: 'authentication_required', says: 'Your bank asked you to confirm this payment. Open billing and choose Pay now.' },
			{ userId: 'u_decl', error: 'card_declined', says: 'Your card was declined. Open billing to pay with this card again or a new one.' },
		];
		for (const { userId, error, says } of cases) {
			sent.length = 0;
			const customer = await seller(userId);
			await insertSubscription(db, { userId, stripeSubscriptionId: `sub_${userId}`, status: 'active', currentPeriodStart: new Date((START - 31 * DAY) * 1000), currentPeriodEnd: new Date(START * 1000) });
			const invoice = { id: `in_${userId}`, customer, amount_paid: 0, currency: 'usd', hosted_invoice_url: null, number: 'EST-0022', billing_reason: 'subscription_cycle', attempt_count: 1, parent: { type: 'subscription_details', subscription_details: { subscription: `sub_${userId}` } } };
			stripeServes({
				[`sub_${userId}`]: subscription(userId, customer, { status: 'past_due' }),
				[`in_${userId}`]: { ...invoice, status: 'open', payments: { data: [{ status: 'open', payment: { type: 'payment_intent', payment_intent: `pi_${userId}` } }] } },
				[`pi_${userId}`]: { id: `pi_${userId}`, status: 'requires_payment_method', last_payment_error: { code: error }, latest_charge: null },
			});
			await deliver(`evt_${userId}`, 'invoice.payment_failed', invoice);
			expect(customerEmails(), userId).toHaveLength(1);
			expect(customerEmails()[0].text, userId).toContain(says);
		}
	});

	it("words the notice by the event, with a warning, when Stripe can't say how the payment failed", async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const customer = await seller('u_unread');
		await insertSubscription(db, { userId: 'u_unread', stripeSubscriptionId: 'sub_u_unread', status: 'active', currentPeriodStart: new Date((START - 31 * DAY) * 1000), currentPeriodEnd: new Date(START * 1000) });
		stripeServes({ sub_u_unread: subscription('u_unread', customer, { status: 'past_due' }) });
		const invoice = { id: 'in_unread', customer, amount_paid: 0, currency: 'usd', hosted_invoice_url: null, number: 'EST-0023', billing_reason: 'subscription_cycle', attempt_count: 1, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_unread' } } };
		expect(await deliver('evt_unread', 'invoice.payment_failed', invoice)).toBe(200);
		expect(customerEmails()).toHaveLength(1);
		expect(customerEmails()[0].text).toContain('Your card was declined.');
		expect(JSON.stringify(warn.mock.calls)).toContain('in_unread');
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

	it("alerts the people who run Estori when a webhook's email can't go out, naming the account, the email and its key", async () => {
		const failingFor = (code: string | null) => ({
			EMAIL: {
				send: async (message: { to: string; subject: string; text: string }) => {
					if (!PLATFORM_ALERT_EMAILS.includes(message.to)) throw Object.assign(new Error('Email Service unavailable'), code ? { code } : {});
					sent.push({ to: message.to, subject: message.subject, text: message.text });
					return { messageId: 'm1' };
				},
			},
		});
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const customer = await seller('u_mail');
		stripeServes({ sub_u_mail: subscription('u_mail', customer), sub_u_gone: subscription('u_gone', await seller('u_gone')) });
		expect(await deliver('evt_mail', 'customer.subscription.created', { id: 'sub_u_mail' }, failingFor(null))).toBe(200);
		expect(sent).toHaveLength(1);
		expect(sent[0].subject).toBe("Estori alert: A billing email couldn't be sent (plan_started:sub_u_mail)");
		for (const named of ['u_mail', 'plan_started', 'plan_started:sub_u_mail']) expect(sent[0].text).toContain(named);
		// An address that refuses mail would refuse a resend too.
		expect(await deliver('evt_gone', 'customer.subscription.created', { id: 'sub_u_gone' }, failingFor('E_RECIPIENT_SUPPRESSED'))).toBe(200);
		expect(sent).toHaveLength(1);
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

	it("moves the row's version with every rebuild, even two in the same second", async () => {
		vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-20T12:00:00.250Z'));
		const customer = await seller('u_ver');
		await insertSubscription(db, { userId: 'u_ver', stripeSubscriptionId: 'sub_u_ver', status: 'active', currentPeriodStart: new Date(START * 1000), currentPeriodEnd: new Date(END * 1000) });
		const stripe = stripeServes({ sub_u_ver: subscription('u_ver', customer, { cancel_at_period_end: true }) });
		const version = async () => Number(await db.prepare("SELECT updated_at FROM subscriptions WHERE user_id = 'u_ver'").first('updated_at'));
		await deliver('evt_v1', 'customer.subscription.updated', { id: 'sub_u_ver' });
		const first = await version();
		stripe.sub_u_ver = subscription('u_ver', customer);
		await deliver('evt_v2', 'customer.subscription.updated', { id: 'sub_u_ver' });
		const second = await version();
		await deliver('evt_v3', 'customer.subscription.updated', { id: 'sub_u_ver' });
		expect(first).toBe(Date.parse('2026-10-20T12:00:00Z') / 1000);
		expect(second).toBe(first + 1);
		expect(await version()).toBe(first + 2);
	});

	it('keeps the plan and warns of nothing when a move to Premium is declined', async () => {
		const customer = await seller('u_declined');
		await insertSubscription(db, { userId: 'u_declined', stripeSubscriptionId: 'sub_u_declined', status: 'active', currentPeriodStart: new Date(START * 1000), currentPeriodEnd: new Date(END * 1000) });
		stripeServes({ sub_u_declined: subscription('u_declined', customer) });
		const declined = { id: 'in_declined', customer, amount_paid: 0, currency: 'usd', hosted_invoice_url: null, number: 'EST-0004', billing_reason: 'subscription_update', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_declined' } } };
		await deliver('evt_declined', 'invoice.payment_failed', declined);
		expect(await rowOf('u_declined')).toMatchObject({ status: 'active', plan: 'pro' });
		expect(await resultOf('evt_declined')).toBe('applied');
		expect(subjects()).toEqual([]);
	});

	it("stores the plan's pool once a renewal is paid after its grace hold, so usage during the hold isn't taken from purchases", async () => {
		const customer = await seller('u_hold');
		const start = Math.floor(Date.now() / 1000) - 2 * DAY;
		const end = start + 30 * DAY;
		await insertSubscription(db, { userId: 'u_hold', stripeSubscriptionId: 'sub_u_hold', status: 'past_due', currentPeriodStart: new Date(start * 1000), currentPeriodEnd: new Date(end * 1000) });
		await insertPurchase(db, { id: 'cp_hold', userId: 'u_hold', credits: 5_000, purchasedAt: new Date((start - 10 * DAY) * 1000), expiresAt: new Date((start + 300 * DAY) * 1000) });
		const billingOn = env({ BILLING: 'on' });
		const ledger = new CreditLedgerService(billingOn);
		const period = { key: `sub:sub_u_hold:${start}`, startMs: start * 1000, endMs: end * 1000 };
		// During the hold the account's pool is 0, so the step was stored against a pool of 0.
		await ledger.recordUse({ userId: 'u_hold', period, pool: 0, useKey: 'k_hold', credits: 3_000, source: 'think', model: 'm', usage: null, now: new Date() });
		const renewed = { id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: start, current_period_end: end };
		stripeServes({ sub_u_hold: subscription('u_hold', customer, { items: { data: [renewed] } }) });
		const paid = { id: 'in_hold', customer, amount_paid: 4_900, currency: 'usd', hosted_invoice_url: null, number: 'EST-0005', billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_hold' } } };
		await deliver('evt_hold_paid', 'invoice.paid', paid, { BILLING: 'on' });
		expect(await db.prepare("SELECT pool FROM credit_periods WHERE user_id = 'u_hold'").first('pool')).toBe(20_000);
		expect(await ledger.settle('u_hold', Date.now())).toBe('nothing');
		expect(await db.prepare("SELECT used FROM credit_purchases WHERE id = 'cp_hold'").first('used')).toBe(0);
	});

	it("writes a paid renewal's pool in the event's own batch, so a redelivery never finds the event without it", async () => {
		const customer = await seller('u_atomic');
		const start = Math.floor(Date.now() / 1000) - 2 * DAY;
		const end = start + 30 * DAY;
		await insertSubscription(db, { userId: 'u_atomic', stripeSubscriptionId: 'sub_u_atomic', status: 'past_due', currentPeriodStart: new Date(start * 1000), currentPeriodEnd: new Date(end * 1000) });
		const period = { key: `sub:sub_u_atomic:${start}`, startMs: start * 1000, endMs: end * 1000 };
		await new CreditLedgerService(env({ BILLING: 'on' })).recordUse({ userId: 'u_atomic', period, pool: 0, useKey: 'k_atomic', credits: 3_000, source: 'think', model: 'm', usage: null, now: new Date() });
		const renewed = { id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: start, current_period_end: end };
		stripeServes({ sub_u_atomic: subscription('u_atomic', customer, { items: { data: [renewed] } }) });
		const paid = { id: 'in_atomic', customer, amount_paid: 4_900, currency: 'usd', hosted_invoice_url: null, number: 'EST-0008', billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_atomic' } } };
		expect(await deliver('evt_atomic', 'invoice.paid', paid, { BILLING: 'on', DB: writesOnlyInBatches() })).toBe(200);
		expect(await resultOf('evt_atomic')).toBe('applied');
		expect(await db.prepare("SELECT pool FROM credit_periods WHERE user_id = 'u_atomic'").first('pool')).toBe(20_000);
	});

	it("sends a returning seller's welcome and first receipt when the invoice arrives before the new subscription's events", async () => {
		const customer = await seller('u_back');
		await insertSubscription(db, { userId: 'u_back', stripeSubscriptionId: 'sub_old_back', status: 'canceled', currentPeriodStart: new Date((START - 60 * DAY) * 1000), currentPeriodEnd: new Date((START - 30 * DAY) * 1000) });
		stripeServes({ sub_u_back: subscription('u_back', customer) });
		const first = { id: 'in_back', customer, amount_paid: 4_900, currency: 'usd', hosted_invoice_url: null, number: 'EST-0009', billing_reason: 'subscription_create', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_back' } } };
		await deliver('evt_back_paid', 'invoice.paid', first);
		await deliver('evt_back_created', 'customer.subscription.created', { id: 'sub_u_back' });
		expect(await rowOf('u_back')).toMatchObject({ id: 'sub_u_back', status: 'active' });
		expect(subjects()).toEqual(['Welcome to Estori Pro', 'Your Estori receipt: $49.00']);
	});

	it('leaves the stored pool alone when a renewal fails, so usage from before the failure stays on the pool', async () => {
		const customer = await seller('u_fail');
		const start = Math.floor(Date.now() / 1000) - 2 * DAY;
		const end = start + 30 * DAY;
		await insertSubscription(db, { userId: 'u_fail', stripeSubscriptionId: 'sub_u_fail', status: 'active', currentPeriodStart: new Date(start * 1000), currentPeriodEnd: new Date(end * 1000) });
		const period = { key: `sub:sub_u_fail:${start}`, startMs: start * 1000, endMs: end * 1000 };
		await new CreditLedgerService(env({ BILLING: 'on' })).recordUse({ userId: 'u_fail', period, pool: 20_000, useKey: 'k_fail', credits: 3_000, source: 'think', model: 'm', usage: null, now: new Date() });
		const renewed = { id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: start, current_period_end: end };
		const failed = { id: 'in_fail', customer, amount_paid: 0, currency: 'usd', hosted_invoice_url: null, number: 'EST-0006', billing_reason: 'subscription_cycle', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_u_fail' } } };
		stripeServes({ sub_u_fail: subscription('u_fail', customer, { status: 'past_due', items: { data: [renewed] } }), in_fail: declinedInvoice(failed), pi_in_fail: DECLINED_INTENT });
		await deliver('evt_fail', 'invoice.payment_failed', failed, { BILLING: 'on' });
		expect(await rowOf('u_fail')).toMatchObject({ status: 'past_due' });
		expect(await db.prepare("SELECT pool FROM credit_periods WHERE user_id = 'u_fail'").first('pool')).toBe(20_000);
	});
});

describe('card and consent webhooks', () => {
	const cardSession = (userId: string, customer: string, overrides: Record<string, unknown> = {}) => ({
		id: `cs_${userId}`,
		mode: 'setup',
		status: 'complete',
		customer,
		client_reference_id: null,
		payment_status: 'no_payment_required',
		metadata: { kind: 'card', estori_user_id: userId, card_mode: 'save' },
		setup_intent: { id: 'seti_1', payment_method: 'pm_new' },
		...overrides,
	});
	const cardEvent = (userId: string) => ({ id: `cs_${userId}`, mode: 'setup', payment_status: 'no_payment_required', metadata: { kind: 'card' } });

	it('a completed card session sets the default card once', async () => {
		const customer = await seller('u_card');
		await insertSubscription(db, { userId: 'u_card', stripeSubscriptionId: 'sub_u_card', status: 'active', currentPeriodStart: new Date(START * 1000), currentPeriodEnd: new Date(END * 1000) });
		stripeServes({ cs_u_card: cardSession('u_card', customer), [customer]: { id: customer }, sub_u_card: subscription('u_card', customer) });
		expect(await deliver('evt_card', 'checkout.session.completed', cardEvent('u_card'))).toBe(200);
		expect(await deliver('evt_card', 'checkout.session.completed', cardEvent('u_card'))).toBe(200);
		expect(await resultOf('evt_card')).toBe('applied');
		expect(stripeWrites()).toEqual(['/v1/customers/cus_u_card invoice_settings[default_payment_method]=pm_new', '/v1/subscriptions/sub_u_card default_payment_method=pm_new']);
		expect(subjects()).toEqual([]);
	});

	it("sets only the customer's card when the seller has no live subscription, and never pays an invoice, even in pay mode", async () => {
		const customer = await seller('u_nosub');
		stripeServes({ cs_u_nosub: cardSession('u_nosub', customer, { metadata: { kind: 'card', estori_user_id: 'u_nosub', card_mode: 'pay' } }), [customer]: { id: customer } });
		expect(await deliver('evt_nosub', 'checkout.session.completed', cardEvent('u_nosub'))).toBe(200);
		expect(await resultOf('evt_nosub')).toBe('applied');
		expect(stripeWrites()).toEqual(['/v1/customers/cus_u_nosub invoice_settings[default_payment_method]=pm_new']);
		const paths = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => new URL(String(input)).pathname);
		expect(paths.some((path) => path.includes('/invoices'))).toBe(false);
	});

	it("refuses a card session whose seller isn't the customer's, changing nothing and alerting", async () => {
		const customer = await seller('u_owner');
		await insertUser(db, 'u_other');
		stripeServes({ cs_u_other: cardSession('u_other', customer), [customer]: { id: customer } });
		expect(await deliver('evt_other', 'checkout.session.completed', cardEvent('u_other'))).toBe(200);
		expect(await resultOf('evt_other')).toBe('refused');
		expect(stripeWrites()).toEqual([]);
		expect(alerted()).toBe(true);
	});

	it("ignores a card session Stripe doesn't show as complete", async () => {
		const customer = await seller('u_open');
		stripeServes({ cs_u_open: cardSession('u_open', customer, { status: 'open' }), [customer]: { id: customer } });
		expect(await deliver('evt_open', 'checkout.session.completed', cardEvent('u_open'))).toBe(200);
		expect(await resultOf('evt_open')).toBe('ignored');
		expect(stripeWrites()).toEqual([]);
	});

	it('records a card session that names no saved card without changing anything', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const customer = await seller('u_nocard');
		stripeServes({ cs_u_nocard: cardSession('u_nocard', customer, { setup_intent: { id: 'seti_2', payment_method: null } }), [customer]: { id: customer } });
		expect(await deliver('evt_nocard', 'checkout.session.completed', cardEvent('u_nocard'))).toBe(200);
		expect(await resultOf('evt_nocard')).toBe('ignored');
		expect(stripeWrites()).toEqual([]);
		expect(JSON.stringify(warn.mock.calls)).toContain('cs_u_nocard');
	});

	const subscriptionSession = (userId: string, customer: string) => ({
		id: `cs_sub_${userId}`,
		mode: 'subscription',
		subscription: `sub_${userId}`,
		customer,
		client_reference_id: userId,
		payment_status: 'paid',
		status: 'complete',
		metadata: { estori_user_id: userId, plan: 'pro' },
	});
	const consentFor = (userId: string, termsVersion = '2026-10-20') =>
		new BillingService(env()).recordConsent({ sessionId: `cs_sub_${userId}`, userId, plan: 'pro', termsVersion, consentText: 'I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel.', now: new Date('2026-10-20T10:00:00Z') });

	it('a subscription checkout stamps the stored consent onto the subscription', async () => {
		const customer = await seller('u_consent');
		await consentFor('u_consent');
		stripeServes({ sub_u_consent: subscription('u_consent', customer) });
		expect(await deliver('evt_consent', 'checkout.session.completed', subscriptionSession('u_consent', customer))).toBe(200);
		expect(await rowOf('u_consent')).toMatchObject({ id: 'sub_u_consent', status: 'active' });
		expect(stripeWrites()).toEqual(['/v1/subscriptions/sub_u_consent metadata[terms_version]=2026-10-20&metadata[renewal_consent_at]=2026-10-20T10:00:00.000Z']);
		expect(stripeWriteKeys()).toEqual([expect.stringMatching(/^billing-consent-sub_u_consent-\d+$/)]);
	});

	it('leaves a subscription that already carries its terms alone', async () => {
		const customer = await seller('u_stamped');
		await consentFor('u_stamped');
		stripeServes({ sub_u_stamped: subscription('u_stamped', customer, { metadata: { estori_user_id: 'u_stamped', terms_version: '2026-10-20' } }) });
		expect(await deliver('evt_stamped', 'checkout.session.completed', subscriptionSession('u_stamped', customer))).toBe(200);
		expect(await resultOf('evt_stamped')).toBe('applied');
		expect(stripeWrites()).toEqual([]);
	});

	it("stamps on a retry in a later bucket when Stripe refused the stamp, and gets the replayed refusal in the same bucket, so the seller's agreement isn't lost", async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-20T12:00:00Z'));
		const customer = await seller('u_retry');
		await consentFor('u_retry');
		stripeServes({ sub_u_retry: subscription('u_retry', customer) });
		// Stripe answers a reused idempotency key with its first response, a failure included, instead of running the request again.
		const serve = vi.mocked(globalThis.fetch).getMockImplementation();
		const answered = new Map<string, { status: number; body: string }>();
		let refusing = true;
		vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
			const key = new Headers(init?.headers).get('Idempotency-Key');
			const first = key ? answered.get(key) : undefined;
			if (first) return new Response(first.body, { status: first.status });
			const response = refusing && init?.method === 'POST' ? Response.json({ error: { message: 'Stripe is down' } }, { status: 500 }) : serve ? await serve(input, init) : Response.error();
			if (key) answered.set(key, { status: response.status, body: await response.clone().text() });
			return response;
		});
		const checkout = subscriptionSession('u_retry', customer);
		const bucket = idempotencyBucket(Date.now());
		expect(await deliver('evt_retry', 'checkout.session.completed', checkout)).toBe(500);
		expect(await resultOf('evt_retry')).toBe('applied');
		refusing = false;
		clock.mockReturnValue(Date.parse('2026-10-20T12:05:00Z'));
		expect(await deliver('evt_retry', 'checkout.session.completed', checkout)).toBe(500);
		clock.mockReturnValue(Date.parse('2026-10-20T12:11:00Z'));
		expect(await deliver('evt_retry', 'checkout.session.completed', checkout)).toBe(200);
		const now = `billing-consent-sub_u_retry-${bucket}`;
		expect(stripeWriteKeys()).toEqual([now, now, `billing-consent-sub_u_retry-${bucket + 1}`]);
		expect(await deliver('evt_retry', 'checkout.session.completed', checkout)).toBe(200);
		expect(subjects()).toEqual(['Welcome to Estori Pro']);
	});

	it('a subscription without a stored consent is still recorded and warns', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const customer = await seller('u_noconsent');
		stripeServes({ sub_u_noconsent: subscription('u_noconsent', customer) });
		expect(await deliver('evt_noconsent', 'checkout.session.completed', subscriptionSession('u_noconsent', customer))).toBe(200);
		expect(await rowOf('u_noconsent')).toMatchObject({ id: 'sub_u_noconsent', status: 'active', plan: 'pro' });
		expect(await resultOf('evt_noconsent')).toBe('applied');
		expect(stripeWrites()).toEqual([]);
		const logged = JSON.stringify(warn.mock.calls);
		expect(logged).toContain('A subscription started without a stored consent');
		expect(logged).toContain('cs_sub_u_noconsent');
		expect(subjects()).toEqual(['Welcome to Estori Pro']);
	});

	it("doesn't stamp a subscription whose account the checkout doesn't match", async () => {
		const customer = await seller('u_mine');
		await insertUser(db, 'u_thief');
		await consentFor('u_thief');
		stripeServes({ sub_u_thief: subscription('u_thief', customer) });
		await deliver('evt_thief', 'checkout.session.completed', subscriptionSession('u_thief', customer));
		expect(await resultOf('evt_thief')).toBe('refused');
		expect(stripeWrites()).toEqual([]);
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

	it("removes the refunded share of what's unused when it writes, when a settle lands between the refund's read and its write", async () => {
		await seller('u_race');
		const now = Date.now();
		await insertPurchase(db, { id: 'cp_race', userId: 'u_race', credits: 5_000, amountCents: 750, purchasedAt: new Date(now - DAY * 1000), expiresAt: new Date(now + 300 * DAY * 1000), paymentIntentId: 'pi_race' });
		const ledger = new CreditLedgerService(env());
		const period = { key: 'acct:race', startMs: now - DAY * 1000, endMs: now + 29 * DAY * 1000 };
		const use = (useKey: string, credits: number) => ledger.recordUse({ userId: 'u_race', period, pool: 5_000, useKey, credits, source: 'think', model: 'm', usage: null, now: new Date(now) });
		await use('k_race_1', 6_000);
		const deps = billingEventDepsFromEnv(env());
		const racing: BillingEventDeps = {
			...deps,
			ledger: {
				purchaseBySession: (sessionId) => ledger.purchaseBySession(sessionId),
				purchaseByPaymentIntent: (paymentIntentId) => ledger.purchaseByPaymentIntent(paymentIntentId),
				settle: async (userId, nowMs, options) => {
					const settled = await ledger.settle(userId, nowMs, options);
					// Another run settles 1,000 more credits of overrun after the refund has read the purchase.
					await use('k_race_2', 1_000);
					await ledger.settle(userId, nowMs);
					return settled;
				},
			},
			track: async () => undefined,
		};
		const charge = { id: 'ch_race', payment_intent: 'pi_race', amount: 750, amount_refunded: 375 };
		expect(await applyCreditRefund(racing, { eventId: 'evt_race', eventType: 'charge.refunded', charge })).toBe('applied');
		// 2,000 credits are used by the time the refund writes, so half of the 3,000 left is removed.
		expect(await db.prepare("SELECT used, refunded_cents AS refunded, removed_credits AS removed FROM credit_purchases WHERE id = 'cp_race'").first()).toEqual({ used: 2_000, refunded: 375, removed: 1_500 });
		expect(sent.map((email) => email.text).join('\n')).toContain('We refunded $3.75 for extra AI credits, and removed 1,500 unused credits from your account.');
	});
});
