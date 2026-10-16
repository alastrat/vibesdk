/**
 * The platform's paths on a store's address (`/__estori/*`): the store script, store data, checkout, the return from
 * Stripe and receipts. They are answered here, before SpaceDO, so generated code never handles payments.
 */

import { STORE_CHECKOUT_MESSAGES, STORE_PLATFORM_PREFIX, type StoreCheckoutRefusal } from '../../../shared/types/store-payments';
import { createLogger } from '../../logger';
import { StoreCheckoutService, StoreOrderService, StripeConnectService } from '../../database';
import { AppService } from '../../database/services/AppService';
import { stripeFromEnv } from '../../services/payments/config';
import { accountFlags, type StripeClient } from '../../services/payments/stripe-client';
import { lockCatalogPricesFor } from '../../services/store-payments/catalog-locks';
import { refusal, startStoreCheckout, storeInfoOf } from '../../services/store-payments/checkout';
import { recordStoreOrder } from '../../services/store-payments/fulfill';
import { parseStoreManifest } from '../../services/store-payments/manifest';
import { addReceiptOrder, readReceiptCookie, receiptAllows, receiptCookieHeader, receiptOf, signReceipt, verifyReceipt } from '../../services/store-payments/receipts';
import { STORE_SCRIPT } from '../../services/store-payments/store-script';
import { recordStoreOrderDeps } from '../../services/store-payments/wiring';
import { PUBLIC_PREVIEW_SUBJECT } from '../../utils/spacePreviewToken';

const logger = createLogger('StorePlatform');

const PREVIEW_PATH = /^(\/space\/[^/]+\/preview\/[^/]+)(\/.*)?$/;
const MAX_BODY_BYTES = 16 * 1024;
/** Stored seller flags this old are refreshed from Stripe before a checkout. */
const SELLER_FLAGS_MAX_AGE_MS = 10 * 60 * 1000;
const REFUSAL_STATUS: Readonly<Record<StoreCheckoutRefusal, number>> = {
	payments_unavailable: 409,
	demo_only: 403,
	invalid_request: 400,
	unknown_item: 409,
	item_unavailable: 409,
	ships_to_unsupported: 409,
	below_minimum_price: 409,
	cart_limits: 400,
	stripe_failed: 502,
};

export interface StorePlatformTarget {
	appId: string;
	branch: string;
	/** `/space/<appId>/preview/<branch>`, as the request spelled it. */
	basePath: string;
	/** Decoded and lower-cased, starting with `/__estori`. */
	platformPath: string;
	/** The preview token's subject: the owner's user id, or the public subject. */
	previewUserId: string;
}

interface StoreManifestStub extends DurableObjectStub {
	getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null>;
}

/** Decoded until stable and lower-cased, so no spelling of the prefix reaches the store. */
function normalizedPath(path: string): string {
	let current = path;
	for (let round = 0; round < 3; round++) {
		let decoded: string;
		try {
			decoded = decodeURIComponent(current);
		} catch {
			break;
		}
		if (decoded === current) break;
		current = decoded;
	}
	return current.toLowerCase();
}

