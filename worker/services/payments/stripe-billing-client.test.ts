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

	it('refuses to change a subscription that has no items, before calling Stripe', async () => {
		const { calls, client } = recordingFetch(SUBSCRIPTION);
		await expect(client.changeSubscriptionPrice({ subscription: { ...SUBSCRIPTION, items: { data: [] } }, priceId: 'price_pro', idempotencyKey: 'k' })).rejects.toThrow('Subscription sub_1 has no items');
		expect(calls).toEqual([]);
	});

	it("carries a phase's coupon when it has no applied discount, and no discounts when it has none", async () => {
		const withCoupon = recordingFetch({ ...SCHEDULE, phases: [{ ...SCHEDULE.phases[0], discounts: [{ coupon: 'coupon_1', discount: null, promotion_code: null }] }] });
		await withCoupon.client.scheduleSubscriptionPrice({ subscription: { ...SUBSCRIPTION, schedule: 'sub_sched_1' }, priceId: 'price_pro', idempotencyKey: 'k' });
		expect(withCoupon.calls[1].params.filter((param) => param.includes('discounts'))).toEqual(['phases[0][discounts][0][coupon]=coupon_1', 'phases[1][discounts][0][coupon]=coupon_1']);
		const without = recordingFetch({ ...SCHEDULE, phases: [{ ...SCHEDULE.phases[0], discounts: [] }] });
		await without.client.scheduleSubscriptionPrice({ subscription: { ...SUBSCRIPTION, schedule: 'sub_sched_1' }, priceId: 'price_pro', idempotencyKey: 'k' });
		expect(without.calls[1].params.some((param) => param.includes('discounts'))).toBe(false);
	});

	it('refuses to schedule from a schedule with no current phase', async () => {
		const { calls, client } = recordingFetch({ ...SCHEDULE, current_phase: null });
		await expect(client.scheduleSubscriptionPrice({ subscription: { ...SUBSCRIPTION, schedule: 'sub_sched_1' }, priceId: 'price_pro', idempotencyKey: 'k' })).rejects.toThrow('Schedule sub_sched_1 has no current phase');
		expect(calls).toHaveLength(1);
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
