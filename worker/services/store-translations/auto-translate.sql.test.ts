/**
 * Translating after a publish, on real SQL with the seller's runner and SpaceDO stood in: a task for each language
 * that is on and ready, only when the seller allows it, never a second one for work already queued, and never an error
 * for the publish it follows.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { DeploymentTexts } from '@space-do/space';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { TaskService } from '../../database/services/TaskService';
import { MAX_UNFINISHED_TASKS } from '../../../shared/types/tasks';
import { translateAfterPublish } from './auto-translate';
import { translationDedupeKey } from './translate-kind';

let db: D1Database;
let woke: string[];
let spaceCalls: string[];
let warn: MockInstance;
let error: MockInstance;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
});

beforeEach(() => {
	woke = [];
	spaceCalls = [];
	warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

const published: DeploymentTexts = { branch: 'live', commitHash: 'c1', files: [{ path: '/index.html', kind: 'html', text: '<h1>Fresh tea every day</h1>' }], manifest: null };

function envFor(extra: Record<string, unknown> = {}): Env {
	const stub = {
		async getActiveDraft() {
			spaceCalls.push('getActiveDraft');
			return { id: 'main', name: 'Main', branch: 'main', tip: null };
		},
		async getDeploymentTexts(branch: string) {
			spaceCalls.push(`getDeploymentTexts:${branch}`);
			return branch === 'live' ? published : null;
		},
	};
	return envWith(db, {
		SPACE_DO: { idFromName: (name: string) => name, get: () => stub },
		TASK_RUNNER: { idFromName: (name: string) => name, get: () => ({ wake: async (userId: string) => void woke.push(userId) }) },
		...extra,
	});
}

async function store(id: string, languages: { on?: Array<'en' | 'es' | 'pt-BR'>; ready?: Array<'en' | 'es' | 'pt-BR'>; autoTranslate?: boolean; sourceLocale?: 'en' | 'es' | 'pt-BR' }): Promise<void> {
	await insertApp(db, { id, userId: 'seller_1' });
	const service = new StoreTranslationService(envWith(db));
	await service.saveSettings(id, { autoTranslate: languages.autoTranslate, sourceLocale: languages.sourceLocale, targets: Object.fromEntries((languages.on ?? []).map((locale) => [locale, { enabled: true }])) });
	for (const locale of languages.ready ?? []) await service.markReady(id, locale);
}

const tasksOf = async (appId: string) => (await db.prepare('SELECT dedupe_key, status, user_id FROM tasks WHERE app_id = ? ORDER BY dedupe_key').bind(appId).all<{ dedupe_key: string; status: string; user_id: string }>()).results;

describe('translating after a publish', () => {
	it('publish enqueues for ready languages only when autoTranslate', async () => {
		await store('app_ready', { on: ['es', 'pt-BR'], ready: ['es'] });
		await translateAfterPublish(envFor(), 'app_ready', 'seller_1');
		expect(await tasksOf('app_ready')).toEqual([{ dedupe_key: translationDedupeKey('app_ready', 'es'), status: 'queued', user_id: 'seller_1' }]);
		expect(woke).toEqual(['seller_1']);

		await store('app_off', { on: ['es'], ready: ['es'], autoTranslate: false });
		woke = [];
		await translateAfterPublish(envFor(), 'app_off', 'seller_1');
		expect(await tasksOf('app_off')).toEqual([]);
		expect(woke).toEqual([]);
	});

	it('queues a task for every language that is on and ready, each with its own payload', async () => {
		await store('app_both', { on: ['es', 'pt-BR'], ready: ['es', 'pt-BR'] });
		await translateAfterPublish(envFor(), 'app_both', 'seller_1');
		expect((await tasksOf('app_both')).map((task) => task.dedupe_key)).toEqual([translationDedupeKey('app_both', 'es'), translationDedupeKey('app_both', 'pt-BR')]);
		const payloads = (await db.prepare("SELECT payload FROM tasks WHERE app_id = 'app_both' ORDER BY dedupe_key").all<{ payload: string }>()).results.map((row) => JSON.parse(row.payload));
		expect(payloads).toEqual([{ appId: 'app_both', locale: 'es' }, { appId: 'app_both', locale: 'pt-BR' }]);
	});

	it('leaves alone a language that is ready but was turned off, one never finished, and the store\'s own language', async () => {
		await store('app_off_lang', { on: ['es', 'pt-BR'], ready: ['es', 'pt-BR'] });
		await new StoreTranslationService(envWith(db)).saveSettings('app_off_lang', { targets: { es: { enabled: false } } });
		await translateAfterPublish(envFor(), 'app_off_lang', 'seller_1');
		expect((await tasksOf('app_off_lang')).map((task) => task.dedupe_key)).toEqual([translationDedupeKey('app_off_lang', 'pt-BR')]);

		await store('app_unfinished', { on: ['es'] });
		await translateAfterPublish(envFor(), 'app_unfinished', 'seller_1');
		expect(await tasksOf('app_unfinished')).toEqual([]);

		// Written in Spanish: Spanish is never a language it is translated into, whatever the flags say.
		await store('app_source', { on: ['en'], ready: ['en'], sourceLocale: 'es' });
		await db.prepare("UPDATE store_translation_settings SET targets = json_set(targets, '$.es', json('{\"enabled\":true,\"ready\":true}')) WHERE app_id = 'app_source'").run();
		await translateAfterPublish(envFor(), 'app_source', 'seller_1');
		expect((await tasksOf('app_source')).map((task) => task.dedupe_key)).toEqual([translationDedupeKey('app_source', 'en')]);
	});

	it('does nothing for a store that has never had translation settings', async () => {
		await insertApp(db, { id: 'app_plain', userId: 'seller_1' });
		await translateAfterPublish(envFor(), 'app_plain', 'seller_1');
		expect(await tasksOf('app_plain')).toEqual([]);
		expect(woke).toEqual([]);
		expect(await db.prepare("SELECT count(*) AS n FROM store_translation_settings WHERE app_id = 'app_plain'").first()).toEqual({ n: 0 });
	});

	it('a publish during a running task adds no second task and no second charge, and the running task gets the new text', async () => {
		await store('app_running', { on: ['es'], ready: ['es'] });
		await db.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_running', 'running-tea', 'live', 'c1', 1, 1, 1)`).run();
		await translateAfterPublish(envFor(), 'app_running', 'seller_1');
		const [task] = await tasksOf('app_running');
		await db.prepare("UPDATE tasks SET status = 'running', credits_used = 7, steps = 2 WHERE app_id = 'app_running'").run();
		woke = [];
		spaceCalls = [];

		await translateAfterPublish(envFor(), 'app_running', 'seller_1');
		expect(await tasksOf('app_running')).toEqual([{ ...task, status: 'running' }]);
		expect(await db.prepare("SELECT credits_used, steps FROM tasks WHERE app_id = 'app_running'").first()).toEqual({ credits_used: 7, steps: 2 });
		// The new text is read, so the running task finds it on its next step.
		expect(spaceCalls).toContain('getDeploymentTexts:live');
		expect((await new StoreTranslationService(envWith(db)).missingTexts('app_running', 'es', 10)).map((text) => text.text)).toEqual(['Fresh tea every day']);
		expect(woke).toEqual(['seller_1']);
	});

	it('reads the store again only when a task for it was already there', async () => {
		await store('app_fresh_read', { on: ['es'], ready: ['es'] });
		await translateAfterPublish(envFor(), 'app_fresh_read', 'seller_1');
		expect(spaceCalls).toEqual([]);
	});

	it('does nothing while translations are paused', async () => {
		await store('app_paused', { on: ['es'], ready: ['es'] });
		await translateAfterPublish(envFor({ FEATURE_FLAG_OVERRIDES: 'store-translations-paused=on' }), 'app_paused', 'seller_1');
		expect(await tasksOf('app_paused')).toEqual([]);
		expect(woke).toEqual([]);
	});

	it('queues what it can for a seller at the task limit, logging the rest, and does not throw', async () => {
		await store('app_limit', { on: ['es', 'pt-BR'], ready: ['es', 'pt-BR'] });
		const tasks = new TaskService(envWith(db));
		for (let index = 0; index < MAX_UNFINISHED_TASKS - 1; index += 1) await tasks.enqueue({ userId: 'seller_1', appId: null, kind: 'store.translate', payload: { appId: 'x', locale: 'es' }, dedupeKey: `other:${index}` });
		await expect(translateAfterPublish(envFor(), 'app_limit', 'seller_1')).resolves.toBeUndefined();
		expect((await tasksOf('app_limit')).map((task) => task.dedupe_key)).toEqual([translationDedupeKey('app_limit', 'es')]);
		expect(warn).toHaveBeenCalled();
		expect(woke).toEqual(['seller_1']);
	});

	it('never throws, whatever fails: the publish it follows has already succeeded', async () => {
		await store('app_broken', { on: ['es'], ready: ['es'] });
		await expect(translateAfterPublish({} as Env, 'app_broken', 'seller_1')).resolves.toBeUndefined();
		expect(error).toHaveBeenCalled();
		// A runner that can't be woken is logged, and the task waits for the sweep.
		await translateAfterPublish(envFor({ TASK_RUNNER: { idFromName: () => 'x', get: () => ({ wake: async () => Promise.reject(new Error('runner down')) }) } }), 'app_broken', 'seller_1');
		expect((await tasksOf('app_broken')).map((task) => task.status)).toEqual(['queued']);
	});
});
