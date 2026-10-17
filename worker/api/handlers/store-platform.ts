/**
 * The platform's paths on a store's address (`/__estori/*`): the store script, store data, checkout, the return from
 * Stripe and receipts. They are answered here, before SpaceDO, so generated code never handles payments.
 */

import { STORE_CHECKOUT_MESSAGES, STORE_PLATFORM_PREFIX, type StoreCheckoutRefusal, type StoreMode } from '../../../shared/types/store-payments';
import { createLogger } from '../../logger';
import { SellerTermsService, StoreCheckoutService, StoreOrderService, StripeConnectService } from '../../database';
import { AppService } from '../../database/services/AppService';
import { stripeFromEnv, stripeModeOf } from '../../services/payments/config';
import { accountFlags, sellerReadiness, type StripeClient } from '../../services/payments/stripe-client';
import { sellerSetupStep, type SellerReadiness } from '../../../shared/types/seller-setup';
import { lockCatalogPricesFor } from '../../services/store-payments/catalog-locks';
import { checkoutModeOf, refusal, startStoreCheckout, storeInfoOf } from '../../services/store-payments/checkout';
import { safeReturnPath } from '../../services/store-payments/request';
import { recordStoreOrder } from '../../services/store-payments/fulfill';
import { parseStoreManifest } from '../../services/store-payments/manifest';
import { addReceiptOrder, readReceiptCookie, receiptAllows, receiptCookieHeader, receiptOf, signReceipt, verifyReceipt } from '../../services/store-payments/receipts';
import { STORE_SCRIPT } from '../../services/store-payments/store-script';
import { payPageHeaders, renderPayPage } from '../../services/store-payments/pay-page';
import { getProtocolForHost } from '../../utils/urls';
import { returnPageRecordDeps } from '../../services/store-payments/wiring';
import { PUBLIC_PREVIEW_SUBJECT } from '../../utils/spacePreviewToken';
import { getSellerLimitsSettings } from '../../config';
import { limitsFor, type SellerLevelLimits } from '../../../shared/types/seller-levels';
import { platformAlertsFromEnv } from '../../services/alerts/platform-alerts';
import { sellerNoticesFromEnv } from '../../services/alerts/seller-notices';

const logger = createLogger('StorePlatform');

const PREVIEW_PATH = /^(\/space\/[^/]+\/preview\/[^/]+)(\/.*)?$/;
const MAX_BODY_BYTES = 16 * 1024;
/** Stored seller flags this old are refreshed from Stripe before a checkout. */
const SELLER_FLAGS_MAX_AGE_MS = 10 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const REFUSAL_STATUS: Readonly<Record<StoreCheckoutRefusal, number>> = {
	payments_unavailable: 409,
	demo_only: 403,
	invalid_request: 400,
	unknown_item: 409,
	item_unavailable: 409,
	ships_to_unsupported: 409,
	below_minimum_price: 409,
	cart_limits: 400,
	order_over_limit: 409,
	store_paused: 409,
	stripe_failed: 502,
};

export interface StorePlatformTarget {
	appId: string;
	branch: string;
	/** `/space/<appId>/preview/<branch>`, as the request spelled it. */
	basePath: string;
	/** Decoded and lower-cased, starting with `/__estori`. */
	platformPath: string;
	/** Who is looking: a preview's token subject (the owner's user id, or the public subject), or a live store's shopper. */
	viewer: StoreViewer;
}

/** A preview is seen by its token's subject; a live store by any shopper, and its sales are its owner's. */
export type StoreViewer = { kind: 'preview'; userId: string } | { kind: 'live'; sellerUserId: string };

