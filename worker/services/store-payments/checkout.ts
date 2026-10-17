/**
 * Starts a store checkout: who may pay, the cart priced from Estori's own records, the checkout saved before Stripe
 * hears of it, and the Checkout session. Previews take Stripe test-mode payments only, and only from the app's owner.
 */

import {
	STORE_CHECKOUT_MESSAGES,
	STORE_ORDER_KIND,
	STORE_PLATFORM_PREFIX,
	type StoreCheckoutRefusal,
	type StoreCheckoutResponse,
	type PricedCart,
	type StoreCheckoutSummary,
	type StoreInfo,
	type StoreManifest,
	type StoreMode,
} from '../../../shared/types/store-payments';
import type { StoreCheckoutSessionInput } from '../payments/stripe-client';
import { parseStoreManifest } from './manifest';
import { priceCart, requestedCatalogVariantIds, type CatalogLock } from './pricing';
import { parseCheckoutRequest, safeReturnPath } from './request';
import type { StoreCheckoutRecord } from './store';
import { sellerSetupStep, type SellerReadiness } from '../../../shared/types/seller-setup';
import { weightedCartCents } from '../../../shared/types/seller-levels';

/** As long as template sales' sessions. */
const CHECKOUT_TTL_MS = 35 * 60 * 1000;

export interface StartCheckoutDeps {
	/** The deployed preview's `estori-store.json`, or null when it has none. */
	loadManifest(): Promise<{ commitHash: string; text: string } | null>;
	/** The seller's Stripe account and how far their payments setup has come; null when they never connected Stripe. */
	sellerAccount(): Promise<{ stripeAccountId: string; readiness: SellerReadiness } | null>;
	lockCatalogPrices(catalogVariantIds: readonly string[], shipToCountry: string): Promise<readonly CatalogLock[]>;
	saveCheckout(checkout: StoreCheckoutRecord): Promise<void>;
	/** The Elements session; its client secret starts Stripe's payment form on Estori's checkout page. */
	createSession(input: StoreCheckoutSessionInput): Promise<{ id: string; clientSecret: string | null }>;
	attachSession(checkoutId: string, sessionId: string): Promise<void>;
	markFailed(checkoutId: string): Promise<void>;
	/** The seller's largest order and weekly sales cap, from their level and any admin override. */
	sellerLimits(): Promise<{ largestOrderCents: number; weeklySalesCents: number }>;
	/** The weight of the seller's checkouts in this mode in the last 7 days that are paid or may still be. */
	weeklyUsage(mode: StoreMode): Promise<number>;
	/**
	 * Expires a checkout of this store that is still starting or open, and its Stripe session, so it stops counting toward
	 * the weekly cap. Any other checkout is left as it is.
	 */
	replaceCheckout(checkoutId: string): Promise<void>;
	/** Tells Estori and the seller that the store reached this weekly cap; may finish after the shopper is answered. */
	limitReached(weeklySalesCents: number): Promise<void>;
	newCheckoutId(): string;
	nowMs(): number;
}

export interface StartCheckoutInput {
	/** The owner's own preview, or one shown to anyone else. */
	access: 'owner' | 'public';
	/** From the platform's Stripe key; null when Stripe isn't configured. */
	stripeMode: 'test' | 'live' | null;
	appId: string;
	sellerUserId: string;
	body: unknown;
	/** The store's origin and base path, without a trailing slash. */
	storeBaseUrl: string;
}

export function refusal(reason: StoreCheckoutRefusal): StoreCheckoutResponse {
	return { ok: false, reason, message: STORE_CHECKOUT_MESSAGES[reason] };
}

export function storeInfoOf(manifest: StoreManifest, paymentsAvailable: boolean): StoreInfo {
	return { mode: 'test', paymentsAvailable, currency: manifest.currency, shipping: manifest.shipping, products: manifest.products, brand: manifest.brand ?? null };
}

