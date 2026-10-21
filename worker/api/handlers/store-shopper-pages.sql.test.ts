/**
 * Estori's own pages on a store's address, in the shopper's language, on real SQL with a fake SpaceDO: the checkout
 * page, store.js, the plain pages and the checkout endpoint's refusals. Each test uses its own store, since store
 * languages are cached per isolate.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../../shared/i18n/locales';
import type { StoreInfo, StoreManifest } from '../../../shared/types/store-payments';
import { UNTOUCHED_SETTINGS_VERSION } from '../../../shared/types/store-translations';
import { RateLimitExceededError } from '../../../shared/types/errors';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { LocalePreferenceService } from '../../database/services/LocalePreferenceService';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { normalizeText, textHash } from '../../services/store-translations/extract';
import type { StoreHost } from '../../services/live-stores/hosts';
import { payPageHeaders } from '../../services/store-payments/pay-page';
import { RateLimitService } from '../../services/rate-limit/rateLimits';
import { RateLimitType } from '../../services/rate-limit/config';
import { PUBLIC_PREVIEW_SUBJECT } from '../../utils/spacePreviewToken';
import { handleLiveStore } from './live-store';
import { handleStorePlatform, matchLivePlatformPath, type StorePlatformTarget } from './store-platform';

const NOW = 1_800_000_000_000;
const CTX = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const ORIGIN = 'https://northwind-tea.estori.shop';
const APP_ORIGIN = 'https://build.estori.test';

const MANIFEST: StoreManifest = {
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US'], flatRateCents: 500, freeOverCents: 5000 },
	products: [
		{
			id: 'trail-mug',
			name: 'Trail mug',
			description: 'A sturdy mug for the trail.',
			image: '/mug.png',
			variants: [
				{ id: 'trail-mug-blue', name: 'Blue', priceCents: 1800 },
				{ id: 'trail-mug-red', name: 'Red', priceCents: 1900, available: false },
			],
		},
	],
};

/** The same store written in Spanish, as a Spanish-speaking seller would write it. */
const SPANISH_MANIFEST: StoreManifest = {
	...MANIFEST,
	products: [
		{
			id: 'trail-mug',
			name: 'Taza de sendero',
			image: '/mug.png',
			variants: [
				{ id: 'trail-mug-blue', name: 'Azul', priceCents: 1800 },
				{ id: 'trail-mug-red', name: 'Rojo', priceCents: 1900, available: false },
			],
		},
	],
};

const DICTIONARIES: Record<Exclude<Locale, 'en'>, Record<string, string>> = {
	es: { 'Trail mug': 'Taza de sendero', Blue: 'Azul', Red: 'Rojo' },
	'pt-BR': { 'Trail mug': 'Caneca de trilha', Blue: 'Azul', Red: 'Vermelho' },
};

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	// A seller who uses Estori in Spanish.
	await insertUser(db, 'seller_es');
	await new LocalePreferenceService(envWith(db)).setLocale('seller_es', 'es', new Date());
});

