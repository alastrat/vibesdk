import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted((): unknown[][] => []);
vi.mock('./analytics', () => ({ serverAnalytics: () => ({ capture: (...args: unknown[]) => void captured.push(args) }) }));
vi.mock('./person', () => ({ personUpdateOf: async () => ({ set: { plan: 'premium' } }) }));

import type { SubscriptionState } from './billing-events';

const { cancelReasonOf, planDirection, subscriptionEventsFor, trackBilling } = await import('./billing-events');

function sub(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
	return { stripeSubscriptionId: 'sub_1', status: 'active', plan: 'pro', cancelAtPeriodEnd: false, ...overrides };
}

const events = (previous: SubscriptionState | null, next: SubscriptionState, failedAttempt: number | null = null) => subscriptionEventsFor({ previous, next, failedAttempt });

describe('subscription events', () => {
	it('start a plan on the first event that stores it live, whichever event that is', () => {
		expect(events(null, sub())).toEqual([{ name: 'subscription_started', properties: { plan: 'pro' } }]);
		expect(events(sub({ status: 'incomplete' }), sub({ plan: 'premium' }))).toEqual([{ name: 'subscription_started', properties: { plan: 'premium' } }]);
		expect(events(sub({ stripeSubscriptionId: 'sub_0', status: 'canceled' }), sub())).toEqual([{ name: 'subscription_started', properties: { plan: 'pro' } }]);
		expect(events(null, sub({ status: 'incomplete' }))).toEqual([]);
		expect(events(sub(), sub())).toEqual([]);
		// A failed card paid later is the same plan going on, not a new one.
		expect(events(sub({ status: 'past_due' }), sub())).toEqual([]);
	});

	it('change plans once, when the new plan is stored, up or down', () => {
		expect(events(sub(), sub({ plan: 'premium' }))).toEqual([{ name: 'subscription_changed', properties: { from_plan: 'pro', to_plan: 'premium', direction: 'up' } }]);
		expect(events(sub({ plan: 'premium' }), sub())).toEqual([{ name: 'subscription_changed', properties: { from_plan: 'premium', to_plan: 'pro', direction: 'down' } }]);
		expect(planDirection('basic', 'enterprise')).toBe('up');
	});

	it('end a plan once, with why it ended', () => {
		expect(events(sub({ cancelAtPeriodEnd: true }), sub({ status: 'canceled', cancelAtPeriodEnd: true }))).toEqual([
			{ name: 'subscription_cancelled', properties: { plan: 'pro', reason: 'seller' } },
		]);
		expect(events(sub({ status: 'canceled' }), sub({ status: 'canceled' }))).toEqual([]);
		// A subscription that never started has no start event to end, so cancelling it sends nothing.
		expect(events(sub({ status: 'incomplete' }), sub({ status: 'canceled' }))).toEqual([]);
		expect(events(sub({ status: 'past_due' }), sub({ status: 'canceled' }))).toEqual([{ name: 'subscription_cancelled', properties: { plan: 'pro', reason: 'payment_failed' } }]);
		expect(cancelReasonOf(sub({ status: 'past_due' }))).toBe('payment_failed');
		expect(cancelReasonOf(sub({ status: 'unpaid' }))).toBe('payment_failed');
		// Sellers can only cancel at the period's end, so an immediate cancel came from an admin or the Stripe Dashboard.
		expect(cancelReasonOf(sub())).toBe('admin');
	});

	it("record a failed renewal with Stripe's attempt number", () => {
		expect(events(sub(), sub({ status: 'past_due' }), 2)).toEqual([{ name: 'subscription_payment_failed', properties: { plan: 'pro', attempt: 2 } }]);
	});

	it('record only failed renewals: not a first invoice that never started the plan, nor a declined move that kept it', () => {
		expect(events(null, sub({ status: 'incomplete' }), 1)).toEqual([]);
		expect(events(sub(), sub(), 1)).toEqual([]);
	});
});

describe('sending billing events', () => {
	beforeEach(() => {
		captured.length = 0;
	});

	it("sends each event about the account, with its person properties read after billing's write", async () => {
		await trackBilling({} as Env, 'u1', [
			{ name: 'credits_purchased', properties: { credits: 5_000, amount_cents: 750 } },
			{ name: 'credits_low', properties: { plan: 'premium', threshold: 20 } },
		]);
		expect(captured).toEqual([
			['credits_purchased', 'u1', { credits: 5_000, amount_cents: 750 }, { set: { plan: 'premium' } }],
			['credits_low', 'u1', { plan: 'premium', threshold: 20 }, { set: { plan: 'premium' } }],
		]);
	});

	it('reads nothing when there is nothing to send', async () => {
		await trackBilling({} as Env, 'u1', []);
		expect(captured).toEqual([]);
	});
});
