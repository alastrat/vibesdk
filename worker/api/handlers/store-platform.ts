import { t } from '../../services/i18n/request-locale';
/**
 * The platform's paths on a store's address (`/__estori/*`): the store script, store data, checkout, the return from
 * Stripe and receipts. They are answered here, before SpaceDO, so generated code never handles payments.
 */

import { STORE_CHECKOUT_MESSAGES, STORE_PLATFORM_PREFIX, type StoreCheckoutRefusal, type StoreCheckoutResponse, type StoreManifest, type StoreMode } from '../../../shared/types/store-payments';
import { isLocale } from '../../../shared/i18n/locales';
import { msg } from '../../../shared/i18n/translate';
import { createLogger } from '../../logger';
import { SellerTermsService, StoreCheckoutService, StoreOrderService, StripeConnectService } from '../../database';
import { AppService } from '../../database/services/AppService';
import { stripeFromEnv, stripeModeOf } from '../../services/payments/config';
import { accountFlags, sellerReadiness, type StripeClient } from '../../services/payments/stripe-client';
import { sellerSetupStep, type SellerReadiness } from '../../../shared/types/seller-setup';
import { lockCatalogPricesFor } from '../../services/store-payments/catalog-locks';
import { isFlagOn } from '../../services/posthog/flags';
import { checkoutModeOf, refusal, startStoreCheckout, storeInfoOf, type StartCheckoutInput } from '../../services/store-payments/checkout';
import { returnPathInLanguage, safeReturnPath } from '../../services/store-payments/request';
import { recordStoreOrder } from '../../services/store-payments/fulfill';
import { parseStoreManifest } from '../../services/store-payments/manifest';
import { addReceiptOrder, readReceiptCookie, receiptAllows, receiptCookieHeader, receiptOf, signReceipt, verifyReceipt } from '../../services/store-payments/receipts';
import { storeScript } from '../../services/store-payments/store-script';
import { payPageHeaders, renderPayPage } from '../../services/store-payments/pay-page';
import { getProtocolForHost } from '../../utils/urls';
import { translateFor } from '../../utils/server-translate';
import { returnPageRecordDeps } from '../../services/store-payments/wiring';
import { PUBLIC_PREVIEW_SUBJECT } from '../../utils/spacePreviewToken';
import { getGlobalConfigurableSettings, getSellerLimitsSettings } from '../../config';
import { limitsFor, type SellerLevelLimits } from '../../../shared/types/seller-levels';
import { platformAlertsFromEnv } from '../../services/alerts/platform-alerts';
import { sellerNoticesFromEnv } from '../../services/alerts/seller-notices';
import { RateLimitService } from '../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from '../../../shared/types/errors';
import { releaseOldestHolds } from '../../services/store-payments/holds';
import { replaceCheckout } from '../../services/store-payments/replace';
import { LiveStoreService } from '../../database/services/LiveStoreService';
import { plainPage } from './plain-page';
import { loadServingLanguages, shopperLanguage, shopperLocale, type ShopperLanguage } from '../../services/store-translations/serve-context';
import { STORE_LANGUAGE_PARAM } from '../../services/store-translations/language';
import { STORE_OVERLAY_PATH, translateManifest } from '../../services/store-translations/rewrite';
import { ProductAssetService } from '../../services/account-products/assets';
import { receiptDownloads, servePaidDownload, type DigitalDeliveryDeps } from '../../services/store-payments/digital-delivery';
import { overlayScript } from '../../services/store-translations/overlay-script';

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
	too_many_checkouts: 429,
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
	/** A live store taken offline: a shopper who already paid gets Estori's own pages, since the store's are closed. */
	closed?: boolean;
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
	return { access, mode: checkoutModeOf({ access, stripeMode: stripeModeOf(env), livePayments: await livePaymentsOn(env, access, sellerIdOf(target)) }) };
}

/**
 * Real payments need a live store's shopper, Stripe in live mode, Estori's switch on and live store payments not paused.
 * The pause flag is read only for a request that could take real money, so previews and test mode never ask PostHog.
 */
