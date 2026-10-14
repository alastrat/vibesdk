import { describe, expect, it } from 'vitest';
import { PLATFORM_FEE_LABEL, platformFeeCents } from '../../../shared/types/templates';
import { StripeApiError, accountFlags, createStripeClient, encodeForm, isMissingAccountError, type StripeAccount } from './stripe-client';

describe('platformFeeCents', () => {
	it('keeps 7% plus 60 cents of every price option, and nothing of a free site', () => {
		expect([900, 1900, 2900, 4900].map(platformFeeCents)).toEqual([123, 193, 263, 403]);
		expect(platformFeeCents(0)).toBe(0);
	});

	it('names the fee the way sellers see it', () => {
		expect(PLATFORM_FEE_LABEL).toBe('7% + $0.60');
	});
});

describe('encodeForm', () => {
	it('encodes nested objects and arrays the way Stripe expects', () => {
		const body = encodeForm({
			mode: 'payment',
			line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 2900 } }],
			metadata: { appId: 'a b' },
			skipped: undefined,
			alsoSkipped: null,
		});
		expect(decodeURIComponent(body).split('&')).toEqual([
			'mode=payment',
			'line_items[0][quantity]=1',
			'line_items[0][price_data][currency]=usd',
			'line_items[0][price_data][unit_amount]=2900',
			'metadata[appId]=a b',
		]);
	});
});

describe('accountFlags', () => {
	it('reads payout readiness from the account', () => {
		const account: StripeAccount = {
			id: 'acct_1',
			details_submitted: true,
			charges_enabled: true,
			payouts_enabled: false,
			capabilities: { transfers: 'active', card_payments: 'inactive' },
		};
		expect(accountFlags(account)).toEqual({
			detailsSubmitted: true,
			chargesEnabled: true,
			payoutsEnabled: false,
			transfersActive: true,
		});
		expect(accountFlags({ ...account, capabilities: undefined }).transfersActive).toBe(false);
	});
});

describe('isMissingAccountError', () => {
	it('recognizes a stored account that Stripe no longer has', () => {
		expect(isMissingAccountError(new StripeApiError('No such account', 404, 'resource_missing', 'invalid_request_error'))).toBe(true);
		expect(isMissingAccountError(new StripeApiError('No access to account', 403, 'account_invalid', 'invalid_request_error'))).toBe(true);
	});

	it('leaves every other failure alone', () => {
		expect(isMissingAccountError(new StripeApiError('Too many requests', 429, 'rate_limit', 'invalid_request_error'))).toBe(false);
		expect(isMissingAccountError(new StripeApiError('Stripe request failed', 500, null, null))).toBe(false);
		expect(isMissingAccountError(Object.assign(new Error('No such account'), { code: 'resource_missing' }))).toBe(false);
		expect(isMissingAccountError({ code: 'resource_missing' })).toBe(false);
		expect(isMissingAccountError(null)).toBe(false);
	});
});

