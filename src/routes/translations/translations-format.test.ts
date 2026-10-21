import { afterEach, describe, expect, it } from 'vitest';
import type { Locale, StoreLanguageStatus, TaskView } from '@/api-types';
import { applyAccountLocale, t } from '@/lib/i18n';
import {
	LANGUAGE_STATE_LABELS,
	LANGUAGE_STATE_VARIANTS,
	TASK_POLL_MS,
	canUseAutomatic,
	creditsLeftText,
	draftChanged,
	estimateText,
	isAutomatic,
	languageState,
	languagesDisagreeWithTasks,
	previewHref,
	taskBadge,
	taskIsMoving,
	taskLabel,
	taskRefetchDelay,
	translatedPercent,
	type LanguageState,
} from './translations-format';

afterEach(async () => {
	await applyAccountLocale('en');
});

function task(overrides: Partial<TaskView> = {}): TaskView {
	return {
		id: 't1',
		appId: 'app1',
		kind: 'store.translate',
		payload: { locale: 'es' },
		status: 'running',
		progress: { done: 10, total: 40, skipped: 0 },
		creditsUsed: 120,
		pauseReason: null,
		lastError: null,
		runAt: '2026-10-21T10:00:00.000Z',
		createdAt: '2026-10-21T10:00:00.000Z',
		startedAt: '2026-10-21T10:00:01.000Z',
		finishedAt: null,
		...overrides,
	} as TaskView;
}

function language(overrides: Partial<StoreLanguageStatus> = {}): StoreLanguageStatus {
	return { locale: 'es', enabled: true, ready: false, total: 200, translated: 0, edited: 0, left: 200, estimateCredits: 300, task: null, ...overrides };
}

describe('the state of a language', () => {
	it.each<[string, Partial<StoreLanguageStatus>, LanguageState]>([
		['off when the seller turned it off', { enabled: false }, 'off'],
		['not translated when on and never translated', {}, 'not-translated'],
		['translating while its task is queued', { task: task({ status: 'queued', startedAt: null }) }, 'translating'],
		['translating while its task runs, even when turned off meanwhile', { enabled: false, task: task() }, 'translating'],
		['paused when its task ran out of credits', { task: task({ status: 'paused', pauseReason: 'credits' }) }, 'paused'],
		["paused while its task waits for tomorrow's allowance", { task: task({ status: 'queued', pauseReason: 'daily-limit' }) }, 'paused'],
		['failed when its last task failed', { ready: true, task: task({ status: 'failed', lastError: 'Something went wrong.' }) }, 'failed'],
		['ready once translated', { ready: true, translated: 200, left: 0, task: task({ status: 'done' }) }, 'ready'],
		['ready with new text left after a publish', { ready: true, translated: 180, left: 20 }, 'ready'],
		['not translated after a canceled first try', { task: task({ status: 'canceled' }) }, 'not-translated'],
		['off after a failure, once the seller turned it off', { enabled: false, task: task({ status: 'failed' }) }, 'off'],
	])('is %s', (_name, overrides, expected) => {
		expect(languageState(language(overrides))).toBe(expected);
	});

	it('is translating while its task waits out a retry delay', () => {
		expect(languageState(language({ task: task({ status: 'queued', runAt: '2099-01-01T00:00:00.000Z', lastError: 'Something went wrong. Estori will try again.' }) }))).toBe('translating');
	});

	it('has a label and a badge variant for each state', () => {
		expect(LANGUAGE_STATE_LABELS).toEqual({ off: 'Off', 'not-translated': 'Not translated', translating: 'Translating', ready: 'Translation ready', paused: 'Paused', failed: 'Translation failed' });
		expect(LANGUAGE_STATE_VARIANTS).toEqual({ off: 'secondary', 'not-translated': 'outline', translating: 'info', ready: 'success', paused: 'warning', failed: 'error' });
	});

	it('says ready and failed in words that agree with "translation", not the generic status words', async () => {
		await applyAccountLocale('es');
		expect([t(LANGUAGE_STATE_LABELS.ready), t(LANGUAGE_STATE_LABELS.failed)]).toEqual(['Traducción lista', 'Traducción fallida']);
		await applyAccountLocale('pt-BR');
		expect([t(LANGUAGE_STATE_LABELS.ready), t(LANGUAGE_STATE_LABELS.failed)]).toEqual(['Tradução pronta', 'Tradução com falha']);
	});

	it('is a whole percent translated, never 100 before the last text', () => {
		expect(translatedPercent(language({ total: 0, translated: 0 }))).toBe(0);
		expect(translatedPercent(language({ total: 200, translated: 50 }))).toBe(25);
		expect(translatedPercent(language({ total: 1000, translated: 999 }))).toBe(99);
		expect(translatedPercent(language({ total: 200, translated: 200 }))).toBe(100);
	});
});

