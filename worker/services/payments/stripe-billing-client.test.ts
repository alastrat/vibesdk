import { describe, expect, it } from 'vitest';
import { BILLING_CHECKOUT_EXPAND, createStripeClient, type StripeSubscription } from './stripe-client';

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

	it('the subscription session is an elements session with a return url and no stripe consent', async () => {
		const { calls, client } = recordingFetch({ id: 'cs_1', url: null, client_secret: 'cs_1_secret_x' });
		await client.createSubscriptionCheckoutSession({ customerId: 'cus_1', priceId: 'price_premium', userId: 'u1', plan: 'premium', returnUrl: 'https://estori.app/settings/billing/checkout/return?session_id={CHECKOUT_SESSION_ID}', nowMs: NOW });
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/checkout/sessions', key: `billing-checkout-u1-premium-${BUCKET}` });
		expect(calls[0].params).toEqual(
			expect.arrayContaining([
				'mode=subscription',
				'ui_mode=elements',
				'customer=cus_1',
				'client_reference_id=u1',
				'line_items[0][price]=price_premium',
				'line_items[0][quantity]=1',
				'payment_method_types[0]=card',
				'allow_promotion_codes=true',
				'subscription_data[metadata][estori_user_id]=u1',
				'metadata[estori_user_id]=u1',
				'metadata[plan]=premium',
				'return_url=https://estori.app/settings/billing/checkout/return?session_id={CHECKOUT_SESSION_ID}',
			]),
		);
		for (const key of ['consent_collection', 'custom_text', 'success_url', 'cancel_url']) {
			expect(calls[0].params.some((param) => param.startsWith(key))).toBe(false);
		}
	});

	it('opens a one-time elements checkout for extra credits, a line per 1,000 credits, tagged on the session and the payment', async () => {
		const { calls, client } = recordingFetch({ id: 'cs_c', url: null, client_secret: 'cs_c_secret_x' });
		await client.createCreditsCheckoutSession({ customerId: 'cus_1', priceId: 'price_credits', userId: 'u1', credits: 12_000, returnUrl: 'https://estori.app/settings/billing/checkout/return?session_id={CHECKOUT_SESSION_ID}', nowMs: NOW, idempotencyKey: 'billing-credits-u1-12000-cp_1-1' });
		expect(calls[0].key).toBe('billing-credits-u1-12000-cp_1-1');
		expect(calls[0].params).toEqual(
			expect.arrayContaining([
				'mode=payment',
				'ui_mode=elements',
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
				'return_url=https://estori.app/settings/billing/checkout/return?session_id={CHECKOUT_SESSION_ID}',
			]),
		);
		for (const key of ['allow_promotion_codes', 'custom_text', 'success_url', 'cancel_url']) {
			expect(calls[0].params.some((param) => param.startsWith(key))).toBe(false);
		}
	});

	it('the credits session creates an invoice with the purchase metadata', async () => {
		const { calls, client } = recordingFetch({ id: 'cs_c', url: null });
		await client.createCreditsCheckoutSession({ customerId: 'cus_1', priceId: 'price_credits', userId: 'u1', credits: 5_000, returnUrl: 'https://estori.app/r', nowMs: NOW, idempotencyKey: 'k' });
		expect(calls[0].params).toEqual(
			expect.arrayContaining([
				'invoice_creation[enabled]=true',
				'invoice_creation[invoice_data][metadata][kind]=credits',
				'invoice_creation[invoice_data][metadata][estori_user_id]=u1',
				'invoice_creation[invoice_data][metadata][credits]=5000',
			]),
		);
	});

	it('a card setup session is a setup-mode elements session', async () => {
		const { calls, client } = recordingFetch({ id: 'cs_card', url: null, client_secret: 'cs_card_secret_x' });
		const session = await client.createCardSetupSession({ customerId: 'cus_1', userId: 'u1', mode: 'pay', afterCardId: 'pm_old', returnUrl: 'https://estori.app/settings/billing/card/return?session_id={CHECKOUT_SESSION_ID}', nowMs: NOW });
		expect(session.client_secret).toBe('cs_card_secret_x');
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/checkout/sessions', method: 'POST', key: `billing-card-u1-pay-pm_old-${BUCKET}` });
		expect(calls[0].params).toEqual(
			expect.arrayContaining([
				'mode=setup',
				'ui_mode=elements',
				'customer=cus_1',
				'currency=usd',
				'payment_method_types[0]=card',
				'metadata[kind]=card',
				'metadata[estori_user_id]=u1',
				'metadata[card_mode]=pay',
				'return_url=https://estori.app/settings/billing/card/return?session_id={CHECKOUT_SESSION_ID}',
				`expires_at=${(BUCKET + 1) * 600 + 35 * 60}`,
			]),
		);
		const saved = recordingFetch({ id: 'cs_card2' });
		await saved.client.createCardSetupSession({ customerId: 'cus_1', userId: 'u1', mode: 'save', afterCardId: null, returnUrl: 'https://estori.app/r', nowMs: NOW });
		expect(saved.calls[0].key).toBe(`billing-card-u1-save-none-${BUCKET}`);
		expect(saved.calls[0].params).toContain('metadata[card_mode]=save');
	});

	it('a card setup after the default card changed is a new session, and one before it is the same session', async () => {
		const { calls, client } = recordingFetch({ id: 'cs_card' });
		const setup = (afterCardId: string | null, nowMs = NOW) => client.createCardSetupSession({ customerId: 'cus_1', userId: 'u1', mode: 'pay', afterCardId, returnUrl: 'https://estori.app/r', nowMs });
		await setup('pm_1');
		await setup('pm_1', NOW + 60_000);
		await setup('pm_2');
		await setup(null);
		expect(calls.map((call) => call.key)).toEqual([`billing-card-u1-pay-pm_1-${BUCKET}`, `billing-card-u1-pay-pm_1-${BUCKET}`, `billing-card-u1-pay-pm_2-${BUCKET}`, `billing-card-u1-pay-none-${BUCKET}`]);
	});

	it('every billing session takes cards only and never offers Link; the plan and credits sessions also charge in dollars, as the store does', async () => {
		const subscription = recordingFetch({ id: 'cs_1' });
		const credits = recordingFetch({ id: 'cs_c' });
		const card = recordingFetch({ id: 'cs_card' });
		await subscription.client.createSubscriptionCheckoutSession({ customerId: 'cus_1', priceId: 'price_pro', userId: 'u1', plan: 'pro', returnUrl: 'https://estori.app/r', nowMs: NOW });
		await credits.client.createCreditsCheckoutSession({ customerId: 'cus_1', priceId: 'price_credits', userId: 'u1', credits: 5_000, returnUrl: 'https://estori.app/r', nowMs: NOW, idempotencyKey: 'k' });
		await card.client.createCardSetupSession({ customerId: 'cus_1', userId: 'u1', mode: 'save', afterCardId: null, returnUrl: 'https://estori.app/r', nowMs: NOW });
		for (const { calls } of [subscription, credits, card]) {
			expect(calls[0].params).toEqual(expect.arrayContaining(['payment_method_types[0]=card', 'wallet_options[link][display]=never']));
			expect(calls[0].params.filter((param) => param.startsWith('payment_method_types'))).toEqual(['payment_method_types[0]=card']);
		}
		for (const { calls } of [subscription, credits]) expect(calls[0].params).toContain('adaptive_pricing[enabled]=false');
		// A setup has no price to show in another currency.
		expect(card.calls[0].params.some((param) => param.startsWith('adaptive_pricing'))).toBe(false);
	});

	it('sends the same checkout twice within a key bucket, closing at least 30 minutes after either call', async () => {
		const nineMinutes = 9 * 60_000;
		const lastMoment = NOW + 600_000 - 1;
		const expiresAt = (params: string[]) => Number(params.find((param) => param.startsWith('expires_at='))?.split('=')[1]);
		const subscription = recordingFetch({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
		const credits = recordingFetch({ id: 'cs_c', url: 'https://checkout.stripe.com/c/cs_c' });
		const card = recordingFetch({ id: 'cs_card' });
		for (const nowMs of [NOW, NOW + nineMinutes, lastMoment]) {
			await subscription.client.createSubscriptionCheckoutSession({ customerId: 'cus_1', priceId: 'price_pro', userId: 'u1', plan: 'pro', returnUrl: 'https://estori.app/r', nowMs });
			await credits.client.createCreditsCheckoutSession({ customerId: 'cus_1', priceId: 'price_credits', userId: 'u1', credits: 5_000, returnUrl: 'https://estori.app/r', nowMs, idempotencyKey: 'billing-credits-u1-5000-none-1' });
			await card.client.createCardSetupSession({ customerId: 'cus_1', userId: 'u1', mode: 'save', afterCardId: 'pm_old', returnUrl: 'https://estori.app/r', nowMs });
		}
		for (const { calls } of [subscription, credits, card]) {
			expect(new Set(calls.map((call) => call.key)).size).toBe(1);
			expect(calls[1].params).toEqual(calls[0].params);
			expect(calls[2].params).toEqual(calls[0].params);
			expect(expiresAt(calls[0].params) - Math.floor(lastMoment / 1000)).toBeGreaterThanOrEqual(30 * 60);
			expect(expiresAt(calls[0].params) - Math.floor(NOW / 1000)).toBeLessThanOrEqual(24 * 60 * 60);
		}
	});

	it('reads a customer, with its default payment method', async () => {
		const { calls, client } = recordingFetch({ id: 'cus_1', email: null, metadata: null, invoice_settings: { default_payment_method: 'pm_1' } });
		expect((await client.retrieveCustomer('cus_1')).invoice_settings?.default_payment_method).toBe('pm_1');
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/customers/cus_1', method: 'GET', key: null });
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

	it('releases a schedule, and treats one already released as done', async () => {
		const released = recordingFetch(SCHEDULE);
		await released.client.releaseSubscriptionSchedule('sub_sched_1');
		expect(released.calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscription_schedules/sub_sched_1/release', method: 'POST' });
		const gone = recordingFetch({ error: { message: 'already released', type: 'invalid_request_error' } }, 400);
		await expect(gone.client.releaseSubscriptionSchedule('sub_sched_1')).resolves.toBeUndefined();
	});

	it("has no call for Stripe's Billing Portal, whose pages Estori's own replace", () => {
		const { client } = recordingFetch({});
		// @ts-expect-error The client no longer opens a Billing Portal session.
		expect(client.createBillingPortalSession).toBeUndefined();
	});

	it('reads a checkout session with the objects billing needs expanded, and without expands when none are asked for', async () => {
		const plain = recordingFetch({ id: 'cs_1' });
		await plain.client.retrieveCheckoutSession('cs_1');
		expect(plain.calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/checkout/sessions/cs_1', method: 'GET' });
		const expanded = recordingFetch({
			id: 'cs_1',
			discounts: [{ coupon: null, promotion_code: { id: 'promo_1', promotion: { type: 'coupon', coupon: { id: 'c1', duration: 'repeating', duration_in_months: 3 } } } }],
			setup_intent: { id: 'seti_1', payment_method: 'pm_1' },
		});
		const session = await expanded.client.retrieveCheckoutSession('cs_1', BILLING_CHECKOUT_EXPAND);
		expect(expanded.calls[0].url).toBe(
			'https://api.stripe.com/v1/checkout/sessions/cs_1?expand%5B0%5D=discounts.coupon&expand%5B1%5D=discounts.promotion_code.promotion.coupon&expand%5B2%5D=setup_intent',
		);
		expect(session.discounts?.[0]?.promotion_code).toMatchObject({ promotion: { coupon: { duration: 'repeating', duration_in_months: 3 } } });
	});

	it('setting the default card updates the customer and the subscription', async () => {
		const { calls, client } = recordingFetch({ id: 'x' });
		await client.setDefaultPaymentMethod({ customerId: 'cus_1', subscriptionId: 'sub_1', paymentMethodId: 'pm_9', nowMs: NOW });
		expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST https://api.stripe.com/v1/customers/cus_1', 'POST https://api.stripe.com/v1/subscriptions/sub_1']);
		expect(calls[0].params).toEqual(['invoice_settings[default_payment_method]=pm_9']);
		expect(calls[1].params).toEqual(['default_payment_method=pm_9']);
		expect(calls[0].key).toBe(`billing-default-card-cus_1-pm_9-${BUCKET}`);
		expect(calls[1].key).toBe(`billing-default-card-sub_1-pm_9-${BUCKET}`);
	});

	it('sets the same card under the same keys within a bucket, and under new ones in a later bucket, so a failure Stripe saved is not replayed for a day', async () => {
		const { calls, client } = recordingFetch({ id: 'x' });
		const set = (nowMs: number) => client.setDefaultPaymentMethod({ customerId: 'cus_1', subscriptionId: 'sub_1', paymentMethodId: 'pm_9', nowMs });
		await set(NOW);
		await set(NOW + 60_000);
		await set(NOW + 600_000);
		expect(calls.map((call) => call.key)).toEqual([
			`billing-default-card-cus_1-pm_9-${BUCKET}`,
			`billing-default-card-sub_1-pm_9-${BUCKET}`,
			`billing-default-card-cus_1-pm_9-${BUCKET}`,
			`billing-default-card-sub_1-pm_9-${BUCKET}`,
			`billing-default-card-cus_1-pm_9-${BUCKET + 1}`,
			`billing-default-card-sub_1-pm_9-${BUCKET + 1}`,
		]);
	});

	it('setting the default card with no subscription updates only the customer', async () => {
		const { calls, client } = recordingFetch({ id: 'x' });
		await client.setDefaultPaymentMethod({ customerId: 'cus_1', subscriptionId: null, paymentMethodId: 'pm_9', nowMs: NOW });
		expect(calls.map((call) => call.url)).toEqual(['https://api.stripe.com/v1/customers/cus_1']);
	});

	it("updating a subscription's metadata sends only the keys given, under the caller's key", async () => {
		const { calls, client } = recordingFetch({ id: 'sub_1' });
		await client.updateSubscriptionMetadata('sub_1', { terms_version: '2026-10-20', renewal_consent_at: '2026-10-20T10:00:00.000Z' }, 'billing-consent-sub_1');
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/subscriptions/sub_1', method: 'POST', key: 'billing-consent-sub_1' });
		expect(calls[0].params).toEqual(['metadata[terms_version]=2026-10-20', 'metadata[renewal_consent_at]=2026-10-20T10:00:00.000Z']);
	});

	it('reads a payment method as its card summary, and as no card when it is not a card', async () => {
		const card = recordingFetch({ id: 'pm_1', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030, funding: 'credit', country: 'US' } });
		expect(await card.client.retrievePaymentMethod('pm_1')).toEqual({ id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030 } });
		expect(card.calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/payment_methods/pm_1', method: 'GET' });
		const bank = recordingFetch({ id: 'pm_2', type: 'us_bank_account' });
		expect(await bank.client.retrievePaymentMethod('pm_2')).toEqual({ id: 'pm_2', card: null });
	});

	it('listing invoices asks for 24 for the customer', async () => {
		const { calls, client } = recordingFetch({ object: 'list', has_more: false, data: [{ id: 'in_2' }, { id: 'in_1' }] });
		const invoices = await client.listInvoices('cus_1', 24);
		expect(invoices.map((invoice) => invoice.id)).toEqual(['in_2', 'in_1']);
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/invoices?customer=cus_1&limit=24', method: 'GET', key: null });
	});

	it("reads an invoice with the payment intent's client secret and its payments", async () => {
		const { calls, client } = recordingFetch({
			id: 'in_1',
			status: 'open',
			confirmation_secret: { client_secret: 'pi_1_secret_x', type: 'payment_intent' },
			payments: { data: [{ status: 'open', payment: { type: 'payment_intent', payment_intent: 'pi_1' } }] },
		});
		const invoice = await client.retrieveInvoice('in_1');
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/invoices/in_1?expand%5B0%5D=confirmation_secret&expand%5B1%5D=payments', method: 'GET' });
		expect(invoice.confirmation_secret?.client_secret).toBe('pi_1_secret_x');
		expect(invoice.payments?.data[0]).toMatchObject({ status: 'open', payment: { payment_intent: 'pi_1' } });
	});

	it('paying an invoice sends the chosen card, as the seller being present', async () => {
		const { calls, client } = recordingFetch({ id: 'in_1', status: 'paid' });
		expect((await client.payInvoice('in_1', 'pm_9', 'billing-pay-u1-in_1-pm_9')).status).toBe('paid');
		expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/invoices/in_1/pay', method: 'POST', key: 'billing-pay-u1-in_1-pm_9' });
		expect(calls[0].params).toEqual(['payment_method=pm_9', 'off_session=false']);
	});

	it("paying an invoice with no chosen card leaves the card to the invoice's own default", async () => {
		const { calls, client } = recordingFetch({ id: 'in_1', status: 'paid' });
		await client.payInvoice('in_1', null, 'billing-pay-u1-in_1-default');
		expect(calls[0].params).toEqual(['off_session=false']);
	});

	it('a payment that needs the seller to authenticate reaches the caller as the error Stripe sent', async () => {
		const { client } = recordingFetch({ error: { message: 'This payment requires additional user action', type: 'invalid_request_error', code: 'invoice_payment_intent_requires_action' } }, 402);
		await expect(client.payInvoice('in_1', null, 'k')).rejects.toMatchObject({ status: 402, code: 'invoice_payment_intent_requires_action' });
	});

	it("fetches an invoice's pdf from its signed address without the secret key, and refuses an address that isn't Stripe's", async () => {
		const seen: Array<{ url: string; method: string; authorization: string | null }> = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			seen.push({ url: String(input), method: init?.method ?? 'GET', authorization: new Headers(init?.headers).get('Authorization') });
			return new Response('%PDF-1.7', { status: 200, headers: { 'Content-Type': 'application/pdf' } });
		};
		const client = createStripeClient('sk_test_fake', fakeFetch);
		const response = await client.fetchInvoicePdf('https://pay.stripe.com/invoice/acct_1/test_x/pdf?s=ap');
		expect(await response.text()).toBe('%PDF-1.7');
		expect(seen).toEqual([{ url: 'https://pay.stripe.com/invoice/acct_1/test_x/pdf?s=ap', method: 'GET', authorization: null }]);
		for (const url of ['https://evil.example/invoice.pdf', 'http://pay.stripe.com/invoice.pdf', 'https://stripe.com.evil.example/x', 'not a url']) {
			await expect(client.fetchInvoicePdf(url)).rejects.toThrow('The invoice PDF is not on a Stripe address');
		}
		expect(seen).toHaveLength(1);
	});
});
