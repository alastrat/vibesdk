import { describe, expect, it } from 'vitest';
import { platformFeeCents } from '../../../shared/types/templates';
import { StripeApiError, accountFlags, createStripeClient, encodeForm, type StripeAccount } from './stripe-client';

describe('platformFeeCents', () => {
	it('keeps 5% of every price option', () => {
		expect([900, 1900, 2900, 4900].map(platformFeeCents)).toEqual([45, 95, 145, 245]);
		expect(platformFeeCents(0)).toBe(0);
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
			feeCents: 145,
			destinationAccountId: 'acct_1',
			buyerUserId: 'u1',
			buyerEmail: 'buyer@example.test',
			successUrl: 'http://localhost/app/a1?purchase=success&session_id={CHECKOUT_SESSION_ID}',
			cancelUrl: 'http://localhost/app/a1',
			metadata: { appId: 'a1' },
		});
		expect(session.id).toBe('cs_1');
		expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
		expect(calls[0].init.method).toBe('POST');
		const headers = new Headers(calls[0].init.headers);
		expect(headers.get('Authorization')).toBe('Bearer sk_test_fake');
		expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
		const body = decodeURIComponent(String(calls[0].init.body));
		expect(body).toContain('payment_intent_data[application_fee_amount]=145');
		expect(body).toContain('payment_intent_data[transfer_data][destination]=acct_1');
		expect(body).toContain('line_items[0][price_data][unit_amount]=2900');
		expect(body).toContain('client_reference_id=u1');
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
