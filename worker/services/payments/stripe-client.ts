/**
 * Minimal Stripe REST client for Workers: form-encoded requests over fetch,
 * no SDK. Covers Connect Express onboarding, Checkout for paid sites, and Stripe Billing for plans and extra credits.
 */

import { CHECKOUT_KIND_CREDITS, EXTRA_CREDITS_DISCLOSURE, renewalDisclosure, type SubscriptionStatus } from '../../../shared/types/billing';
import { EXTRA_CREDITS, type PaidPlanId } from '../../../shared/types/plans';
import type { SellerReadiness } from '../../../shared/types/seller-setup';

const STRIPE_API = 'https://api.stripe.com/v1';

/** Stripe replays a failed request for 24 hours per idempotency key, so keys rotate every 10 minutes. */
export const IDEMPOTENCY_BUCKET_MS = 600_000;

/** A Checkout session closes 35 minutes after it opens, so a buyer can't pay long after the listing changed. Stripe's minimum is 30. */
const CHECKOUT_SESSION_TTL_SECONDS = 35 * 60;
/** Every request names its API version, so a new account default can't change what Stripe returns; Stripe.js on the
 * store checkout page loads the same version. */
export const STRIPE_API_VERSION = '2026-03-25.dahlia';

export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

/**
 * Every Checkout session charges in US dollars by card or a card wallet (Apple Pay, Google Pay): no prices in the
 * shopper's local currency, and no Link, which would also offer bank payments. Estori's fees assume Stripe's card rate.
 */
const USD_CARD_CHECKOUT: Record<string, FormValue> = {
	payment_method_types: ['card'],
	adaptive_pricing: { enabled: false },
	wallet_options: { link: { display: 'never' } },
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

export interface StripeCheckoutSession {
	id: string;
	/** Billing sessions: a subscription checkout, an extra-credits payment. */
	mode?: 'payment' | 'subscription' | 'setup';
	subscription?: string | null;
	customer?: string | null;
	url: string | null;
	/** Elements sessions: what Stripe.js on Estori's checkout page starts the payment form with. */
	client_secret?: string | null;
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
	id: string;
	metadata?: Record<string, string> | null;
	unit_amount?: number | null;
	lookup_key?: string | null;
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

export interface StripeInvoice {
	id: string;
	customer: string | null;
	amount_paid: number;
	currency: string;
	hosted_invoice_url: string | null;
	number: string | null;
	billing_reason: string | null;
	attempt_count?: number;
	parent: { type: string; subscription_details?: { subscription: string } | null } | null;
}

export interface StripeCharge {
	id: string;
	payment_intent: string | null;
	amount: number;
	amount_refunded: number;
}

export interface SubscriptionCheckoutInput {
	customerId: string;
	priceId: string;
	userId: string;
	plan: PaidPlanId;
	successUrl: string;
	cancelUrl: string;
	nowMs: number;
}

export interface CreditsCheckoutInput {
	customerId: string;
	priceId: string;
	userId: string;
	credits: number;
	successUrl: string;
	cancelUrl: string;
	nowMs: number;
	/**
	 * The caller's key: it must change once a purchase is recorded, or a second purchase of the same amount replays the paid
	 * session, and rotate with `idempotencyBucket(nowMs)`, which also sets the session's expiry.
	 */
	idempotencyKey: string;
}

export interface SubscriptionPriceChange {
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
	retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession>;
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
	/** The subscription with its schedule expanded. */
	retrieveSubscription(subscriptionId: string): Promise<StripeSubscription>;
	/** Moves to the price now, prorated and invoiced; Stripe refuses the change when the invoice can't be paid. */
	changeSubscriptionPrice(input: SubscriptionPriceChange): Promise<StripeSubscription>;
	/** Moves to the price at the renewal, keeping the subscription's discounts and charging no proration. */
	scheduleSubscriptionPrice(input: SubscriptionPriceChange): Promise<StripeSubscriptionSchedule>;
	/** Drops a pending plan change; a schedule already released counts as done. */
	releaseSubscriptionSchedule(scheduleId: string): Promise<void>;
	cancelAtPeriodEnd(subscriptionId: string, idempotencyKey: string): Promise<StripeSubscription>;
	resumeSubscription(subscription: StripeSubscription, idempotencyKey: string): Promise<StripeSubscription>;
	createBillingPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
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
		retrieveCheckoutSession: (sessionId) =>
			request<StripeCheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`),
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
					payment_method_types: ['card'],
					allow_promotion_codes: true,
					subscription_data: { metadata: { estori_user_id: input.userId } },
					metadata: { estori_user_id: input.userId, plan: input.plan },
					consent_collection: { terms_of_service: 'required' },
					custom_text: { submit: { message: renewalDisclosure(input.plan) } },
					success_url: input.successUrl,
					cancel_url: input.cancelUrl,
					expires_at: billingCheckoutExpiresAt(input.nowMs),
				},
				`billing-checkout-${input.userId}-${input.plan}-${idempotencyBucket(input.nowMs)}`,
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
					payment_method_types: ['card'],
					metadata,
					payment_intent_data: { metadata },
					custom_text: { submit: { message: EXTRA_CREDITS_DISCLOSURE } },
					success_url: input.successUrl,
					cancel_url: input.cancelUrl,
					expires_at: billingCheckoutExpiresAt(input.nowMs),
				},
				input.idempotencyKey,
			);
		},
		retrieveSubscription: (subscriptionId) =>
			request<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}?${encodeForm({ expand: ['schedule'] })}`),
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
		scheduleSubscriptionPrice: async ({ subscription, priceId, idempotencyKey }) => {
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
							duration: { interval: 'month', interval_count: 1 },
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
		createBillingPortalSession: ({ customerId, returnUrl }) =>
			request<{ url: string }>('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl }),
	};
}
