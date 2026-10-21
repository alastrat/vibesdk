/**
 * The translation task kind against real SQL, driven by the real runner, with a fake model and a fake store reader:
 * batches, retries and skips, seller edits, finishing, and the stores that have nothing to translate.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Locale } from '../../../shared/i18n/locales';
import { TASK_MODEL_ID, TRANSLATION_BATCH_MAX_CHARS, TRANSLATION_BATCH_MAX_TEXTS, type StoreText } from '../../../shared/types/store-translations';
import { TASK_FAILED_MESSAGE, TASK_RETRY_MESSAGE } from '../../../shared/types/tasks';
import { TaskService, type TaskRecord } from '../../database/services/TaskService';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { taskKind, type ModelCall, type TaskStepContext } from '../tasks/kinds';
import { runTaskTick } from '../tasks/runner';
import type { TaskModel } from '../tasks/task-model';
import type { TaskMeter } from '../tasks/meter';
import type { TranslationItem } from './prompt';
import type { RefreshedStoreTexts } from './texts';
import { createStoreTranslateKind, storeTranslateKind, translationDedupeKey, type TranslatePayload } from './translate-kind';

const NOW = 1_800_000_000_000;
const HOURS_3 = 3 * 60 * 60 * 1000;
const CALL: ModelCall = { model: TASK_MODEL_ID, usage: { inputTokens: 100, outputTokens: 80 } };
const PAYLOAD: TranslatePayload = { appId: 'app_1', locale: 'es' };
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_1', userId: 'seller_1' });
});

// The runner logs each failed step, which several tests cause on purpose.
let errorLog: MockInstance<typeof console.error>;
beforeEach(() => {
	errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	errorLog.mockRestore();
});

const service = () => new StoreTranslationService(envWith(db));

type Reply = Array<{ id: string; text: string }> | Error;
type Answer = (items: TranslationItem[], request: number) => Reply | Promise<Reply>;

interface Request {
	system: string;
	prompt: string;
	maxOutputTokens: number;
	items: TranslationItem[];
}

const translateAll: Answer = (items) => items.map(({ id, text }) => ({ id, text: `ES ${text}` }));

function fakeModel(answer: Answer = translateAll) {
	const requests: Request[] = [];
	const model: TaskModel = {
		async generate({ system, prompt, schema, maxOutputTokens }) {
			const items = JSON.parse(prompt) as TranslationItem[];
			requests.push({ system, prompt, maxOutputTokens, items });
			const reply = await answer(items, requests.length);
			if (reply instanceof Error) throw reply;
			return { object: schema.parse({ items: reply }), call: CALL };
		},
	};
	return { model, requests, texts: () => requests.flatMap((request) => request.items.map((item) => item.text)) };
}

const numbered = (count: number): StoreText[] => Array.from({ length: count }, (_, index) => ({ hash: `h${index + 1}`, text: `Text ${index + 1}`, kind: 'page' }));
const named = (...texts: string[]): StoreText[] => texts.map((text, index) => ({ hash: `h${index + 1}`, text, kind: 'page' }));

/** Stores the texts as a fresh read of the store's deployments would. */
function reading(texts: StoreText[]) {
	const reads: string[] = [];
	const refresh = async (env: Env, appId: string): Promise<RefreshedStoreTexts> => {
		reads.push(appId);
		await new StoreTranslationService(env).replaceTexts(appId, texts, NOW);
		return { count: texts.length, truncated: false, deployed: true };
	};
	return { refresh, reads };
}

const meter: TaskMeter = { gate: async () => ({ ok: true }), charge: async ({ calls }) => calls.length };

