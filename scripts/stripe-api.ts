/** What the Stripe scripts share: a key's mode, and a caller that sends requests in the shape of the app's own client. */

import { STRIPE_API_VERSION, StripeApiError, encodeForm, type FormValue } from '../worker/services/payments/stripe-client';

const STRIPE_API = 'https://api.stripe.com/v1';

export type StripeMode = 'test' | 'live';

/** Keys starting sk_test_ or rk_test_ belong to Stripe's test mode; any other key is live. */
export function modeOfKey(secretKey: string): StripeMode {
	return secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_') ? 'test' : 'live';
}

export type StripeCall = <T>(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, FormValue>, idempotencyKey?: string) => Promise<T>;

/**
 * Form-encoded calls with the pinned API version; a GET sends its params in the query string, and a write may carry an
 * idempotency key. A Stripe error answer becomes a StripeApiError.
 */
export function stripeCaller(secretKey: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): StripeCall {
	return async <T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, FormValue> = {}, idempotencyKey?: string): Promise<T> => {
		const body = encodeForm(params);
		const headers: Record<string, string> = {
			Authorization: `Bearer ${secretKey}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'Stripe-Version': STRIPE_API_VERSION,
		};
		if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
		const response = await fetchImpl(method === 'GET' && body ? `${STRIPE_API}${path}?${body}` : `${STRIPE_API}${path}`, {
			method,
			headers,
			body: method === 'POST' ? body : undefined,
		});
		const json: unknown = await response.json();
		if (!response.ok) {
			const error = (json as { error?: { message?: string; type?: string; code?: string } }).error;
			throw new StripeApiError(error?.message ?? 'Stripe request failed', response.status, error?.code ?? null, error?.type ?? null);
		}
		return json as T;
	};
}
