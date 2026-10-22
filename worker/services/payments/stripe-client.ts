import type { BillingInterval } from '../../../shared/types/plans';
/**
 * Minimal Stripe REST client for Workers: form-encoded requests over fetch,
 * no SDK. Covers Connect Express onboarding, Checkout for paid sites, and Stripe Billing for plans, extra credits, cards and invoices.
 */

import { CHECKOUT_KIND_CARD, CHECKOUT_KIND_CREDITS, type CardSetupMode, type SubscriptionStatus } from '../../../shared/types/billing';
import { EXTRA_CREDITS, formatCredits, type PaidPlanId } from '../../../shared/types/plans';
import type { SellerReadiness } from '../../../shared/types/seller-setup';
import { STRIPE_API_VERSION } from '../../../shared/types/stripe';

const STRIPE_API = 'https://api.stripe.com/v1';

/** Stripe replays a failed request for 24 hours per idempotency key, so keys rotate every 10 minutes. */
export const IDEMPOTENCY_BUCKET_MS = 600_000;

/** A Checkout session closes 35 minutes after it opens, so a buyer can't pay long after the listing changed. Stripe's minimum is 30. */
const CHECKOUT_SESSION_TTL_SECONDS = 35 * 60;

export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

/** Cards only, and no Link, which would also offer bank payments and its own sign-up; billing's card setup takes this alone. */
const CARD_ONLY_CHECKOUT: Record<string, FormValue> = {
	payment_method_types: ['card'],
	wallet_options: { link: { display: 'never' } },
};

/**
 * Every Checkout session that charges does so in US dollars by card or a card wallet (Apple Pay, Google Pay; billing's
 * page hides those too): no prices in the buyer's local currency, and no Link. Estori's fees assume Stripe's card rate.
 */
const USD_CARD_CHECKOUT: Record<string, FormValue> = {
	...CARD_ONLY_CHECKOUT,
	adaptive_pricing: { enabled: false },
};

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

export interface StripeCoupon {
	id: string;
	duration: 'once' | 'repeating' | 'forever';
	/** Set only for a repeating coupon. */
	duration_in_months: number | null;
}

/** A promotion code. The coupon sits under `promotion` in the pinned API version, not on the code itself. */
export interface StripePromotionCode {
	id: string;
	promotion: { type: string; coupon: StripeCoupon | string | null };
}

/** What a billing session is read with: the discounts down to their coupons, and a card setup's SetupIntent. */
export const BILLING_CHECKOUT_EXPAND = ['discounts.coupon', 'discounts.promotion_code.promotion.coupon', 'setup_intent', 'line_items.data.price'] as const;