function queue(deps: { model: TaskModel; refresh: (env: Env, appId: string) => Promise<RefreshedStoreTexts> }) {
	const env = envWith(db);
	const tasks = new TaskService(env);
	const kind = createStoreTranslateKind({ model: () => deps.model, refresh: deps.refresh });
	let now = NOW;
	let taskId = '';

	async function read(): Promise<TaskRecord> {
		const found = (await tasks.listForUser('seller_1', { limit: 20 })).find((task) => task.id === taskId);
		if (!found) throw new Error('No task');
		return found;
	}

	/** Queues the task; `taskAppId` is the store the task row names, which a sound task shares with its payload. */
	async function start(payload: TranslatePayload = PAYLOAD, taskAppId: string = payload.appId): Promise<TaskRecord> {
		const result = await tasks.enqueue({ userId: 'seller_1', appId: taskAppId, kind: 'store.translate', payload, dedupeKey: translationDedupeKey(payload.appId, payload.locale), now });
		if (!('task' in result)) throw new Error(`Refused: ${result.refused}`);
		taskId = result.task.id;
		return result.task;
	}

	/** One alarm of the seller's runner, as long after the last as the longest retry wait. */
	async function tick(): Promise<TaskRecord> {
		await runTaskTick({ store: tasks, meter, kinds: () => kind, env, ended: () => undefined }, 'seller_1', now);
		now += HOURS_3;
		return read();
	}

	async function finish(maxTicks = 60): Promise<TaskRecord> {
		let task = await read();
		for (let ticks = 0; ticks < maxTicks && !['done', 'failed', 'canceled'].includes(task.status); ticks += 1) task = await tick();
		return task;
	}

	return { kind, read, start, tick, finish };
}

const rowsOf = async (locale: Locale = 'es') => (await service().listRows('app_1', locale, { limit: 200 })).rows;
const translated = async (locale: Locale = 'es') => new Map((await rowsOf(locale)).filter((row) => row.text !== null).map((row) => [row.source, row.text]));
/** What shoppers are told about the language: undefined until a task has made it ready. */
const targetOf = async (locale: Locale = 'es') => (await service().settingsOf('app_1')).targets[locale];