// The platform logs each refusal; these tests read answers, not logs.
beforeEach(() => void vi.spyOn(console, 'log').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

let stores = 0;

/** A new store written in `source`, with these languages translated and ready. */
async function storeWith(options: { source?: Locale; ready?: Array<Exclude<Locale, 'en'>> } = {}): Promise<string> {
	const appId = `shopper_app_${++stores}`;
	await insertApp(db, { id: appId, userId: 'seller_1' });
	const service = new StoreTranslationService(envWith(db));
	await service.saveSettings(appId, { sourceLocale: options.source ?? 'en' }, NOW);
	// Serving only exposes translations for texts in the current extraction.
	await service.replaceTexts(appId, await Promise.all(Object.keys(DICTIONARIES.es).map(async (text) => ({
		hash: await textHash(normalizeText(text)), text, kind: 'product' as const,
	}))), NOW);
	for (const locale of options.ready ?? []) {
		const rows = await Promise.all(Object.entries(DICTIONARIES[locale]).map(async ([source, text]) => ({ hash: await textHash(normalizeText(source)), source, text })));
		await service.upsertMachine(appId, locale, rows, NOW);
		await service.markReady(appId, locale, NOW);
	}
	return appId;
}

/** A SpaceDO that serves the store's manifest, and fails to serve pages when told to. */
function spaceEnv(options: { db?: D1Database; manifest?: StoreManifest; failPages?: boolean; extra?: Record<string, unknown> } = {}): Env {
	const namespace = {
		idFromName: (name: string) => name,
		get: () => ({
			fetch: async () => {
				if (options.failPages) throw new Error('No deployment found for branch "live"');
				return new Response('<h1>store</h1>', { headers: { 'Content-Type': 'text/html' } });
			},
			getStoreManifest: async () => ({ commitHash: 'c0ffee', manifest: JSON.stringify(options.manifest ?? MANIFEST) }),
		}),
	};
	const settings = { get: async () => null };
	return envWith(options.db ?? db, { SPACE_DO: namespace, JWT_SECRET: 'store-shopper-pages-test-secret-0123456789', CUSTOM_DOMAIN: 'build.estori.test', STRIPE_PUBLISHABLE_KEY: 'pk_test_123', VibecoderStore: settings, ...options.extra });
}

function liveTarget(appId: string, platformPath: string): StorePlatformTarget {
	return { appId, branch: 'live', basePath: '', platformPath, viewer: { kind: 'live', sellerUserId: 'seller_1' } };
}

function liveHost(appId: string, status: 'live' | 'offline' = 'live'): StoreHost {
	return { kind: 'subdomain', store: { appId, slug: 'northwind-tea', status, sellerUserId: 'seller_1' } };
}

async function platform(appId: string, env: Env, path: string, init: RequestInit = {}): Promise<Response> {
	const url = new URL(path, ORIGIN);
	const matched = matchLivePlatformPath(url.pathname);
	if (!matched) throw new Error(`${path} is not a platform path`);
	return handleStorePlatform(new Request(url, init), env, liveTarget(appId, matched.platformPath), CTX);
}

interface PayConfig {
	locale: string;
	stripeLocale: string;
	intlLocale: string;
	products: StoreInfo['products'];
	successPath: string;
	cancelPath: string;
	unavailable: string;
	text: Record<string, string>;
}

async function payPage(appId: string, env: Env, init: { query?: string; headers?: Record<string, string> } = {}) {
	const response = await platform(appId, env, `/__estori/pay${init.query ?? ''}`, { headers: init.headers });
	const html = await response.text();
	const config = JSON.parse(html.match(/<script type="application\/json" id="estori-pay-config">([\s\S]*?)<\/script>/)?.[1] ?? '{}') as PayConfig;
	return { response, html, config };
}

describe("the checkout page in the shopper's language", () => {
	it('preserves untouched store return paths even when a caller sends lang=en', async () => {
		const appId = `untouched_paths_${++stores}`;
		await insertApp(db, { id: appId, userId: 'seller_es' });
		const { config } = await payPage(appId, spaceEnv(), { query: '?lang=en&success=%2Fthanks&cancel=%2Fcart%3Fx%3D1' });
		expect(config.successPath).toBe('/thanks');
		expect(config.cancelPath).toBe('/cart?x=1');
	});
	it('is Spanish for a shopper who chose Spanish: the document, the copy, product names from the dictionary, US dollars and the card form', async () => {
		const appId = await storeWith({ ready: ['es'] });
		const { response, html, config } = await payPage(appId, spaceEnv(), { query: '?lang=es' });
		expect(html).toContain('<html lang="es">');
		expect(html).toContain('<h1>Finalizar compra</h1>');
		expect(html).toContain('&larr; Seguir comprando');
		expect(html).toContain('<button class="pay" id="pay" type="button" disabled>Pagar</button>');
		expect(config).toMatchObject({ locale: 'es', stripeLocale: 'es-419', intlLocale: 'es-419' });
		expect(config.products[0].name).toBe('Taza de sendero');
		expect(config.products[0].variants.map((variant) => variant.name)).toEqual(['Azul', 'Rojo']);
		expect(config.text.payAmount).toBe('Pagar {amount}');
		expect(response.headers.get('Content-Language')).toBe('es');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it("is Portuguese for the shopper's cookie, with the store's Portuguese product names", async () => {
		const appId = await storeWith({ ready: ['pt-BR'] });
		const { response, html, config } = await payPage(appId, spaceEnv(), { headers: { Cookie: 'estori_lang=pt-BR' } });
		expect(html).toContain('<html lang="pt-BR">');
		expect(html).toContain('&larr; Continuar comprando');
		expect(html).toContain('<h2><span>2</span> Endereço de entrega</h2>');
		expect(config).toMatchObject({ locale: 'pt-BR', stripeLocale: 'pt-BR', intlLocale: 'pt-BR' });
		expect(config.products[0].name).toBe('Caneca de trilha');
		expect(config.products[0].variants.map((variant) => variant.name)).toEqual(['Azul', 'Vermelho']);
		expect(response.headers.get('Content-Language')).toBe('pt-BR');
	});

	it('is the English page, with the product names as written, for English and for a language the store has not translated', async () => {
		const appId = await storeWith({ ready: ['es'] });
		for (const init of [{ query: '?lang=en' }, {}, { query: '?lang=pt-BR' }, { headers: { Cookie: 'estori_lang=pt-BR' } }]) {
			const { html, config } = await payPage(appId, spaceEnv(), init);
			expect(html, JSON.stringify(init)).toContain('<html lang="en">');
			expect(html).toContain('<h1>Checkout</h1>');
			expect(config).toMatchObject({ locale: 'en', stripeLocale: 'auto', intlLocale: 'en-US' });
			expect(config.products[0].name).toBe('Trail mug');
			expect(config.unavailable).toBe("This store can't take payments right now.");
		}
	});

	it("sends the shopper back to the store, and on to its confirmation page, in the page's language when the page was asked for one", async () => {
		const appId = await storeWith({ ready: ['es'] });
		const paths = async (init: { query?: string; headers?: Record<string, string> }) => {
			const { config } = await payPage(appId, spaceEnv(), init);
			return { successPath: config.successPath, cancelPath: config.cancelPath };
		};
		expect(await paths({ query: '?lang=es&success=%2Fthanks&cancel=%2Fcart' })).toEqual({ successPath: '/thanks?lang=es', cancelPath: '/cart?lang=es' });
		expect(await paths({ query: '?lang=es&success=%2Forders%2Fdone%3Fx%3D1&cancel=%2Fcart%3Flang%3Den' })).toEqual({ successPath: '/orders/done?x=1&lang=es', cancelPath: '/cart?lang=es' });
		expect(await paths({ query: '?lang=en&success=%2Fthanks&cancel=%2Fcart' })).toEqual({ successPath: '/thanks?lang=en', cancelPath: '/cart?lang=en' });
		// A page reached with no language in its address, or one the store doesn't know, keeps its paths as they were.
		expect(await paths({ query: '?success=%2Fthanks&cancel=%2Fcart', headers: { Cookie: 'estori_lang=es' } })).toEqual({ successPath: '/thanks', cancelPath: '/cart' });
		expect(await paths({ query: '?lang=xx&success=%2Fthanks&cancel=%2Fcart' })).toEqual({ successPath: '/thanks', cancelPath: '/cart' });
	});

	it('never changes a price, an id, a country or the currency, whatever the language', async () => {
		const appId = await storeWith({ ready: ['es'] });
		const english = await payPage(appId, spaceEnv());
		const spanish = await payPage(appId, spaceEnv(), { query: '?lang=es' });
		const withoutWords = (config: PayConfig) => config.products.map((product) => ({ id: product.id, image: product.image, variants: product.variants.map((variant) => ({ id: variant.id, priceCents: variant.priceCents })) }));
		expect(withoutWords(spanish.config)).toEqual(withoutWords(english.config));
		expect(withoutWords(spanish.config)[0].variants).toEqual([
			{ id: 'trail-mug-blue', priceCents: 1800 },
			{ id: 'trail-mug-red', priceCents: 1900 },
		]);
		expect(spanish.config).toMatchObject({ countries: ['US'], paymentsAvailable: false });
	});

	it("serves a store written in Spanish, with no other language, in Spanish, whatever the browser asks for", async () => {
		const appId = await storeWith({ source: 'es' });
		const { html, config } = await payPage(appId, spaceEnv({ manifest: SPANISH_MANIFEST }), { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
		expect(html).toContain('<html lang="es">');
		expect(html).toContain('<h1>Finalizar compra</h1>');
		expect(config).toMatchObject({ locale: 'es', stripeLocale: 'es-419' });
		expect(config.products[0].name).toBe('Taza de sendero');
	});

	it("keeps the page's security policy and a fresh nonce, in every language", async () => {
		const appId = await storeWith({ ready: ['es'] });
		for (const query of ['', '?lang=es']) {
			const { response, html } = await payPage(appId, spaceEnv(), { query });
			const nonce = html.match(/<script nonce="([^"]+)">/)?.[1] ?? '';
			expect(nonce).not.toBe('');
			expect(response.headers.get('Content-Security-Policy')).toBe(payPageHeaders(nonce, APP_ORIGIN)['Content-Security-Policy']);
		}
	});

	it("is English, and still a page, when the store's languages cannot be read", async () => {
		const appId = await storeWith({ ready: ['es'] });
		const broken = {
			prepare: () => {
				throw new Error('D1 is unavailable');
			},
		} as unknown as D1Database;
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { response, html, config } = await payPage(appId, spaceEnv({ db: broken }), { query: '?lang=es' });
		expect(response.status).toBe(200);
		expect(html).toContain('<html lang="en">');
		expect(config.products[0].name).toBe('Trail mug');
		expect(warned).toHaveBeenCalled();
	});
});

describe('a store whose seller has not set a language', () => {
	/** A store of a seller who uses Estori in Spanish, with no settings of its own; `readTexts` reads its texts, as opening the Translations page does. */
	async function unsetStore(options: { readTexts?: boolean } = {}): Promise<string> {
		const appId = `shopper_app_${++stores}`;
		await insertApp(db, { id: appId, userId: 'seller_es' });
		if (options.readTexts) await new StoreTranslationService(envWith(db)).replaceTexts(appId, [], NOW);
		return appId;
	}

	it("serves an English checkout, as it always has, to the shoppers of a Spanish-speaking seller's store", async () => {
		const appId = await unsetStore();
		expect((await new StoreTranslationService(envWith(db)).settingsOf(appId)).sourceLocale).toBe('es');
		for (const init of [{}, { query: '?lang=es' }, { headers: { Cookie: 'estori_lang=es' } }, { headers: { 'Accept-Language': 'es-MX,es;q=0.9' } }]) {
			const { response, html, config } = await payPage(appId, spaceEnv(), init);
			expect(html, JSON.stringify(init)).toContain('<html lang="en">');
			expect(html).toContain('<h1>Checkout</h1>');
			expect(config).toMatchObject({ locale: 'en', stripeLocale: 'auto', intlLocale: 'en-US' });
			expect(response.headers.get('Content-Language')).toBe('en');
		}
	});

	it('stays English when its texts have only been read, which is all that opening the Translations page does', async () => {
		const appId = await unsetStore({ readTexts: true });
		const settings = await new StoreTranslationService(envWith(db)).settingsOf(appId);
		// A row exists and names the owner's language, but nobody has saved anything.
		expect(settings.sourceLocale).toBe('es');
		expect(settings.version).toBe(UNTOUCHED_SETTINGS_VERSION);
		expect((await payPage(appId, spaceEnv())).html).toContain('<html lang="en">');
	});

	it('is English in store.js, the plain pages and the refusals, whatever the shopper asks for', async () => {
		const appId = await unsetStore({ readTexts: true });
		const script = await (await platform(appId, spaceEnv(), '/__estori/store.js?lang=es', { headers: { Cookie: 'estori_lang=es' } })).text();
		expect(script).toContain('var DEFAULT_LANGUAGE = "en";');
		expect(script).toContain('var LANGUAGES = ["en"];');
		const closed = await handleLiveStore(new Request(`${ORIGIN}/?lang=es`, { headers: { 'Accept-Language': 'es' } }), spaceEnv(), CTX, liveHost(appId, 'offline'));
		expect(await closed.text()).toContain("<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"robots\" content=\"noindex\"><title>This store isn't open right now</title>");
		vi.spyOn(RateLimitService, 'enforceStoreCheckoutRateLimit').mockResolvedValue(undefined);
		const refused = await platform(appId, spaceEnv(), '/__estori/checkout?lang=es', {
			method: 'POST',
			headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: 'estori_lang=es' },
			body: JSON.stringify({ items: [{ variantId: 'trail-mug-blue', quantity: 1 }], shipTo: 'US' }),
		});
		expect(await refused.json()).toMatchObject({ reason: 'store_paused', message: "This store isn't taking new orders right now. Try again later." });
	});

	it("takes the owner's language as the store's once the seller has saved its settings", async () => {
		const appId = await unsetStore({ readTexts: true });
		await new StoreTranslationService(envWith(db)).saveSettings(appId, { sourceLocale: 'es' }, NOW);
		const { html, config } = await payPage(appId, spaceEnv({ manifest: SPANISH_MANIFEST }));
		expect(html).toContain('<html lang="es">');
		expect(config).toMatchObject({ locale: 'es', stripeLocale: 'es-419' });
	});
});

describe('store.js in the shopper\'s language', () => {
	const script = async (appId: string, init: { query?: string; headers?: Record<string, string> } = {}) => (await platform(appId, spaceEnv(), `/__estori/store.js${init.query ?? ''}`, { headers: init.headers })).text();

	it("words the empty-cart message in the shopper's language, and in English for English", async () => {
		const appId = await storeWith({ ready: ['es', 'pt-BR'] });
		expect(await script(appId, { headers: { Cookie: 'estori_lang=es' } })).toContain('var DEFAULT_LANGUAGE = "es";');
		expect(await script(appId, { query: '?lang=pt-BR' })).toContain('var DEFAULT_LANGUAGE = "pt-BR";');
		// A page in any of the store's languages is answered in it, so the script carries each one's message.
		const english = await script(appId);
		expect(english).toContain('var DEFAULT_LANGUAGE = "en";');
		expect(english).toContain('"en":"Your cart is empty."');
		expect(english).toContain('"es":"Tu carrito está vacío."');
		expect(english).toContain('"pt-BR":"Seu carrinho está vazio."');
	});

	it('knows only English for a store with no other language', async () => {
		const appId = await storeWith();
		const text = await script(appId);
		expect(text).toContain('var LANGUAGES = ["en"];');
		expect(text).toContain('"en":"Your cart is empty."');
		expect(text).not.toContain('Tu carrito');
	});

	it('is Spanish for a store written in Spanish with no other language', async () => {
		const appId = await storeWith({ source: 'es' });
		const text = await script(appId, { headers: { 'Accept-Language': 'en' } });
		expect(text).toContain('var DEFAULT_LANGUAGE = "es";');
		expect(text).toContain('"es":"Tu carrito está vacío."');
		expect(text).not.toContain('Your cart is empty.');
	});

	it('is served fresh each time, since the language is the shopper\'s', async () => {
		const appId = await storeWith({ ready: ['es'] });
		const response = await platform(appId, spaceEnv(), '/__estori/store.js');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.headers.get('Content-Type')).toContain('text/javascript');
	});

	/** Runs the script the store served, in a page with this language, whose requests go to the store's platform handler. */
	async function pageRunning(appId: string, pageLanguage: string, headers: Record<string, string> = {}) {
		const text = await script(appId, { headers });
		const env = spaceEnv();
		const window: Record<string, unknown> = {
			location: { href: `${ORIGIN}/`, assign: () => undefined },
			localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
			addEventListener: () => undefined,
		};
		const document = { currentScript: { src: `${ORIGIN}/__estori/store.js` }, documentElement: { lang: pageLanguage } };
		const fetchFake = (url: string, init?: RequestInit) => {
			const resolved = new URL(url, ORIGIN);
			const matched = matchLivePlatformPath(resolved.pathname);
			if (!matched) throw new Error(`${url} is not a platform path`);
			return handleStorePlatform(new Request(resolved, { ...init, headers: { ...headers } }), env, liveTarget(appId, matched.platformPath), CTX);
		};
		new Function('window', 'document', 'fetch', text)(window, document, fetchFake);
		return window.Estori as { store(): Promise<StoreInfo> };
	}

	it('gets the store in the page\'s language without a language cookie, as a preview inside the app\'s frame does', async () => {
		const appId = await storeWith({ ready: ['es'] });
		const spanish = await (await pageRunning(appId, 'es')).store();
		expect(spanish.products[0].name).toBe('Taza de sendero');
		expect(spanish.products[0].variants.map((variant) => variant.name)).toEqual(['Azul', 'Rojo']);
		// The page says English, so the browser's preference for Spanish doesn't change the answer.
		const english = await (await pageRunning(appId, 'en', { 'Accept-Language': 'es-MX,es;q=0.9' })).store();
		expect(english.products[0].name).toBe('Trail mug');
		// A page whose language the store doesn't offer gets what the request alone says.
		const other = await (await pageRunning(appId, 'fr')).store();
		expect(other.products[0].name).toBe('Trail mug');
	});
});

describe('the plain pages', () => {
	it('shows a closed store in the shopper\'s language, and in the store\'s own when it has no other', async () => {
		const translated = await storeWith({ ready: ['es'] });
		const closed = await handleLiveStore(new Request(`${ORIGIN}/`, { headers: { Cookie: 'estori_lang=es' } }), spaceEnv(), CTX, liveHost(translated, 'offline'));
		expect(closed.status).toBe(404);
		const html = await closed.text();
		expect(html).toContain('<html lang="es">');
		expect(html).toContain('<h1>Esta tienda no está abierta en este momento</h1><p>Vuelve pronto.</p>');
		expect(closed.headers.get('Content-Language')).toBe('es');

		const spanishStore = await storeWith({ source: 'es' });
		const own = await handleLiveStore(new Request(`${ORIGIN}/`, { headers: { 'Accept-Language': 'en' } }), spaceEnv(), CTX, liveHost(spanishStore, 'offline'));
		expect(await own.text()).toContain('<h1>Esta tienda no está abierta en este momento</h1>');

		const english = await storeWith({ ready: ['es'] });
		const plain = await handleLiveStore(new Request(`${ORIGIN}/`), spaceEnv(), CTX, liveHost(english, 'offline'));
		expect(await plain.text()).toContain("<h1>This store isn't open right now</h1><p>Check back soon.</p>");
	});

	it('shows a store that fails to load in the shopper\'s language', async () => {
		const appId = await storeWith({ ready: ['pt-BR'] });
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const response = await handleLiveStore(new Request(`${ORIGIN}/?lang=pt-BR`), spaceEnv({ failPages: true }), CTX, liveHost(appId));
		expect(response.status).toBe(503);
		expect(await response.text()).toContain('<h1>Esta loja está temporariamente indisponível</h1><p>Tente novamente em instantes.</p>');
	});

	it("tells a shopper returning from Stripe to a closed store, in their language, that the payment is being confirmed", async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Stripe is unreachable'));
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const appId = await storeWith({ ready: ['es'] });
		const closed = { ...liveTarget(appId, '/__estori/return'), closed: true };
		const env = spaceEnv({ extra: { STRIPE_SECRET_KEY: 'sk_test_fake' } });
		const response = await handleStorePlatform(new Request(`${ORIGIN}/__estori/return?session_id=cs_1`, { headers: { Cookie: 'estori_lang=es' } }), env, closed, CTX);
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('<html lang="es">');
		expect(html).toContain('<h1>Estamos confirmando tu pago</h1>');
	});
});

describe("the checkout endpoint's refusals", () => {
	const checkout = (appId: string, env: Env, headers: Record<string, string> = {}, query = '') =>
		platform(appId, env, `/__estori/checkout${query}`, {
			method: 'POST',
			headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify({ items: [{ variantId: 'trail-mug-blue', quantity: 1 }], shipTo: 'US' }),
		});

	it('words a refusal for the shopper in their language, and keeps the English as it was', async () => {
		const appId = await storeWith({ ready: ['es', 'pt-BR'] });
		vi.spyOn(RateLimitService, 'enforceStoreCheckoutRateLimit').mockResolvedValue(undefined);
		const answer = async (headers: Record<string, string>, query = '') => (await (await checkout(appId, spaceEnv(), headers, query)).json()) as { ok: boolean; reason: string; message: string };

		// No live store record, so the store is paused for new checkouts.
		expect(await answer({ Cookie: 'estori_lang=es' })).toEqual({ ok: false, reason: 'store_paused', message: 'Esta tienda no está recibiendo pedidos nuevos en este momento. Inténtalo más tarde.' });
		expect(await answer({}, '?lang=pt-BR')).toEqual({ ok: false, reason: 'store_paused', message: 'Esta loja não está recebendo novos pedidos agora. Tente novamente mais tarde.' });
		expect(await answer({})).toEqual({ ok: false, reason: 'store_paused', message: "This store isn't taking new orders right now. Try again later." });
	});

	it('words the limit on checkouts in the shopper\'s language', async () => {
		const appId = await storeWith({ ready: ['pt-BR'] });
		vi.spyOn(RateLimitService, 'enforceStoreCheckoutRateLimit').mockRejectedValue(new RateLimitExceededError('Store checkout limit reached', RateLimitType.STORE_CHECKOUT));
		const response = await checkout(appId, spaceEnv(), { Cookie: 'estori_lang=pt-BR' });
		expect(response.status).toBe(429);
		expect(await response.json()).toMatchObject({ reason: 'too_many_checkouts', message: 'Muitas compras foram iniciadas daqui. Aguarde alguns minutos e tente novamente.' });
	});

	it("words a demo's refusal in the shopper's language on a preview", async () => {
		const appId = await storeWith({ ready: ['es'] });
		const target: StorePlatformTarget = { appId, branch: 'main', basePath: `/space/${appId}/preview/main`, platformPath: '/__estori/checkout', viewer: { kind: 'preview', userId: PUBLIC_PREVIEW_SUBJECT } };
		const request = (headers: Record<string, string>) =>
			new Request(`${ORIGIN}${target.basePath}/__estori/checkout`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ items: [], shipTo: 'US' }) });
		const spanish = await handleStorePlatform(request({ Cookie: 'estori_lang=es' }), spaceEnv(), target, CTX);
		expect(spanish.status).toBe(403);
		expect(await spanish.json()).toEqual({ ok: false, reason: 'demo_only', message: 'Esto es una demostración. Las compras funcionan en la tienda publicada.' });
		const english = await handleStorePlatform(request({}), spaceEnv(), target, CTX);
		expect(await english.json()).toEqual({ ok: false, reason: 'demo_only', message: 'This is a demo. Checkout works on the live store.' });
	});

	it('answers a request refused before anything is read in English, without reading the store\'s languages', async () => {
		const appId = await storeWith({ ready: ['es'] });
		const prepared = vi.fn(() => {
			throw new Error('nothing should be read');
		});
		const env = spaceEnv({ db: { prepare: prepared } as unknown as D1Database });
		const response = await checkout(appId, env, { Origin: 'https://evil.example', Cookie: 'estori_lang=es' });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ reason: 'invalid_request', message: "Your cart couldn't be read. Refresh the page and try again." });
		expect(prepared).not.toHaveBeenCalled();
	});
});
