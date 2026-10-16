/**
 * Minimal Stripe REST client for Workers: form-encoded requests over fetch,
 * no SDK. Covers Connect Express onboarding and Checkout for paid sites.
 */

import type { SellerReadiness } from '../../../shared/types/seller-setup';

const STRIPE_API = 'https://api.stripe.com/v1';

/** Stripe replays a failed request for 24 hours per idempotency key, so keys rotate every 10 minutes. */
const IDEMPOTENCY_BUCKET_MS = 600_000;

/** A Checkout session closes 35 minutes after it opens, so a buyer can't pay long after the listing changed. Stripe's minimum is 30. */
const CHECKOUT_SESSION_TTL_SECONDS = 35 * 60;

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

const MISSING_ACCOUNT_CODES: readonly string[] = ['resource_missing', 'account_invalid'];

/** Stripe no longer has the account, or this key cannot reach it (for example after a switch from test to live keys). */
export function isMissingAccountError(error: unknown): boolean {
	return error instanceof StripeApiError && error.code !== null && MISSING_ACCOUNT_CODES.includes(error.code);
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

export interface StripeAddress {
	line1: string | null;
	line2: string | null;
	city: string | null;
	state: string | null;
	postal_code: string | null;
	country: string | null;
}

export interface StripeShippingDetails {
	name: string | null;
	address: StripeAddress | null;
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
	customer_details?: { email: string | null; name: string | null; phone: string | null } | null;
	/** Where Stripe puts the collected shipping address from API version 2025-03-31. */
	collected_information?: { shipping_details: StripeShippingDetails | null } | null;
	/** Where earlier API versions put it. */
	shipping_details?: StripeShippingDetails | null;
}

export interface StripeTransferSummary {
	id: string;
	amount: number;
	amount_reversed: number;
}

export interface StripePaymentIntent {
	id: string;
	/** Expanded on request: the charge, with the transfer that paid the seller on a destination charge. */
	latest_charge: { id: string; transfer: StripeTransferSummary | string | null } | string | null;
}

export interface StripeRefund {
	id: string;
	amount: number;
	status: string;
}

export interface StripeTransferReversal {
	id: string;
	amount: number;
}

export interface CheckoutSessionInput {
	productName: string;
	priceCents: number;
	feeCents: number;
	destinationAccountId: string;
	buyerUserId: string;
	buyerEmail?: string;
	successUrl: string;
	cancelUrl: string;
	metadata: Record<string, string>;
	nowMs: number;
}

export interface StoreCheckoutSessionInput {
	checkoutId: string;
	lines: readonly { name: string; quantity: number; unitPriceCents: number }[];
	shippingCents: number;
	/** The one country Checkout may ship to: catalog prices were locked for it. */
	shipToCountry: string;
	applicationFeeCents: number;
	sellerStripeAccountId: string;
	metadata: Record<string, string>;
	successUrl: string;
	cancelUrl: string;
	nowMs: number;
	/** The seller is the merchant of record (on_behalf_of); Stripe allows it only once their card payments are active. */
	sellerIsMerchant: boolean;
}

export interface SellerFlags {
	detailsSubmitted: boolean;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	transfersActive: boolean;
	cardPaymentsActive: boolean;
}

export interface StripeClient {
	createExpressAccount(input: { email?: string; userId: string; nowMs: number }): Promise<StripeAccount>;
	retrieveAccount(accountId: string): Promise<StripeAccount>;
	createAccountLink(input: { accountId: string; refreshUrl: string; returnUrl: string }): Promise<StripeAccountLink>;
	createLoginLink(accountId: string): Promise<StripeLoginLink>;
	createCheckoutSession(input: CheckoutSessionInput): Promise<StripeCheckoutSession>;
	createStoreCheckoutSession(input: StoreCheckoutSessionInput): Promise<StripeCheckoutSession>;
	retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession>;
	retrievePaymentIntent(paymentIntentId: string): Promise<StripePaymentIntent>;
	createRefund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<StripeRefund>;
	createTransferReversal(input: { transferId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<StripeTransferReversal>;
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
		cardPaymentsActive: account.capabilities?.card_payments === 'active',
	};
}

/** The seller's readiness to take store payments, from their stored or fresh flags; null flags mean no Connect account. */
export function sellerReadiness(flags: SellerFlags | null, termsAccepted: boolean): SellerReadiness {
	return {
		termsAccepted,
		connected: flags !== null,
		detailsSubmitted: flags?.detailsSubmitted ?? false,
		cardPaymentsActive: flags?.cardPaymentsActive ?? false,
		transfersActive: flags?.transfersActive ?? false,
		payoutsEnabled: flags?.payoutsEnabled ?? false,
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
		// One key per user and time bucket: a double click makes one account, a later retry is not served a cached error. An empty email is left out.
		createExpressAccount: ({ email, userId, nowMs }) =>
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
				`connect-account-${userId}-${Math.floor(nowMs / IDEMPOTENCY_BUCKET_MS)}`,
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
				// Stripe rejects an empty customer_email, so a buyer without one is left out.
				customer_email: input.buyerEmail || undefined,
				metadata: input.metadata,
				success_url: input.successUrl,
				cancel_url: input.cancelUrl,
				expires_at: Math.floor(input.nowMs / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
			}),
		// The seller is the merchant of record (on_behalf_of); a retried start reuses the session through its key.
		createStoreCheckoutSession: (input) =>
			request<StripeCheckoutSession>(
				'POST',
				'/checkout/sessions',
				{
					mode: 'payment',
					line_items: input.lines.map((line) => ({
						quantity: line.quantity,
						price_data: { currency: 'usd', unit_amount: line.unitPriceCents, product_data: { name: line.name } },
					})),
					shipping_address_collection: { allowed_countries: [input.shipToCountry] },
					shipping_options: [
						{
							shipping_rate_data: {
								type: 'fixed_amount',
								display_name: input.shippingCents === 0 ? 'Free shipping' : 'Shipping',
								fixed_amount: { amount: input.shippingCents, currency: 'usd' },
							},
						},
					],
					payment_method_types: ['card'],
					payment_intent_data: {
						application_fee_amount: input.applicationFeeCents,
						on_behalf_of: input.sellerIsMerchant ? input.sellerStripeAccountId : undefined,
						transfer_data: { destination: input.sellerStripeAccountId },
						metadata: input.metadata,
					},
					metadata: input.metadata,
					client_reference_id: input.checkoutId,
					success_url: input.successUrl,
					cancel_url: input.cancelUrl,
					expires_at: Math.floor(input.nowMs / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
				},
				`store-checkout-${input.checkoutId}`,
			),
		retrieveCheckoutSession: (sessionId) =>
			request<StripeCheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`),
		retrievePaymentIntent: (paymentIntentId) =>
			request<StripePaymentIntent>('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}?${encodeForm({ expand: ['latest_charge.transfer'] })}`),
		// Catalog refunds carry stable idempotency keys, so a retried refund is never paid twice.
		createRefund: (input) =>
			request<StripeRefund>(
				'POST',
				'/refunds',
				{ payment_intent: input.paymentIntentId, amount: input.amountCents, metadata: input.metadata },
				input.idempotencyKey,
			),
		createTransferReversal: (input) =>
			request<StripeTransferReversal>(
				'POST',
				`/transfers/${encodeURIComponent(input.transferId)}/reversals`,
				{ amount: input.amountCents, metadata: input.metadata },
				input.idempotencyKey,
			),
	};
}
