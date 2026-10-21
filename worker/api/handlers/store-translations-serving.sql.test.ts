/**
 * A translated store as shoppers reach it, on real SQL with a fake SpaceDO: pages on the live address and the preview,
 * the store's data, and the overlay script. Each test uses its own store, since store languages are cached per isolate.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Locale } from '../../../shared/i18n/locales';
import type { StoreInfo, StoreManifest } from '../../../shared/types/store-payments';
import type { StoreTextKind } from '../../../shared/types/store-translations';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { extractStoreTexts, normalizeText, textHash } from '../../services/store-translations/extract';
import type { StoreHost } from '../../services/live-stores/hosts';
import { RateLimitService } from '../../services/rate-limit/rateLimits';
import { signSpacePreviewToken } from '../../utils/spacePreviewToken';
import { handleLiveStore } from './live-store';
import { handleSpacePreview } from './space-preview';
import { handleStorePlatform, type StorePlatformTarget } from './store-platform';

const NOW = 1_800_000_000_000;
const JWT_SECRET = 'store-translations-serving-test-secret-0123456789';
/** Work handed to waitUntil, which each test lets finish so none of it reads the database after the test. */
const background: Promise<unknown>[] = [];
const CTX = { waitUntil: (work: Promise<unknown>) => void background.push(work), passThroughOnException: () => undefined } as unknown as ExecutionContext;
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
	// A text the store no longer shows.
	'Gone for good': 'Ya no está',
};

/** Where each text the store shows now came from; the rest of SPANISH are translations of texts that went away. */
const KINDS: Record<string, StoreTextKind> = {
	'Trail mug': 'product',
	'A sturdy mug for the trail.': 'product',
	Blue: 'product',
	Red: 'product',
	'Fresh tea': 'page',
	'Add to cart': 'script',
};

const PAGE = '<!doctype html><html lang="en"><head><title>Fresh tea</title></head><body><h1>Fresh tea</h1><button>Add to cart</button></body></html>';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
});

afterEach(async () => {
	await Promise.all(background.splice(0));
	vi.restoreAllMocks();
});

let stores = 0;

/** A new store whose source is English, with these languages translated and ready. */
async function storeWith(ready: Locale[], options: { showSwitcher?: boolean } = {}): Promise<string> {
	const appId = `app_${++stores}`;
	await insertApp(db, { id: appId, userId: 'seller_1' });
	const service = new StoreTranslationService(envWith(db));
	await service.saveSettings(appId, { sourceLocale: 'en', showSwitcher: options.showSwitcher ?? true }, NOW);
	const texts = await Promise.all(Object.entries(KINDS).map(async ([text, kind]) => ({ hash: await textHash(normalizeText(text)), text, kind })));
	await service.replaceTexts(appId, texts, NOW);
	for (const locale of ready) {
		const rows = await Promise.all(Object.entries(SPANISH).map(async ([source, text]) => ({ hash: await textHash(normalizeText(source)), source, text })));
		await service.upsertMachine(appId, locale, rows, NOW);
		await service.markReady(appId, locale, NOW);
	}
	return appId;
}

/** A new store that never saved language settings. */
async function storeWithoutSettings(): Promise<string> {
	const appId = `app_${++stores}`;
	await insertApp(db, { id: appId, userId: 'seller_1' });
	return appId;
}

/**
 * The test database behind a plain object, recording each statement prepared on it and holding every answer until
 * `open` settles. Sentry wraps `prepare` in place, so the real binding is never handed out to be wrapped.
 */
function watchedD1(open: Promise<void> = Promise.resolve()) {
	const prepared: string[] = [];
	const held = (statement: D1PreparedStatement): D1PreparedStatement =>
		({
			bind: (...values: unknown[]) => held(statement.bind(...values)),
			first: async (column?: string) => {
				await open;
				return column === undefined ? statement.first() : statement.first(column);
			},
			all: async () => {
				await open;
				return statement.all();
			},
			raw: async (options?: { columnNames?: boolean }) => {
				await open;
				return options?.columnNames ? statement.raw({ columnNames: true }) : statement.raw();
			},
			run: async () => {
				await open;
				return statement.run();
			},
		}) as unknown as D1PreparedStatement;
	const d1 = {
		prepare: (query: string) => {
			prepared.push(query);
			return held(db.prepare(query));
		},
		batch: async (statements: D1PreparedStatement[]) => {
			await open;
			return db.batch(statements);
		},
		exec: (query: string) => db.exec(query),
	} as unknown as D1Database;
	return { d1, prepared };
}

