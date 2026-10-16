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
	type StoreInfo,
	type StoreManifest,
} from '../../../shared/types/store-payments';
import type { StoreCheckoutSessionInput } from '../payments/stripe-client';
import { parseStoreManifest } from './manifest';
import { priceCart, requestedCatalogVariantIds, type CatalogLock } from './pricing';
import { parseCheckoutRequest, safeReturnPath } from './request';
import type { StoreCheckoutRecord } from './store';

/** As long as template sales' sessions. */
const CHECKOUT_TTL_MS = 35 * 60 * 1000;

export interface StartCheckoutDeps {
	/** The deployed preview's `estori-store.json`, or null when it has none. */
	loadManifest(): Promise<{ commitHash: string; text: string } | null>;
	sellerAccount(): Promise<{ stripeAccountId: string; paymentsEnabled: boolean } | null>;
	lockCatalogPrices(catalogVariantIds: readonly string[], shipToCountry: string): Promise<readonly CatalogLock[]>;
	saveCheckout(checkout: StoreCheckoutRecord): Promise<void>;
	createSession(input: StoreCheckoutSessionInput): Promise<{ id: string; url: string | null }>;
	attachSession(checkoutId: string, sessionId: string): Promise<void>;
	markFailed(checkoutId: string): Promise<void>;
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
	return { mode: 'test', paymentsAvailable, currency: manifest.currency, shipping: manifest.shipping, products: manifest.products };
}

export async function startStoreCheckout(deps: StartCheckoutDeps, input: StartCheckoutInput): Promise<StoreCheckoutResponse> {
	if (input.access !== 'owner') return refusal('demo_only');
	if (input.stripeMode !== 'test') return refusal('payments_unavailable');
	const request = parseCheckoutRequest(input.body);
	if (!request) return refusal('invalid_request');

	const seller = await deps.sellerAccount();
	if (!seller?.paymentsEnabled) return refusal('payments_unavailable');
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
		createdAt: new Date(nowMs),
		expiresAt: new Date(nowMs + CHECKOUT_TTL_MS),
	});

	let session: { id: string; url: string | null };
	try {
		session = await deps.createSession({
			checkoutId,
			lines: cart.lines.map((line) => ({ name: line.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
			shippingCents: cart.shippingCents,
			shipToCountry: cart.shipToCountry,
			applicationFeeCents: priced.applicationFeeCents,
			sellerStripeAccountId: seller.stripeAccountId,
			metadata: { kind: STORE_ORDER_KIND, checkoutId, storeAppId: input.appId },
			successUrl: `${input.storeBaseUrl}${STORE_PLATFORM_PREFIX}/return?session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${input.storeBaseUrl}${cancelPath}`,
			nowMs,
		});
	} catch {
		await deps.markFailed(checkoutId);
		return refusal('stripe_failed');
	}
	if (!session.url) {
		await deps.markFailed(checkoutId);
		return refusal('stripe_failed');
	}
	await deps.attachSession(checkoutId, session.id);
	return { ok: true, checkoutUrl: session.url };
}