describe('a task', () => {
	it('moves while it runs or is queued to run now, but not while it waits for a later time or has ended', () => {
		const now = Date.parse('2026-10-21T10:00:00.000Z');
		expect(taskIsMoving(task(), now)).toBe(true);
		expect(taskIsMoving(task({ status: 'queued', runAt: '2026-10-21T10:00:00.000Z' }), now)).toBe(true);
		expect(taskIsMoving(task({ status: 'queued', runAt: '2026-10-21T09:59:00.000Z' }), now)).toBe(true);
		expect(taskIsMoving(task({ status: 'queued', runAt: '2026-10-21T10:02:00.000Z', lastError: 'Something went wrong. Estori will try again.' }), now)).toBe(false);
		expect(taskIsMoving(task({ status: 'queued', runAt: '2026-10-22T00:00:00.000Z', pauseReason: 'daily-limit' }), now)).toBe(false);
		for (const status of ['paused', 'done', 'failed', 'canceled'] as const) expect(taskIsMoving(task({ status }), now), status).toBe(false);
	});

	it('is read again every 3 seconds while one moves, once when the next waiting one is due, and never with none unfinished', () => {
		const now = Date.parse('2026-10-21T10:00:00.000Z');
		const waiting = (runAt: string) => task({ status: 'queued', runAt });
		expect(TASK_POLL_MS).toBe(3_000);
		expect(taskRefetchDelay([task(), waiting('2026-10-21T11:00:00.000Z')], now)).toBe(3_000);
		expect(taskRefetchDelay([waiting('2026-10-21T10:02:00.000Z'), waiting('2026-10-21T10:30:00.000Z')], now)).toBe(120_000);
		expect(taskRefetchDelay([waiting('2026-10-21T10:00:01.000Z')], now)).toBe(3_000);
		expect(taskRefetchDelay([task({ status: 'queued', runAt: '2026-10-22T00:00:00.000Z', pauseReason: 'daily-limit' })], now)).toBe(14 * 3_600_000);
		expect(taskRefetchDelay([waiting('2099-01-01T00:00:00.000Z')], now)).toBe(2_147_483_647);
		expect(taskRefetchDelay([task({ status: 'done' }), task({ status: 'paused', pauseReason: 'credits' })], now)).toBe(false);
		expect(taskRefetchDelay([], now)).toBe(false);
	});

	it("is told apart from the store's languages when either read is older than the other", () => {
		const running = task({ id: 't1' });
		expect(languagesDisagreeWithTasks([language({ task: running })], [running])).toBe(false);
		expect(languagesDisagreeWithTasks([language({ task: running })], [task({ id: 't1', status: 'done' })])).toBe(true);
		expect(languagesDisagreeWithTasks([language({ task: running })], [task({ id: 't1', status: 'paused', pauseReason: 'credits' })])).toBe(true);
		// A newer task for the language than the one the languages know.
		expect(languagesDisagreeWithTasks([language({ task: task({ id: 't1', status: 'done' }) })], [task({ id: 't2', status: 'queued' }), task({ id: 't1', status: 'done' })])).toBe(true);
		expect(languagesDisagreeWithTasks([language({ task: null })], [task({ id: 't3' })])).toBe(true);
		// Another language's task, or none listed, says nothing about this one.
		expect(languagesDisagreeWithTasks([language({ task: running })], [task({ id: 't4', payload: { locale: 'pt-BR' } })])).toBe(false);
		expect(languagesDisagreeWithTasks([language({ task: null })], [])).toBe(false);
	});

	it("is labelled with what it does, naming the language in that language's own words", async () => {
		expect(taskLabel(task())).toBe('Translate to Español');
		expect(taskLabel(task({ payload: { locale: 'pt-BR' } }))).toBe('Translate to Português (Brasil)');
		await applyAccountLocale('es');
		expect(taskLabel(task({ payload: { locale: 'en' } }))).toBe('Traducir a English');
	});

	it("shows its status, and a task held for tomorrow's allowance as paused", () => {
		expect(taskBadge(task())).toEqual({ label: 'Running', variant: 'info' });
		expect(taskBadge(task({ status: 'queued' }))).toEqual({ label: 'Queued', variant: 'secondary' });
		expect(taskBadge(task({ status: 'queued', pauseReason: 'daily-limit' }))).toEqual({ label: 'Paused', variant: 'warning' });
		expect(taskBadge(task({ status: 'paused', pauseReason: 'credits' }))).toEqual({ label: 'Paused', variant: 'warning' });
		expect(taskBadge(task({ status: 'done' }))).toEqual({ label: 'Task done', variant: 'success' });
		expect(taskBadge(task({ status: 'failed' }))).toEqual({ label: 'Task failed', variant: 'error' });
		expect(taskBadge(task({ status: 'canceled' }))).toEqual({ label: 'Task canceled', variant: 'outline' });
	});

	it('says how a task ended in words that agree with "task"', async () => {
		const ended = () => (['done', 'failed', 'canceled'] as const).map((status) => t(taskBadge(task({ status })).label));
		await applyAccountLocale('es');
		expect(ended()).toEqual(['Tarea terminada', 'Tarea fallida', 'Tarea cancelada']);
		await applyAccountLocale('pt-BR');
		expect(ended()).toEqual(['Tarefa concluída', 'Tarefa com falha', 'Tarefa cancelada']);
	});
});

