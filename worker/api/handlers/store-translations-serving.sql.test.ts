/**
 * A translated store as shoppers reach it, on real SQL with a fake SpaceDO: pages on the live address and the preview,
 * the store's data, and the overlay script. Each test uses its own store, since store languages are cached per isolate.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../../shared/i18n/locales';
import type { StoreInfo, StoreManifest } from '../../../shared/types/store-payments';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { normalizeText, textHash } from '../../services/store-translations/extract';
import type { StoreHost } from '../../services/live-stores/hosts';
import { RateLimitService } from '../../services/rate-limit/rateLimits';
import { signSpacePreviewToken } from '../../utils/spacePreviewToken';
import { handleLiveStore } from './live-store';
import { handleSpacePreview } from './space-preview';
import { handleStorePlatform, type StorePlatformTarget } from './store-platform';

const NOW = 1_800_000_000_000;
const JWT_SECRET = 'store-translations-serving-test-secret-0123456789';
const CTX = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const ORIGIN = 'https://northwind-tea.estori.shop';

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

const SPANISH: Record<string, string> = {
	'Trail mug': 'Taza de sendero',
	'A sturdy mug for the trail.': 'Una taza resistente para el sendero.',
	Blue: 'Azul',
	Red: 'Rojo',
	'Fresh tea': 'Té fresco',
	'Add to cart': 'Agregar al carrito',
};

const PAGE = '<!doctype html><html lang="en"><head><title>Fresh tea</title></head><body><h1>Fresh tea</h1><button>Add to cart</button></body></html>';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
});

afterEach(() => vi.restoreAllMocks());

let stores = 0;

/** A new store whose source is English, with these languages translated and ready. */
async function storeWith(ready: Locale[], options: { showSwitcher?: boolean } = {}): Promise<string> {
	const appId = `app_${++stores}`;
	await insertApp(db, { id: appId, userId: 'seller_1' });
	const service = new StoreTranslationService(envWith(db));
	await service.saveSettings(appId, { sourceLocale: 'en', showSwitcher: options.showSwitcher ?? true }, NOW);
	for (const locale of ready) {
		const rows = await Promise.all(Object.entries(SPANISH).map(async ([source, text]) => ({ hash: await textHash(normalizeText(source)), source, text })));
		await service.upsertMachine(appId, locale, rows, NOW);
		await service.markReady(appId, locale, NOW);
	}
	return appId;
}

/** A SpaceDO that serves the store's page and manifest, and records the requests it was sent. */
function spaceEnv(options: { db?: D1Database; page?: string } = {}) {
	const seen: Request[] = [];
	const namespace = {
		idFromName: (name: string) => name,
		get: () => ({
			fetch: async (request: Request) => {
				seen.push(request);
				return new Response(options.page ?? PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: '"page"' } });
			},
			getStoreManifest: async () => ({ commitHash: 'c0ffee', manifest: JSON.stringify(MANIFEST) }),
		}),
	};
	const settings = { get: async () => null };
	return { env: envWith(options.db ?? db, { SPACE_DO: namespace, JWT_SECRET, CUSTOM_DOMAIN: 'build.estori.test', CUSTOM_PREVIEW_DOMAIN: '', VibecoderStore: settings }), seen };
}

function liveHost(appId: string): StoreHost {
	return { kind: 'subdomain', store: { appId, slug: 'northwind-tea', status: 'live', sellerUserId: 'seller_1' } };
}

function liveTarget(appId: string, platformPath: string): StorePlatformTarget {
	return { appId, branch: 'live', basePath: '', platformPath, viewer: { kind: 'live', sellerUserId: 'seller_1' } };
}

async function storeInfo(appId: string, headers: Record<string, string> = {}): Promise<StoreInfo> {
	const request = new Request(`${ORIGIN}/__estori/store`, { headers });
	const response = await handleStorePlatform(request, spaceEnv().env, liveTarget(appId, '/__estori/store'), CTX);
	expect(response.status).toBe(200);
	return response.json();
}