export function matchStorePlatformPath(pathname: string): { basePath: string; platformPath: string } | null {
	const match = pathname.match(PREVIEW_PATH);
	if (!match) return null;
	const rest = normalizedPath(match[2] ?? '/');
	if (rest !== STORE_PLATFORM_PREFIX && !rest.startsWith(`${STORE_PLATFORM_PREFIX}/`)) return null;
	return { basePath: match[1], platformPath: rest };
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function stripeMode(env: Env): 'test' | 'live' | null {
	const key = env.STRIPE_SECRET_KEY;
	if (!key) return null;
	return key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'test' : 'live';
}

/** The owner's own preview takes test payments; any other viewer sees a demo. */
async function previewAccess(env: Env, target: StorePlatformTarget): Promise<'owner' | 'public'> {
	if (target.previewUserId === PUBLIC_PREVIEW_SUBJECT) return 'public';
	const ownership = await new AppService(env).checkAppOwnership(target.appId, target.previewUserId);
	return ownership.isOwner ? 'owner' : 'public';
}

async function loadManifest(env: Env, target: StorePlatformTarget): Promise<{ commitHash: string; text: string } | null> {
	const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
	if (!namespace) return null;
	const stub = namespace.get(namespace.idFromName(target.appId)) as unknown as StoreManifestStub;
	const deployed = await stub.getStoreManifest(target.branch);
	return deployed?.manifest ? { commitHash: deployed.commitHash, text: deployed.manifest } : null;
}

async function sellerAccount(env: Env, userId: string, stripe: StripeClient | null): Promise<{ stripeAccountId: string; paymentsEnabled: boolean } | null> {
	const accounts = new StripeConnectService(env);
	const stored = await accounts.getByUser(userId);
	if (!stored) return null;
	let flags = { chargesEnabled: stored.chargesEnabled, transfersActive: stored.transfersActive };
	// A row with no update time reads as stale.
	if (stripe && Date.now() - (stored.updatedAt?.getTime() ?? 0) > SELLER_FLAGS_MAX_AGE_MS) {
		const account = await accounts.forgetIfMissing(stored, (accountId) => stripe.retrieveAccount(accountId));
		if (!account) return null;
		const fresh = accountFlags(account);
		await accounts.updateFlags(stored.stripeAccountId, fresh);
		flags = fresh;
	}
	return { stripeAccountId: stored.stripeAccountId, paymentsEnabled: flags.chargesEnabled && flags.transfersActive };
}

async function serveStoreInfo(env: Env, target: StorePlatformTarget): Promise<Response> {
	const file = await loadManifest(env, target);
	const parsed = file ? parseStoreManifest(file.text) : null;
	if (!parsed?.ok) return json({ error: 'This store has no valid estori-store.json' }, 404);
	const access = await previewAccess(env, target);
	const seller = access === 'owner' && stripeMode(env) === 'test' ? await sellerAccount(env, target.previewUserId, null) : null;
	return json(storeInfoOf(parsed.manifest, seller?.paymentsEnabled === true));
}

async function serveCheckout(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const url = new URL(request.url);
	const sameOrigin = request.headers.get('Origin') === url.origin;
	const isJson = (request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json');
	if (!sameOrigin || !isJson) return json(refusal('invalid_request'), 400);
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return json(refusal('invalid_request'), 413);
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return json(refusal('invalid_request'), 400);
	}

	const stripe = stripeFromEnv(env);
	const checkouts = new StoreCheckoutService(env);
	const response = await startStoreCheckout(
		{
			loadManifest: () => loadManifest(env, target),
			sellerAccount: () => sellerAccount(env, target.previewUserId, stripe),
			lockCatalogPrices: (ids, country) => lockCatalogPricesFor(env, ids, country),
			saveCheckout: (checkout) => checkouts.create(checkout),
			createSession: (input) => {
				if (!stripe) throw new Error('Stripe is not configured');
				return stripe.createStoreCheckoutSession(input);
			},
			attachSession: (checkoutId, sessionId) => checkouts.attachSession(checkoutId, sessionId),
			markFailed: (checkoutId) => checkouts.markFailed(checkoutId),
			newCheckoutId: () => `chk_${crypto.randomUUID().replace(/-/g, '')}`,
			nowMs: () => Date.now(),
		},
		{
			access: await previewAccess(env, target),
			stripeMode: stripeMode(env),
			appId: target.appId,
			sellerUserId: target.previewUserId,
			body,
			storeBaseUrl: `${url.origin}${target.basePath}`,
		},
	);
	if (!response.ok) logger.info('Store checkout refused', { appId: target.appId, reason: response.reason });
	return json(response, response.ok ? 200 : REFUSAL_STATUS[response.reason]);
}

/** A shopper who just paid always lands back on the store; the webhook records the order if this page couldn't. */
async function serveReturn(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const url = new URL(request.url);
	const home = `${url.origin}${target.basePath}/`;
	const processing = (path: string): Response => Response.redirect(`${url.origin}${target.basePath}${path}${path.includes('?') ? '&' : '?'}status=processing`, 303);
	const sessionId = url.searchParams.get('session_id');
	const stripe = stripeFromEnv(env);
	if (!sessionId || !stripe) return Response.redirect(home, 303);
	let successPath = '/';
	try {
		const session = await stripe.retrieveCheckoutSession(sessionId);
		if (session.metadata?.storeAppId !== target.appId) return Response.redirect(home, 303);
		const recorded = await recordStoreOrder(recordStoreOrderDeps(env), session);
		if (recorded.result === 'not-ours') return Response.redirect(home, 303);
		successPath = recorded.checkout.successPath;
		if (recorded.result === 'not-paid') return processing(successPath);
		return await withReceipt(request, env, target, recorded.orderId, `${url.origin}${target.basePath}${successPath}`);
	} catch (error) {
		logger.error('Store return could not record the order; the webhook will', { appId: target.appId, sessionId, error });
		return processing(successPath);
	}
}

/** Redirects to the success page with the order id, adding the order to the shopper's receipt cookie. */
async function withReceipt(request: Request, env: Env, target: StorePlatformTarget, orderId: string, successUrl: string): Promise<Response> {
	const url = new URL(request.url);
	const join = successUrl.includes('?') ? '&' : '?';
	const claims = addReceiptOrder(await verifyReceipt(env, readReceiptCookie(request)), target.appId, orderId);
	const token = await signReceipt(env, claims);
	return new Response(null, {
		status: 303,
		headers: {
			Location: `${successUrl}${join}order=${encodeURIComponent(orderId)}`,
			'Set-Cookie': receiptCookieHeader(token, `${target.basePath}${STORE_PLATFORM_PREFIX}/`, url.protocol === 'https:'),
		},
	});
}

async function serveReceipt(request: Request, env: Env, target: StorePlatformTarget, orderId: string): Promise<Response> {
	const claims = await verifyReceipt(env, readReceiptCookie(request));
	if (!receiptAllows(claims, target.appId, orderId)) return json({ error: 'Order not found' }, 404);
	const order = await new StoreOrderService(env).getOrder(orderId);
	if (!order || order.appId !== target.appId) return json({ error: 'Order not found' }, 404);
	return json(receiptOf(order));
}

export async function handleStorePlatform(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const path = target.platformPath;
	try {
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/store.js`) {
			return new Response(STORE_SCRIPT, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
		}
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/store`) return await serveStoreInfo(env, target);
		if (request.method === 'POST' && path === `${STORE_PLATFORM_PREFIX}/checkout`) return await serveCheckout(request, env, target);
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/return`) return await serveReturn(request, env, target);
		const receipt = path.match(/^\/__estori\/orders\/(ord_[a-z0-9]{1,64})$/);
		if (request.method === 'GET' && receipt) return await serveReceipt(request, env, target, receipt[1]);
		return json({ error: 'Not found' }, 404);
	} catch (error) {
		logger.error('Store platform request failed', { appId: target.appId, path, error });
		return path === `${STORE_PLATFORM_PREFIX}/checkout` ? json(refusal('stripe_failed'), 502) : json({ error: STORE_CHECKOUT_MESSAGES.payments_unavailable }, 500);
	}
}