describe('the estimate', () => {
	it('reads "About {credits} credits", with the credits written the way the language writes numbers', async () => {
		expect(estimateText(12_500, 'en')).toBe('About 12,500 credits');
		expect(estimateText(1, 'en')).toBe('About 1 credit');
		await applyAccountLocale('pt-BR');
		expect(estimateText(12_500, 'pt-BR')).toBe('Cerca de 12.500 créditos');
		await applyAccountLocale('es');
		expect(estimateText(12_500, 'es')).toBe('Alrededor de 12,500 créditos');
	});

	it('says how many credits the seller has left', async () => {
		expect(creditsLeftText(4_000, 'en')).toBe('You have 4,000 credits left.');
		await applyAccountLocale('es');
		expect(creditsLeftText(4_000, 'es')).toBe('Te quedan 4,000 créditos.');
	});
});

describe('the preview link', () => {
	it.each<[string, Locale, string]>([
		['https://shop.estori.app/', 'es', 'https://shop.estori.app/?lang=es'],
		['https://preview.estori.app/p/abc?t=signed', 'pt-BR', 'https://preview.estori.app/p/abc?t=signed&lang=pt-BR'],
		['https://shop.estori.app/?lang=es', 'en', 'https://shop.estori.app/?lang=en'],
		['/preview/abc?t=signed', 'es', '/preview/abc?t=signed&lang=es'],
	])('opens %s in %s', (base, locale, expected) => {
		expect(previewHref(base, locale)).toBe(expected);
	});
});

describe('the translations editor', () => {
	it.each<[string, string | null, string | null, boolean]>([
		['nothing typed', null, 'Velas', false],
		['the same text', 'Velas', 'Velas', false],
		['the same text with spaces around it, which the server trims', '  Velas \n', 'Velas', false],
		['other words', 'Velas de soya', 'Velas', true],
		['a translation cleared', '', 'Velas', true],
		['a text with no translation, left empty', '', null, false],
		['a text with no translation, written', 'Velas', null, true],
		['a text with no translation, left with spaces', '   ', null, false],
	])('sees %s as changed or not', (_name, draft, saved, changed) => {
		expect(draftChanged(draft, saved)).toBe(changed);
	});

	it.each<[string, 'machine' | 'seller' | null, string | null, boolean]>([
		['an automatic translation', 'machine', 'Velas', false],
		['a text with no translation', null, null, false],
		['an edit of an automatic translation', 'seller', 'Velas', true],
		['an edit of a text the automatic translation never wrote', 'seller', null, false],
	])('lets the seller go back to the automatic translation of %s: %s', (_name, origin, machineText, can) => {
		expect(canUseAutomatic({ origin, machineText })).toBe(can);
	});
});

describe('whose translation a text has', () => {
	it.each<[string, string | null, 'machine' | 'seller' | null, boolean]>([
		['the automatic translation', 'Velas', 'machine', true],
		['the seller', 'Velas', 'seller', false],
		['nobody yet', null, null, false],
	])('says a text with %s is automatic: %s', (_name, text, origin, automatic) => {
		expect(isAutomatic({ text, origin })).toBe(automatic);
	});
});