describe('a translated store page', () => {
	it("is served in the shopper's language on the live address, and remembers it", async () => {
		const appId = await storeWith(['es']);
		const { env } = spaceEnv();
		const response = await handleLiveStore(new Request(`${ORIGIN}/?lang=es`), env, CTX, liveHost(appId));
		const html = await response.text();
		expect(html).toContain('<html lang="es">');
		expect(html).toContain('<h1>Té fresco</h1><button>Agregar al carrito</button>');
		expect(html).toContain('<script src="/__estori/i18n.js?lang=es&amp;v=');
		expect(html).toContain('<details');
		expect(response.headers.get('Set-Cookie')).toBe('estori_lang=es; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
		expect(response.headers.get('Content-Language')).toBe('es');
		expect(response.headers.get('Vary')).toBe('Cookie, Accept-Language');
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');

		const browser = await handleLiveStore(new Request(`${ORIGIN}/`, { headers: { 'Accept-Language': 'es-MX,es;q=0.9' } }), env, CTX, liveHost(appId));
		expect(await browser.text()).toContain('<h1>Té fresco</h1>');
		expect(browser.headers.get('Set-Cookie')).toBeNull();
	});

	it("is the store's own page, byte for byte, when no language is ready", async () => {
		const appId = await storeWith([]);
		const { env, seen } = spaceEnv();
		const response = await handleLiveStore(new Request(`${ORIGIN}/?lang=es`, { headers: { Accept: 'text/html', 'If-None-Match': '"page"' } }), env, CTX, liveHost(appId));
		expect(await response.text()).toBe(PAGE);
		expect(response.headers.get('ETag')).toBe('"page"');
		expect(response.headers.get('Vary')).toBeNull();
		// The store answers its own revalidation.
		expect(seen[0].headers.get('If-None-Match')).toBe('"page"');
	});

	it("asks the store for a whole page when it may be served in another language than the browser's copy", async () => {
		const appId = await storeWith(['es']);
		const { env, seen } = spaceEnv();
		await handleLiveStore(new Request(`${ORIGIN}/`, { headers: { Accept: 'text/html,application/xhtml+xml', 'If-None-Match': '"page"' } }), env, CTX, liveHost(appId));
		expect(seen[0].headers.get('If-None-Match')).toBeNull();
		// Scripts, styles and images are never rewritten, so they keep their revalidation.
		await handleLiveStore(new Request(`${ORIGIN}/app.js`, { headers: { Accept: '*/*', 'If-None-Match': '"js"' } }), env, CTX, liveHost(appId));
		expect(seen[1].headers.get('If-None-Match')).toBe('"js"');
	});

	it('serves the original page when its languages cannot be read', async () => {
		const appId = await storeWith(['es']);
		const broken = {
			prepare: () => {
				throw new Error('D1 is unavailable');
			},
		} as unknown as D1Database;
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const response = await handleLiveStore(new Request(`${ORIGIN}/?lang=es`), spaceEnv({ db: broken }).env, CTX, liveHost(appId));
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(PAGE);
		expect(response.headers.get('Set-Cookie')).toBeNull();
		expect(warned).toHaveBeenCalledOnce();
	});

	it('carries the preview path in its overlay, links and cookie', async () => {
		const appId = await storeWith(['es']);
		vi.spyOn(RateLimitService, 'enforceSpacePreviewRateLimit').mockResolvedValue(undefined);
		const { env } = spaceEnv();
		const token = await signSpacePreviewToken(env, { spaceName: appId, branch: 'main', userId: 'seller_1', previewVersion: 0 });
		const base = `/space/${appId}/preview/main`;
		const response = await handleSpacePreview(new Request(`https://build.estori.test${base}/about?t=${token}&lang=es`), env, appId, 'main', CTX);
		const html = await response.text();
		expect(html).toContain(`<script src="${base}/__estori/i18n.js?lang=es&amp;v=`);
		expect(html).toContain(`<link rel="alternate" hreflang="es" href="https://build.estori.test${base}/about?lang=es">`);
		expect(html).toContain(`href="${base}/about?lang=en"`);
		expect(html).not.toContain(token);
		expect(response.headers.getSetCookie()).toContain(`estori_lang=es; Path=${base}/; Max-Age=31536000; SameSite=Lax; Secure`);
	});
});

describe("a translated store's data", () => {
	it('store JSON returns translated product names and variant names', async () => {
		const appId = await storeWith(['es']);
		const info = await storeInfo(appId, { Cookie: 'estori_lang=es' });
		expect(info.products[0].name).toBe('Taza de sendero');
		expect(info.products[0].description).toBe('Una taza resistente para el sendero.');
		expect(info.products[0].variants.map((variant) => variant.name)).toEqual(['Azul', 'Rojo']);
		// The source language, and a language that isn't ready, read as written.
		expect((await storeInfo(appId, { Cookie: 'estori_lang=en' })).products[0].name).toBe('Trail mug');
		expect((await storeInfo(appId, { Cookie: 'estori_lang=pt-BR' })).products[0].name).toBe('Trail mug');
	});

	it('prices are unchanged', async () => {
		const appId = await storeWith(['es']);
		const spanish = await storeInfo(appId, { 'Accept-Language': 'es' });
		const english = await storeInfo(appId);
		expect(spanish.products[0].name).toBe('Taza de sendero');
		const withoutWords = (info: StoreInfo) => ({
			...info,
			products: info.products.map(({ name: _name, description: _description, ...product }) => ({ ...product, variants: product.variants.map(({ name: _variant, ...variant }) => variant) })),
		});
		expect(withoutWords(spanish)).toEqual(withoutWords(english));
		expect(spanish.products[0].variants.map((variant) => [variant.id, variant.priceCents, variant.available])).toEqual([
			['trail-mug-blue', 1800, undefined],
			['trail-mug-red', 1900, false],
		]);
		expect(spanish.currency).toBe('usd');
		expect(spanish.shipping).toEqual(MANIFEST.shipping);
	});

	it('i18n.js is versioned and cacheable', async () => {
		const appId = await storeWith(['es']);
		const { version } = await new StoreTranslationService(envWith(db)).settingsOf(appId);
		const overlay = (query: string) => handleStorePlatform(new Request(`${ORIGIN}/__estori/i18n.js${query}`), spaceEnv().env, liveTarget(appId, '/__estori/i18n.js'), CTX);

		const current = await overlay(`?lang=es&v=${version}`);
		expect(current.status).toBe(200);
		expect(current.headers.get('Content-Type')).toContain('text/javascript');
		expect(current.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
		const script = await current.text();
		expect(script).toContain('["Fresh tea","Té fresco"]');
		expect(script).toContain('MutationObserver');

		const stale = await overlay(`?lang=es&v=${version - 1}`);
		expect(stale.status).toBe(200);
		expect(stale.headers.get('Cache-Control')).toBe('no-store');

		for (const query of ['?lang=pt-BR&v=1', '?lang=en&v=1', '?lang=xx']) {
			const refused = await overlay(query);
			expect(refused.status, query).toBe(404);
			expect(refused.headers.get('Cache-Control'), query).toBe('no-store');
		}
	});
});
