import { describe, expect, it } from 'vitest';
import { StripeApiError } from '../worker/services/payments/stripe-client';
import { STRIPE_API_VERSION } from '../shared/types/stripe';
import { modeOfKey, stripeCaller } from './stripe-api';

interface Seen {
	url: string;
	init: RequestInit;
}

function stripe(respond: () => Response): { seen: Seen[]; fetchImpl: typeof fetch } {
	const seen: Seen[] = [];
	return {
		seen,
		fetchImpl: async (input, init) => {
			seen.push({ url: String(input), init: init ?? {} });
			return respond();
		},
	};
}

describe('the shared Stripe caller', () => {
	it('tells a test key from a live one', () => {
		expect(['sk_test_a', 'rk_test_a', 'sk_live_a', 'rk_live_a', 'pk_test_a'].map(modeOfKey)).toEqual(['test', 'test', 'live', 'live', 'live']);
	});

	it('sends a GET with its params in the query, and a POST form-encoded with the idempotency key', async () => {
		const { seen, fetchImpl } = stripe(() => Response.json({ ok: true }));
		const call = stripeCaller('sk_test_a', fetchImpl);
		await call('GET', '/prices', { lookup_keys: ['a', 'b'], active: true });
		await call('POST', '/subscriptions', { customer: 'cus_1', items: [{ price: 'price_1' }] }, 'key-1');
		expect(seen[0].url).toBe('https://api.stripe.com/v1/prices?lookup_keys%5B0%5D=a&lookup_keys%5B1%5D=b&active=true');
		expect(seen[0].init.body).toBeUndefined();
		expect(seen[1].url).toBe('https://api.stripe.com/v1/subscriptions');
		expect(seen[1].init.body).toBe('customer=cus_1&items%5B0%5D%5Bprice%5D=price_1');
		const headers = new Headers(seen[1].init.headers);
		expect(headers.get('Authorization')).toBe('Bearer sk_test_a');
		expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
		expect(headers.get('Stripe-Version')).toBe(STRIPE_API_VERSION);
		expect(headers.get('Idempotency-Key')).toBe('key-1');
		expect(new Headers(seen[0].init.headers).get('Idempotency-Key')).toBeNull();
	});

	it('sends a DELETE with no body', async () => {
		const { seen, fetchImpl } = stripe(() => Response.json({ deleted: true }));
		expect(await stripeCaller('sk_test_a', fetchImpl)('DELETE', '/test_helpers/test_clocks/clock_1')).toEqual({ deleted: true });
		expect(seen[0].init).toMatchObject({ method: 'DELETE', body: undefined });
	});

	it("turns Stripe's error answer into a StripeApiError", async () => {
		const { fetchImpl } = stripe(() => Response.json({ error: { message: 'No such customer', type: 'invalid_request_error', code: 'resource_missing' } }, { status: 404 }));
		const failure = await stripeCaller('sk_test_a', fetchImpl)('GET', '/customers/cus_x').catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(StripeApiError);
		expect(failure).toMatchObject({ message: 'No such customer', status: 404, code: 'resource_missing', type: 'invalid_request_error' });
	});
});