describe('the store.translate kind', () => {
	it('is registered, reads its payload, and keys one task per store and language', () => {
		expect(taskKind('store.translate')).toBe(storeTranslateKind);
		expect(storeTranslateKind.parsePayload({ appId: 'app_1', locale: 'pt-BR' })).toEqual({ appId: 'app_1', locale: 'pt-BR' });
		// Anything unreadable is null, and reading never throws: the runner calls it outside its error handling.
		for (const bad of [undefined, null, 'es', 42, [], ['app_1', 'es'], {}, { appId: 'app_1' }, { appId: '', locale: 'es' }, { appId: 'app_1', locale: 'fr' }, { appId: 7, locale: 'es' }, { appId: 'app_1', locale: ['es'] }]) {
			expect(storeTranslateKind.parsePayload(bad), JSON.stringify(bad)).toBeNull();
		}
		expect(translationDedupeKey('app_1', 'pt-BR')).toBe('store.translate:app_1:pt-BR');
	});

	it('the first step refreshes texts and sets total to the missing count', async () => {
		const model = fakeModel();
		const store = reading(numbered(5));
		const run = queue({ model: model.model, refresh: store.refresh });
		await service().replaceTexts('app_1', numbered(5), NOW);
		// Two of the five are translated already, so only three are missing.
		await service().upsertMachine('app_1', 'es', [{ hash: 'h1', source: 'Text 1', text: 'Texto 1' }], NOW);
		await service().setSellerText('app_1', 'es', 'h2', 'Mi texto', NOW);
		await run.start();

		const task = await run.tick();

		expect(store.reads).toEqual(['app_1']);
		expect(task).toMatchObject({ status: 'running', steps: 1, creditsUsed: 0, progress: { done: 0, total: 3, skipped: 0 } });
		expect(model.requests).toHaveLength(0);
		expect(await translated()).toEqual(new Map([['Text 1', 'Texto 1'], ['Text 2', 'Mi texto']]));
	});

	it('each step translates one batch of at most 40 texts or 12,000 characters and saves it', async () => {
		const model = fakeModel();
		const run = queue({ model: model.model, refresh: reading(numbered(100)).refresh });
		await run.start();

		await run.tick();
		const first = await run.tick();
		expect(model.requests).toHaveLength(1);
		expect(model.requests[0].items.map((item) => item.id)).toEqual(Array.from({ length: TRANSLATION_BATCH_MAX_TEXTS }, (_, index) => String(index + 1)));
		expect(model.requests[0].items[0]).toEqual({ id: '1', text: 'Text 1' });
		expect(first).toMatchObject({ status: 'running', creditsUsed: 1, progress: { done: 40, total: 100, skipped: 0 } });
		// What a batch saved is stored before the next step starts.
		expect((await translated()).get('Text 40')).toBe('ES Text 40');
		expect((await translated()).has('Text 41')).toBe(false);

		const last = await run.finish();
		expect(model.requests.map((request) => request.items.length)).toEqual([40, 40, 20]);
		expect(last).toMatchObject({ status: 'done', creditsUsed: 3, steps: 4, progress: { done: 100, total: 100, skipped: 0 } });
		expect((await translated()).size).toBe(100);
	});

	it('keeps a batch of long texts under 12,000 characters, with at least one text', async () => {
		const long = (letter: string) => letter.repeat(4_500);
		const texts = named(long('a'), long('b'), long('c'), long('d'), long('e'));
		const model = fakeModel();
		const run = queue({ model: model.model, refresh: reading(texts).refresh });
		await run.start();

		await run.finish();

		expect(model.requests.map((request) => request.items.length)).toEqual([2, 2, 1]);
		for (const request of model.requests) expect(request.items.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(TRANSLATION_BATCH_MAX_CHARS);
		// About twice the batch's estimated tokens.
		const chars = 2 * 4_500;
		expect(model.requests[0].maxOutputTokens).toBeGreaterThanOrEqual(2 * Math.ceil(chars / 4));
		expect(model.requests[0].maxOutputTokens).toBeLessThanOrEqual(2.5 * Math.ceil(chars / 4));
		expect((await translated()).size).toBe(5);
	});

	it('a batch missing ids or breaking placeholders retries once naming the problem, then counts the rest as skipped', async () => {
		const texts = named('Hello {name}', 'Order <b>now</b>', 'Plain', 'Never answered', 'Fine');
		const answer: Answer = (items, request) =>
			request === 1
				? // The first answer drops a placeholder and leaves out id 4.
					items.filter((item) => item.id !== '4').map(({ id, text }) => ({ id, text: id === '1' ? 'Hola' : `ES ${text}` }))
				: items.filter((item) => item.id === '1').map(({ id, text }) => ({ id, text: `ES ${text}` }));
		const model = fakeModel(answer);
		const run = queue({ model: model.model, refresh: reading(texts).refresh });
		await run.start();

		await run.tick();
		const task = await run.tick();

		expect(model.requests).toHaveLength(2);
		// The retry holds only the failures, with their ids and what was wrong.
		expect(model.requests[1].items.map((item) => [item.id, item.text])).toEqual([['1', 'Hello {name}'], ['4', 'Never answered']]);
		expect(model.requests[1].items[0].problem).toMatch(/\{name\}/);
		expect(model.requests[1].items[1].problem).toMatch(/no translation/i);
		expect(model.requests[1].system).toMatch(/problem/i);
		expect(model.requests[0].items.every((item) => item.problem === undefined)).toBe(true);

		expect(await translated()).toEqual(
			new Map([['Hello {name}', 'ES Hello {name}'], ['Order <b>now</b>', 'ES Order <b>now</b>'], ['Plain', 'ES Plain'], ['Fine', 'ES Fine']]),
		);
		// Both calls are charged; the text that never came back is skipped and nothing else is left.
		expect(task).toMatchObject({ status: 'done', creditsUsed: 2, progress: { done: 4, total: 5, skipped: 1 } });
		expect(task.progress.skippedHashes).toEqual(['h4']);
		// Four of five translated is most of the store, so the language is ready.
		expect(await targetOf()).toEqual({ enabled: true, ready: true });
	});

	it('ignores ids outside the batch and keeps the first answer for an id given twice', async () => {
		const model = fakeModel((items) => [
			{ id: '1', text: 'ES first' },
			{ id: '1', text: 'ES second' },
			{ id: '99', text: 'ES nobody asked' },
			...items.slice(1).map(({ id, text }) => ({ id, text: `ES ${text}` })),
		]);
		const run = queue({ model: model.model, refresh: reading(named('First', 'Second')).refresh });
		await run.start();

		const task = await run.finish();

		expect(await translated()).toEqual(new Map([['First', 'ES first'], ['Second', 'ES Second']]));
		expect(task).toMatchObject({ status: 'done', progress: { done: 2, total: 2, skipped: 0 } });
		expect(model.requests).toHaveLength(1);
	});

	it('a text still bad after the retry is not taken again by the task, and a later task tries it again', async () => {
		const texts = [...named('Hello {name}'), ...numbered(45).slice(1).map((text) => ({ ...text, hash: `n${text.hash}` }))];
		const model = fakeModel((items) => items.map(({ id, text }) => ({ id, text: text === 'Hello {name}' ? 'Hola' : `ES ${text}` })));
		const run = queue({ model: model.model, refresh: reading(texts).refresh });
		await run.start();

		const task = await run.finish();

		// 40 texts, the retry of the one bad text, then the last 5 without it.
		expect(model.requests.map((request) => request.items.length)).toEqual([40, 1, 5]);
		expect(model.requests[2].items.map((item) => item.text)).not.toContain('Hello {name}');
		expect(task).toMatchObject({ status: 'done', progress: { done: 44, total: 45, skipped: 1 } });
		expect((await translated()).has('Hello {name}')).toBe(false);
		expect(await targetOf()).toEqual({ enabled: true, ready: true });

		// The text is still missing, so the next task for the language picks it up.
		const fixed = fakeModel();
		const next = queue({ model: fixed.model, refresh: reading(texts).refresh });
		await next.start();
		await next.finish();
		expect(fixed.texts()).toEqual(['Hello {name}']);
		expect((await translated()).get('Hello {name}')).toBe('ES Hello {name}');
	});

	it('a language is ready when at least half of the task\'s texts were translated, and not otherwise', async () => {
		// Two of four is half: ready.
		const half = fakeModel((items) => items.filter((item) => Number(item.id) <= 2).map(({ id, text }) => ({ id, text: `ES ${text}` })));
		const halfRun = queue({ model: half.model, refresh: reading(numbered(4)).refresh });
		await halfRun.start();
		expect(await halfRun.finish()).toMatchObject({ status: 'done', progress: { done: 2, total: 4, skipped: 2 } });
		expect(await targetOf()).toEqual({ enabled: true, ready: true });
	});

	it("most of a store's texts skipped ends the task failed with a message for the seller, and the language is not ready", async () => {
		// One of four translated.
		const model = fakeModel((items) => items.filter((item) => item.id === '1').map(({ id, text }) => ({ id, text: `ES ${text}` })));
		const run = queue({ model: model.model, refresh: reading(numbered(4)).refresh });
		await run.start();

		const task = await run.finish();

		expect(task).toMatchObject({ status: 'failed', lastError: "Couldn't translate most of your store's text.", progress: { done: 1, total: 4, skipped: 3 } });
		expect(await targetOf()).toBeUndefined();
		// What was translated stays.
		expect(await translated()).toEqual(new Map([['Text 1', 'ES Text 1']]));
	});

	it("a task that failed for skipped texts tries them again when the seller retries, and is ready when they get through", async () => {
		let working = false;
		const model = fakeModel((items) => (working ? translateAll(items, 1) : items.filter((item) => item.id === '1').map(({ id, text }) => ({ id, text: `ES ${text}` }))));
		const run = queue({ model: model.model, refresh: reading(numbered(4)).refresh });
		const queued = await run.start();
		expect(await run.finish()).toMatchObject({ status: 'failed' });

		working = true;
		const resumed = await new TaskService(envWith(db)).resume(queued.id, 'seller_1', NOW);
		expect(resumed).toMatchObject({ status: 'queued' });
		const task = await run.finish();

		expect(task).toMatchObject({ status: 'done', lastError: null, progress: { done: 4, total: 4, skipped: 0 } });
		expect(await targetOf()).toEqual({ enabled: true, ready: true });
		expect((await translated()).size).toBe(4);
	});

	it('stops after 500 skipped texts and fails, keeping no more than 500 hashes while it runs', async () => {
		const model = fakeModel(() => []);
		const run = queue({ model: model.model, refresh: reading(numbered(600)).refresh });
		await run.start();

		const task = await run.finish();

		expect(task).toMatchObject({ status: 'failed', lastError: "Couldn't translate most of your store's text.", progress: { done: 0, total: 600, skipped: 500 } });
		// A failed task forgets what it gave up on, so that Retry tries those texts again.
		expect(task.progress.skippedHashes).toEqual([]);
		// Thirteen batches, each asked twice.
		expect(model.requests).toHaveLength(26);
		expect(await targetOf()).toBeUndefined();
	});

	it('finishes when nothing is missing, marks the language ready and bumps the version', async () => {
		const model = fakeModel();
		const run = queue({ model: model.model, refresh: reading(numbered(3)).refresh });
		await run.start();
		await service().replaceTexts('app_1', numbered(3), NOW);
		const before = await service().settingsOf('app_1');
		expect(before.targets.es).toBeUndefined();

		const task = await run.finish();

		const after = await service().settingsOf('app_1');
		expect(task).toMatchObject({ status: 'done', progress: { done: 3, total: 3, skipped: 0 } });
		expect(after.targets.es).toEqual({ enabled: true, ready: true });
		expect(after.version).toBeGreaterThan(before.version);

		// Run again over a fully translated store: nothing is sent, and the task is done at once.
		const again = fakeModel();
		const second = queue({ model: again.model, refresh: reading(numbered(3)).refresh });
		await second.start();
		expect(await second.tick()).toMatchObject({ status: 'done', progress: { done: 0, total: 0, skipped: 0 }, steps: 1 });
		expect(again.requests).toHaveLength(0);
	});

	it('a store with no texts finishes at once with total 0', async () => {
		for (const refreshed of [
			{ count: 0, truncated: false, deployed: false },
			{ count: 0, truncated: false, deployed: true },
		]) {
			const model = fakeModel();
			const run = queue({ model: model.model, refresh: async () => refreshed });
			await run.start();

			const task = await run.tick();

			expect(task, JSON.stringify(refreshed)).toMatchObject({ status: 'done', steps: 1, creditsUsed: 0, progress: { done: 0, total: 0, skipped: 0 } });
			expect(model.requests).toHaveLength(0);
			// A store with no text, or never deployed, has nothing to serve in the language yet.
			expect(await targetOf(), JSON.stringify(refreshed)).toBeUndefined();
		}
	});

	it('a store whose texts are all translated already is ready at once, without a model call', async () => {
		await service().replaceTexts('app_1', numbered(2), NOW);
		await service().upsertMachine('app_1', 'es', [{ hash: 'h1', source: 'Text 1', text: 'Texto 1' }], NOW);
		await service().setSellerText('app_1', 'es', 'h2', 'Mi texto', NOW);
		const model = fakeModel();
		const run = queue({ model: model.model, refresh: reading(numbered(2)).refresh });
		await run.start();

		expect(await run.tick()).toMatchObject({ status: 'done', steps: 1, progress: { done: 0, total: 0, skipped: 0 } });

		expect(model.requests).toHaveLength(0);
		expect(await targetOf()).toEqual({ enabled: true, ready: true });
	});

	it('a store whose texts cannot be read is not finished: the step throws, and nothing is sent', async () => {
		const model = fakeModel();
		const refresh = async (): Promise<RefreshedStoreTexts> => ({ count: 0, truncated: false, deployed: false, error: 'unavailable' });
		const run = queue({ model: model.model, refresh });
		const task = await run.start();
		const context: TaskStepContext = { env: envWith(db), task, now: NOW };

		const failure = await run.kind.step(context, PAYLOAD).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		expect(run.kind.describeError?.(failure)).toBe("Couldn't read your store right now.");
		expect(model.requests).toHaveLength(0);
		// Through the runner, the task backs off to try again, and the seller reads the kind's message.
		expect(await run.tick()).toMatchObject({ status: 'queued', attempts: 1, steps: 0, lastError: "Couldn't read your store right now." });
	});

	it('translating into the language the store is written in is nothing to do', async () => {
		const model = fakeModel();
		const run = queue({ model: model.model, refresh: reading(numbered(3)).refresh });
		await service().saveSettings('app_1', { sourceLocale: 'es' }, NOW);
		const before = await service().settingsOf('app_1');
		await run.start({ appId: 'app_1', locale: 'es' });

		const task = await run.finish();

		expect(task).toMatchObject({ status: 'done', progress: { done: 0, total: 0, skipped: 0 } });
		expect(model.requests).toHaveLength(0);
		expect(await service().settingsOf('app_1')).toEqual(before);
	});

	it('seller edits are never sent or overwritten', async () => {
		await service().replaceTexts('app_1', numbered(4), NOW);
		await service().setSellerText('app_1', 'es', 'h2', 'Mi propio texto', NOW);
		const answer: Answer = async (items) => {
			// The seller edits Text 3 while the model is working on it.
			await service().setSellerText('app_1', 'es', 'h3', 'Edición a mitad', NOW + 1);
			return translateAll(items, 1);
		};
		const model = fakeModel(answer);
		const run = queue({ model: model.model, refresh: reading(numbered(4)).refresh });
		await run.start();

		const task = await run.finish();

		expect(task).toMatchObject({ status: 'done', progress: { total: 3 } });
		expect(model.texts()).toEqual(['Text 1', 'Text 3', 'Text 4']);
		const rows = new Map((await rowsOf()).map((row) => [row.source, row]));
		expect(rows.get('Text 2')).toMatchObject({ text: 'Mi propio texto', origin: 'seller', machineText: null });
		expect(rows.get('Text 3')).toMatchObject({ text: 'Edición a mitad', origin: 'seller', machineText: 'ES Text 3' });
		expect(rows.get('Text 1')).toMatchObject({ text: 'ES Text 1', origin: 'machine' });
	});

	it('a text that makes the model fail every time is skipped on its own, and the rest of the batch is translated', async () => {
		// One poisoned text among 40: any request that holds it fails.
		const poison = 'Text 25';
		const model = fakeModel((items) => (items.some((item) => item.text === poison) ? new Error('The model refused this request') : translateAll(items, 1)));
		const run = queue({ model: model.model, refresh: reading(numbered(40)).refresh });
		await run.start();

		const task = await run.finish();

		expect(task).toMatchObject({ status: 'done', lastError: null, progress: { done: 39, total: 40, skipped: 1 } });
		expect(task.progress.skippedHashes).toEqual(['h25']);
		const stored = await translated();
		expect(stored.size).toBe(39);
		expect(stored.has(poison)).toBe(false);
		// Thirty-nine of forty is most of the store.
		expect(await targetOf()).toEqual({ enabled: true, ready: true });
		// The batch shrank after failures, down to the lone text.
		expect(Math.max(...model.requests.map((request) => request.items.length))).toBe(40);
		expect(model.requests.some((request) => request.items.length === 10)).toBe(true);
		expect(model.requests.filter((request) => request.items.length === 1).length).toBeGreaterThan(0);
	});

	it('takes 40 texts, then 10 after a failed step, then 1, and gives up on a lone text only after that', async () => {
		const model = fakeModel((items) => (items.some((item) => item.text === 'Text 1') ? new Error('The model refused this request') : translateAll(items, 1)));
		const run = queue({ model: model.model, refresh: reading(numbered(45)).refresh });
		await run.start();
		await run.tick();

		const failures: number[] = [];
		for (let step = 0; step < 3; step += 1) {
			const task = await run.tick();
			failures.push(task.attempts);
		}

		// Two failed steps, then the lone text is skipped and the step succeeds, so the count starts over.
		expect(failures).toEqual([1, 2, 0]);
		expect(model.requests.map((request) => request.items.length)).toEqual([40, 10, 1]);
		const after = await run.read();
		expect(after.progress).toMatchObject({ done: 0, skipped: 1, skippedHashes: ['h1'] });
		expect(await translated()).toEqual(new Map());

		// With the poisoned text set aside, batches are full again.
		await run.tick();
		expect(model.requests[3].items).toHaveLength(40);
		expect(model.requests[3].items[0].text).toBe('Text 2');
	});

	it('a model failure for a batch that was not shrunk by failures still throws, even for one text', async () => {
		let failing = true;
		const model = fakeModel(() => (failing ? new Error('The model is unreachable') : [{ id: '1', text: 'ES Only' }]));
		const run = queue({ model: model.model, refresh: reading(named('Only')).refresh });
		await run.start();
		await run.tick();

		const task = await run.tick();

		expect(task).toMatchObject({ status: 'queued', attempts: 1, lastError: "Couldn't reach the translation service." });
		expect(task.progress.skippedHashes ?? []).toEqual([]);
		failing = false;
		expect(await run.finish()).toMatchObject({ status: 'done', progress: { done: 1, total: 1, skipped: 0 } });
		expect(await translated()).toEqual(new Map([['Only', 'ES Only']]));
	});

	it('a retry call that fails on a lone text skips it, like the first call', async () => {
		// Two failed steps first, so the batch is one text; its answer fails the check and the retry call throws.
		let request = 0;
		const model = fakeModel((items) => {
			request += 1;
			if (request <= 2) return new Error('The model is unreachable');
			return request === 3 ? [{ id: items[0].id, text: 'Hola' }] : new Error('The model is unreachable');
		});
		const run = queue({ model: model.model, refresh: reading(named('Hello {name}')).refresh });
		await run.start();
		await run.tick();
		await run.tick();
		await run.tick();

		const task = await run.tick();

		expect(task).toMatchObject({ status: 'failed', progress: { done: 0, total: 1, skipped: 1 } });
		expect(await translated()).toEqual(new Map());
	});

	it('refuses a payload for another store than the task\'s own, without reading or translating anything', async () => {
		const model = fakeModel();
		const store = reading(numbered(3));
		const run = queue({ model: model.model, refresh: store.refresh });
		await run.start({ appId: 'app_other', locale: 'es' }, 'app_1');

		const task = await run.tick();

		expect(task).toMatchObject({ status: 'failed', lastError: TASK_FAILED_MESSAGE, steps: 1, creditsUsed: 0 });
		expect(store.reads).toEqual([]);
		expect(model.requests).toHaveLength(0);
		expect(await targetOf()).toBeUndefined();
	});

	it('a step run again after its save was lost does not send the finished batch again', async () => {
		const model = fakeModel();
		const run = queue({ model: model.model, refresh: reading(numbered(50)).refresh });
		await run.start();
		const setup = await run.tick();
		const context: TaskStepContext = { env: envWith(db), task: setup, now: NOW };

		const lost = await run.kind.step(context, PAYLOAD);
		const repeated = await run.kind.step(context, PAYLOAD);

		expect(lost.progress).toMatchObject({ done: 40, total: 50 });
		expect(model.requests[1].items.map((item) => item.text)).toEqual(numbered(50).slice(40).map((text) => text.text));
		// The repeat still reports the whole task, counting the batch whose save was lost.
		expect(repeated).toMatchObject({ finished: true, progress: { done: 50, total: 50, skipped: 0 } });
	});

	it('a model that fails sends nothing to the store and shows the seller a message without the provider', async () => {
		const model = fakeModel(() => new Error('google-ai-studio 503: quota exceeded for key AIza-secret'));
		const run = queue({ model: model.model, refresh: reading(numbered(3)).refresh });
		await run.start();
		await run.tick();
		const context: TaskStepContext = { env: envWith(db), task: await run.read(), now: NOW };

		const failure = await run.kind.step(context, PAYLOAD).catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(Error);
		const shown = run.kind.describeError?.(failure) ?? '';
		expect(shown).toBe("Couldn't reach the translation service.");
		expect(`${shown} ${(failure as Error).message}`).not.toMatch(/google|AIza|quota/i);
		expect((failure as Error).cause).toBeInstanceOf(Error);
		expect(await translated()).toEqual(new Map());
		expect(model.requests).toHaveLength(1);

		// Through the runner, the same message is all the seller is shown.
		const shownByRunner = await run.tick();
		expect(shownByRunner).toMatchObject({ status: 'queued', attempts: 1, lastError: "Couldn't reach the translation service." });
	});

	it('keeps what the first answer got right when the retry fails', async () => {
		const model = fakeModel((items, request) => (request === 1 ? items.map(({ id, text }) => ({ id, text: id === '2' ? 'Hola' : `ES ${text}` })) : new Error('upstream failed')));
		const run = queue({ model: model.model, refresh: reading(named('Plain one', 'Hello {name}', 'Plain two')).refresh });
		await run.start();
		await run.tick();

		const task = await run.tick();

		expect(await translated()).toEqual(new Map([['Plain one', 'ES Plain one'], ['Plain two', 'ES Plain two']]));
		// The step failed as a whole: it will run again, and the texts already saved are not sent again.
		expect(task).toMatchObject({ status: 'queued', attempts: 1, steps: 1, creditsUsed: 0 });
		const retried = await run.tick();
		expect(model.requests[2]?.items.map((item) => item.text)).toEqual(['Hello {name}']);
		expect(retried.attempts).toBe(2);
	});

	it("leaves any other failure to the queue's own message", async () => {
		expect(storeTranslateKind.describeError?.(new Error('D1_ERROR: no such table: secrets'))).toBeNull();
		expect(storeTranslateKind.describeError?.('boom')).toBeNull();

		const run = queue({ model: fakeModel().model, refresh: async () => Promise.reject(new Error('D1_ERROR: no such table: secrets')) });
		await run.start();
		expect(await run.tick()).toMatchObject({ status: 'queued', attempts: 1, lastError: TASK_RETRY_MESSAGE });
	});
});