describe('createStripeClient', () => {
	it('sends form-encoded requests with the secret key and parses JSON', async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1', payment_status: 'unpaid', status: 'open', client_reference_id: 'u1', metadata: {}, amount_total: 2900, currency: 'usd', payment_intent: null }), { status: 200 });
		};
		const client = createStripeClient('sk_test_fake', fakeFetch);
		const session = await client.createCheckoutSession({
			productName: 'Lumen Yoga',
			priceCents: 2900,
			feeCents: 263,
			destinationAccountId: 'acct_1',
			buyerUserId: 'u1',
			buyerEmail: 'buyer@example.test',
			successUrl: 'http://localhost/app/a1?purchase=success&session_id={CHECKOUT_SESSION_ID}',
			cancelUrl: 'http://localhost/app/a1',
			metadata: { appId: 'a1' },
			nowMs: 1_800_000_000_500,
		});
		expect(session.id).toBe('cs_1');
		expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
		expect(calls[0].init.method).toBe('POST');
		const headers = new Headers(calls[0].init.headers);
		expect(headers.get('Authorization')).toBe('Bearer sk_test_fake');
		expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
		const body = decodeURIComponent(String(calls[0].init.body));
		expect(body).toContain('payment_intent_data[application_fee_amount]=263');
		expect(body).toContain('payment_intent_data[transfer_data][destination]=acct_1');
		expect(body).toContain('line_items[0][price_data][unit_amount]=2900');
		expect(body).toContain('client_reference_id=u1');
		// 35 minutes after the pinned time, in Unix seconds; Stripe's minimum is 30.
		expect(body).toContain('expires_at=1800002100');
	});

	it('sends a time-bucketed idempotency key when creating an Express account, so a double click makes one account but a retry later does not replay an error', async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Response(JSON.stringify({ id: 'acct_1', details_submitted: false, charges_enabled: false, payouts_enabled: false }), { status: 200 });
		};
		const client = createStripeClient('sk_test_fake', fakeFetch);
		const bucketStart = 1_800_000_000_000;
		await client.createExpressAccount({ email: 'seller@example.test', userId: 'u1', nowMs: bucketStart });
		expect(calls[0].url).toBe('https://api.stripe.com/v1/accounts');
		expect(new Headers(calls[0].init.headers).get('Idempotency-Key')).toBe('connect-account-u1-3000000');
		await client.createExpressAccount({ email: 'seller@example.test', userId: 'u1', nowMs: bucketStart + 599_999 });
		expect(new Headers(calls[1].init.headers).get('Idempotency-Key')).toBe('connect-account-u1-3000000');
		await client.createExpressAccount({ email: 'seller@example.test', userId: 'u1', nowMs: bucketStart + 600_000 });
		expect(new Headers(calls[2].init.headers).get('Idempotency-Key')).toBe('connect-account-u1-3000001');
		await client.retrieveAccount('acct_1');
		expect(new Headers(calls[3].init.headers).has('Idempotency-Key')).toBe(false);
	});

	it('leaves the email out of a new Express account when the user has none', async () => {
		const bodies: string[] = [];
		const fakeFetch: typeof fetch = async (_input, init) => {
			bodies.push(decodeURIComponent(String(init?.body)));
			return new Response(JSON.stringify({ id: 'acct_1', details_submitted: false, charges_enabled: false, payouts_enabled: false }), { status: 200 });
		};
		const client = createStripeClient('sk_test_fake', fakeFetch);
		await client.createExpressAccount({ email: '', userId: 'u1', nowMs: 0 });
		await client.createExpressAccount({ email: 'seller@example.test', userId: 'u2', nowMs: 0 });
		expect(bodies[0]).not.toContain('email=');
		expect(bodies[1]).toContain('email=seller@example.test');
	});

	it('leaves customer_email out of a Checkout session when the buyer has no email', async () => {
		const bodies: string[] = [];
		const fakeFetch: typeof fetch = async (_input, init) => {
			bodies.push(decodeURIComponent(String(init?.body)));
			return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1', payment_status: 'unpaid', status: 'open', client_reference_id: 'u1', metadata: {}, amount_total: 2900, currency: 'usd', payment_intent: null }), { status: 200 });
		};
		const client = createStripeClient('sk_test_fake', fakeFetch);
		const input = {
			productName: 'Lumen Yoga',
			priceCents: 2900,
			feeCents: 263,
			destinationAccountId: 'acct_1',
			buyerUserId: 'u1',
			successUrl: 'http://localhost/app/a1?purchase=success&session_id={CHECKOUT_SESSION_ID}',
			cancelUrl: 'http://localhost/app/a1',
			metadata: { appId: 'a1' },
			nowMs: 0,
		};
		await client.createCheckoutSession({ ...input, buyerEmail: '' });
		await client.createCheckoutSession(input);
		await client.createCheckoutSession({ ...input, buyerEmail: 'buyer@example.test' });
		expect(bodies[0]).not.toContain('customer_email');
		expect(bodies[1]).not.toContain('customer_email');
		expect(bodies[2]).toContain('customer_email=buyer@example.test');
	});

	it('turns Stripe errors into StripeApiError', async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(JSON.stringify({ error: { message: 'No such account', type: 'invalid_request_error', code: 'resource_missing' } }), {
				status: 404,
			});
		const client = createStripeClient('sk_test_fake', fakeFetch);
		await expect(client.retrieveAccount('acct_missing')).rejects.toMatchObject({
			name: 'StripeApiError',
			status: 404,
			code: 'resource_missing',
		});
		await expect(client.retrieveAccount('acct_missing')).rejects.toBeInstanceOf(StripeApiError);
	});
});