/** A SpaceDO that serves the store's page and manifest, answers revalidation of its page and script, and records what it was sent. */
function spaceEnv(options: { db?: D1Database; page?: string } = {}) {
	const seen: Request[] = [];
	const namespace = {
		idFromName: (name: string) => name,
		get: () => ({
			fetch: async (request: Request) => {
				seen.push(request);
				const script = new URL(request.url).pathname.endsWith('.js');
				const etag = script ? '"js"' : '"page"';
				const headers = { 'Content-Type': script ? 'text/javascript' : 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: etag };
				if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
				return new Response(script ? 'render("Add to cart")' : (options.page ?? PAGE), { headers });
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
		const response = await handleLiveStore(new Request(`${ORIGIN}/?lang=es`, { headers: { Accept: 'text/html' } }), env, CTX, liveHost(appId));
		expect(await response.text()).toBe(PAGE);
		expect(response.headers.get('ETag')).toBe('"page"');
		expect(response.headers.get('Vary')).toBeNull();
		// The store answers its own revalidation.
		const revalidated = await handleLiveStore(new Request(`${ORIGIN}/`, { headers: { Accept: 'text/html', 'If-None-Match': '"page"' } }), env, CTX, liveHost(appId));
		expect(revalidated.status).toBe(304);
		expect(seen).toHaveLength(2);
	});

	it('a store with no settings makes exactly one D1 read on a cold page view, then none within 30 s', async () => {
		const appId = await storeWithoutSettings();
		const { d1, prepared } = watchedD1();
		const { env } = spaceEnv({ db: d1 });
		const view = async () => (await handleLiveStore(new Request(`${ORIGIN}/products`, { headers: { Accept: 'text/html', 'Accept-Language': 'es' } }), env, CTX, liveHost(appId))).text();
		expect(await view()).toBe(PAGE);
		expect(prepared).toHaveLength(1);
		expect(prepared[0]).toContain('"store_translation_settings"');
		expect(await view()).toBe(PAGE);
		expect(prepared).toHaveLength(1);
	});

	it('a revalidating navigation is forwarded before the settings read resolves', async () => {
		const appId = await storeWith(['es']);
		let open = () => undefined as void;
		const { d1 } = watchedD1(new Promise<void>((resolve) => (open = resolve)));
		const { env, seen } = spaceEnv({ db: d1 });
		const pending = handleLiveStore(new Request(`${ORIGIN}/`, { headers: { Accept: 'text/html', 'If-None-Match': '"page"', Cookie: 'estori_lang=es' } }), env, CTX, liveHost(appId));
		try {
			await vi.waitFor(() => expect(seen).toHaveLength(1));
			expect(seen[0].headers.get('If-None-Match')).toBe('"page"');
		} finally {
			// Held reads must finish before the test ends, or its storage can't be reset.
			open();
		}
		// The store said 304, but the browser's copy may be in another language, so the page is fetched whole.
		const response = await pending;
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<h1>Té fresco</h1>');
		expect(seen).toHaveLength(2);
		expect(seen[1].headers.get('If-None-Match')).toBeNull();
	});

	it("keeps the store's own revalidation of scripts, styles and images, which are never rewritten", async () => {
		const appId = await storeWith(['es']);
		const { env, seen } = spaceEnv();
		const response = await handleLiveStore(new Request(`${ORIGIN}/app.js`, { headers: { Accept: '*/*', 'If-None-Match': '"js"' } }), env, CTX, liveHost(appId));
		expect(response.status).toBe(304);
		expect(seen).toHaveLength(1);
		// The store's languages were read meanwhile, for the next page.
		expect(background).toHaveLength(1);
		expect(await background[0]).not.toBeNull();
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
		expect(html).toContain('href="?lang=en"');
		expect(html).not.toContain(token);
		expect(response.headers.getSetCookie()).toContain(`estori_lang=es; Path=${base}/; Max-Age=31536000; SameSite=Lax; Secure`);
	});
});

describe('the overlay script', () => {
	it('the payload excludes page-kind and stale texts', async () => {
		const appId = await storeWith(['es']);
		const { version } = await new StoreTranslationService(envWith(db)).settingsOf(appId);
		const response = await handleStorePlatform(new Request(`${ORIGIN}/__estori/i18n.js?lang=es&v=${version}`), spaceEnv().env, liveTarget(appId, '/__estori/i18n.js'), CTX);
		const script = await response.text();
		const payload = JSON.parse(/new Map\((\[.*?\])\);/.exec(script)?.[1] ?? 'null') as [string, string][];
		// Pages are translated on the server and products come translated in the store's data.
		expect(payload).toEqual([['Add to cart', 'Agregar al carrito']]);
		expect(script).not.toContain('Ya no está');
	});

	it('includes a text the page shows and its script renders again, as the extractor reads the store', async () => {
		const appId = await storeWith(['es']);
		const { texts } = await extractStoreTexts([
			{
				branch: 'live',
				commitHash: 'c0ffee',
				files: [
					{ path: '/index.html', kind: 'html', text: '<h1>Fresh tea</h1><button>Add to cart</button>' },
					{ path: '/app.js', kind: 'script', text: 'button.textContent = added ? "Added" : "Add to cart";' },
				],
				manifest: null,
			},
		]);
		expect(texts.find((text) => text.text === 'Add to cart')?.kind).toBe('script');
		const service = new StoreTranslationService(envWith(db));
		await service.replaceTexts(appId, texts, NOW);
		const { version } = await service.settingsOf(appId);
		const response = await handleStorePlatform(new Request(`${ORIGIN}/__estori/i18n.js?lang=es&v=${version}`), spaceEnv().env, liveTarget(appId, '/__estori/i18n.js'), CTX);
		const payload = JSON.parse(/new Map\((\[.*?\])\);/.exec(await response.text())?.[1] ?? 'null') as [string, string][];
		expect(payload).toEqual([['Add to cart', 'Agregar al carrito']]);
	});

	it('answers a failure with an empty script, never JSON', async () => {
		const appId = await storeWith(['es']);
		const broken = {
			prepare: () => {
				throw new Error('D1 is unavailable');
			},
		} as unknown as D1Database;
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const response = await handleStorePlatform(new Request(`${ORIGIN}/__estori/i18n.js?lang=es&v=1`), spaceEnv({ db: broken }).env, liveTarget(appId, '/__estori/i18n.js'), CTX);
		expect(response.status).toBe(503);
		expect(response.headers.get('Content-Type')).toContain('text/javascript');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.text()).toBe('');
		expect(warned).toHaveBeenCalledOnce();
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
		expect(script).toContain('["Add to cart","Agregar al carrito"]');
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