async function livePaymentsOn(env: Env, access: StartCheckoutInput['access'], sellerUserId: string): Promise<boolean> {
	if (access !== 'live' || stripeModeOf(env) !== 'live' || env.LIVE_STORE_PAYMENTS !== 'on') return false;
	return !(await isFlagOn(env, 'live-store-payments-paused', sellerUserId));
}

async function serveStoreInfo(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const file = await loadManifest(env, target);
	const parsed = file ? parseStoreManifest(file.text) : null;
	if (!parsed?.ok) return json({ error: 'This store has no valid estori-store.json' }, 404);
	const { mode } = await checkoutModeFor(env, target);
	const seller = mode ? await sellerAccount(env, sellerIdOf(target), null) : null;
	const { manifest, varies } = await manifestForShopper(await shopperLanguage(request, env, target.appId), target.appId, parsed.manifest);
	const response = json(storeInfoOf(manifest, seller !== null && sellerSetupStep(seller.readiness) === null, mode ?? 'test'));
	if (varies) response.headers.set('Vary', 'Cookie, Accept-Language');
	return response;
}

/**
 * The store's products in the shopper's language when the store has ready languages; `varies` says the answer depends
 * on the shopper. Prices and everything else are untouched, and a failure answers in the store's own words.
 */
async function manifestForShopper(language: ShopperLanguage, appId: string, manifest: StoreManifest): Promise<{ manifest: StoreManifest; varies: boolean }> {
	const { ctx, locale } = language;
	if (!ctx || ctx.ready.length === 0) return { manifest, varies: false };
	if (locale === ctx.settings.sourceLocale) return { manifest, varies: true };
	try {
		return { manifest: await translateManifest(manifest, await ctx.dictionary(locale)), varies: true };
	} catch (error) {
		logger.warn('Store products could not be translated; they are served as written', { appId, error });
		return { manifest, varies: false };
	}
}

/** A refusal worded in the shopper's language. */
async function refusedFor(request: Request, env: Env, target: StorePlatformTarget, reason: StoreCheckoutRefusal): Promise<StoreCheckoutResponse> {
	return refusal(reason, await shopperLocale(request, env, target.appId));
}

/**
 * `/__estori/i18n.js?lang=xx&v=n`: the overlay for a ready language, kept by browsers while `v` is the current version.
 * It is always a script: a failure answers an empty one, since the page itself is already translated.
 */
