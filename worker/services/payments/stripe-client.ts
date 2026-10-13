/**
 * Minimal Stripe REST client for Workers: form-encoded requests over fetch,
 * no SDK. Covers Connect Express onboarding and Checkout for paid sites.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

export class StripeApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string | null,
		readonly type: string | null,
	) {
		super(message);
		this.name = 'StripeApiError';
	}
}

export interface StripeAccount {
	id: string;
	details_submitted: boolean;
	charges_enabled: boolean;
	payouts_enabled: boolean;
	capabilities?: { transfers?: string; card_payments?: string };
}

export interface StripeAccountLink {
	url: string;
	expires_at: number;
}

export interface StripeLoginLink {
	url: string;
}

export interface StripeCheckoutSession {
	id: string;
	url: string | null;
	payment_status: 'paid' | 'unpaid' | 'no_payment_required';
	status: 'open' | 'complete' | 'expired' | null;
	client_reference_id: string | null;
	metadata: Record<string, string> | null;
	amount_total: number | null;
	currency: string | null;
	payment_intent: string | null;
}

export interface CheckoutSessionInput {
	productName: string;
	priceCents: number;
	feeCents: number;
	destinationAccountId: string;
	buyerUserId: string;
	buyerEmail: string;
	successUrl: string;
	cancelUrl: string;
	metadata: Record<string, string>;
}

export interface SellerFlags {
	detailsSubmitted: boolean;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	transfersActive: boolean;
}

export interface StripeClient {
	createExpressAccount(input: { email?: string; userId: string }): Promise<StripeAccount>;
	retrieveAccount(accountId: string): Promise<StripeAccount>;
	createAccountLink(input: { accountId: string; refreshUrl: string; returnUrl: string }): Promise<StripeAccountLink>;
	createLoginLink(accountId: string): Promise<StripeLoginLink>;
	createCheckoutSession(input: CheckoutSessionInput): Promise<StripeCheckoutSession>;
	retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession>;
}

/** Encode nested params the way Stripe expects: a[b][c]=v and a[0]=v; null and undefined are left out. */
export function encodeForm(params: Record<string, FormValue>): string {
	const pairs: string[] = [];
	const add = (key: string, value: FormValue): void => {
		if (value === undefined || value === null) return;
		if (Array.isArray(value)) {
			value.forEach((item, index) => add(`${key}[${index}]`, item));
			return;
		}
		if (typeof value === 'object') {
			for (const [child, childValue] of Object.entries(value)) add(`${key}[${child}]`, childValue);
			return;
		}
		pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
	};
	for (const [key, value] of Object.entries(params)) add(key, value);
	return pairs.join('&');
}

export function accountFlags(account: StripeAccount): SellerFlags {
	return {
		detailsSubmitted: account.details_submitted,
		chargesEnabled: account.charges_enabled,
		payoutsEnabled: account.payouts_enabled,
		transfersActive: account.capabilities?.transfers === 'active',
	};
}

interface StripeErrorBody {
	error?: { message?: string; type?: string; code?: string };
}

export function createStripeClient(secretKey: string, fetchImpl: typeof fetch = fetch): StripeClient {
	async function request<T>(
		method: 'GET' | 'POST',
		path: string,
		params?: Record<string, FormValue>,
		idempotencyKey?: string,
	): Promise<T> {
		const body = params ? encodeForm(params) : undefined;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${secretKey}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		};
		if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
		const response = await fetchImpl(`${STRIPE_API}${path}`, {
			method,
			headers,
			body: method === 'POST' ? body : undefined,
		});
		const json: unknown = await response.json();
		if (!response.ok) {
			const error = (json as StripeErrorBody).error;
			throw new StripeApiError(error?.message ?? 'Stripe request failed', response.status, error?.code ?? null, error?.type ?? null);
		}
		return json as T;
	}

	return {
		// The per-user key makes a double click create one account; an empty email is left out.
		createExpressAccount: ({ email, userId }) =>
			request<StripeAccount>(
				'POST',
				'/accounts',
				{
					type: 'express',
					country: 'US',
					email: email || undefined,
					capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
					metadata: { estoriUserId: userId },
				},
				`connect-account-${userId}`,
			),
		retrieveAccount: (accountId) => request<StripeAccount>('GET', `/accounts/${encodeURIComponent(accountId)}`),
		createAccountLink: ({ accountId, refreshUrl, returnUrl }) =>
			request<StripeAccountLink>('POST', '/account_links', {
				account: accountId,
				refresh_url: refreshUrl,
				return_url: returnUrl,
				type: 'account_onboarding',
			}),
		createLoginLink: (accountId) =>
			request<StripeLoginLink>('POST', `/accounts/${encodeURIComponent(accountId)}/login_links`),
		createCheckoutSession: (input) =>
			request<StripeCheckoutSession>('POST', '/checkout/sessions', {
				mode: 'payment',
				line_items: [
					{
						quantity: 1,
						price_data: { currency: 'usd', unit_amount: input.priceCents, product_data: { name: input.productName } },
					},
				],
				payment_intent_data: {
					application_fee_amount: input.feeCents,
					transfer_data: { destination: input.destinationAccountId },
					metadata: input.metadata,
				},
				client_reference_id: input.buyerUserId,
				customer_email: input.buyerEmail,
				metadata: input.metadata,
				success_url: input.successUrl,
				cancel_url: input.cancelUrl,
			}),
		retrieveCheckoutSession: (sessionId) =>
			request<StripeCheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`),
	};
}
