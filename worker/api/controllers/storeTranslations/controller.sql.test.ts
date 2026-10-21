/**
 * The translations API on real SQL, with SpaceDO, the agent and the seller's task runner stood in: the Translations
 * page's reads and writes for a store, starting a translation (twice quickly, past the task limit, before the first
 * deploy), a seller's edits, the pause, and who may reach what. Each test's writes are rolled back after it, and each
 * test with state of its own uses a store of its own.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { DeploymentTexts } from '@space-do/space';
import { envWith, insertApp, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { LocalePreferenceService } from '../../../database/services/LocalePreferenceService';
import { StoreTranslationService } from '../../../database/services/StoreTranslationService';
import { TaskService } from '../../../database/services/TaskService';
import { loadAccount, loadCredits } from '../../../services/billing/account';
import { textHash } from '../../../services/store-translations/extract';
import { translationDedupeKey } from '../../../services/store-translations/translate-kind';
import { translateFor } from '../../../utils/server-translate';
import { shopperLanguage } from '../../../services/store-translations/serve-context';
import { formatNumber } from '../../../../shared/i18n/format';
import { msg } from '../../../../shared/i18n/translate';
import { STORE_TRANSLATIONS_PAUSED_MESSAGE } from '../../../../shared/types/pauses';
import { MAX_TEXT_CHARS, STORE_TRANSLATION_PAGE_SIZE, type StoreTranslationOverview } from '../../../../shared/types/store-translations';
import type { AppEnv } from '../../../types/appenv';
import type { AuthUser } from '../../../types/auth-types';
import type { RouteContext } from '../../types/route-context';
import { setupTranslationRoutes } from '../../routes/translationRoutes';
import { StoreTranslationsController } from './controller';

/** What the agent says about a store's preview: a link, or that it can't be reached. */
const agent = vi.hoisted((): { preview: string | 'down' } => ({ preview: 'https://estori.app/space/app/preview/main/?t=signed' }));

// The agents module pulls in the Durable Object classes, which the test runtime can't load.
vi.mock('../../../agents', () => ({
	getAgentStubLightweight: async () => {
		if (agent.preview === 'down') throw new Error('agent unreachable');
		return { getPublicPreviewURL: async () => agent.preview };
	},
}));

const DEPLOYED_AT = 1_700_000_000;
let db: D1Database;
let woke: string[];

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['seller_1', 'seller_2', 'seller_3', 'seller_4']) await insertUser(db, id);
	await new LocalePreferenceService(envWith(db)).setLocale('seller_2', 'es', new Date());
	await new LocalePreferenceService(envWith(db)).setLocale('seller_3', 'pt-BR', new Date());
});