export async function startStoreCheckout(deps: StartCheckoutDeps, input: StartCheckoutInput): Promise<StoreCheckoutResponse> {
	if (input.access !== 'owner') return refusal('demo_only');
	if (input.stripeMode !== 'test') return refusal('payments_unavailable');
	const request = parseCheckoutRequest(input.body);
	if (!request) return refusal('invalid_request');
	// The cart was edited, or the page reloaded: the earlier checkout goes first, so the cap counts only this one.
	if (request.replaces) await deps.replaceCheckout(request.replaces);

	const seller = await deps.sellerAccount();
	// The seller must be able to be the merchant of record, with a bank account Stripe can recover from.
	if (!seller || sellerSetupStep(seller.readiness) !== null) return refusal('payments_unavailable');
	const file = await deps.loadManifest();
	const parsed = file ? parseStoreManifest(file.text) : null;
	if (!file || !parsed?.ok) return refusal('payments_unavailable');

	const catalogVariantIds = requestedCatalogVariantIds(parsed.manifest, request);
	const locks = catalogVariantIds.length > 0 ? await deps.lockCatalogPrices(catalogVariantIds, request.shipTo) : [];
	const priced = priceCart({
		manifest: parsed.manifest,
		request,
		catalogLocks: new Map(locks.map((lock) => [lock.catalogVariantId, lock])),
		context: { mode: 'test', storeAppId: input.appId, storeVersionId: null, commitHash: file.commitHash, sellerStripeAccountId: seller.stripeAccountId },
	});
	if (!priced.ok) return refusal(priced.reason);

	const limits = await deps.sellerLimits();
	if (priced.cart.totalCents > limits.largestOrderCents) return refusal('order_over_limit');
	// Saved as creating before Stripe is called, so the next checkout's usage counts this one.
	const weightedCents = weightedCartCents(priced.cart);
	if ((await deps.weeklyUsage(priced.cart.mode)) + weightedCents > limits.weeklySalesCents) {
		await deps.limitReached(limits.weeklySalesCents);
		return refusal('store_paused');
	}

	const { cart } = priced;
	const checkoutId = deps.newCheckoutId();
	const nowMs = deps.nowMs();
	const cancelPath = safeReturnPath(request.cancelPath, '/');
	await deps.saveCheckout({
		id: checkoutId,
		mode: cart.mode,
		appId: input.appId,
		storeVersionId: null,
		commitHash: cart.commitHash,
		sellerUserId: input.sellerUserId,
		sellerStripeAccountId: seller.stripeAccountId,
		shipToCountry: cart.shipToCountry,
		pricedCart: cart,
		subtotalCents: cart.subtotalCents,
		shippingCents: cart.shippingCents,
		totalCents: cart.totalCents,
		applicationFeeCents: priced.applicationFeeCents,
		status: 'creating',
		successPath: safeReturnPath(request.successPath, '/'),
		cancelPath,
		note: request.note ?? null,
		weightedCents,
		createdAt: new Date(nowMs),
		expiresAt: new Date(nowMs + CHECKOUT_TTL_MS),
	});

	let session: { id: string; clientSecret: string | null };
	try {
		session = await deps.createSession({
			checkoutId,
			lines: cart.lines.map((line) => ({ name: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
			shippingCents: cart.shippingCents,
			shipToCountry: cart.shipToCountry,
			applicationFeeCents: priced.applicationFeeCents,
			sellerStripeAccountId: seller.stripeAccountId,
			metadata: { kind: STORE_ORDER_KIND, checkoutId, storeAppId: input.appId },
			returnUrl: `${input.storeBaseUrl}${STORE_PLATFORM_PREFIX}/return?session_id={CHECKOUT_SESSION_ID}`,
			nowMs,
		});
	} catch {
		await deps.markFailed(checkoutId);
		return refusal('stripe_failed');
	}
	if (!session.clientSecret) {
		await deps.markFailed(checkoutId);
		return refusal('stripe_failed');
	}
	await deps.attachSession(checkoutId, session.id);
	return { ok: true, checkoutId, clientSecret: session.clientSecret, summary: summaryOf(parsed.manifest, cart) };
}

/** The order as Estori priced it, with each line's product and variant names and image from the store's file. */
function summaryOf(manifest: StoreManifest, cart: PricedCart): StoreCheckoutSummary {
	const lines = cart.lines.map((line) => {
		const product = manifest.products.find((candidate) => candidate.id === line.productId);
		const variant = product?.variants.find((candidate) => candidate.id === line.variantId);
		return {
			variantId: line.variantId,
			productId: line.productId,
			name: product?.name ?? line.name,
			variantName: variant?.name ?? '',
			...(product?.image ? { image: product.image } : {}),
			quantity: line.quantity,
			unitPriceCents: line.unitPriceCents,
			lineTotalCents: line.unitPriceCents * line.quantity,
		};
	});
	return { currency: 'usd', shipTo: cart.shipToCountry, lines, subtotalCents: cart.subtotalCents, shippingCents: cart.shippingCents, totalCents: cart.totalCents };
}
