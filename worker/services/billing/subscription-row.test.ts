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
	return { id: 'in_1', customer: 'cus_1', status: 'paid', created: 1, amount_due: amountPaid, amount_paid: amountPaid, total: amountPaid, currency: 'usd', hosted_invoice_url: 'https://invoice.stripe.com/i/in_1', invoice_pdf: null, number: 'EST-0001', description: null, billing_reason: reason, parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } } };
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

	it("sends a returning seller's welcome and receipt while the stored row is still their ended subscription", () => {
		const ended = row({ stripeSubscriptionId: 'sub_old', status: 'canceled' });
		expect(keys(noticesFor(ended, row(), { eventType: 'invoice.paid', invoice: invoice('subscription_create') }))).toEqual(['plan_started:sub_1', 'receipt:in_1']);
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

	it("says nothing of a move up set for the renewal, since the move-down email can't describe it", () => {
		const pendingUp = row({ pendingPlan: 'premium', pendingPlanAt: new Date(END * 1000), stripeScheduleId: 'sub_sched_2' });
		expect(noticesFor(row(), pendingUp, UPDATED)).toEqual([]);
	});

	it('warns once per failed invoice, naming the end of the grace period', () => {
		expect(noticesFor(row(), row({ status: 'past_due' }), { eventType: 'invoice.payment_failed', invoice: invoice('subscription_cycle', 0) })).toEqual([
			{ key: 'payment_failed:in_1', email: { kind: 'payment_failed', plan: 'pro', graceEndsAt: START * 1000 + 7 * DAY, needsConfirmation: false } },
		]);
	});

	it('asks the seller to confirm when the bank wants it, under the same key a plain failure uses', () => {
		const asked = noticesFor(row(), row({ status: 'past_due' }), { eventType: 'invoice.payment_action_required', invoice: invoice('subscription_cycle', 0) });
		expect(asked).toEqual([{ key: 'payment_failed:in_1', email: { kind: 'payment_failed', plan: 'pro', graceEndsAt: START * 1000 + 7 * DAY, needsConfirmation: true } }]);
	});

	it('sends a receipt that carries no address of the invoice', () => {
		const [receipt] = noticesFor(row(), row(), { eventType: 'invoice.paid', invoice: invoice('subscription_create') });
		expect(receipt.email).toEqual({ kind: 'receipt', plan: 'pro', amountCents: 4_900, currency: 'usd', periodStart: START * 1000, periodEnd: END * 1000, invoiceNumber: 'EST-0001' });
	});

	it('warns of nothing when a failed invoice leaves the subscription paid up, such as a declined move to Premium', () => {
		expect(noticesFor(row(), row(), { eventType: 'invoice.payment_failed', invoice: invoice('subscription_update', 0) })).toEqual([]);
		expect(noticesFor(row(), row(), { eventType: 'invoice.payment_action_required', invoice: invoice('subscription_update', 0) })).toEqual([]);
	});
});
