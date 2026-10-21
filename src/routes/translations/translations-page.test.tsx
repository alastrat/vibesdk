/**
 * The Translations page mounted for real, with the API mocked: what a seller sees for a store, what Translate asks before
 * it spends credits, and that the page reads the store again while a translation moves and stops once it is done.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import type TestRenderer from 'react-test-renderer';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider, environmentManager } from '@tanstack/react-query';
import type { ApiResponse, StoreLanguageStatus, StoreTranslationOverview, StoreTranslationStoreSummary, TaskView } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { applyAccountLocale } from '@/lib/i18n';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import TranslationsPage from './translations';

const flags = vi.hoisted((): { paused: boolean } => ({ paused: false }));

vi.mock('@/lib/api-client', () => ({
	apiClient: {
		getTranslationStores: vi.fn(),
		getStoreTranslations: vi.fn(),
		getTasks: vi.fn(),
		runStoreTranslation: vi.fn(),
		saveStoreTranslationSettings: vi.fn(),
		cancelTask: vi.fn(),
		resumeTask: vi.fn(),
	},
}));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ telemetry: { flags: { 'store-translations-paused': flags.paused } } }) }));
// Radix dialogs and selects load `react-remove-scroll`, which the Workers test pool can't resolve, and render into a portal
// the test renderer can't mount; plain elements keep what the page hands them.
vi.mock('@/components/ui/dialog', async () => {
	const { createElement, Fragment } = await import('react');
	const wrapper = (props: { children?: ReactNode }) => createElement(Fragment, null, props.children);
	return {
		Dialog: (props: { open: boolean; children?: ReactNode }) => (props.open ? createElement('div', { role: 'dialog' }, props.children) : null),
		DialogContent: wrapper,
		DialogDescription: wrapper,
		DialogFooter: wrapper,
		DialogHeader: wrapper,
		DialogTitle: wrapper,
	};
});
vi.mock('@/components/ui/select', async () => {
	const { createElement, Fragment } = await import('react');
	const wrapper = (props: { children?: ReactNode }) => createElement(Fragment, null, props.children);
	return {
		Select: (props: { value?: string; onValueChange?: (value: string) => void; disabled?: boolean; children?: ReactNode }) =>
			createElement('select', { value: props.value, disabled: props.disabled, onChange: (event: { target: { value: string } }) => props.onValueChange?.(event.target.value) }, props.children),
		SelectContent: wrapper,
		SelectItem: (props: { value: string; children?: ReactNode }) => createElement('option', { value: props.value }, props.children),
		SelectTrigger: () => null,
		SelectValue: () => null,
	};
});

beforeAll(silenceTestRendererDeprecation);

beforeEach(() => {
	flags.paused = false;
	vi.mocked(apiClient.getTranslationStores).mockResolvedValue(ok(STORES));
	vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview()));
	vi.mocked(apiClient.getTasks).mockResolvedValue(ok([task({ status: 'done', progress: { done: 150, total: 150, skipped: 0 }, finishedAt: '2026-10-21T10:05:00.000Z' })]));
});

afterEach(async () => {
	await unmountAll();
	await applyAccountLocale('en');
	vi.useRealTimers();
	for (const method of [apiClient.getTranslationStores, apiClient.getStoreTranslations, apiClient.getTasks, apiClient.runStoreTranslation, apiClient.saveStoreTranslationSettings, apiClient.cancelTask, apiClient.resumeTask]) {
		vi.mocked(method).mockReset();
	}
});

function ok<T>(data: T): ApiResponse<T> {
	return { success: true, data };
}

const STORES: StoreTranslationStoreSummary[] = [
	{ appId: 'app1', title: 'Lucia Candles', sourceLocale: 'en', languages: [{ locale: 'es', enabled: true, ready: true }] },
	{ appId: 'app2', title: 'Open Shop', sourceLocale: 'es', languages: [] },
];

function task(overrides: Partial<TaskView> = {}): TaskView {
	return {
		id: 't1',
		appId: 'app1',
		kind: 'store.translate',
		payload: { locale: 'es' },
		status: 'running',
		progress: { done: 40, total: 150, skipped: 0 },
		creditsUsed: 60,
		pauseReason: null,
		lastError: null,
		runAt: '2026-10-21T10:00:00.000Z',
		createdAt: '2026-10-21T10:00:00.000Z',
		startedAt: '2026-10-21T10:00:01.000Z',
		finishedAt: null,
		...overrides,
	} as TaskView;
}

function spanish(overrides: Partial<StoreLanguageStatus> = {}): StoreLanguageStatus {
	return { locale: 'es', enabled: true, ready: true, total: 200, translated: 150, edited: 3, left: 50, estimateCredits: 75, task: task({ status: 'done', finishedAt: '2026-10-21T10:05:00.000Z' }), ...overrides };
}

function portuguese(overrides: Partial<StoreLanguageStatus> = {}): StoreLanguageStatus {
	return { locale: 'pt-BR', enabled: false, ready: false, total: 200, translated: 0, edited: 0, left: 200, estimateCredits: 300, task: null, ...overrides };
}

function overview(overrides: Partial<StoreTranslationOverview> = {}): StoreTranslationOverview {
	return {
		settings: { sourceLocale: 'en', targets: { es: { enabled: true, ready: true }, 'pt-BR': { enabled: false, ready: false } }, matchBrowser: true, showSwitcher: true, autoTranslate: false, version: 4 },
		languages: [spanish(), portuguese()],
		extractedAt: '2026-10-21T09:00:00.000Z',
		truncated: false,
		manifestInvalid: false,
		deployed: true,
		textsUnavailable: false,
		creditsLeft: 4_000,
		previewUrl: 'https://preview.example.test/p/app1?t=signed',
		liveUrl: 'https://lucia.estori.app/',
		...overrides,
	};
}

/** Lets the queries answer and React show what they answered. */
async function settle(): Promise<void> {
	for (let round = 0; round < 3; round++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mountPage(): Promise<TestRenderer.ReactTestRenderer> {
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	const renderer = await mountElement(createElement(QueryClientProvider, { client: queries }, createElement(MemoryRouter, null, createElement(TranslationsPage))));
	await settle();
	return renderer;
}

type Instance = TestRenderer.ReactTestInstance;

function textIn(node: Instance): string {
	return node.children.map((child) => (typeof child === 'string' ? child : textIn(child))).join('');
}

function card(renderer: TestRenderer.ReactTestRenderer, locale: string): Instance {
	return renderer.root.find((node) => typeof node.type === 'string' && node.props['data-locale'] === locale);
}

function button(scope: Instance, name: string): Instance {
	const found = scope.findAll((node) => node.type === 'button' && textIn(node).trim() === name);
	if (found.length === 0) throw new Error(`No button named ${name}`);
	return found[0];
}

/** The button or link whose accessible name is `label`. */
function labelled(scope: Instance, label: string): Instance {
	const found = scope.findAll((node) => (node.type === 'button' || node.type === 'a') && node.props['aria-label'] === label);
	if (found.length === 0) throw new Error(`Nothing labelled ${label}`);
	return found[0];
}

function dialogOf(renderer: TestRenderer.ReactTestRenderer): Instance {
	return renderer.root.find((node) => node.props.role === 'dialog');
}

/** Polls as a browser would, with only the intervals under the test's control; the original setting comes back after. */
async function withPolling(run: () => Promise<void>): Promise<void> {
	const wasServer = environmentManager.isServer();
	vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
	// The query library polls only in a browser; the Workers test pool looks like a server to it.
	environmentManager.setIsServer(() => false);
	try {
		await run();
	} finally {
		environmentManager.setIsServer(() => wasServer);
	}
}

describe('the Translations page', () => {
	it('shows the store picker, the settings, one card per target language', async () => {
		const renderer = await mountPage();
		const screen = textOf(renderer);
		const [picker, storeLanguage] = renderer.root.findAllByType('select');
		expect(picker.findAllByType('option').map(textIn)).toEqual(['Lucia Candles', 'Open Shop']);
		expect(picker.props.value).toBe('app1');
		expect(storeLanguage.findAllByType('option').map(textIn)).toEqual(['English', 'Español', 'Português (Brasil)']);
		expect(storeLanguage.props.value).toBe('en');
		expect(apiClient.getStoreTranslations).toHaveBeenCalledWith('app1');
		expect(apiClient.getTasks).toHaveBeenCalledWith('app1');
		for (const text of ['Store language', "Match the shopper's browser language", 'Show a language switcher', 'Translate new text when I publish']) expect(screen).toContain(text);
		expect(renderer.root.findAll((node) => typeof node.type === 'string' && typeof node.props['data-locale'] === 'string').map((node) => node.props['data-locale'])).toEqual(['es', 'pt-BR']);

		const es = textIn(card(renderer, 'es'));
		for (const text of ['Español', 'Translation ready', '50 texts left', 'About 75 credits', '3 texts have your edits']) expect(es).toContain(text);
		const preview = labelled(card(renderer, 'es'), 'Preview in Español');
		expect(textIn(preview)).toContain('Preview in Español');
		expect(preview.props.href).toBe('https://lucia.estori.app/?lang=es');
		expect(preview.props.target).toBe('_blank');
		expect(textIn(labelled(card(renderer, 'es'), 'Translate to Español'))).toBe('Translate');

		const pt = textIn(card(renderer, 'pt-BR'));
		for (const text of ['Português (Brasil)', 'Off', '200 texts left', 'About 300 credits']) expect(pt).toContain(text);
		expect(pt).not.toContain('Preview in');
		expect(textIn(labelled(card(renderer, 'pt-BR'), 'Translate to Português (Brasil)'))).toBe('Translate');

		expect(screen).toContain('Activity');
		expect(screen).toContain('Translate to Español');
		expect(screen).toContain('60 credits used');
		expect(screen).toContain('Task done');
	});

	it('loads without sending any settings, and each control saves only its own field', async () => {
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ settings: { ...overview().settings, version: 1 } })));
		vi.mocked(apiClient.saveStoreTranslationSettings).mockResolvedValue(ok({ ...overview().settings, sourceLocale: 'es', version: 2 }));
		const renderer = await mountPage();
		expect(apiClient.saveStoreTranslationSettings).not.toHaveBeenCalled();
		const [, storeLanguage] = renderer.root.findAllByType('select');
		await act(async () => storeLanguage.props.onChange({ target: { value: 'es' } }));
		await settle();
		expect(apiClient.saveStoreTranslationSettings).toHaveBeenCalledTimes(1);
		expect(apiClient.saveStoreTranslationSettings).toHaveBeenCalledWith('app1', { sourceLocale: 'es' });
	});

	it('falls back to the preview when the store is not live', async () => {
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ liveUrl: null })));
		const renderer = await mountPage();
		expect(labelled(card(renderer, 'es'), 'Preview in Español').props.href).toBe('https://preview.example.test/p/app1?t=signed&lang=es');
	});

	it('saves a setting as it is switched, and reads another store when it is picked', async () => {
		vi.mocked(apiClient.saveStoreTranslationSettings).mockResolvedValue(ok({ ...overview().settings, autoTranslate: true, version: 5 }));
		const renderer = await mountPage();
		const autoTranslate = renderer.root.find((node) => node.props['aria-label'] === 'Translate new text when I publish' && typeof node.props.onCheckedChange === 'function');
		await act(async () => autoTranslate.props.onCheckedChange(true));
		await settle();
		expect(apiClient.saveStoreTranslationSettings).toHaveBeenCalledWith('app1', { autoTranslate: true });

		const [picker] = renderer.root.findAllByType('select');
		await act(async () => picker.props.onChange({ target: { value: 'app2' } }));
		await settle();
		expect(apiClient.getStoreTranslations).toHaveBeenLastCalledWith('app2');
		expect(renderer.root.findAllByType('select')[0].props.value).toBe('app2');
	});

	it('Translate opens a confirm with the estimate and starts a task', async () => {
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ creditsLeft: 100 })));
		vi.mocked(apiClient.runStoreTranslation).mockResolvedValue(ok({ task: task({ status: 'queued', payload: { locale: 'pt-BR' }, startedAt: null }), created: true }));
		const renderer = await mountPage();
		expect(renderer.root.findAll((node) => node.props.role === 'dialog')).toHaveLength(0);

		await act(async () => button(card(renderer, 'pt-BR'), 'Translate').props.onClick());
		const dialog = dialogOf(renderer);
		const asked = textIn(dialog);
		expect(asked).toContain('Translate your store into Português (Brasil)?');
		expect(asked).toContain('Your store is written in');
		expect(dialog.findByType('select').props.value).toBe('en');
		expect(asked).toContain('About 300 credits');
		expect(asked).toContain('You have 100 credits left.');
		expect(asked).toContain("That's more than you have left. The translation pauses when your credits run out, and you can add credits to finish it.");
		expect(apiClient.runStoreTranslation).not.toHaveBeenCalled();

		const started = task({ id: 't2', status: 'queued', payload: { locale: 'pt-BR' }, startedAt: null });
		vi.mocked(apiClient.getTasks).mockResolvedValue(ok([started]));
		await act(async () => labelled(dialog, 'Translate to Português (Brasil)').props.onClick());
		await settle();
		// The seller's settings were saved before, and the language shown is the one they had: nothing to save.
		expect(apiClient.saveStoreTranslationSettings).not.toHaveBeenCalled();
		expect(apiClient.runStoreTranslation).toHaveBeenCalledTimes(1);
		expect(apiClient.runStoreTranslation).toHaveBeenCalledWith('app1', 'pt-BR');
		expect(renderer.root.findAll((node) => node.props.role === 'dialog')).toHaveLength(0);
		// The new task shows in the activity, and its arrival reads the store's languages once more.
		expect(apiClient.getTasks).toHaveBeenCalledTimes(2);
		expect(apiClient.getStoreTranslations).toHaveBeenCalledTimes(2);
		expect(textOf(renderer)).toContain('Translate to Português (Brasil)');
	});

	it('confirming saves the shown store language before the run, while the settings are untouched', async () => {
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ settings: { ...overview().settings, version: 1 } })));
		vi.mocked(apiClient.saveStoreTranslationSettings).mockResolvedValue(ok({ ...overview().settings, version: 2 }));
		vi.mocked(apiClient.runStoreTranslation).mockResolvedValue(ok({ task: task({ status: 'queued', payload: { locale: 'pt-BR' } }), created: true }));
		const renderer = await mountPage();
		expect(apiClient.saveStoreTranslationSettings).not.toHaveBeenCalled();
		await act(async () => button(card(renderer, 'pt-BR'), 'Translate').props.onClick());
		expect(dialogOf(renderer).findByType('select').props.value).toBe('en');
		await act(async () => labelled(dialogOf(renderer), 'Translate to Português (Brasil)').props.onClick());
		await settle();
		expect(apiClient.saveStoreTranslationSettings).toHaveBeenCalledWith('app1', { sourceLocale: 'en' });
		expect(apiClient.runStoreTranslation).toHaveBeenCalledWith('app1', 'pt-BR');
		expect(vi.mocked(apiClient.saveStoreTranslationSettings).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(apiClient.runStoreTranslation).mock.invocationCallOrder[0]);
	});

	it('saves the store language the seller picks in the confirm, then translates', async () => {
		vi.mocked(apiClient.saveStoreTranslationSettings).mockResolvedValue(ok({ ...overview().settings, sourceLocale: 'es', version: 5 }));
		vi.mocked(apiClient.runStoreTranslation).mockResolvedValue(ok({ task: task({ status: 'queued', payload: { locale: 'pt-BR' } }), created: true }));
		const renderer = await mountPage();
		await act(async () => button(card(renderer, 'pt-BR'), 'Translate').props.onClick());
		await act(async () => dialogOf(renderer).findByType('select').props.onChange({ target: { value: 'es' } }));
		expect(dialogOf(renderer).findByType('select').props.value).toBe('es');
		await act(async () => labelled(dialogOf(renderer), 'Translate to Português (Brasil)').props.onClick());
		await settle();
		expect(apiClient.saveStoreTranslationSettings).toHaveBeenCalledTimes(1);
		expect(apiClient.saveStoreTranslationSettings).toHaveBeenCalledWith('app1', { sourceLocale: 'es' });
		expect(apiClient.runStoreTranslation).toHaveBeenCalledWith('app1', 'pt-BR');
		expect(vi.mocked(apiClient.saveStoreTranslationSettings).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(apiClient.runStoreTranslation).mock.invocationCallOrder[0]);
	});

	it('only saves the store language when the seller says the store is already in the language it was asked to translate into', async () => {
		vi.mocked(apiClient.saveStoreTranslationSettings).mockResolvedValue(ok({ ...overview().settings, sourceLocale: 'pt-BR', version: 5 }));
		const renderer = await mountPage();
		await act(async () => button(card(renderer, 'pt-BR'), 'Translate').props.onClick());
		await act(async () => dialogOf(renderer).findByType('select').props.onChange({ target: { value: 'pt-BR' } }));
		expect(textIn(dialogOf(renderer))).toContain("Your store is already in Português (Brasil), so there's nothing to translate it into.");
		await act(async () => button(dialogOf(renderer), 'Save').props.onClick());
		await settle();
		expect(apiClient.saveStoreTranslationSettings).toHaveBeenCalledWith('app1', { sourceLocale: 'pt-BR' });
		expect(apiClient.runStoreTranslation).not.toHaveBeenCalled();
	});

	it('shows only the estimate while billing is off, and counts one text the Spanish way', async () => {
		await applyAccountLocale('es');
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ creditsLeft: null, languages: [spanish(), portuguese({ left: 1, estimateCredits: 2 })] })));
		const renderer = await mountPage();
		await act(async () => button(card(renderer, 'pt-BR'), 'Traducir').props.onClick());
		const asked = textIn(dialogOf(renderer));
		expect(asked).toContain('Estori traduce automáticamente 1 texto que aún no tiene traducción.');
		expect(asked).toContain('Alrededor de 2 créditos');
		expect(asked).not.toContain('Te quedan');
		expect(asked).not.toContain('Es más de lo que te queda');
	});

	it('polls while a task is running and stops when it is done', async () => {
		await withPolling(async () => {
			const running = task({ payload: { locale: 'es' } });
			const further = task({ progress: { done: 80, total: 150, skipped: 0 } });
			const done = task({ status: 'done', progress: { done: 150, total: 150, skipped: 0 }, finishedAt: '2026-10-21T10:05:00.000Z' });
			vi.mocked(apiClient.getStoreTranslations).mockResolvedValueOnce(ok(overview({ languages: [spanish({ task: running }), portuguese()] }))).mockResolvedValue(ok(overview()));
			vi.mocked(apiClient.getTasks).mockResolvedValueOnce(ok([running])).mockResolvedValueOnce(ok([further])).mockResolvedValue(ok([done]));
			const renderer = await mountPage();
			expect(textIn(card(renderer, 'es'))).toContain('Translating');
			expect(apiClient.getStoreTranslations).toHaveBeenCalledTimes(1);
			expect(apiClient.getTasks).toHaveBeenCalledTimes(1);

			// Only the task list is read while the task runs; the store's languages wait for a change of status.
			await act(async () => vi.advanceTimersByTime(3_000));
			await settle();
			expect(apiClient.getTasks).toHaveBeenCalledTimes(2);
			expect(apiClient.getStoreTranslations).toHaveBeenCalledTimes(1);
			expect(textOf(renderer)).toContain('80 of 150 texts');

			await act(async () => vi.advanceTimersByTime(3_000));
			await settle();
			expect(apiClient.getTasks).toHaveBeenCalledTimes(3);
			expect(apiClient.getStoreTranslations).toHaveBeenCalledTimes(2);
			expect(textIn(card(renderer, 'es'))).toContain('Translation ready');

			await act(async () => vi.advanceTimersByTime(9_000));
			await settle();
			expect(apiClient.getTasks).toHaveBeenCalledTimes(3);
			expect(apiClient.getStoreTranslations).toHaveBeenCalledTimes(2);
		});
	});

	it('reads a task waiting out a retry delay once, when it is due, instead of every few seconds', async () => {
		await withPolling(async () => {
			const runAt = new Date(Date.now() + 120_000).toISOString();
			const waiting = task({ status: 'queued', runAt, lastError: 'Something went wrong. Estori will try again.' });
			const done = task({ status: 'done', progress: { done: 150, total: 150, skipped: 0 }, finishedAt: runAt });
			vi.mocked(apiClient.getStoreTranslations).mockResolvedValueOnce(ok(overview({ languages: [spanish({ task: waiting }), portuguese()] }))).mockResolvedValue(ok(overview()));
			vi.mocked(apiClient.getTasks).mockResolvedValueOnce(ok([waiting])).mockResolvedValue(ok([done]));
			const renderer = await mountPage();
			expect(textOf(renderer)).toContain('Something went wrong. Estori will try again.');

			await act(async () => vi.advanceTimersByTime(60_000));
			await settle();
			expect(apiClient.getTasks).toHaveBeenCalledTimes(1);

			await act(async () => vi.advanceTimersByTime(61_000));
			await settle();
			expect(apiClient.getTasks).toHaveBeenCalledTimes(2);
			expect(apiClient.getStoreTranslations).toHaveBeenCalledTimes(2);
		});
	});

	it("waits for tomorrow's allowance without polling", async () => {
		await withPolling(async () => {
			const held = task({ status: 'queued', pauseReason: 'daily-limit', runAt: new Date(Date.now() + 6 * 3_600_000).toISOString() });
			vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ languages: [spanish({ task: held }), portuguese()] })));
			vi.mocked(apiClient.getTasks).mockResolvedValue(ok([held]));
			const renderer = await mountPage();
			expect(textIn(card(renderer, 'es'))).toContain("Waiting for tomorrow's allowance");
			expect(textIn(card(renderer, 'es'))).toContain('Paused');
			await act(async () => vi.advanceTimersByTime(60_000));
			await settle();
			expect(apiClient.getTasks).toHaveBeenCalledTimes(1);
		});
	});

	it("reads the store's languages again once when its first read disagrees with the task list", async () => {
		const running = task();
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValueOnce(ok(overview({ languages: [spanish({ task: running }), portuguese()] }))).mockResolvedValue(ok(overview()));
		vi.mocked(apiClient.getTasks).mockResolvedValue(ok([task({ status: 'done', finishedAt: '2026-10-21T10:05:00.000Z' })]));
		const renderer = await mountPage();
		expect(apiClient.getStoreTranslations).toHaveBeenCalledTimes(2);
		expect(textIn(card(renderer, 'es'))).toContain('Translation ready');
	});

	it('renders in Spanish under es', async () => {
		await applyAccountLocale('es');
		const renderer = await mountPage();
		const screen = textOf(renderer);
		for (const text of ['Traducciones', 'Idioma de la tienda', 'Mostrar un selector de idioma', 'Actividad', 'Traducir a Español', '60 créditos usados']) expect(screen).toContain(text);
		const es = textIn(card(renderer, 'es'));
		for (const text of ['Traducción lista', 'Quedan 50 textos', 'Alrededor de 75 créditos', 'Vista previa en Español']) expect(es).toContain(text);
		expect(screen).toContain('Tarea terminada');
		expect(textIn(card(renderer, 'pt-BR'))).toContain('Desactivado');
		expect(screen).not.toContain('texts left');
	});

	it('says when a store was never deployed, and when it has no text', async () => {
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ deployed: false, previewUrl: null, liveUrl: null })));
		expect(textOf(await mountPage())).toContain('Publish or preview your store first');
		await unmountAll();
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ languages: [spanish({ total: 0, translated: 0, left: 0, edited: 0, task: null }), portuguese({ total: 0, left: 0 })] })));
		expect(textOf(await mountPage())).toContain('No text to translate');
		await unmountAll();
		vi.mocked(apiClient.getTranslationStores).mockResolvedValue(ok([]));
		expect(textOf(await mountPage())).toContain('Publish or preview your store first');
	});

	it("says when the store couldn't be read, and reads it again on Retry", async () => {
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ textsUnavailable: true, manifestInvalid: true, truncated: true })));
		const renderer = await mountPage();
		const screen = textOf(renderer);
		expect(screen).toContain("We couldn't read your store right now. Try again in a moment.");
		expect(screen).toContain("We couldn't read your products, so they aren't translated.");
		expect(screen).toContain("Your store has more text than Estori translates, so some of it isn't translated.");
		await act(async () => button(renderer.root, 'Retry').props.onClick());
		await settle();
		expect(apiClient.getStoreTranslations).toHaveBeenCalledTimes(2);
	});

	it('offers Retry when the stores or the activity could not be read', async () => {
		vi.mocked(apiClient.getTranslationStores).mockResolvedValueOnce({ success: false, error: { message: 'Stores are down', name: 'Error' } });
		const renderer = await mountPage();
		expect(textOf(renderer)).toContain('Stores are down');
		await act(async () => button(renderer.root, 'Retry').props.onClick());
		await settle();
		expect(apiClient.getTranslationStores).toHaveBeenCalledTimes(2);
		await unmountAll();

		vi.mocked(apiClient.getTasks).mockResolvedValueOnce({ success: false, error: { message: 'Activity is down', name: 'Error' } });
		const activity = await mountPage();
		expect(textOf(activity)).toContain('Activity is down');
		await act(async () => button(activity.root, 'Retry').props.onClick());
		await settle();
		expect(apiClient.getTasks).toHaveBeenCalledTimes(3);
		expect(textOf(activity)).toContain('60 credits used');
	});

	it('offers a way to add credits and Resume for a task out of credits, and says what was skipped', async () => {
		const paused = task({ status: 'paused', pauseReason: 'credits' });
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ languages: [spanish({ task: paused }), portuguese()] })));
		vi.mocked(apiClient.getTasks).mockResolvedValue(ok([paused, task({ id: 't0', status: 'done', progress: { done: 98, total: 100, skipped: 2 }, finishedAt: '2026-10-20T10:00:00.000Z' })]));
		vi.mocked(apiClient.resumeTask).mockResolvedValue(ok(task({ status: 'queued' })));
		const renderer = await mountPage();
		const es = card(renderer, 'es');
		expect(textIn(es)).toContain("Paused: you're out of AI credits");
		expect(es.find((node) => node.type === 'a' && textIn(node) === 'Add credits').props.href).toBe('/settings/billing');
		expect(textOf(renderer)).toContain("2 texts couldn't be translated");
		await act(async () => labelled(es, 'Resume Translate to Español').props.onClick());
		await settle();
		expect(apiClient.resumeTask).toHaveBeenCalledWith('t1');
	});

	it('offers Resume for a task paused for another reason, and Cancel for an unfinished one', async () => {
		const paused = task({ status: 'paused', pauseReason: 'seller' });
		vi.mocked(apiClient.getStoreTranslations).mockResolvedValue(ok(overview({ languages: [spanish({ task: paused }), portuguese()] })));
		vi.mocked(apiClient.getTasks).mockResolvedValue(ok([paused]));
		vi.mocked(apiClient.cancelTask).mockResolvedValue(ok(task({ status: 'canceled', finishedAt: '2026-10-21T10:06:00.000Z' })));
		const renderer = await mountPage();
		const es = textIn(card(renderer, 'es'));
		expect(es).toContain('Paused');
		expect(es).not.toContain('out of AI credits');
		expect(textIn(labelled(card(renderer, 'es'), 'Resume Translate to Español'))).toBe('Resume');
		const cancel = labelled(renderer.root, 'Cancel Translate to Español');
		expect(textIn(cancel)).toBe('Cancel');
		await act(async () => cancel.props.onClick());
		await settle();
		expect(apiClient.cancelTask).toHaveBeenCalledWith('t1');
		expect(apiClient.getTasks).toHaveBeenCalledTimes(2);
	});

	it('shows a failed task in the language of the seller, and retries it', async () => {
		await applyAccountLocale('es');
		const failed = task({ status: 'failed', lastError: "Couldn't translate most of your store's text.", finishedAt: '2026-10-21T10:05:00.000Z' });
		vi.mocked(apiClient.getTasks).mockResolvedValue(ok([failed]));
		vi.mocked(apiClient.resumeTask).mockResolvedValue(ok(task({ status: 'queued' })));
		const renderer = await mountPage();
		expect(textOf(renderer)).toContain('No se pudo traducir la mayor parte del texto de tu tienda.');
		const retry = labelled(renderer.root, 'Intentar de nuevo: Traducir a Español');
		expect(textIn(retry)).toBe('Intentar de nuevo');
		await act(async () => retry.props.onClick());
		await settle();
		expect(apiClient.resumeTask).toHaveBeenCalledWith('t1');
	});

	it('says translations are paused, and reads nothing, while the pause is on', async () => {
		flags.paused = true;
		const screen = textOf(await mountPage());
		expect(screen).toContain('Store translations are paused for a few minutes. Stores already translated keep working.');
		expect(apiClient.getTranslationStores).not.toHaveBeenCalled();
	});
});