export interface StripeCheckoutSession {
	line_items?: { data: Array<{ quantity: number | null; price: StripePrice | null }> };
	id: string;
	/** Billing sessions: a subscription checkout, an extra-credits payment. */
	mode?: 'payment' | 'subscription' | 'setup';
	subscription?: string | null;
	customer?: string | null;
	/** The hosted page; null for an Elements session, which is paid on Estori's own page. */
	url: string | null;
	/** Elements sessions: what Stripe.js on Estori's checkout page starts the payment form with. */
	client_secret?: string | null;
	/** Unix seconds at which the session stops accepting payment. */
	expires_at?: number;
	/** What the session applied; each reference is an id, or the object when the request expanded it. */
	discounts?: Array<{ coupon?: StripeCoupon | string | null; promotion_code?: StripePromotionCode | string | null }> | null;
	/** A card setup session's SetupIntent: the id, or the object when the request expanded it. */
	setup_intent?: { id: string; payment_method: string | null } | string | null;
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
	status?: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded';
	/** Why the last confirmation failed; `code` is Stripe's error code, such as `card_declined` or `authentication_required`. */
	last_payment_error?: { code?: string | null } | null;
	/** What the Checkout session put on it; a store payment carries its kind and checkout id. */
	metadata?: Record<string, string> | null;
	/** Expanded on request: the charge, with the transfer that paid the seller and the balance transaction Stripe's fee is on. */
	latest_charge:
		| {
				id: string;
				transfer: StripeTransferSummary | string | null;
				balance_transaction?: { id: string; fee: number } | string | null;
				/** Radar's screening of the payment. */
				outcome?: { risk_level?: string } | null;
		  }
		| string
		| null;
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

/** A payment method as Stripe refers to it: its id, or the object when the request expanded it. */
export type StripePaymentMethodRef = string | { id: string };

export interface StripeCustomer {
	id: string;
	email: string | null;
	metadata: Record<string, string> | null;
	/** What the customer's invoices charge when the subscription names no payment method of its own. */
	invoice_settings?: { default_payment_method: StripePaymentMethodRef | null } | null;
}

export interface StripePrice {
	product?: string | { id: string };
	id: string;
	metadata?: Record<string, string> | null;
	unit_amount?: number | null;
	currency?: string;
	lookup_key?: string | null;
	recurring?: { interval: string; interval_count?: number } | null;
}

export interface StripeSubscriptionItem {
	id: string;
	price: StripePrice;
	current_period_start: number;
	current_period_end: number;
}

/** One discount on a schedule phase: Stripe sets exactly one of the three. */
export interface StripeDiscountRef {
	coupon: string | null;
	discount: string | null;
	promotion_code: string | null;
}

export interface StripeSchedulePhase {
	start_date: number;
	end_date: number | null;
	items: Array<{ price: string | StripePrice; quantity?: number }>;
	discounts?: StripeDiscountRef[];
}

export interface StripeSubscriptionSchedule {
	id: string;
	status: string;
	subscription: string | null;
	released_subscription?: string | null;
	current_phase: { start_date: number; end_date: number } | null;
	phases: StripeSchedulePhase[];
}

export interface StripeSubscription {
	id: string;
	customer: string;
	status: SubscriptionStatus;
	created: number;
	cancel_at_period_end: boolean;
	cancel_at: number | null;
	metadata: Record<string, string> | null;
	items: { data: StripeSubscriptionItem[] };
	/** The schedule's id, or the schedule itself when the request expanded it. */
	schedule: string | StripeSubscriptionSchedule | null;
	/** What the subscription's invoices charge; null falls back to the customer's default. */
	default_payment_method?: StripePaymentMethodRef | null;
}

export type StripeInvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

/** One payment toward an invoice. In the pinned API version this replaces the invoice's `payment_intent`. */
export interface StripeInvoicePayment {
	status: 'open' | 'paid' | 'canceled';
	payment: { type: 'charge' | 'payment_intent' | 'payment_record'; payment_intent?: string | null };
}

export interface StripeInvoice {
	id: string;
	customer: string | null;
	status: StripeInvoiceStatus;
	created: number;
	amount_due: number;
	amount_paid: number;
	total: number;
	currency: string;
	hosted_invoice_url: string | null;
	invoice_pdf: string | null;
	number: string | null;
	description: string | null;
	/** `amount` is in cents, negative for a credit such as a plan change's unused time. */
	lines?: { data: Array<{ description: string | null; amount: number }> };
	billing_reason: string | null;
	attempt_count?: number;
	parent: { type: string; subscription_details?: { subscription: string } | null } | null;
	/** Only when the request expanded it: the client secret of the PaymentIntent that collects this invoice, which Stripe.js confirms. */
	confirmation_secret?: { client_secret: string; type: string } | null;
	/** Only when the request expanded it: the invoice's payments, each with its PaymentIntent's id. */
	payments?: { data: StripeInvoicePayment[] } | null;
}

export interface StripePaymentMethod {
	id: string;
	card: { brand: string; last4: string; exp_month: number; exp_year: number } | null;
}

export interface StripeCharge {
	id: string;
	payment_intent: string | null;
	amount: number;
	amount_refunded: number;
}

/** A session Stripe closed before its key's bucket ended, which a new one replaces; see `replacementKey`. */
interface Replacing {
	replaces?: string | null;
}

export interface SubscriptionCheckoutInput extends Replacing {
	monthlyCredits?: number;
	billingInterval?: BillingInterval;
	customerId: string;
	priceId: string;
	userId: string;
	plan: PaidPlanId;
	/** Where Stripe sends the seller after paying on Estori's checkout page; `{CHECKOUT_SESSION_ID}` is filled in by Stripe. */
	returnUrl: string;
	nowMs: number;
}

export interface CreditsCheckoutInput extends Replacing {
	customerId: string;
	priceId: string;
	userId: string;
	credits: number;
	returnUrl: string;
	nowMs: number;
	/**
	 * The caller's key: it must change once a purchase is recorded, or a second purchase of the same amount replays the paid
	 * session, and rotate with `idempotencyBucket(nowMs)`, which also sets the session's expiry.
	 */
	idempotencyKey: string;
}

export interface CardSetupInput extends Replacing {
	customerId: string;
	userId: string;
	mode: CardSetupMode;
	/**
	 * The card Stripe charges when the setup starts: the subscription's own default, else the customer's
	 * `invoice_settings.default_payment_method`. A finished setup changes it, so the next setup gets a new session instead
	 * of the finished one replayed, while a retry of an unfinished setup shares its session.
	 */
	afterCardId: string | null;
	returnUrl: string;
	nowMs: number;
}

export interface SubscriptionPriceChange {
	billingInterval?: BillingInterval;
	subscription: StripeSubscription;
	priceId: string;
	idempotencyKey: string;
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
	/** Where Stripe sends the shopper after paying on Estori's checkout page. */
	returnUrl: string;
	nowMs: number;
}

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

export interface PayoutSchedule {
	interval: 'daily' | 'weekly' | 'monthly';
	weeklyAnchor: Weekday | null;
	monthlyAnchor: number | null;
	/** Days a sale waits before payout; null leaves Stripe's current value. */
	delayDays: number | null;
}

interface StripeBalance {
	available: Array<{ amount: number; currency: string }>;
	pending: Array<{ amount: number; currency: string }>;
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
	/** Accounts made before store payments asked only for transfers; the next onboarding link collects what card payments need. */
	requestCardPayments(accountId: string): Promise<StripeAccount>;
	createAccountLink(input: { accountId: string; refreshUrl: string; returnUrl: string }): Promise<StripeAccountLink>;
	createLoginLink(accountId: string): Promise<StripeLoginLink>;
	createCheckoutSession(input: CheckoutSessionInput): Promise<StripeCheckoutSession>;
	createStoreCheckoutSession(input: StoreCheckoutSessionInput): Promise<StripeCheckoutSession>;
	/** `expand` names the objects to return in full, such as `BILLING_CHECKOUT_EXPAND`. */
	retrieveCheckoutSession(sessionId: string, expand?: readonly string[]): Promise<StripeCheckoutSession>;
	/** Closes an open session so it can't be paid; one already expired or completed counts as done. */
	expireCheckoutSession(sessionId: string): Promise<void>;
	retrievePaymentIntent(paymentIntentId: string): Promise<StripePaymentIntent>;
	createRefund(input: { paymentIntentId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<StripeRefund>;
	createTransferReversal(input: { transferId: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<StripeTransferReversal>;
	retrieveBalance(accountId: string): Promise<{ availableCents: number; pendingCents: number }>;
	createTransfer(input: { destination: string; amountCents: number; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string; amount: number }>;
	updatePayoutSchedule(accountId: string, schedule: PayoutSchedule): Promise<StripeAccount>;
	/** Only the payout delay, so payout days the seller chose stay as they are. */
	updatePayoutDelay(accountId: string, delayDays: number): Promise<StripeAccount>;
	createCustomer(input: { userId: string; email: string }): Promise<StripeCustomer>;
	retrieveCustomer(customerId: string): Promise<StripeCustomer>;
	/** Card only: renewals and Smart Retries charge the card on file, and bank methods would settle days later. */
	createSubscriptionCheckoutSession(input: SubscriptionCheckoutInput): Promise<StripeCheckoutSession>;
	createCreditsCheckoutSession(input: CreditsCheckoutInput): Promise<StripeCheckoutSession>;
	/** Saves a new card for the customer's invoices, on Estori's own page. */
	createCardSetupSession(input: CardSetupInput): Promise<StripeCheckoutSession>;
	/** The card the customer's next invoices are charged to, and the subscription's own when it has one. */
	setDefaultPaymentMethod(input: { customerId: string; subscriptionId: string | null; paymentMethodId: string; nowMs: number }): Promise<void>;
	/** Adds or replaces only the keys given; Stripe leaves the subscription's other metadata as it is. */
	updateSubscriptionMetadata(subscriptionId: string, metadata: Record<string, string>, idempotencyKey: string): Promise<void>;
	retrievePaymentMethod(id: string): Promise<StripePaymentMethod>;
	/** Newest first. */
	listInvoices(customerId: string, limit: number): Promise<StripeInvoice[]>;
	/** With `confirmation_secret` and `payments` expanded, so a payment that needs the seller's action can be finished in the browser. */
	retrieveInvoice(id: string): Promise<StripeInvoice>;
	/**
	 * Pays with the seller present, so the bank may ask them to authenticate. That answers 402 with code
	 * `invoice_payment_intent_requires_action`; the invoice's `confirmation_secret` then finishes the payment.
	 */
	payInvoice(id: string, paymentMethodId: string | null, idempotencyKey: string): Promise<StripeInvoice>;
	/** The PDF of an invoice, from its `invoice_pdf` address; the caller checks the response. */
	fetchInvoicePdf(url: string): Promise<Response>;
	/** The subscription with its schedule expanded. */
	retrieveSubscription(subscriptionId: string): Promise<StripeSubscription>;
	retrievePrice(priceId: string): Promise<StripePrice>;
 findPlanPrice(lookupKey: string): Promise<StripePrice | null>;
 createPlanPrice(input: { productId: string; plan: PaidPlanId; interval: BillingInterval; monthlyCredits: number; priceCents: number; lookupKey: string }): Promise<StripePrice>;
	/** Moves to the price now, prorated and invoiced; Stripe refuses the change when the invoice can't be paid. */
	changeSubscriptionPrice(input: SubscriptionPriceChange): Promise<StripeSubscription>;
	/** Moves to the price at the renewal, keeping the subscription's discounts and charging no proration. */
	scheduleSubscriptionPrice(input: SubscriptionPriceChange): Promise<StripeSubscriptionSchedule>;
	/** Drops a pending plan change; a schedule already released counts as done. */
	releaseSubscriptionSchedule(scheduleId: string): Promise<void>;
	cancelAtPeriodEnd(subscriptionId: string, idempotencyKey: string): Promise<StripeSubscription>;
	resumeSubscription(subscription: StripeSubscription, idempotencyKey: string): Promise<StripeSubscription>;
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

export function idempotencyBucket(nowMs: number): number {
	return Math.floor(nowMs / IDEMPOTENCY_BUCKET_MS);
}

/**
 * A plan or credits checkout closes 35 minutes after its key's bucket ends: every request under one key sends the same
 * expiry (Stripe refuses a key replayed with other parameters), and each session stays open 35 to 45 minutes.
 */
function billingCheckoutExpiresAt(nowMs: number): number {
	return (idempotencyBucket(nowMs) + 1) * (IDEMPOTENCY_BUCKET_MS / 1000) + CHECKOUT_SESSION_TTL_SECONDS;
}

/**
 * The key of a session made in place of `replaces`: Stripe replays a key's first session within its bucket, even one it
 * has since closed, so the new one is keyed on the closed one, and a repeat of the same start shares it.
 */
function replacementKey(key: string, replaces: string | null | undefined): string {
	return replaces ? `${key}-retry-${replaces}` : key;
}

function isStripeUrl(url: string): boolean {
	try {
		const { protocol, hostname } = new URL(url);
		return protocol === 'https:' && (hostname === 'stripe.com' || hostname.endsWith('.stripe.com'));
	} catch {
		return false;
	}
}

function priceIdOf(price: string | StripePrice): string {
	return typeof price === 'string' ? price : price.id;
}

/** A phase's discounts as a phase accepts them: an applied discount by id, else its coupon or promotion code. */
function phaseDiscounts(refs: readonly StripeDiscountRef[] | undefined): Array<Record<string, string>> | undefined {
	const mapped: Array<Record<string, string>> = [];
	for (const ref of refs ?? []) {
		if (ref.discount) mapped.push({ discount: ref.discount });
		else if (ref.coupon) mapped.push({ coupon: ref.coupon });
		else if (ref.promotion_code) mapped.push({ promotion_code: ref.promotion_code });
	}
	return mapped.length > 0 ? mapped : undefined;
}

export function createStripeClient(secretKey: string, fetchImpl: typeof fetch = fetch): StripeClient {
	async function request<T>(
		method: 'GET' | 'POST',
		path: string,
		params?: Record<string, FormValue>,
		idempotencyKey?: string,
		stripeAccount?: string,
	): Promise<T> {
		const body = params ? encodeForm(params) : undefined;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${secretKey}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'Stripe-Version': STRIPE_API_VERSION,
		};
		if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
		// Calls made as a connected account, such as reading a seller's balance.
		if (stripeAccount) headers['Stripe-Account'] = stripeAccount;
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

	/** Stripe's schedule for a subscription: the one it already has, or a new one that starts from the subscription. */
	async function scheduleFor(subscription: StripeSubscription, idempotencyKey: string): Promise<StripeSubscriptionSchedule> {
		const existing = typeof subscription.schedule === 'string' ? subscription.schedule : subscription.schedule?.id;
		if (existing) return request<StripeSubscriptionSchedule>('GET', `/subscription_schedules/${encodeURIComponent(existing)}`);
		return request<StripeSubscriptionSchedule>('POST', '/subscription_schedules', { from_subscription: subscription.id }, `${idempotencyKey}-create`);
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
		requestCardPayments: (accountId) =>
			request<StripeAccount>('POST', `/accounts/${encodeURIComponent(accountId)}`, { capabilities: { card_payments: { requested: true } } }),
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
				...USD_CARD_CHECKOUT,
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
					...USD_CARD_CHECKOUT,
					payment_intent_data: {
						application_fee_amount: input.applicationFeeCents,
						on_behalf_of: input.sellerStripeAccountId,
						transfer_data: { destination: input.sellerStripeAccountId },
						metadata: input.metadata,
					},
					metadata: input.metadata,
					client_reference_id: input.checkoutId,
					// Paid on Estori's own checkout page with Stripe Elements, so there is no hosted page to come back from.
					ui_mode: 'elements',
					return_url: input.returnUrl,
					expires_at: Math.floor(input.nowMs / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
				},
				`store-checkout-${input.checkoutId}`,
			),
		expireCheckoutSession: async (sessionId) => {
			try {
				await request<StripeCheckoutSession>('POST', `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`);
			} catch (error) {
				// Stripe refuses to expire a session that isn't open: it was already expired or paid.
				if (error instanceof StripeApiError && error.status === 400) return;
				throw error;
			}
		},
		retrieveCheckoutSession: (sessionId, expand) =>
			request<StripeCheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}${expand && expand.length > 0 ? `?${encodeForm({ expand: [...expand] })}` : ''}`),
		retrievePaymentIntent: (paymentIntentId) =>
			request<StripePaymentIntent>('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}?${encodeForm({ expand: ['latest_charge.transfer', 'latest_charge.balance_transaction'] })}`),
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
		retrieveBalance: async (accountId) => {
			const balance = await request<StripeBalance>('GET', '/balance', undefined, undefined, accountId);
			const usd = (entries: StripeBalance['available']) => entries.filter((entry) => entry.currency === 'usd').reduce((sum, entry) => sum + entry.amount, 0);
			return { availableCents: usd(balance.available), pendingCents: usd(balance.pending) };
		},
		createTransfer: (input) =>
			request<{ id: string; amount: number }>('POST', '/transfers', { destination: input.destination, amount: input.amountCents, currency: 'usd', metadata: input.metadata }, input.idempotencyKey),
		// The platform owns these accounts' losses, so it sets their payout timing and lets Stripe debit their bank when negative.
		updatePayoutDelay: (accountId, delayDays) =>
			request<StripeAccount>('POST', `/accounts/${encodeURIComponent(accountId)}`, { settings: { payouts: { schedule: { delay_days: delayDays } } } }),
		updatePayoutSchedule: (accountId, schedule) =>
			request<StripeAccount>('POST', `/accounts/${encodeURIComponent(accountId)}`, {
				settings: {
					payouts: {
						schedule: {
							interval: schedule.interval,
							weekly_anchor: schedule.interval === 'weekly' ? schedule.weeklyAnchor : undefined,
							monthly_anchor: schedule.interval === 'monthly' ? schedule.monthlyAnchor : undefined,
							delay_days: schedule.delayDays ?? undefined,
						},
						debit_negative_balances: true,
					},
				},
			}),
		// One customer per account: the key is stable, so a retried first purchase can't make a second.
		createCustomer: ({ userId, email }) =>
			request<StripeCustomer>('POST', '/customers', { email: email || undefined, metadata: { estori_user_id: userId } }, `billing-customer-${userId}`),
		retrieveCustomer: (customerId) => request<StripeCustomer>('GET', `/customers/${encodeURIComponent(customerId)}`),
		createSubscriptionCheckoutSession: (input) =>
			request<StripeCheckoutSession>(
				'POST',
				'/checkout/sessions',
				{
					mode: 'subscription',
					customer: input.customerId,
					client_reference_id: input.userId,
					line_items: [{ price: input.priceId, quantity: 1 }],
					...USD_CARD_CHECKOUT,
					allow_promotion_codes: true,
					subscription_data: { metadata: { estori_user_id: input.userId } },
					metadata: { estori_user_id: input.userId, plan: input.plan, ...(input.billingInterval === 'year' ? { billing_interval: 'year' } : {}), ...(input.monthlyCredits !== undefined ? { monthly_credits: String(input.monthlyCredits) } : {}) },
					// Paid on Estori's own checkout page; Estori records the seller's agreement to the renewal terms itself.
					ui_mode: 'elements',
					return_url: input.returnUrl,
					expires_at: billingCheckoutExpiresAt(input.nowMs),
				},
				replacementKey(`billing-checkout-${input.userId}-${input.plan}${input.billingInterval === 'year' ? '-year' : ''}${input.monthlyCredits !== undefined ? '-credits-' + input.monthlyCredits : ''}-${idempotencyBucket(input.nowMs)}`, input.replaces),
			),
		createCreditsCheckoutSession: (input) => {
			const metadata = { kind: CHECKOUT_KIND_CREDITS, estori_user_id: input.userId, credits: String(input.credits) };
			return request<StripeCheckoutSession>(
				'POST',
				'/checkout/sessions',
				{
					mode: 'payment',
					customer: input.customerId,
					client_reference_id: input.userId,
					line_items: [{ price: input.priceId, quantity: input.credits / EXTRA_CREDITS.creditsPerUnit }],
					...USD_CARD_CHECKOUT,
					metadata,
					payment_intent_data: { metadata },
					// The purchase's invoice is its receipt in billing history, which shows its description.
					invoice_creation: { enabled: true, invoice_data: { description: `${formatCredits(input.credits)} extra AI credits`, metadata } },
					ui_mode: 'elements',
					return_url: input.returnUrl,
					expires_at: billingCheckoutExpiresAt(input.nowMs),
				},
				replacementKey(input.idempotencyKey, input.replaces),
			);
		},
		// The session's metadata names the seller and whether a failed invoice is paid with the new card.
		createCardSetupSession: (input) =>
			request<StripeCheckoutSession>(
				'POST',
				'/checkout/sessions',
				{
					mode: 'setup',
					ui_mode: 'elements',
					customer: input.customerId,
					currency: 'usd',
					...CARD_ONLY_CHECKOUT,
					metadata: { kind: CHECKOUT_KIND_CARD, estori_user_id: input.userId, card_mode: input.mode },
					return_url: input.returnUrl,
					expires_at: billingCheckoutExpiresAt(input.nowMs),
				},
				replacementKey(`billing-card-${input.userId}-${input.mode}-${input.afterCardId ?? 'none'}-${idempotencyBucket(input.nowMs)}`, input.replaces),
			),
		// Each key names the payment method, which a card setup creates new every time, so a retry replays and a later change is
		// a new request. It rotates with the bucket, so a failure Stripe saved under it is retried in the next one.
		setDefaultPaymentMethod: async ({ customerId, subscriptionId, paymentMethodId, nowMs }) => {
			const bucket = idempotencyBucket(nowMs);
			await request<StripeCustomer>(
				'POST',
				`/customers/${encodeURIComponent(customerId)}`,
				{ invoice_settings: { default_payment_method: paymentMethodId } },
				`billing-default-card-${customerId}-${paymentMethodId}-${bucket}`,
			);
			if (subscriptionId === null) return;
			await request<StripeSubscription>(
				'POST',
				`/subscriptions/${encodeURIComponent(subscriptionId)}`,
				{ default_payment_method: paymentMethodId },
				`billing-default-card-${subscriptionId}-${paymentMethodId}-${bucket}`,
			);
		},
		updateSubscriptionMetadata: async (subscriptionId, metadata, idempotencyKey) => {
			await request<StripeSubscription>('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { metadata }, idempotencyKey);
		},
		retrievePaymentMethod: async (id) => {
			const method = await request<{ id: string; card?: StripePaymentMethod['card'] }>('GET', `/payment_methods/${encodeURIComponent(id)}`);
			const card = method.card ?? null;
			return { id: method.id, card: card && { brand: card.brand, last4: card.last4, exp_month: card.exp_month, exp_year: card.exp_year } };
		},
		listInvoices: async (customerId, limit) => {
			const invoices = await request<{ data: StripeInvoice[] }>('GET', `/invoices?${encodeForm({ customer: customerId, limit })}`);
			return invoices.data;
		},
		retrieveInvoice: (id) => request<StripeInvoice>('GET', `/invoices/${encodeURIComponent(id)}?${encodeForm({ expand: ['confirmation_secret', 'payments'] })}`),
		payInvoice: (id, paymentMethodId, idempotencyKey) =>
			request<StripeInvoice>('POST', `/invoices/${encodeURIComponent(id)}/pay`, { payment_method: paymentMethodId, off_session: false }, idempotencyKey),
		fetchInvoicePdf: async (url) => {
			// `invoice_pdf` is a signed address that needs no key, so none is sent, and a redirect carries nothing; it is still checked to be Stripe's.
			if (!isStripeUrl(url)) throw new Error('The invoice PDF is not on a Stripe address');
			return fetchImpl(url);
		},
  findPlanPrice: async (lookupKey) => {
   const found = await request<{ data: StripePrice[] }>('GET', `/prices?${encodeForm({ lookup_keys: [lookupKey], active: true, limit: 1 })}`);
   return found.data[0] ?? null;
  },
  createPlanPrice: (input) => request<StripePrice>('POST', '/prices', {
   product: input.productId, currency: 'usd', unit_amount: input.priceCents,
   recurring: { interval: input.interval }, lookup_key: input.lookupKey,
   metadata: { estori_plan: input.plan, estori_billing_interval: input.interval, estori_monthly_credits: String(input.monthlyCredits) },
  }, `billing-price-${input.lookupKey}`),
		retrievePrice: (priceId) => request<StripePrice>('GET', `/prices/${encodeURIComponent(priceId)}`),
		retrieveSubscription: (subscriptionId) =>
			request<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}?${encodeForm({ expand: ['schedule', 'schedule.phases.items.price'] })}`),
		changeSubscriptionPrice: async ({ subscription, priceId, idempotencyKey }) => {
			const item = subscription.items.data[0];
			if (!item) throw new Error(`Subscription ${subscription.id} has no items`);
			return request<StripeSubscription>(
				'POST',
				`/subscriptions/${encodeURIComponent(subscription.id)}`,
				{
					items: [{ id: item.id, price: priceId }],
					proration_behavior: 'always_invoice',
					payment_behavior: 'error_if_incomplete',
					expand: ['schedule'],
				},
				idempotencyKey,
			);
		},
		scheduleSubscriptionPrice: async ({ subscription, priceId, idempotencyKey, billingInterval = 'month' }) => {
			const schedule = await scheduleFor(subscription, idempotencyKey);
			const currentPhase = schedule.current_phase;
			const current = currentPhase && schedule.phases.find((phase) => phase.start_date === currentPhase.start_date);
			const currentItem = current?.items[0];
			if (!currentPhase || !current || !currentItem) throw new Error(`Schedule ${schedule.id} has no current phase`);
			const discounts = phaseDiscounts(current.discounts);
			return request<StripeSubscriptionSchedule>(
				'POST',
				`/subscription_schedules/${encodeURIComponent(schedule.id)}`,
				{
					end_behavior: 'release',
					proration_behavior: 'none',
					phases: [
						{
							items: [{ price: priceIdOf(currentItem.price), quantity: 1 }],
							start_date: currentPhase.start_date,
							end_date: currentPhase.end_date,
							discounts,
						},
						{
							items: [{ price: priceId, quantity: 1 }],
							duration: { interval: billingInterval, interval_count: 1 },
							proration_behavior: 'none',
							discounts,
						},
					],
				},
				`${idempotencyKey}-phases`,
			);
		},
		releaseSubscriptionSchedule: async (scheduleId) => {
			try {
				await request<StripeSubscriptionSchedule>('POST', `/subscription_schedules/${encodeURIComponent(scheduleId)}/release`);
			} catch (error) {
				// Stripe refuses to release a schedule that isn't active: it was already released, completed or canceled.
				if (error instanceof StripeApiError && error.status === 400) return;
				throw error;
			}
		},
		cancelAtPeriodEnd: (subscriptionId, idempotencyKey) =>
			request<StripeSubscription>('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: true }, idempotencyKey),
		// A subscription ends through cancel_at_period_end or through a cancel_at date; resuming clears whichever is set.
		resumeSubscription: (subscription, idempotencyKey) =>
			request<StripeSubscription>(
				'POST',
				`/subscriptions/${encodeURIComponent(subscription.id)}`,
				subscription.cancel_at !== null && !subscription.cancel_at_period_end ? { cancel_at: '' } : { cancel_at_period_end: false },
				idempotencyKey,
			),
	};
}