/** Whose sales the store's are: the app's owner on a live store, the preview token's subject on a preview. */
function sellerIdOf(target: StorePlatformTarget): string {
	return target.viewer.kind === 'live' ? target.viewer.sellerUserId : target.viewer.userId;
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

function isPlatformPath(path: string): boolean {
	return path === STORE_PLATFORM_PREFIX || path.startsWith(`${STORE_PLATFORM_PREFIX}/`);
}

export function matchStorePlatformPath(pathname: string): { basePath: string; platformPath: string } | null {
	const match = pathname.match(PREVIEW_PATH);
	if (!match) return null;
	const rest = normalizedPath(match[2] ?? '/');
	return isPlatformPath(rest) ? { basePath: match[1], platformPath: rest } : null;
}

/** On a live store's own address, Estori's paths sit at the root. */
export function matchLivePlatformPath(pathname: string): { basePath: string; platformPath: string } | null {
	const rest = normalizedPath(pathname);
	return isPlatformPath(rest) ? { basePath: '', platformPath: rest } : null;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** Any shopper may pay on a live store; on a preview only its owner, in test mode; anyone else sees a demo. */
async function storeAccess(env: Env, target: StorePlatformTarget): Promise<'owner' | 'public' | 'live'> {
	if (target.viewer.kind === 'live') return 'live';
	if (target.viewer.userId === PUBLIC_PREVIEW_SUBJECT) return 'public';
	const ownership = await new AppService(env).checkAppOwnership(target.appId, target.viewer.userId);
	return ownership.isOwner ? 'owner' : 'public';
}

async function loadManifest(env: Env, target: StorePlatformTarget): Promise<{ commitHash: string; text: string } | null> {
	const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
	if (!namespace) return null;
	const stub = namespace.get(namespace.idFromName(target.appId)) as unknown as StoreManifestStub;
	const deployed = await stub.getStoreManifest(target.branch);
	return deployed?.manifest ? { commitHash: deployed.commitHash, text: deployed.manifest } : null;
}

/**
 * The seller's Connect account and payments readiness. Checkout reads the account live from Stripe, and rewrites stored
 * flags older than the freshness window; the store's info, which runs on every page load, reads the stored flags only.
 */
async function sellerAccount(env: Env, userId: string, stripe: StripeClient | null): Promise<{ stripeAccountId: string; readiness: SellerReadiness } | null> {
	const accounts = new StripeConnectService(env);
	const stored = await accounts.getByUser(userId);
	if (!stored) return null;
	const termsAccepted = await new SellerTermsService(env).hasAccepted(userId);
	if (!stripe) return { stripeAccountId: stored.stripeAccountId, readiness: sellerReadiness(stored, termsAccepted) };
	const account = await accounts.forgetIfMissing(stored, (accountId) => stripe.retrieveAccount(accountId));
	if (!account) return null;
	const fresh = accountFlags(account);
	// A row with no update time, or one older than the freshness window, is rewritten with what Stripe says now.
	if (Date.now() - (stored.updatedAt?.getTime() ?? 0) > SELLER_FLAGS_MAX_AGE_MS) await accounts.updateFlags(stored.stripeAccountId, fresh);
	return { stripeAccountId: stored.stripeAccountId, readiness: sellerReadiness(fresh, termsAccepted) };
}

/** The mode this viewer's checkout would take, or null when this store can't take payments for them. */
async function checkoutModeFor(env: Env, target: StorePlatformTarget): Promise<{ access: 'owner' | 'public' | 'live'; mode: StoreMode | null }> {
	const access = await storeAccess(env, target);
	return { access, mode: checkoutModeOf({ access, stripeMode: stripeModeOf(env), livePayments: livePaymentsOn(env) }) };
}

function livePaymentsOn(env: Env): boolean {
	return env.LIVE_STORE_PAYMENTS === 'on';
}

async function serveStoreInfo(env: Env, target: StorePlatformTarget): Promise<Response> {
	const file = await loadManifest(env, target);
	const parsed = file ? parseStoreManifest(file.text) : null;
	if (!parsed?.ok) return json({ error: 'This store has no valid estori-store.json' }, 404);
	const { mode } = await checkoutModeFor(env, target);
	const seller = mode ? await sellerAccount(env, sellerIdOf(target), null) : null;
	return json(storeInfoOf(parsed.manifest, seller !== null && sellerSetupStep(seller.readiness) === null, mode ?? 'test'));
}

/** Estori's checkout page: the store's brand and products from its file, and a fresh nonce for the page's own script. */
async function servePayPage(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const file = await loadManifest(env, target);
	const parsed = file ? parseStoreManifest(file.text) : null;
	const { mode } = await checkoutModeFor(env, target);
	const seller = parsed?.ok && mode ? await sellerAccount(env, sellerIdOf(target), null) : null;
	const info = parsed?.ok ? storeInfoOf(parsed.manifest, seller !== null && sellerSetupStep(seller.readiness) === null, mode ?? 'test') : null;
	const query = new URL(request.url).searchParams;
	const returnPaths = { successPath: safeReturnPath(query.get('success'), '/'), cancelPath: safeReturnPath(query.get('cancel'), '/') };
	const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
	const appOrigin = env.CUSTOM_DOMAIN ? `${getProtocolForHost(env.CUSTOM_DOMAIN)}://${env.CUSTOM_DOMAIN}` : null;
	const html = renderPayPage({ basePath: target.basePath, publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null, info, nonce, returnPaths });
	return new Response(html, { headers: payPageHeaders(nonce, appOrigin) });
}

/** The seller's limits: an admin's pin wins over the stored level, which Estori keeps current. */
async function sellerLimitsOf(env: Env, sellerUserId: string): Promise<SellerLevelLimits> {
	const settings = await getSellerLimitsSettings(env, sellerUserId);
	const level = settings.pinnedLevel ?? (await new StripeConnectService(env).getByUser(sellerUserId))?.sellerLevel ?? 'new';
	return limitsFor(level, settings);
}

async function serveCheckout(request: Request, env: Env, target: StorePlatformTarget, ctx: ExecutionContext): Promise<Response> {
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
			sellerAccount: () => sellerAccount(env, sellerIdOf(target), stripe),
			lockCatalogPrices: (ids, country) => lockCatalogPricesFor(env, ids, country),
			saveCheckout: (checkout) => checkouts.create(checkout),
			createSession: async (input) => {
				if (!stripe) throw new Error('Stripe is not configured');
				const session = await stripe.createStoreCheckoutSession(input);
				return { id: session.id, clientSecret: session.client_secret ?? null };
			},
			replaceCheckout: async (checkoutId) => {
				const replaced = await checkouts.replaceOpen(checkoutId, target.appId);
				if (replaced?.sessionId && stripe) await stripe.expireCheckoutSession(replaced.sessionId);
			},
			attachSession: (checkoutId, sessionId) => checkouts.attachSession(checkoutId, sessionId),
			markFailed: (checkoutId) => checkouts.markFailed(checkoutId),
			sellerLimits: () => sellerLimitsOf(env, sellerIdOf(target)),
			weeklyUsage: (mode) => checkouts.weeklyUsage(sellerIdOf(target), mode, new Date(Date.now() - WEEK_MS)),
			// The shopper is answered at once; the alert and the seller's email go out after.
			limitReached: async (weeklySalesCents) => {
				ctx.waitUntil(
					(async () => {
						await platformAlertsFromEnv(env)({ kind: 'seller-limit-reached', subject: sellerIdOf(target), message: `A store reached its weekly limit of $${(weeklySalesCents / 100).toFixed(2)}.` });
						await sellerNoticesFromEnv(env)({ sellerUserId: sellerIdOf(target), kind: 'limit-reached', weeklySalesCents });
					})(),
				);
			},
			newCheckoutId: () => `chk_${crypto.randomUUID().replace(/-/g, '')}`,
			nowMs: () => Date.now(),
		},
		{
			access: await storeAccess(env, target),
			stripeMode: stripeModeOf(env),
			livePayments: livePaymentsOn(env),
			appId: target.appId,
			sellerUserId: sellerIdOf(target),
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
		const recorded = await recordStoreOrder(returnPageRecordDeps(env), session);
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

export async function handleStorePlatform(request: Request, env: Env, target: StorePlatformTarget, ctx: ExecutionContext): Promise<Response> {
	const path = target.platformPath;
	try {
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/store.js`) {
			return new Response(STORE_SCRIPT, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
		}
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/store`) return await serveStoreInfo(env, target);
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/pay`) return await servePayPage(request, env, target);
		if (request.method === 'POST' && path === `${STORE_PLATFORM_PREFIX}/checkout`) return await serveCheckout(request, env, target, ctx);
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/return`) return await serveReturn(request, env, target);
		const receipt = path.match(/^\/__estori\/orders\/(ord_[a-z0-9]{1,64})$/);
		if (request.method === 'GET' && receipt) return await serveReceipt(request, env, target, receipt[1]);
		return json({ error: 'Not found' }, 404);
	} catch (error) {
		logger.error('Store platform request failed', { appId: target.appId, path, error });
		return path === `${STORE_PLATFORM_PREFIX}/checkout` ? json(refusal('stripe_failed'), 502) : json({ error: STORE_CHECKOUT_MESSAGES.payments_unavailable }, 500);
	}
}