async function serveOverlayScript(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const query = new URL(request.url).searchParams;
	const headers = { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' };
	try {
		const ctx = await loadServingLanguages(env, target.appId);
		const locale = query.get(STORE_LANGUAGE_PARAM);
		if (!ctx || !isLocale(locale) || !ctx.ready.includes(locale)) return new Response('', { status: 404, headers });
		const current = query.get('v') === String(ctx.settings.version);
		const script = overlayScript(locale, await ctx.scriptEntries(locale));
		return new Response(script, { headers: { ...headers, 'Cache-Control': current ? 'public, max-age=31536000, immutable' : 'no-store' } });
	} catch (error) {
		logger.warn('The store overlay script could not be built', { appId: target.appId, error });
		return new Response('', { status: 503, headers });
	}
}

/** `store.js`, worded for the shopper's language; it knows the store's languages to follow the page's own. */
async function serveStoreScript(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const { locale, languages } = await shopperLanguage(request, env, target.appId);
	const script = storeScript(locale, languages);
	return new Response(script, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/**
 * Estori's checkout page: the store's brand and products from its file, in the shopper's language, and a fresh nonce
 * for the page's own script.
 */
async function servePayPage(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const file = await loadManifest(env, target);
	const parsed = file ? parseStoreManifest(file.text) : null;
	const { mode } = await checkoutModeFor(env, target);
	const seller = parsed?.ok && mode ? await sellerAccount(env, sellerIdOf(target), null) : null;
	const language = await shopperLanguage(request, env, target.appId);
	const manifest = parsed?.ok ? (await manifestForShopper(language, target.appId, parsed.manifest)).manifest : null;
	const info = manifest ? storeInfoOf(manifest, seller !== null && sellerSetupStep(seller.readiness) === null, mode ?? 'test') : null;
	const query = new URL(request.url).searchParams;
	// A page asked for in a language sends the shopper back, and on to the confirmation page, in it.
	const carried = (path: string): string => (language.languages.length > 1 && isLocale(query.get(STORE_LANGUAGE_PARAM)) ? returnPathInLanguage(path, language.locale) : path);
	const returnPaths = { successPath: carried(safeReturnPath(query.get('success'), '/')), cancelPath: carried(safeReturnPath(query.get('cancel'), '/')) };
	const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
	const appOrigin = env.CUSTOM_DOMAIN ? `${getProtocolForHost(env.CUSTOM_DOMAIN)}://${env.CUSTOM_DOMAIN}` : null;
	const html = renderPayPage({ basePath: target.basePath, publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null, info, nonce, returnPaths, locale: language.locale });
	return new Response(html, { headers: { ...payPageHeaders(nonce, appOrigin), 'Content-Language': language.locale } });
}

/** The seller's limits: an admin's pin wins over the stored level, which Estori keeps current. */
async function sellerLimitsOf(env: Env, sellerUserId: string): Promise<SellerLevelLimits> {
	const settings = await getSellerLimitsSettings(env, sellerUserId);
	const level = settings.pinnedLevel ?? (await new StripeConnectService(env).getByUser(sellerUserId))?.sellerLevel ?? 'new';
	return limitsFor(level, settings);
}

async function serveCheckout(request: Request, env: Env, target: StorePlatformTarget, ctx: ExecutionContext): Promise<Response> {
	const url = new URL(request.url);
	// A request refused before anything is read is answered in English, since the checkout page never sends one.
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

	if (target.viewer.kind === 'live') {
		if (await liveCheckoutLimited(env, request, target.appId)) return json(await refusedFor(request, env, target, 'too_many_checkouts'), 429);
		// The address cache can trail a Take offline by seconds; a new checkout reads the store's status itself.
		if ((await new LiveStoreService(env).getByApp(target.appId))?.status !== 'live') return json(await refusedFor(request, env, target, 'store_paused'), 409);
	}

	const access = await storeAccess(env, target);
	const stripe = stripeFromEnv(env);
	const checkouts = new StoreCheckoutService(env);
	const weekAgo = () => new Date(Date.now() - WEEK_MS);
	const response = await startStoreCheckout(
		{
			loadManifest: () => loadManifest(env, target),
			sellerAccount: () => sellerAccount(env, sellerIdOf(target), stripe),
			lockCatalogPrices: (ids, country) => lockCatalogPricesFor(env, ids, country, sellerIdOf(target)),
			saveCheckout: (checkout) => checkouts.create(checkout),
			createSession: async (input) => {
				if (!stripe) throw new Error('Stripe is not configured');
				const session = await stripe.createStoreCheckoutSession(input);
				return { id: session.id, clientSecret: session.client_secret ?? null };
			},
			replaceCheckout: (checkoutId) =>
				replaceCheckout(
					{
						openSession: (id) => checkouts.openSessionOf(id, target.appId),
						expireSession: async (sessionId) => {
							if (!stripe) throw new Error('Stripe is not configured');
							try {
								await stripe.expireCheckoutSession(sessionId);
							} catch (error) {
								logger.warn('A replaced checkout keeps its session: Stripe could not expire it', { appId: target.appId, sessionId, error });
								throw error;
							}
						},
						markReplaced: async (id) => {
							await checkouts.replaceOpen(id, target.appId);
						},
					},
					checkoutId,
				),
			attachSession: (checkoutId, sessionId) => checkouts.attachSession(checkoutId, sessionId),
			markFailed: (checkoutId) => checkouts.markFailed(checkoutId),
			sellerLimits: () => sellerLimitsOf(env, sellerIdOf(target)),
			weeklyUsage: (mode) => checkouts.weeklyUsage(sellerIdOf(target), mode, weekAgo()),
			releaseHolds: (mode, cents) =>
				releaseOldestHolds(
					{
						holds: () => checkouts.openHolds(sellerIdOf(target), mode, weekAgo()),
						expireSession: async (sessionId) => {
							if (!stripe) throw new Error('Stripe is not configured');
							await stripe.expireCheckoutSession(sessionId);
						},
						markExpired: (checkoutId) => checkouts.expire(checkoutId),
					},
					cents,
				),
			// The shopper is answered at once; the alert and the seller's email go out after.
			limitReached: async (weeklySalesCents) => {
				ctx.waitUntil(
					(async () => {
						await platformAlertsFromEnv(env)({ kind: 'seller-limit-reached', subject: sellerIdOf(target), message: t("A store reached its weekly limit of ${value1}.", { value1: (weeklySalesCents / 100).toFixed(2) }) });
						await sellerNoticesFromEnv(env)({ sellerUserId: sellerIdOf(target), kind: 'limit-reached', weeklySalesCents });
					})(),
				);
			},
			newCheckoutId: () => `chk_${crypto.randomUUID().replace(/-/g, '')}`,
			nowMs: () => Date.now(),
		},
		{
			access,
			stripeMode: stripeModeOf(env),
			livePayments: await livePaymentsOn(env, access, sellerIdOf(target)),
			appId: target.appId,
			sellerUserId: sellerIdOf(target),
			body,
			storeBaseUrl: `${url.origin}${target.basePath}`,
		},
	);
	if (response.ok) return json(response, 200);
	logger.info('Store checkout refused', { appId: target.appId, reason: response.reason });
	return json(await refusedFor(request, env, target, response.reason), REFUSAL_STATUS[response.reason]);
}

/** True when this shopper started too many checkouts on this live store; an unexpected limiter error lets them through. */
async function liveCheckoutLimited(env: Env, request: Request, appId: string): Promise<boolean> {
	try {
		const config = await getGlobalConfigurableSettings(env);
		await RateLimitService.enforceStoreCheckoutRateLimit(env, config.security.rateLimit, request, appId);
		return false;
	} catch (error) {
		if (error instanceof RateLimitExceededError) return true;
		logger.error('Store checkout limit could not be checked', error);
		return false;
	}
}

/** A shopper who just paid always lands back on the store; the webhook records the order if this page couldn't. */
async function serveReturn(request: Request, env: Env, target: StorePlatformTarget): Promise<Response> {
	const url = new URL(request.url);
	const home = `${url.origin}${target.basePath}/`;
	const processing = async (path: string): Promise<Response> =>
		target.closed
			? plainPage(
					await shopperLocale(request, env, target.appId),
					200,
					msg('Your payment is being confirmed'),
					msg("This store's pages aren't open right now. If your payment goes through, the store has your order."),
				)
			: Response.redirect(`${url.origin}${target.basePath}${path}${path.includes('?') ? '&' : '?'}status=processing`, 303);
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
		if (recorded.result === 'not-paid') return await processing(successPath);
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
	const cookie = receiptCookieHeader(token, `${target.basePath}${STORE_PLATFORM_PREFIX}/`, url.protocol === 'https:');
	if (target.closed) {
		return plainPage(
			await shopperLocale(request, env, target.appId),
			200,
			msg('Thank you for your order'),
			msg("Your payment went through and the store has your order. Its pages aren't open right now."),
			{ 'Set-Cookie': cookie },
		);
	}
	return new Response(null, {
		status: 303,
		headers: {
			Location: `${successUrl}${join}order=${encodeURIComponent(orderId)}`,
			'Set-Cookie': cookie,
		},
	});
}

function digitalDeliveryDeps(env: Env): DigitalDeliveryDeps {
	const assets = new ProductAssetService(env);
	return {
		getOrder: (id) => new StoreOrderService(env).getOrder(id),
		getCheckout: (id) => new StoreCheckoutService(env).get(id),
		getAsset: (ownerId, id) => assets.getForEntitlement(ownerId, id),
		getObject: (key) => env.TEMPLATES_BUCKET.get(key),
	};
}
function deliveryTarget(env: Env, target: StorePlatformTarget, orderId: string) {
	return { appId: target.appId, mode: target.viewer.kind === 'preview' ? 'test' as const : stripeModeOf(env) ?? 'live', orderId, basePath: target.basePath };
}
async function serveProductImage(env: Env, target: StorePlatformTarget, productId: string, assetId: string): Promise<Response> {
	const missing = () => json({ error: 'Not found' }, 404);
	// A shared preview cannot expose the owner's unpublished private files.
	if (await storeAccess(env, target) === 'public') return missing();
	const file = await loadManifest(env, target);
	const parsed = file ? parseStoreManifest(file.text) : null;
	const path = `${STORE_PLATFORM_PREFIX}/product-images/${productId}/${assetId}`;
	if (!parsed?.ok || !parsed.manifest.products.some((product) => product.id === productId && product.image === path)) return missing();
	const assets = new ProductAssetService(env);
	const record = await assets.getOwned(sellerIdOf(target), assetId);
	if (!record || record.asset.kind !== 'image') return missing();
	const object = await env.TEMPLATES_BUCKET.get(record.key);
	if (!object) return missing();
	return new Response(object.body, { headers: { 'Content-Type': record.asset.contentType, 'Content-Length': String(object.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
}

async function serveReceipt(request: Request, env: Env, target: StorePlatformTarget, orderId: string): Promise<Response> {
	const claims = await verifyReceipt(env, readReceiptCookie(request));
	if (!receiptAllows(claims, target.appId, orderId)) return json({ error: 'Order not found' }, 404);
	const order = await new StoreOrderService(env).getOrder(orderId);
	if (!order || order.appId !== target.appId || order.mode !== deliveryTarget(env, target, orderId).mode) return json({ error: 'Order not found' }, 404);
	return json({ ...receiptOf(order), downloads: await receiptDownloads(digitalDeliveryDeps(env), claims, deliveryTarget(env, target, orderId)) });
}

export async function handleStorePlatform(request: Request, env: Env, target: StorePlatformTarget, ctx: ExecutionContext): Promise<Response> {
	const path = target.platformPath;
	try {
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/store.js`) return await serveStoreScript(request, env, target);
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/store`) return await serveStoreInfo(request, env, target);
		if (request.method === 'GET' && path === STORE_OVERLAY_PATH) return await serveOverlayScript(request, env, target);
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/pay`) return await servePayPage(request, env, target);
		if (request.method === 'POST' && path === `${STORE_PLATFORM_PREFIX}/checkout`) return await serveCheckout(request, env, target, ctx);
		if (request.method === 'GET' && path === `${STORE_PLATFORM_PREFIX}/return`) return await serveReturn(request, env, target);
		const image = path.match(/^\/__estori\/product-images\/([a-z0-9-]{1,64})\/([a-z0-9_-]{1,64})$/);
		if (request.method === 'GET' && image) return await serveProductImage(env, target, image[1], image[2]);
		const download = path.match(/^\/__estori\/orders\/(ord_[a-z0-9]{1,64})\/downloads\/([a-z0-9_-]{1,64})$/);
		if (request.method === 'GET' && download) return await servePaidDownload(digitalDeliveryDeps(env), await verifyReceipt(env, readReceiptCookie(request)), deliveryTarget(env, target, download[1]), download[2]);
		const receipt = path.match(/^\/__estori\/orders\/(ord_[a-z0-9]{1,64})$/);
		if (request.method === 'GET' && receipt) return await serveReceipt(request, env, target, receipt[1]);
		return json({ error: 'Not found' }, 404);
	} catch (error) {
		logger.error('Store platform request failed', { appId: target.appId, path, error });
		const locale = await shopperLocale(request, env, target.appId);
		return path === `${STORE_PLATFORM_PREFIX}/checkout` ? json(refusal('stripe_failed', locale), 502) : json({ error: translateFor(locale, STORE_CHECKOUT_MESSAGES.payments_unavailable) }, 500);
	}
}
