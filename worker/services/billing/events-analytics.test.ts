/** Billing's subscription event handler sends its PostHog events once, after it records the Stripe event. */

import { describe, expect, it } from 'vitest';
import type { SubscriptionRecord } from '../../database/schema';
import type { StripeSubscription } from '../payments/stripe-client';
import type { StripeEvent } from '../payments/webhook';
import type { BillingAnalyticsEvent } from '../posthog/billing-events';
import { handleBillingEvent, type BillingEventDeps } from './events';

const PRICES = { pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' };
const START = Date.parse('2026-10-05T10:00:00Z') / 1000;
const END = Date.parse('2026-11-05T10:00:00Z') / 1000;

const PRO: StripeSubscription = {
	id: 'sub_1',
	customer: 'cus_1',
	status: 'active',
	created: START,
	cancel_at_period_end: false,
	cancel_at: null,
	metadata: { estori_user_id: 'u1' },
	items: { data: [{ id: 'si_1', price: { id: 'price_pro', metadata: null }, current_period_start: START, current_period_end: END }] },
	schedule: null,
};

const CHECKOUT: StripeEvent = {
	id: 'evt_checkout',
	type: 'checkout.session.completed',
	data: {
		object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', client_reference_id: 'u1', payment_status: 'paid', status: 'complete', metadata: { estori_user_id: 'u1', plan: 'pro' } },
	},
};

const notRead = (): Promise<never> => Promise.reject(new Error('not read by a checkout'));

/** A live Premium subscription the account started a minute after the Pro one. */
const LATER_PREMIUM: SubscriptionRecord = {
	userId: 'u1',
	stripeSubscriptionId: 'sub_2',
	status: 'active',
	plan: 'premium',
	currentPeriodStart: new Date(START * 1000),
	currentPeriodEnd: new Date(END * 1000),
	cancelAtPeriodEnd: false,
	pendingPlan: null,
	pendingPlanAt: null,
	stripeScheduleId: null,
	stripeCreatedAt: new Date((START + 60) * 1000),
	updatedAt: new Date((START + 60) * 1000),
};

/** The handler's deps over a store that remembers the events it recorded and the row it stored. */
function world(options: { recordFails?: boolean; stored?: SubscriptionRecord } = {}) {
	const recorded = new Set<string>();
	let row: SubscriptionRecord | null = options.stored ?? null;
	const tracked: Array<[string, readonly BillingAnalyticsEvent[]]> = [];
	const deps: BillingEventDeps = {
		stripe: { retrieveSubscription: async () => PRO, retrieveCheckoutSession: notRead },
		store: {
			eventSeen: async (eventId) => recorded.has(eventId),
			userOfCustomer: async (customerId) => (customerId === 'cus_1' ? 'u1' : null),
			subscriptionOf: async () => row,
			sentNoticeKeys: async () => new Set<string>(),
			recordEvent: async (input) => {
				if (options.recordFails) throw new Error('D1_ERROR: network connection lost');
				recorded.add(input.event.id);
				if (input.row) row = input.row;
			},
		},
		ledger: { purchaseBySession: notRead, purchaseByPaymentIntent: notRead, settle: notRead },
		priceIds: PRICES,
		account: notRead,
		accountWith: notRead,
		notify: async () => [],
		alert: async () => undefined,
		nowMs: () => Date.parse('2026-10-05T10:00:05Z'),
		track: async (userId, events) => void tracked.push([userId, events]),
	};
	return { deps, tracked };
}

describe('billing events to PostHog', () => {
	it('sends subscription_started once for a completed checkout, and nothing on the retry', async () => {
		const { deps, tracked } = world();
		expect(await handleBillingEvent(deps, CHECKOUT)).toBe('applied');
		expect(tracked).toEqual([['u1', [{ name: 'subscription_started', properties: { plan: 'pro' } }]]]);
		expect(await handleBillingEvent(deps, CHECKOUT)).toBe('duplicate');
		expect(tracked).toHaveLength(1);
	});

	it('sends nothing when the event fails to record, so the retry is the one that counts', async () => {
		const { deps, tracked } = world({ recordFails: true });
		await expect(handleBillingEvent(deps, CHECKOUT)).rejects.toThrow('D1_ERROR');
		expect(tracked).toEqual([]);
	});

	it('sends nothing when the subscription replaces another live one, as billing sends no notices then', async () => {
		const { deps, tracked } = world({ stored: LATER_PREMIUM });
		expect(await handleBillingEvent(deps, CHECKOUT)).toBe('applied');
		expect(tracked).toEqual([]);
	});
});