beforeEach(() => {
	woke = [];
	agent.preview = 'https://estori.app/space/app/preview/main/?t=signed';
	vi.spyOn(console, 'log').mockImplementation(() => undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

async function store(id: string, ownerId: string, options: { deployed?: boolean; title?: string } = {}): Promise<void> {
	await insertApp(db, { id, userId: ownerId, title: options.title });
	if (options.deployed !== false) await db.prepare('UPDATE apps SET last_deployed_at = ? WHERE id = ?').bind(DEPLOYED_AT, id).run();
}

interface FakeSpace {
	deployments: Record<string, DeploymentTexts>;
	calls: string[];
	down?: boolean;
}

const deployment = (commitHash: string, html: string, manifest: string | null = null, branch = 'main'): DeploymentTexts => ({ branch, commitHash, files: [{ path: '/index.html', kind: 'html', text: html }], manifest });
const space = (deployments: Record<string, DeploymentTexts> = {}): FakeSpace => ({ deployments, calls: [] });

function envFor(fake: FakeSpace, extra: Record<string, unknown> = {}): Env {
	const stub = {
		async getActiveDraft() {
			fake.calls.push('getActiveDraft');
			if (fake.down) throw new Error('SpaceDO is down');
			return { id: 'main', name: 'Main', branch: 'main', tip: null };
		},
		async getDeploymentTexts(branch: string) {
			fake.calls.push(`getDeploymentTexts:${branch}`);
			if (fake.down) throw new Error('SpaceDO is down');
			return fake.deployments[branch] ?? null;
		},
	};
	const runner = { idFromName: (name: string) => name, get: () => ({ wake: async (userId: string) => void woke.push(userId) }) };
	return envWith(db, { SPACE_DO: { idFromName: (name: string) => name, get: () => stub }, TASK_RUNNER: runner, STORES_DOMAIN: 'stores.example', CUSTOM_DOMAIN: 'estori.app', ...extra });
}

const as = (userId: string, pathParams: Record<string, string> = {}, query = '') => ({ user: { id: userId, email: `${userId}@example.test` }, pathParams, queryParams: new URLSearchParams(query) }) as unknown as RouteContext;
const request = (method = 'GET', body?: unknown) => new Request('https://estori.app/api/x', { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = {} as ExecutionContext;

type Answer<T = Record<string, unknown>> = { status: number; body: { success: boolean; data?: T; error?: { message?: string } } };
const answer = async <T = Record<string, unknown>>(response: Response): Promise<Answer<T>> => ({ status: response.status, body: await response.json() });

const overviewOf = async (env: Env, appId: string, userId = 'seller_1'): Promise<StoreTranslationOverview> => {
	const reply = await answer<StoreTranslationOverview>(await StoreTranslationsController.overview(request(), env, ctx, as(userId, { id: appId })));
	expect(reply.status).toBe(200);
	return reply.body.data as StoreTranslationOverview;
};

const WELCOME = '<h1>Welcome to the shop</h1><p>Fresh tea every day</p>';

describe('reading a store\'s translations', () => {
	it('says deployed false for a store never deployed, and never asks SpaceDO', async () => {
		await store('app_new', 'seller_1', { deployed: false });
		const fake = space({ main: deployment('c1', WELCOME) });
		const overview = await overviewOf(envFor(fake), 'app_new');
		expect(overview).toMatchObject({ deployed: false, extractedAt: null, textsUnavailable: false, truncated: false, manifestInvalid: false, previewUrl: null, liveUrl: null, creditsLeft: null });
		expect(overview.settings).toMatchObject({ sourceLocale: 'en', targets: {}, autoTranslate: true });
		expect(overview.languages).toEqual([
			{ locale: 'es', enabled: false, ready: false, total: 0, translated: 0, edited: 0, left: 0, estimateCredits: 0, task: null },
			{ locale: 'pt-BR', enabled: false, ready: false, total: 0, translated: 0, edited: 0, left: 0, estimateCredits: 0, task: null },
		]);
		expect(fake.calls).toEqual([]);
	});

	it("reads a deployed store's texts, and shows each other language with what is left, its estimate, and where to see the store", async () => {
		await store('app_tea', 'seller_1');
		await db.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_tea', 'northwind-tea', 'live', 'c1', ?, 1, 1)`).bind(DEPLOYED_AT).run();
		const fake = space({ live: deployment('c1', WELCOME, null, 'live'), main: deployment('c2', WELCOME) });
		const overview = await overviewOf(envFor(fake), 'app_tea');
		expect(overview).toMatchObject({
			deployed: true,
			textsUnavailable: false,
			truncated: false,
			manifestInvalid: false,
			creditsLeft: null,
			previewUrl: 'https://estori.app/space/app/preview/main/?t=signed',
			liveUrl: 'https://northwind-tea.stores.example',
		});
		expect(overview.extractedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
		expect(overview.languages.map((language) => [language.locale, language.total, language.translated, language.left])).toEqual([
			['es', 2, 0, 2],
			['pt-BR', 2, 0, 2],
		]);
		for (const language of overview.languages) expect(language.estimateCredits).toBeGreaterThan(0);
	});

	it('counts what is translated and what the seller edited, and prices only what is left', async () => {
		await store('app_count', 'seller_1');
		const service = new StoreTranslationService(envWith(db));
		const [welcome, fresh] = [await textHash('Welcome to the shop'), await textHash('Fresh tea every day')];
		const fake = space({ main: deployment('c1', WELCOME) });
		const before = await overviewOf(envFor(fake), 'app_count');
		await service.upsertMachine('app_count', 'es', [{ hash: welcome, source: 'Welcome to the shop', text: 'Bienvenido a la tienda' }]);
		await service.setSellerText('app_count', 'es', fresh, 'Té fresco todos los días');
		const after = await overviewOf(envFor(fake), 'app_count');
		expect(after.languages[0]).toMatchObject({ locale: 'es', total: 2, translated: 2, edited: 1, left: 0, estimateCredits: 0 });
		expect(after.languages[1]).toMatchObject({ locale: 'pt-BR', translated: 0, left: 2, estimateCredits: before.languages[1].estimateCredits });
		expect(after.settings.version).toBeGreaterThan(before.settings.version);
	});

	it('reads the texts again only when a deploy or a publish is newer than the last read', async () => {
		await store('app_fresh', 'seller_1');
		const fake = space({ main: deployment('c1', WELCOME) });
		const env = envFor(fake);
		await overviewOf(env, 'app_fresh');
		expect(fake.calls).not.toEqual([]);

		fake.calls.length = 0;
		await overviewOf(env, 'app_fresh');
		expect(fake.calls).toEqual([]);

		const inAnHour = Math.floor(Date.now() / 1000) + 3600;
		await db.prepare('UPDATE apps SET last_deployed_at = ? WHERE id = ?').bind(inAnHour, 'app_fresh').run();
		await overviewOf(env, 'app_fresh');
		expect(fake.calls).not.toEqual([]);

		await store('app_published', 'seller_1');
		fake.calls.length = 0;
		await overviewOf(env, 'app_published');
		await overviewOf(env, 'app_published');
		const readsAfterFirst = fake.calls.length;
		await db.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_published', 'fresh-tea', 'live', 'c9', ?, 1, 1)`).bind(inAnHour).run();
		await overviewOf(env, 'app_published');
		expect(fake.calls.length).toBeGreaterThan(readsAfterFirst);
	});

	it('answers a store whose deployments cannot be read with its stored texts and textsUnavailable, never as never deployed', async () => {
		await store('app_outage', 'seller_1');
		const fake = space({ main: deployment('c1', WELCOME) });
		const env = envFor(fake);
		const first = await overviewOf(env, 'app_outage');
		expect(first.languages[0].total).toBe(2);

		const inAnHour = Math.floor(Date.now() / 1000) + 3600;
		await db.prepare('UPDATE apps SET last_deployed_at = ? WHERE id = ?').bind(inAnHour, 'app_outage').run();
		fake.down = true;
		const during = await overviewOf(env, 'app_outage');
		expect(during).toMatchObject({ deployed: true, textsUnavailable: true, extractedAt: first.extractedAt });
		expect(during.languages.map((language) => language.total)).toEqual([2, 2]);

		// Nothing was ever read, and the store can't be read now: it is still deployed.
		await store('app_cold', 'seller_1');
		const cold = await overviewOf(env, 'app_cold');
		expect(cold).toMatchObject({ deployed: true, textsUnavailable: true, extractedAt: null });
		expect(cold.languages.map((language) => language.total)).toEqual([0, 0]);
	});

	it('answers a store with no SpaceDO binding at all the same way, without crashing', async () => {
		await store('app_nobinding', 'seller_1');
		const overview = await overviewOf(envWith(db), 'app_nobinding');
		expect(overview).toMatchObject({ deployed: true, textsUnavailable: true, extractedAt: null });
	});

	it('keeps saying products were not read, and that the store was cut short, until a later read says otherwise', async () => {
		await store('app_notes', 'seller_1');
		const fake = space({ main: deployment('c1', WELCOME, '{"version":2}') });
		const env = envFor(fake);
		expect(await overviewOf(env, 'app_notes')).toMatchObject({ manifestInvalid: true, truncated: false });
		fake.calls.length = 0;
		expect(await overviewOf(env, 'app_notes')).toMatchObject({ manifestInvalid: true });
		expect(fake.calls).toEqual([]);

		await store('app_big', 'seller_1');
		const paragraphs = Array.from({ length: 5_001 }, (_, index) => `<p>Item number ${index} here</p>`).join('');
		expect(await overviewOf(envFor(space({ main: deployment('c1', paragraphs) })), 'app_big')).toMatchObject({ truncated: true, manifestInvalid: false });
	});

	it('falls back to no preview link when the agent cannot be reached', async () => {
		await store('app_agent', 'seller_1');
		agent.preview = 'down';
		expect(await overviewOf(envFor(space({ main: deployment('c1', WELCOME) })), 'app_agent')).toMatchObject({ deployed: true, previewUrl: null });
	});

	it('gives the live address of the own domain once it is active, and none while the store is offline', async () => {
		await store('app_live', 'seller_1');
		const env = envFor(space({ main: deployment('c1', WELCOME) }));
		await db.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_live', 'live-tea', 'live', 'c1', ?, 1, 1)`).bind(DEPLOYED_AT).run();
		expect((await overviewOf(env, 'app_live')).liveUrl).toBe('https://live-tea.stores.example');

		await db
			.prepare(`INSERT INTO store_domains (hostname, app_id, status, provider, records, created_at) VALUES ('shop.live-tea.test', 'app_live', 'pending', 'manual', '[]', 1)`)
			.run();
		expect((await overviewOf(env, 'app_live')).liveUrl).toBe('https://live-tea.stores.example');
		await db.prepare("UPDATE store_domains SET status = 'active' WHERE hostname = 'shop.live-tea.test'").run();
		expect((await overviewOf(env, 'app_live')).liveUrl).toBe('https://shop.live-tea.test');

		await db.prepare("UPDATE live_stores SET status = 'offline' WHERE app_id = 'app_live'").run();
		expect((await overviewOf(env, 'app_live')).liveUrl).toBeNull();
	});

	it('shows the credits the seller has left when billing is on, as the billing page does, and none when it is off', async () => {
		await store('app_credits', 'seller_1');
		const env = envFor(space({ main: deployment('c1', WELCOME) }), { BILLING: 'on' });
		const account = await loadAccount(env, 'seller_1');
		const expected = (await loadCredits(env, account)).left;
		expect(expected).toBeGreaterThan(0);
		expect((await overviewOf(env, 'app_credits')).creditsLeft).toBe(expected);
		expect((await overviewOf(envFor(space({ main: deployment('c1', WELCOME) })), 'app_credits')).creditsLeft).toBeNull();
	});

	it('answers 404 for a store that does not exist', async () => {
		const reply = await answer(await StoreTranslationsController.overview(request(), envFor(space()), ctx, as('seller_1', { id: 'app_gone' })));
		expect(reply.status).toBe(404);
	});

	it("lists the seller's deployed stores for the picker", async () => {
		await store('app_pick_a', 'seller_4', { title: 'Alpha' });
		await store('app_pick_b', 'seller_4', { title: 'Beta', deployed: false });
		await store('app_pick_c', 'seller_1', { title: 'Someone else' });
		const reply = await answer(await StoreTranslationsController.stores(request(), envFor(space()), ctx, as('seller_4')));
		expect(reply.body.data).toEqual([{ appId: 'app_pick_a', title: 'Alpha', sourceLocale: 'en', languages: [{ locale: 'es', enabled: false, ready: false }, { locale: 'pt-BR', enabled: false, ready: false }] }]);
	});
});

describe('starting a translation', () => {
	it('refuses a run before the seller confirms the source language, without queuing or changing checkout', async () => {
		await store('app_unconfirmed_run', 'seller_2');
		const env = envFor(space());
		const reply = await answer(await StoreTranslationsController.run(request('POST'), env, ctx, as('seller_2', { id: 'app_unconfirmed_run', locale: 'en' })));
		expect(reply.status).toBe(400);
		expect((await new TaskService(env).listForUser('seller_2', { appId: 'app_unconfirmed_run', limit: 20 }))).toEqual([]);
		expect((await shopperLanguage(request(), env, 'app_unconfirmed_run')).locale).toBe('en');
		expect(woke).toEqual([]);
	});

	it('rejects a first switch save by a Spanish-speaking seller, keeping checkout English', async () => {
		await store('app_unconfirmed_patch', 'seller_2');
		const env = envFor(space());
		const service = new StoreTranslationService(env);
		await service.replaceTexts('app_unconfirmed_patch', [], Date.now());
		const reply = await answer(await StoreTranslationsController.saveSettings(request('PUT', { showSwitcher: false }), env, ctx, as('seller_2', { id: 'app_unconfirmed_patch' })));
		expect(reply.status).toBe(400);
		expect((await service.settingsOf('app_unconfirmed_patch')).version).toBe(1);
		expect((await shopperLanguage(request(), env, 'app_unconfirmed_patch')).locale).toBe('en');
		const confirmed = await StoreTranslationsController.saveSettings(request('PUT', { sourceLocale: 'es' }), env, ctx, as('seller_2', { id: 'app_unconfirmed_patch' }));
		expect(confirmed.status).toBe(200);
		expect((await service.settingsOf('app_unconfirmed_patch')).sourceLocale).toBe('es');
	});

	const run = async (env: Env, appId: string, locale: string, userId = 'seller_1') => {
		const service = new StoreTranslationService(env);
		const current = await service.settingsOf(appId);
		if (current.version <= 1) await service.saveSettings(appId, { sourceLocale: current.sourceLocale });
		return StoreTranslationsController.run(request('POST'), env, ctx, as(userId, { id: appId, locale }));
	};
	const taskRows = async (appId: string) => (await db.prepare('SELECT id, status, dedupe_key FROM tasks WHERE app_id = ?').bind(appId).all<{ id: string; status: string; dedupe_key: string }>()).results;

	it('queues one task and answers it, turns the language on, and wakes the seller\'s runner', async () => {
		await store('app_run', 'seller_1');
		const reply = await answer<{ task: { id: string; kind: string; status: string; appId: string; payload: unknown }; created: boolean }>(await run(envFor(space()), 'app_run', 'es'));
		expect(reply.status).toBe(200);
		expect(reply.body.data).toMatchObject({ created: true, task: { kind: 'store.translate', status: 'queued', appId: 'app_run', payload: { locale: 'es' } } });
		expect(await taskRows('app_run')).toEqual([{ id: reply.body.data?.task.id, status: 'queued', dedupe_key: translationDedupeKey('app_run', 'es') }]);
		expect((await new StoreTranslationService(envWith(db)).settingsOf('app_run')).targets.es).toEqual({ enabled: true, ready: false });
		expect(woke).toEqual(['seller_1']);
	});

	it('run twice returns created false the second time, with the same task and no second one', async () => {
		await store('app_twice', 'seller_1');
		const env = envFor(space());
		const first = await answer<{ task: { id: string }; created: boolean }>(await run(env, 'app_twice', 'pt-BR'));
		const second = await answer<{ task: { id: string }; created: boolean }>(await run(env, 'app_twice', 'pt-BR'));
		expect([first.status, second.status]).toEqual([200, 200]);
		expect([first.body.data?.created, second.body.data?.created]).toEqual([true, false]);
		expect(second.body.data?.task.id).toBe(first.body.data?.task.id);
		expect(await taskRows('app_twice')).toHaveLength(1);
	});

	it('makes one task of two clicks that arrive together, and a second language its own', async () => {
		await store('app_clicks', 'seller_1');
		const env = envFor(space());
		const [a, b] = await Promise.all([run(env, 'app_clicks', 'es'), run(env, 'app_clicks', 'es')]);
		const created = [(await answer<{ created: boolean }>(a)).body.data?.created, (await answer<{ created: boolean }>(b)).body.data?.created];
		expect(created.sort()).toEqual([false, true]);
		expect(await taskRows('app_clicks')).toHaveLength(1);
		await run(env, 'app_clicks', 'pt-BR');
		expect(await taskRows('app_clicks')).toHaveLength(2);
	});

	it('a language already on is not turned on again, so the store\'s version is not bumped for nothing', async () => {
		await store('app_on', 'seller_1');
		const service = new StoreTranslationService(envWith(db));
		await service.saveSettings('app_on', { targets: { es: { enabled: true } } });
		const before = (await service.settingsOf('app_on')).version;
		await run(envFor(space()), 'app_on', 'es');
		expect((await service.settingsOf('app_on')).version).toBe(before);
	});

	it('runs again as a new task once the last one is done, and a publish while one runs makes no second', async () => {
		await store('app_again', 'seller_1');
		const env = envFor(space());
		const first = await answer<{ task: { id: string } }>(await run(env, 'app_again', 'es'));
		await db.prepare("UPDATE tasks SET status = 'running' WHERE id = ?").bind(first.body.data?.task.id).run();
		expect((await answer<{ created: boolean }>(await run(env, 'app_again', 'es'))).body.data?.created).toBe(false);
		await db.prepare("UPDATE tasks SET status = 'done', finished_at = 1 WHERE id = ?").bind(first.body.data?.task.id).run();
		const next = await answer<{ task: { id: string }; created: boolean }>(await run(env, 'app_again', 'es'));
		expect(next.body.data?.created).toBe(true);
		expect(next.body.data?.task.id).not.toBe(first.body.data?.task.id);
	});

	it("refuses the store's own language and a language Estori doesn't speak with 400", async () => {
		await store('app_lang', 'seller_1');
		const env = envFor(space());
		const own = await answer(await run(env, 'app_lang', 'en'));
		expect(own.status).toBe(400);
		expect(own.body.error?.message).toContain('English');
		expect((await answer(await run(env, 'app_lang', 'fr'))).status).toBe(400);
		expect((await answer(await run(env, 'app_lang', 'toString'))).status).toBe(400);
		expect(await taskRows('app_lang')).toEqual([]);
		expect(woke).toEqual([]);
	});

	it('refuses a store never deployed with 409, queuing nothing and turning nothing on', async () => {
		await store('app_undeployed', 'seller_1', { deployed: false });
		const reply = await answer(await run(envFor(space()), 'app_undeployed', 'es'));
		expect(reply.status).toBe(409);
		expect(await taskRows('app_undeployed')).toEqual([]);
		expect((await new StoreTranslationService(envWith(db)).settingsOf('app_undeployed')).targets).toEqual({});
		expect(woke).toEqual([]);
	});

	it('accepts a store that was only ever published', async () => {
		await store('app_pubonly', 'seller_1', { deployed: false });
		await db.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_pubonly', 'pub-only', 'live', 'c1', 1, 1, 1)`).run();
		expect((await run(envFor(space()), 'app_pubonly', 'es')).status).toBe(200);
	});

	it('refuses with 429 at the limit of unfinished tasks, but still answers the same work already queued', async () => {
		await store('app_limit', 'seller_4');
		const tasks = new TaskService(envWith(db));
		for (let index = 0; index < 49; index += 1) await tasks.enqueue({ userId: 'seller_4', appId: null, kind: 'store.translate', payload: { appId: 'x', locale: 'es' }, dedupeKey: `other:${index}` });
		const env = envFor(space());
		const last = await run(env, 'app_limit', 'es', 'seller_4');
		expect(last.status).toBe(200);
		const refused = await answer(await run(env, 'app_limit', 'pt-BR', 'seller_4'));
		expect(refused.status).toBe(429);
		expect(refused.body.error?.message).toContain('too many unfinished tasks');
		// The refused language was not turned on; the one that was queued was.
		expect((await new StoreTranslationService(envWith(db)).settingsOf('app_limit')).targets).toEqual({ es: { enabled: true, ready: false } });
		expect((await answer<{ created: boolean }>(await run(env, 'app_limit', 'es', 'seller_4'))).body.data?.created).toBe(false);
	});

	it('leaves the language as it was when queuing the task throws, and wakes nothing', async () => {
		await store('app_throws', 'seller_1');
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(TaskService.prototype, 'enqueue').mockRejectedValueOnce(new Error('D1 is down'));
		const failed = await answer(await run(envFor(space()), 'app_throws', 'es'));
		expect(failed.status).toBe(500);
		const service = new StoreTranslationService(envWith(db));
		expect((await service.settingsOf('app_throws')).targets).toEqual({});
		expect(woke).toEqual([]);
		// The seller's next click goes through, and only then is the language on.
		expect((await run(envFor(space()), 'app_throws', 'es')).status).toBe(200);
		expect((await service.settingsOf('app_throws')).targets).toEqual({ es: { enabled: true, ready: false } });
	});

	it("words a refusal in the seller's saved language", async () => {
		await store('app_es', 'seller_2', { deployed: false });
		await store('app_pt', 'seller_3', { deployed: false });
		const spanish = await answer(await run(envFor(space()), 'app_es', 'pt-BR', 'seller_2'));
		expect(spanish.status).toBe(409);
		expect(spanish.body.error?.message).toBe(translateFor('es', msg('Publish or preview your store before translating it.')));
		expect(spanish.body.error?.message).toContain('Publica');
		const portuguese = await answer(await run(envFor(space()), 'app_pt', 'es', 'seller_3'));
		expect(portuguese.body.error?.message).toBe(translateFor('pt-BR', msg('Publish or preview your store before translating it.')));
		expect(portuguese.body.error?.message).toContain('Publique');
	});

	it("tells the language a store's own is its own, in the seller's words and the language's own name", async () => {
		await store('app_own_es', 'seller_2');
		const reply = await answer(await run(envFor(space()), 'app_own_es', 'es', 'seller_2'));
		expect(reply.status).toBe(400);
		expect(reply.body.error?.message).toContain('Español');
		expect(reply.body.error?.message).toContain('idioma original');
	});

	it("shows a language its unfinished task, even an older one that was resumed, and otherwise its newest", async () => {
		await store('app_resumed', 'seller_1');
		const env = envFor(space({ main: deployment('c1', WELCOME) }));
		const tasks = new TaskService(envWith(db));
		const first = (await answer<{ task: { id: string } }>(await run(env, 'app_resumed', 'es'))).body.data?.task.id ?? '';
		await db.prepare("UPDATE tasks SET status = 'failed', finished_at = 1 WHERE id = ?").bind(first).run();
		const second = (await answer<{ task: { id: string } }>(await run(env, 'app_resumed', 'es'))).body.data?.task.id ?? '';
		await db.prepare('UPDATE tasks SET created_at = created_at + 1000 WHERE id = ?').bind(second).run();
		await tasks.cancel(second, 'seller_1');

		// Neither is unfinished: the newest shows.
		const taskOf = async () => (await overviewOf(env, 'app_resumed')).languages.find((language) => language.locale === 'es')?.task;
		expect(await taskOf()).toMatchObject({ id: second, status: 'canceled' });
		// The older one is picked up again: it is the one that is working, so it shows.
		expect(await tasks.resume(first, 'seller_1')).not.toBeNull();
		expect(await taskOf()).toMatchObject({ id: first, status: 'queued' });
		// A newer finished one doesn't hide it, and the other language is unaffected.
		expect((await overviewOf(env, 'app_resumed')).languages.find((language) => language.locale === 'pt-BR')?.task).toBeNull();
	});

	it('shows each language its latest task in the overview', async () => {
		await store('app_latest', 'seller_1');
		const env = envFor(space({ main: deployment('c1', WELCOME) }));
		const first = await answer<{ task: { id: string } }>(await run(env, 'app_latest', 'es'));
		const overview = await overviewOf(env, 'app_latest');
		expect(overview.languages.find((language) => language.locale === 'es')?.task).toMatchObject({ id: first.body.data?.task.id, status: 'queued' });
		expect(overview.languages.find((language) => language.locale === 'pt-BR')?.task).toBeNull();
		expect(overview.languages.find((language) => language.locale === 'es')?.enabled).toBe(true);

		await new TaskService(envWith(db)).cancel(first.body.data?.task.id ?? '', 'seller_1');
		const second = await answer<{ task: { id: string }; created: boolean }>(await run(env, 'app_latest', 'es'));
		expect(second.body.data?.created).toBe(true);
		expect((await overviewOf(env, 'app_latest')).languages[0].task?.id).toBe(second.body.data?.task.id);
	});
});

describe("a store's settings", () => {
	const save = (appId: string, body: unknown, userId = 'seller_1') => StoreTranslationsController.saveSettings(request('PUT', body), envFor(space()), ctx, as(userId, { id: appId }));

	it('saves the switches and the languages, and answers the settings', async () => {
		await store('app_settings', 'seller_1');
		const reply = await answer<{ matchBrowser: boolean; showSwitcher: boolean; targets: Record<string, unknown>; version: number }>(await save('app_settings', { sourceLocale: 'en', matchBrowser: false, targets: { es: { enabled: true } } }));
		expect(reply.status).toBe(200);
		expect(reply.body.data).toMatchObject({ matchBrowser: false, showSwitcher: true, targets: { es: { enabled: true, ready: false } } });
		expect(await new StoreTranslationService(envWith(db)).settingsOf('app_settings')).toMatchObject({ matchBrowser: false, targets: { es: { enabled: true } } });
	});

	it('answers an empty patch with the settings as they are, without changing the version', async () => {
		await store('app_empty', 'seller_1');
		await new StoreTranslationService(envWith(db)).saveSettings('app_empty', { sourceLocale: 'en' });
		const before = (await new StoreTranslationService(envWith(db)).settingsOf('app_empty')).version;
		const reply = await answer<{ version: number }>(await save('app_empty', {}));
		expect(reply.body.data?.version).toBe(before);
		expect((await new StoreTranslationService(envWith(db)).settingsOf('app_empty')).version).toBe(before);
	});

	it('refuses what is not a setting with 400, saving nothing', async () => {
		await store('app_bad', 'seller_1');
		const service = new StoreTranslationService(envWith(db));
		const before = await service.settingsOf('app_bad');
		for (const body of [{ matchBrowser: 'yes' }, { sourceLocale: 'fr' }, { targets: { fr: { enabled: true } } }, { targets: { es: { enabled: 'on' } } }, { targets: { en: { enabled: true } } }, 'text', [], null]) {
			expect((await save('app_bad', body)).status, JSON.stringify(body)).toBe(400);
		}
		expect((await StoreTranslationsController.saveSettings(new Request('https://estori.app/api/x', { method: 'PUT', body: 'not json' }), envFor(space()), ctx, as('seller_1', { id: 'app_bad' }))).status).toBe(400);
		expect(await service.settingsOf('app_bad')).toEqual(before);
	});

	it("turns a language off when the seller makes it the store's own language", async () => {
		await store('app_source', 'seller_1');
		await save('app_source', { sourceLocale: 'en', targets: { es: { enabled: true }, 'pt-BR': { enabled: true } } });
		const reply = await answer<{ sourceLocale: string; targets: Record<string, { enabled: boolean }> }>(await save('app_source', { sourceLocale: 'es' }));
		expect(reply.body.data?.sourceLocale).toBe('es');
		expect(reply.body.data?.targets.es.enabled).toBe(false);
		expect(reply.body.data?.targets['pt-BR'].enabled).toBe(true);
	});
});

describe("a store's texts and the seller's own words", () => {
	let welcome: string;
	let fresh: string;

	beforeAll(async () => {
		[welcome, fresh] = [await textHash('Welcome to the shop'), await textHash('Fresh tea every day')];
	});

	async function seeded(appId: string): Promise<StoreTranslationService> {
		await store(appId, 'seller_1');
		const service = new StoreTranslationService(envWith(db));
		await service.replaceTexts(appId, [{ hash: welcome, text: 'Welcome to the shop', kind: 'page' }, { hash: fresh, text: 'Fresh tea every day', kind: 'page' }], Date.now());
		await service.upsertMachine(appId, 'es', [{ hash: welcome, source: 'Welcome to the shop', text: 'Bienvenido a la tienda' }]);
		return service;
	}

	const edit = (appId: string, hash: string, body: unknown, locale = 'es', userId = 'seller_1') =>
		StoreTranslationsController.saveText(request('PUT', body), envFor(space()), ctx, as(userId, { id: appId, locale, hash }));
	const revert = (appId: string, hash: string, locale = 'es') => StoreTranslationsController.revertText(request('DELETE'), envFor(space()), ctx, as('seller_1', { id: appId, locale, hash }));

	it('seller edit then revert', async () => {
		const service = await seeded('app_edit');
		const versionBefore = (await service.settingsOf('app_edit')).version;

		const edited = await answer(await edit('app_edit', welcome, { text: '  Bienvenidos a nuestra tienda  ' }));
		expect(edited.status).toBe(200);
		expect(edited.body.data).toEqual({ hash: welcome, source: 'Welcome to the shop', text: 'Bienvenidos a nuestra tienda', origin: 'seller', machineText: 'Bienvenido a la tienda' });
		expect((await service.settingsOf('app_edit')).version).toBeGreaterThan(versionBefore);
		// A machine translation run afterwards leaves the seller's words, and refreshes what they can go back to.
		await service.upsertMachine('app_edit', 'es', [{ hash: welcome, source: 'Welcome to the shop', text: 'Bienvenido a la tienda hoy' }]);
		expect((await service.dictionary('app_edit', 'es')).get(welcome)).toBe('Bienvenidos a nuestra tienda');

		const reverted = await answer(await revert('app_edit', welcome));
		expect(reverted.status).toBe(200);
		expect(reverted.body.data).toEqual({ hash: welcome, source: 'Welcome to the shop', text: 'Bienvenido a la tienda hoy', origin: 'machine', machineText: 'Bienvenido a la tienda hoy' });
		// Nothing left to go back to.
		expect((await revert('app_edit', welcome)).status).toBe(409);
	});

	it("saves the seller's words for a text the machine never translated, which then cannot be reverted", async () => {
		await seeded('app_mine');
		const saved = await answer(await edit('app_mine', fresh, { text: 'Té fresco todos los días' }));
		expect(saved.body.data).toMatchObject({ text: 'Té fresco todos los días', origin: 'seller', machineText: null });
		expect((await revert('app_mine', fresh)).status).toBe(409);
	});

	it('refuses an empty or too long translation, a text that is not there, and a hash that is not one, with the right status', async () => {
		await seeded('app_refuse');
		expect((await edit('app_refuse', welcome, { text: '   ' })).status).toBe(400);
		expect((await edit('app_refuse', welcome, {})).status).toBe(400);
		const tooLong = await answer(await edit('app_refuse', welcome, { text: 'x'.repeat(MAX_TEXT_CHARS + 1) }));
		expect(tooLong.status).toBe(400);
		expect(tooLong.body.error?.message).toContain('5,000');
		expect((await edit('app_refuse', welcome, { text: 'x'.repeat(MAX_TEXT_CHARS) })).status).toBe(200);
		expect((await edit('app_refuse', 'f'.repeat(64), { text: 'Hola' })).status).toBe(404);
		for (const hash of ['hash-a', '', 'F'.repeat(64), 'g'.repeat(64), 'a'.repeat(63)]) {
			expect((await edit('app_refuse', hash, { text: 'Hola' })).status, hash).toBe(404);
			expect((await revert('app_refuse', hash)).status, hash).toBe(404);
		}
	});

	it("writes the limit's number the way the seller's language does", async () => {
		const tooLong = { text: 'x'.repeat(MAX_TEXT_CHARS + 1) };
		// Each store is written in its owner's language, so each is translated into another.
		const limitFor = async (appId: string, userId: string, locale: string): Promise<string | undefined> => {
			await store(appId, userId);
			const reply = await answer(await edit(appId, welcome, tooLong, locale, userId));
			expect(reply.status).toBe(400);
			return reply.body.error?.message;
		};
		const english = await limitFor('app_max_en', 'seller_1', 'es');
		const spanish = await limitFor('app_max_es', 'seller_2', 'pt-BR');
		const portuguese = await limitFor('app_max_pt', 'seller_3', 'es');
		expect(english).toContain('5,000');
		expect(spanish).toContain(formatNumber(MAX_TEXT_CHARS, 'es'));
		expect(portuguese).toContain('5.000');
		expect(spanish).not.toContain('{max}');
		expect(portuguese).toContain('caracteres');
	});

	it("refuses the store's own language and a language that isn't one", async () => {
		await seeded('app_langs');
		expect((await edit('app_langs', welcome, { text: 'Welcome' }, 'en')).status).toBe(400);
		expect((await edit('app_langs', welcome, { text: 'Bonjour' }, 'fr')).status).toBe(400);
		expect((await revert('app_langs', welcome, 'en')).status).toBe(400);
		expect((await StoreTranslationsController.texts(request(), envFor(space()), ctx, as('seller_1', { id: 'app_langs', locale: 'en' }))).status).toBe(400);
	});

	it('lists the texts in pages with their translations, searchable, and refuses a cursor it did not hand out', async () => {
		await store('app_pages', 'seller_1');
		const service = new StoreTranslationService(envWith(db));
		const texts = await Promise.all(Array.from({ length: STORE_TRANSLATION_PAGE_SIZE + 10 }, async (_, index) => ({ hash: await textHash(`Item ${index}`), text: `Item ${index}`, kind: 'page' as const })));
		await service.replaceTexts('app_pages', texts, Date.now());
		await service.upsertMachine('app_pages', 'es', [{ hash: texts[0].hash, source: 'Item 0', text: 'Artículo 0' }]);
		const list = (query = '') => StoreTranslationsController.texts(request(), envFor(space()), ctx, as('seller_1', { id: 'app_pages', locale: 'es' }, query));

		const first = await answer<{ rows: Array<{ hash: string; text: string | null }>; nextCursor: string | null }>(await list());
		expect(first.body.data?.rows).toHaveLength(STORE_TRANSLATION_PAGE_SIZE);
		expect(first.body.data?.rows[0]).toMatchObject({ hash: texts[0].hash, text: 'Artículo 0' });
		expect(first.body.data?.rows[1].text).toBeNull();
		const nextCursor = first.body.data?.nextCursor ?? '';
		expect(nextCursor).not.toBe('');
		const second = await answer<{ rows: unknown[]; nextCursor: string | null }>(await list(`cursor=${encodeURIComponent(nextCursor)}`));
		expect(second.body.data?.rows).toHaveLength(10);
		expect(second.body.data?.nextCursor).toBeNull();

		const found = await answer<{ rows: Array<{ source: string }> }>(await list('query=artículo'));
		expect(found.body.data?.rows.map((row) => row.source)).toEqual(['Item 0']);

		for (const cursor of ['abc', '1:', '1:2:3', '-1:2', "1;DROP TABLE tasks"]) {
			expect((await list(`cursor=${encodeURIComponent(cursor)}`)).status, cursor).toBe(400);
		}
	});
});

describe('who may reach the translations API', () => {
	const routes: Array<[string, string]> = [
		['GET', '/api/stores/app_acl/translations'],
		['PUT', '/api/stores/app_acl/translations/settings'],
		['POST', '/api/stores/app_acl/translations/es/run'],
		['GET', '/api/stores/app_acl/translations/es/texts'],
		['PUT', `/api/stores/app_acl/translations/es/texts/${'a'.repeat(64)}`],
		['DELETE', `/api/stores/app_acl/translations/es/texts/${'a'.repeat(64)}`],
	];

	/** The routes mounted as the worker mounts them, with the signed-in user already known. */
	function api(env: Env) {
		const app = new Hono<AppEnv>();
		app.use('*', async (c, next) => {
			const id = c.req.header('x-test-user');
			c.set('user', id ? ({ id, email: `${id}@example.test` } as AuthUser) : null);
			await next();
		});
		setupTranslationRoutes(app);
		const executionCtx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
		return (method: string, path: string, user: string) =>
			app.request(path, { method, headers: { 'x-test-user': user, 'Content-Type': 'application/json' }, body: method === 'PUT' ? JSON.stringify({ text: 'Hola', matchBrowser: true }) : undefined }, env, executionCtx);
	}

	it('another seller gets 403 on every store route, and changes nothing', async () => {
		await store('app_acl', 'seller_1');
		const call = api(envFor(space()));
		for (const [method, path] of routes) {
			const reply = await answer(await call(method, path, 'seller_2'));
			expect(reply.status, `${method} ${path}`).toBe(403);
		}
		expect(await db.prepare('SELECT count(*) AS n FROM tasks').first()).toEqual({ n: 0 });
		expect(await db.prepare("SELECT count(*) AS n FROM store_translation_settings WHERE app_id = 'app_acl'").first()).toEqual({ n: 0 });
		expect(woke).toEqual([]);
		// The owner is let in.
		expect((await call('GET', '/api/stores/app_acl/translations', 'seller_1')).status).toBe(200);
	});

	it('paused flag answers 503 on every route of the API but cancel, in the seller\'s language, doing nothing', async () => {
		await store('app_paused', 'seller_2');
		const env = envFor(space({ main: deployment('c1', WELCOME) }), { FEATURE_FLAG_OVERRIDES: 'store-translations-paused=on' });
		const call = api(env);
		const all: Array<[string, string]> = [
			['GET', '/api/translations/stores'],
			...routes.map(([method, path]): [string, string] => [method, path.replace('app_acl', 'app_paused')]),
			['GET', '/api/tasks'],
			['POST', '/api/tasks/task_1/resume'],
		];
		for (const [method, path] of all) {
			const reply = await answer(await call(method, path, 'seller_2'));
			expect(reply.status, `${method} ${path}`).toBe(503);
			expect(reply.body.error?.message, `${method} ${path}`).toBe(translateFor('es', STORE_TRANSLATIONS_PAUSED_MESSAGE));
		}
		expect(await db.prepare('SELECT count(*) AS n FROM tasks').first()).toEqual({ n: 0 });
		expect(await db.prepare("SELECT count(*) AS n FROM store_translation_settings WHERE app_id = 'app_paused'").first()).toEqual({ n: 0 });
		expect(woke).toEqual([]);
		// A seller can always cancel: a task that isn't there is not found, not paused.
		expect((await call('POST', '/api/tasks/task_1/cancel', 'seller_2')).status).toBe(404);

		// With the flag off, the same request is served.
		const open = api(envFor(space({ main: deployment('c1', WELCOME) })));
		expect((await open('GET', '/api/stores/app_paused/translations', 'seller_2')).status).toBe(200);
	});
});
