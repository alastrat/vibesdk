import { afterEach, describe, expect, it } from 'vitest';
import type { Locale, StoreLanguageStatus, TaskView } from '@/api-types';
import { applyAccountLocale } from '@/lib/i18n';
import {
	LANGUAGE_STATE_LABELS,
	LANGUAGE_STATE_VARIANTS,
	creditsLeftText,
	estimateText,
	languageState,
	previewHref,
	taskBadge,
	taskIsMoving,
	taskLabel,
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

	it('has a label and a badge variant for each state', () => {
		expect(LANGUAGE_STATE_LABELS).toEqual({ off: 'Off', 'not-translated': 'Not translated', translating: 'Translating', ready: 'Ready', paused: 'Paused', failed: 'Failed' });
		expect(LANGUAGE_STATE_VARIANTS).toEqual({ off: 'secondary', 'not-translated': 'outline', translating: 'info', ready: 'success', paused: 'warning', failed: 'error' });
	});

	it('is a whole percent translated, never 100 before the last text', () => {
		expect(translatedPercent(language({ total: 0, translated: 0 }))).toBe(0);
		expect(translatedPercent(language({ total: 200, translated: 50 }))).toBe(25);
		expect(translatedPercent(language({ total: 1000, translated: 999 }))).toBe(99);
		expect(translatedPercent(language({ total: 200, translated: 200 }))).toBe(100);
	});
});

describe('a task', () => {
	it('moves while it runs or waits its turn, but not while it is held until tomorrow or has ended', () => {
		expect(taskIsMoving(task())).toBe(true);
		expect(taskIsMoving(task({ status: 'queued' }))).toBe(true);
		expect(taskIsMoving(task({ status: 'queued', lastError: 'Something went wrong. Estori will try again.' }))).toBe(true);
		expect(taskIsMoving(task({ status: 'queued', pauseReason: 'daily-limit' }))).toBe(false);
		for (const status of ['paused', 'done', 'failed', 'canceled'] as const) expect(taskIsMoving(task({ status })), status).toBe(false);
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
		expect(taskBadge(task({ status: 'done' }))).toEqual({ label: 'Done', variant: 'success' });
		expect(taskBadge(task({ status: 'failed' }))).toEqual({ label: 'Failed', variant: 'error' });
		expect(taskBadge(task({ status: 'canceled' }))).toEqual({ label: 'Canceled', variant: 'outline' });
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
