/**
 * The translations editor mounted for real, with the API mocked: the texts a seller reviews, what saving and going back to
 * the automatic translation do to a row, paging, and that what the seller typed is never lost to a failed save.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiResponse, Locale, StoreLanguageStatus, StoreTranslationOverview, StoreTranslationPage, StoreTranslationRow } from '@/api-types';
import { ApiError, apiClient } from '@/lib/api-client';
import { applyAccountLocale } from '@/lib/i18n';
import { queryKeys } from '@/lib/query-keys';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { TranslationEditor } from './translation-editor';

vi.mock('@/lib/api-client', () => {
	class ApiError extends Error {
		constructor(
			public status: number,
			public statusText: string,
			message: string,
			public endpoint: string,
		) {
			super(message);
		}
	}
	return { ApiError, apiClient: { getStoreTranslationTexts: vi.fn(), saveStoreTranslationText: vi.fn(), revertStoreTranslationText: vi.fn() } };
});

beforeAll(silenceTestRendererDeprecation);

const METHODS = [apiClient.getStoreTranslationTexts, apiClient.saveStoreTranslationText, apiClient.revertStoreTranslationText];

afterEach(async () => {
	await unmountAll();
	await applyAccountLocale('en');
	for (const method of METHODS) vi.mocked(method).mockReset();
});

function ok<T>(data: T): ApiResponse<T> {
	return { success: true, data };
}

const MACHINE: StoreTranslationRow = { hash: 'h1', source: 'Hand-poured candles', text: 'Velas hechas a mano', origin: 'machine', machineText: 'Velas hechas a mano' };
const EDITED: StoreTranslationRow = { hash: 'h2', source: 'Free shipping on every order', text: 'Envío gratis en todos los pedidos', origin: 'seller', machineText: 'Envío gratuito en cada pedido' };
const FRESH: StoreTranslationRow = { hash: 'h3', source: 'New arrivals', text: null, origin: null, machineText: null };
const ALL = [MACHINE, EDITED, FRESH];

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function page(rows: StoreTranslationRow[], nextCursor: string | null = null): StoreTranslationPage {
	return { rows, nextCursor };
}

function language(locale: Locale, enabled: boolean): StoreLanguageStatus {
	return { locale, enabled, ready: enabled, total: 3, translated: 2, edited: 1, left: 1, estimateCredits: 5, task: null };
}

const ES_ONLY = [language('es', true), language('pt-BR', false)];

function overview(): StoreTranslationOverview {
	return {
		settings: { sourceLocale: 'en', targets: { es: { enabled: true, ready: true } }, matchBrowser: true, showSwitcher: true, autoTranslate: false, version: 2 },
		languages: ES_ONLY,
		extractedAt: '2026-10-21T09:00:00.000Z',
		truncated: false,
		manifestInvalid: false,
		deployed: true,
		textsUnavailable: false,
		creditsLeft: null,
		previewUrl: null,
		liveUrl: null,
	};
}

/** Lets the queries answer and React show what they answered. */
async function settle(): Promise<void> {
	for (let round = 0; round < 3; round++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mountEditor(languages: StoreLanguageStatus[] = ES_ONLY): Promise<{ renderer: TestRenderer.ReactTestRenderer; queries: QueryClient }> {
	const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	queries.setQueryData(queryKeys.account.storeTranslations.store('app1'), overview());
	const renderer = await mountElement(createElement(QueryClientProvider, { client: queries }, createElement(TranslationEditor, { appId: 'app1', sourceLocale: 'en', languages })));
	await settle();
	return { renderer, queries };
}

type Instance = TestRenderer.ReactTestInstance;

function textIn(node: Instance): string {
	return node.children.map((child) => (typeof child === 'string' ? child : textIn(child))).join('');
}

function rowNodes(renderer: TestRenderer.ReactTestRenderer): Instance[] {
	return renderer.root.findAll((node) => typeof node.type === 'string' && typeof node.props['data-hash'] === 'string');
}

function rowOf(renderer: TestRenderer.ReactTestRenderer, hash: string): Instance {
	return renderer.root.find((node) => typeof node.type === 'string' && node.props['data-hash'] === hash);
}

function button(scope: Instance, name: string): Instance {
	const found = scope.findAll((node) => node.type === 'button' && textIn(node).trim() === name);
	if (found.length === 0) throw new Error(`No button named ${name}`);
	return found[0];
}

function hasButton(scope: Instance, name: string): boolean {
	return scope.findAll((node) => node.type === 'button' && textIn(node).trim() === name).length > 0;
}

function searchBox(renderer: TestRenderer.ReactTestRenderer): Instance {
	return renderer.root.find((node) => node.type === 'input' && node.props.type === 'search');
}

async function type(scope: Instance, value: string): Promise<void> {
	await act(async () => scope.findByType('textarea').props.onChange({ target: { value } }));
}

async function leave(scope: Instance): Promise<void> {
	await act(async () => scope.findByType('textarea').props.onBlur());
	await settle();
}

function valueOf(scope: Instance): string {
	return scope.findByType('textarea').props.value;
}

describe('the translations editor', () => {
	beforeEach(() => {
		vi.mocked(apiClient.getStoreTranslationTexts).mockResolvedValue(ok(page(ALL)));
	});

	it('lists source and translation with search', async () => {
		vi.mocked(apiClient.getStoreTranslationTexts).mockImplementation(async (_appId, _locale, options) => ok(page(options?.query ? [MACHINE] : ALL)));
		const { renderer } = await mountEditor();
		expect(apiClient.getStoreTranslationTexts).toHaveBeenCalledWith('app1', 'es', { query: undefined, cursor: undefined });

		const rows = rowNodes(renderer);
		expect(rows.map((row) => row.props['data-hash'])).toEqual(['h1', 'h2', 'h3']);
		expect(textIn(rows[0])).toContain('Hand-poured candles');
		expect(textIn(rows[1])).toContain('Free shipping on every order');
		expect(valueOf(rows[0])).toBe('Velas hechas a mano');
		expect(valueOf(rows[1])).toBe('Envío gratis en todos los pedidos');
		// A text with no translation yet is an empty box that says so.
		expect(valueOf(rows[2])).toBe('');
		expect(rows[2].findByType('textarea').props.placeholder).toBe('Not translated yet');
		// The source is the store's language and the box the target's.
		expect(rows[0].find((node) => node.props.lang === 'en' && textIn(node) === 'Hand-poured candles')).toBeTruthy();
		expect(rows[0].findByType('textarea').props.lang).toBe('es');
		// Only an edit is marked, and only an edit of a translated text can go back.
		expect(textIn(rows[1])).toContain('Edited by you');
		expect(textIn(rows[0])).not.toContain('Edited by you');
		expect(textIn(rows[0])).toContain('Automatic translation');
		expect(hasButton(rows[1], 'Use the automatic translation')).toBe(true);
		expect(hasButton(rows[0], 'Use the automatic translation')).toBe(false);
		expect(hasButton(rows[2], 'Use the automatic translation')).toBe(false);

		const box = searchBox(renderer);
		expect(box.props.placeholder).toBe("Search your store's text");
		await act(async () => box.props.onChange({ target: { value: ' velas ' } }));
		// The search waits for a pause in typing.
		expect(apiClient.getStoreTranslationTexts).toHaveBeenCalledTimes(1);
		await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
		await settle();
		expect(apiClient.getStoreTranslationTexts).toHaveBeenCalledTimes(2);
		expect(apiClient.getStoreTranslationTexts).toHaveBeenLastCalledWith('app1', 'es', { query: 'velas', cursor: undefined });
		expect(rowNodes(renderer).map((row) => row.props['data-hash'])).toEqual(['h1']);
	});

	it('says when there is no text, and when nothing matches the search', async () => {
		vi.mocked(apiClient.getStoreTranslationTexts).mockResolvedValue(ok(page([])));
		const { renderer } = await mountEditor();
		expect(textOf(renderer)).toContain('No text to show yet. Translate this language first.');
		await act(async () => searchBox(renderer).props.onChange({ target: { value: 'zzz' } }));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
		await settle();
		const screen = textOf(renderer);
		expect(screen).toContain('No text matches your search.');
		expect(screen).not.toContain('Translate this language first.');
	});

	it('saves only when the text changed, on leaving the box or with Save', async () => {
		vi.mocked(apiClient.saveStoreTranslationText).mockResolvedValue(ok({ ...MACHINE, text: 'Velas artesanales', origin: 'seller' }));
		const { renderer } = await mountEditor();
		const row = () => rowOf(renderer, 'h1');
		expect(button(row(), 'Save').props.disabled).toBe(true);

		await leave(row());
		expect(apiClient.saveStoreTranslationText).not.toHaveBeenCalled();
		await type(row(), 'Velas hechas a mano  ');
		expect(button(row(), 'Save').props.disabled).toBe(true);
		await leave(row());
		await type(row(), 'Velas artesanales');
		expect(button(row(), 'Save').props.disabled).toBe(false);
		await leave(row());
		expect(apiClient.saveStoreTranslationText).not.toHaveBeenCalledWith('app1', 'es', 'h2', expect.anything());
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(1);
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledWith('app1', 'es', 'h1', 'Velas artesanales');

		// Saved: nothing is left to save, and a second blur sends nothing.
		expect(button(row(), 'Save').props.disabled).toBe(true);
		await leave(row());
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(1);

		await type(row(), 'Velas de soya');
		await act(async () => button(row(), 'Save').props.onClick());
		await settle();
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(2);
		expect(apiClient.saveStoreTranslationText).toHaveBeenLastCalledWith('app1', 'es', 'h1', 'Velas de soya');
	});

	it('saving an edit marks it Edited by you', async () => {
		vi.mocked(apiClient.saveStoreTranslationText).mockResolvedValue(ok({ ...MACHINE, text: 'Velas artesanales', origin: 'seller' }));
		const { renderer, queries } = await mountEditor();
		expect(textIn(rowOf(renderer, 'h1'))).not.toContain('Edited by you');
		expect(textIn(rowOf(renderer, 'h1'))).not.toContain('Saved');
		const overviewKey = queryKeys.account.storeTranslations.store('app1');
		expect(queries.getQueryState(overviewKey)?.isInvalidated).toBe(false);

		await type(rowOf(renderer, 'h1'), 'Velas artesanales');
		await leave(rowOf(renderer, 'h1'));

		const row = rowOf(renderer, 'h1');
		expect(textIn(row)).toContain('Edited by you');
		expect(textIn(row)).not.toContain('Automatic translation');
		expect(textIn(row)).toContain('Saved');
		expect(valueOf(row)).toBe('Velas artesanales');
		// The row changed where it stands, and the store's counts of edits are read again.
		expect(rowNodes(renderer).map((node) => node.props['data-hash'])).toEqual(['h1', 'h2', 'h3']);
		expect(queries.getQueryState(overviewKey)?.isInvalidated).toBe(true);
		expect(apiClient.getStoreTranslationTexts).toHaveBeenCalledTimes(1);
		// A text the machine translated can go back to what it wrote.
		expect(hasButton(row, 'Use the automatic translation')).toBe(true);

		// Typing again clears the confirmation.
		await type(row, 'Velas artesanales 2');
		expect(textIn(rowOf(renderer, 'h1'))).not.toContain('Saved');
	});

	it('revert returns the machine text', async () => {
		vi.mocked(apiClient.revertStoreTranslationText).mockResolvedValue(ok({ ...EDITED, text: EDITED.machineText, origin: 'machine' }));
		const { renderer, queries } = await mountEditor();
		const overviewKey = queries.getQueryCache().find({ queryKey: queryKeys.account.storeTranslations.store('app1') })?.queryKey;
		expect(overviewKey).toBeDefined();

		await act(async () => button(rowOf(renderer, 'h2'), 'Use the automatic translation').props.onClick());
		await settle();
		expect(apiClient.revertStoreTranslationText).toHaveBeenCalledWith('app1', 'es', 'h2');

		const row = rowOf(renderer, 'h2');
		expect(valueOf(row)).toBe('Envío gratuito en cada pedido');
		expect(textIn(row)).not.toContain('Edited by you');
		expect(textIn(row)).toContain('Automatic translation');
		expect(hasButton(row, 'Use the automatic translation')).toBe(false);
		expect(rowNodes(renderer).map((node) => node.props['data-hash'])).toEqual(['h1', 'h2', 'h3']);
		expect(queries.getQueryState(queryKeys.account.storeTranslations.store('app1'))?.isInvalidated).toBe(true);
	});

	it('going back drops what was typed but not saved', async () => {
		vi.mocked(apiClient.revertStoreTranslationText).mockResolvedValue(ok({ ...EDITED, text: EDITED.machineText, origin: 'machine' }));
		const { renderer } = await mountEditor();
		await type(rowOf(renderer, 'h2'), 'Algo a medias');
		await act(async () => button(rowOf(renderer, 'h2'), 'Use the automatic translation').props.onClick());
		await settle();
		expect(apiClient.saveStoreTranslationText).not.toHaveBeenCalled();
		expect(valueOf(rowOf(renderer, 'h2'))).toBe('Envío gratuito en cada pedido');
	});

	it('paging loads more', async () => {
		const first = Array.from({ length: 2 }, (_, index): StoreTranslationRow => ({ hash: `a${index}`, source: `Source ${index}`, text: `Texto ${index}`, origin: 'machine', machineText: `Texto ${index}` }));
		const second = [{ ...FRESH, hash: 'b0' }];
		vi.mocked(apiClient.getStoreTranslationTexts).mockImplementation(async (_appId, _locale, options) => ok(options?.cursor === 'next-1' ? page(second) : page(first, 'next-1')));
		const { renderer } = await mountEditor();
		expect(rowNodes(renderer)).toHaveLength(2);
		expect(textOf(renderer)).not.toContain('Not translated yet');

		await act(async () => button(renderer.root, 'Load more').props.onClick());
		await settle();
		expect(apiClient.getStoreTranslationTexts).toHaveBeenLastCalledWith('app1', 'es', { query: undefined, cursor: 'next-1' });
		expect(rowNodes(renderer).map((node) => node.props['data-hash'])).toEqual(['a0', 'a1', 'b0']);
		expect(hasButton(renderer.root, 'Load more')).toBe(false);
	});

	it('a text with no translation can be written, and is saved as the seller edit', async () => {
		vi.mocked(apiClient.saveStoreTranslationText).mockResolvedValue(ok({ ...FRESH, text: 'Novedades', origin: 'seller' }));
		const { renderer } = await mountEditor();
		await type(rowOf(renderer, 'h3'), 'Novedades');
		await leave(rowOf(renderer, 'h3'));
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledWith('app1', 'es', 'h3', 'Novedades');
		const row = rowOf(renderer, 'h3');
		expect(textIn(row)).toContain('Edited by you');
		expect(valueOf(row)).toBe('Novedades');
		// The machine never translated it, so there is nothing to go back to.
		expect(hasButton(row, 'Use the automatic translation')).toBe(false);
	});

	it('keeps what was typed when a save is refused, and says why beside it', async () => {
		vi.mocked(apiClient.saveStoreTranslationText).mockRejectedValue(new ApiError(400, 'Bad Request', 'Write the translation.', '/api/x'));
		const { renderer } = await mountEditor();
		await type(rowOf(renderer, 'h1'), '');
		await leave(rowOf(renderer, 'h1'));
		const row = rowOf(renderer, 'h1');
		expect(textIn(row)).toContain('Write the translation, up to 5,000 characters.');
		expect(textIn(row)).not.toContain('Saved');
		expect(valueOf(row)).toBe('');
		expect(row.find((node) => node.props.role === 'alert')).toBeTruthy();
		// The row still says what is saved.
		expect(textIn(row)).toContain('Automatic translation');
	});

	it('keeps what was typed when a save fails, shows the reason, and saves on the next try', async () => {
		vi.mocked(apiClient.saveStoreTranslationText)
			.mockRejectedValueOnce(new ApiError(0, 'Network Error', 'Failed to fetch', '/api/x'))
			.mockResolvedValue(ok({ ...MACHINE, text: 'Velas artesanales', origin: 'seller' }));
		const { renderer } = await mountEditor();
		await type(rowOf(renderer, 'h1'), 'Velas artesanales');
		await leave(rowOf(renderer, 'h1'));
		let row = rowOf(renderer, 'h1');
		expect(textIn(row)).toContain('Failed to fetch');
		expect(valueOf(row)).toBe('Velas artesanales');
		// Still unsaved, so Save is there for another try.
		expect(button(row, 'Save').props.disabled).toBe(false);

		await act(async () => button(row, 'Save').props.onClick());
		await settle();
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(2);
		row = rowOf(renderer, 'h1');
		expect(textIn(row)).not.toContain('Failed to fetch');
		expect(textIn(row)).toContain('Edited by you');
		expect(valueOf(row)).toBe('Velas artesanales');
	});

	it('keeps what was typed but not saved through a search and a change of language', async () => {
		vi.mocked(apiClient.getStoreTranslationTexts).mockImplementation(async (_appId, _locale, options) => ok(page(options?.query ? [MACHINE] : ALL)));
		vi.mocked(apiClient.saveStoreTranslationText).mockRejectedValue(new ApiError(0, 'Network Error', 'Failed to fetch', '/api/x'));
		const { renderer } = await mountEditor([language('es', true), language('pt-BR', true)]);
		const tabs = () => renderer.root.find((node) => Array.isArray(node.props.tabs) && typeof node.props.onValueChange === 'function');
		const search = async (value: string) => {
			await act(async () => searchBox(renderer).props.onChange({ target: { value } }));
			await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
			await settle();
		};
		await type(rowOf(renderer, 'h2'), 'Algo nuevo');
		await leave(rowOf(renderer, 'h2'));
		expect(textIn(rowOf(renderer, 'h2'))).toContain('Failed to fetch');

		// The search drops the row from the list; clearing it brings the row back with the words, unsaved.
		await search('velas');
		expect(rowNodes(renderer).map((node) => node.props['data-hash'])).toEqual(['h1']);
		await search('');
		expect(valueOf(rowOf(renderer, 'h2'))).toBe('Algo nuevo');
		expect(button(rowOf(renderer, 'h2'), 'Save').props.disabled).toBe(false);
		expect(valueOf(rowOf(renderer, 'h1'))).toBe('Velas hechas a mano');

		await act(async () => tabs().props.onValueChange('pt-BR'));
		await settle();
		await act(async () => tabs().props.onValueChange('es'));
		await settle();
		expect(valueOf(rowOf(renderer, 'h2'))).toBe('Algo nuevo');
		// The same text in the other language is a different box.
		await act(async () => tabs().props.onValueChange('pt-BR'));
		await settle();
		expect(valueOf(rowOf(renderer, 'h2'))).toBe('Envío gratis en todos los pedidos');
	});

	it('says when going back fails, and leaves the row as it is', async () => {
		vi.mocked(apiClient.revertStoreTranslationText).mockRejectedValue(new ApiError(409, 'Conflict', 'There is no automatic translation to go back to.', '/api/x'));
		const { renderer } = await mountEditor();
		await act(async () => button(rowOf(renderer, 'h2'), 'Use the automatic translation').props.onClick());
		await settle();
		const row = rowOf(renderer, 'h2');
		expect(textIn(row)).toContain('There is no automatic translation to go back to.');
		expect(valueOf(row)).toBe('Envío gratis en todos los pedidos');
		expect(textIn(row)).toContain('Edited by you');
	});

	it('has a tab for each language that is on, and reads the language that is chosen', async () => {
		vi.mocked(apiClient.getStoreTranslationTexts).mockImplementation(async (_appId, locale) => ok(page(locale === 'pt-BR' ? [{ ...FRESH, hash: 'p1' }] : ALL)));
		const { renderer } = await mountEditor([language('es', true), language('pt-BR', true)]);
		const tabs = renderer.root.find((node) => Array.isArray(node.props.tabs) && typeof node.props.onValueChange === 'function');
		expect(tabs.props.tabs.map((tab: { value: string }) => tab.value)).toEqual(['es', 'pt-BR']);
		expect(tabs.props.value).toBe('es');

		await act(async () => tabs.props.onValueChange('pt-BR'));
		await settle();
		expect(apiClient.getStoreTranslationTexts).toHaveBeenLastCalledWith('app1', 'pt-BR', { query: undefined, cursor: undefined });
		expect(rowNodes(renderer).map((node) => node.props['data-hash'])).toEqual(['p1']);
		expect(rowNodes(renderer)[0].findByType('textarea').props.lang).toBe('pt-BR');
	});

	it('shows nothing while no language is on', async () => {
		const { renderer } = await mountEditor([language('es', false), language('pt-BR', false)]);
		expect(renderer.toJSON()).toBeNull();
		expect(apiClient.getStoreTranslationTexts).not.toHaveBeenCalled();
	});

	it('says when the texts could not be read, and reads them again on Retry', async () => {
		vi.mocked(apiClient.getStoreTranslationTexts).mockRejectedValueOnce(new ApiError(500, 'Server Error', 'Something broke.', '/api/x')).mockResolvedValue(ok(page(ALL)));
		const { renderer } = await mountEditor();
		const screen = textOf(renderer);
		expect(screen).toContain("Couldn't load your store's text");
		expect(screen).toContain('Something broke.');
		await act(async () => button(renderer.root, 'Retry').props.onClick());
		await settle();
		expect(rowNodes(renderer)).toHaveLength(3);
	});

	it('renders in Spanish', async () => {
		await applyAccountLocale('es');
		vi.mocked(apiClient.saveStoreTranslationText).mockRejectedValue(new ApiError(400, 'Bad Request', 'Write the translation.', '/api/x'));
		const { renderer } = await mountEditor();
		const screen = textOf(renderer);
		for (const text of ['Revisar traducciones', 'Editado por ti', 'Traducción automática']) expect(screen).toContain(text);
		expect(searchBox(renderer).props.placeholder).toBe('Buscar en el texto de tu tienda');
		expect(rowOf(renderer, 'h3').findByType('textarea').props.placeholder).toBe('Aún sin traducir');
		expect(hasButton(rowOf(renderer, 'h2'), 'Usar la traducción automática')).toBe(true);
		expect(screen).not.toContain('Edited by you');

		await type(rowOf(renderer, 'h1'), '');
		await leave(rowOf(renderer, 'h1'));
		expect(textIn(rowOf(renderer, 'h1'))).toContain('Escribe la traducción, de hasta 5,000 caracteres.');
	});

	it('renders in Portuguese, with a number of characters written the way Portuguese writes it', async () => {
		await applyAccountLocale('pt-BR');
		vi.mocked(apiClient.saveStoreTranslationText).mockRejectedValue(new ApiError(400, 'Bad Request', 'Write the translation.', '/api/x'));
		const { renderer } = await mountEditor();
		expect(textOf(renderer)).toContain('Editado por você');
		await type(rowOf(renderer, 'h1'), '');
		await leave(rowOf(renderer, 'h1'));
		expect(textIn(rowOf(renderer, 'h1'))).toContain('Escreva a tradução, com até 5.000 caracteres.');
	});

	it('sends what was typed while a save was pending once it lands, and says Saved only then', async () => {
		const first = deferred<ApiResponse<StoreTranslationRow>>();
		const second = deferred<ApiResponse<StoreTranslationRow>>();
		vi.mocked(apiClient.saveStoreTranslationText).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const { renderer } = await mountEditor();
		const row = () => rowOf(renderer, 'h1');

		await type(row(), 'Velas');
		await leave(row());
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(1);
		// Typing on, and leaving the box, while the first save is on its way.
		await type(row(), 'Velas de soya');
		await leave(row());
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(1);

		await act(async () => first.resolve(ok({ ...MACHINE, text: 'Velas', origin: 'seller' })));
		await settle();
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(2);
		expect(apiClient.saveStoreTranslationText).toHaveBeenLastCalledWith('app1', 'es', 'h1', 'Velas de soya');
		// The newer words are not saved yet, so nothing says they are.
		expect(textIn(row())).not.toContain('Saved');
		expect(valueOf(row())).toBe('Velas de soya');

		await act(async () => second.resolve(ok({ ...MACHINE, text: 'Velas de soya', origin: 'seller' })));
		await settle();
		expect(textIn(row())).toContain('Saved');
		expect(valueOf(row())).toBe('Velas de soya');
		expect(button(row(), 'Save').props.disabled).toBe(true);
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(2);
	});

	it('says Saved when only spaces were typed after a save began', async () => {
		const first = deferred<ApiResponse<StoreTranslationRow>>();
		vi.mocked(apiClient.saveStoreTranslationText).mockReturnValueOnce(first.promise);
		const { renderer } = await mountEditor();
		await type(rowOf(renderer, 'h1'), 'Velas');
		await leave(rowOf(renderer, 'h1'));
		await type(rowOf(renderer, 'h1'), 'Velas ');
		await act(async () => first.resolve(ok({ ...MACHINE, text: 'Velas', origin: 'seller' })));
		await settle();
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(1);
		expect(textIn(rowOf(renderer, 'h1'))).toContain('Saved');
	});

	it('does not send a refused text again on leaving the box, only once it changes or Save is used', async () => {
		vi.mocked(apiClient.saveStoreTranslationText).mockRejectedValue(new ApiError(500, 'Server Error', 'Something broke.', '/api/x'));
		const { renderer } = await mountEditor();
		const row = () => rowOf(renderer, 'h1');
		await type(row(), 'Velas nuevas');
		await leave(row());
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(1);
		await leave(row());
		await leave(row());
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(1);

		await type(row(), 'Velas nuevas 2');
		await leave(row());
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(2);
		expect(apiClient.saveStoreTranslationText).toHaveBeenLastCalledWith('app1', 'es', 'h1', 'Velas nuevas 2');
		await leave(row());
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(2);

		// Save is the seller asking again.
		await act(async () => button(row(), 'Save').props.onClick());
		await settle();
		expect(apiClient.saveStoreTranslationText).toHaveBeenCalledTimes(3);
		expect(textIn(row())).toContain('Something broke.');
	});

	it('does not bring back stale spaces for a row that left the list while its save landed', async () => {
		const server = new Map(ALL.map((row) => [row.hash, row]));
		const gate = deferred<void>();
		vi.mocked(apiClient.getStoreTranslationTexts).mockImplementation(async (_appId, _locale, options) =>
			ok(page([...server.values()].filter((row) => !options?.query || row.source.toLowerCase().includes(options.query.toLowerCase())))),
		);
		vi.mocked(apiClient.saveStoreTranslationText).mockImplementation(async (_appId, _locale, hash, text) => {
			await gate.promise;
			const saved: StoreTranslationRow = { ...server.get(hash)!, text: text.trim(), origin: 'seller' };
			server.set(hash, saved);
			return ok(saved);
		});
		const { renderer } = await mountEditor();
		const search = async (value: string) => {
			await act(async () => searchBox(renderer).props.onChange({ target: { value } }));
			await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
			await settle();
		};
		await type(rowOf(renderer, 'h1'), 'Hola ');
		await leave(rowOf(renderer, 'h1'));
		// The row leaves the list while its save is still on its way.
		await search('zzz');
		expect(rowNodes(renderer)).toHaveLength(0);
		await act(async () => gate.resolve());
		await settle();

		await search('');
		const row = rowOf(renderer, 'h1');
		expect(valueOf(row)).toBe('Hola');
		expect(textIn(row)).toContain('Edited by you');
		expect(button(row, 'Save').props.disabled).toBe(true);
	});

	it('lists a text once when a re-read of the store makes the next page repeat it', async () => {
		const first = { ...MACHINE, hash: 'a0' };
		const second = { ...MACHINE, hash: 'a1' };
		vi.mocked(apiClient.getStoreTranslationTexts).mockImplementation(async (_appId, _locale, options) =>
			ok(options?.cursor === 'c' ? page([second, { ...FRESH, hash: 'b0' }]) : page([first, second], 'c')),
		);
		const { renderer } = await mountEditor();
		await act(async () => button(renderer.root, 'Load more').props.onClick());
		await settle();
		expect(rowNodes(renderer).map((node) => node.props['data-hash'])).toEqual(['a0', 'a1', 'b0']);
	});

	it('names each box and each action for its row, with the first words of the text', async () => {
		const long = { ...FRESH, hash: 'h4', source: 'Sign up for our newsletter and get ten percent off your first order, plus early access to new scents' };
		vi.mocked(apiClient.getStoreTranslationTexts).mockResolvedValue(ok(page([EDITED, long])));
		vi.mocked(apiClient.saveStoreTranslationText).mockRejectedValue(new ApiError(500, 'Server Error', 'Something broke.', '/api/x'));
		const { renderer } = await mountEditor();

		const edited = rowOf(renderer, 'h2');
		const sourceId = edited.find((node) => node.type === 'p' && node.props.lang === 'en').props.id;
		expect(sourceId).toEqual(expect.any(String));
		expect(edited.findByType('textarea').props['aria-label']).toBe('Translation into Español: Free shipping on every order');
		expect(edited.findByType('textarea').props['aria-describedby']).toBe(sourceId);
		// Several rows say the same thing on their buttons; the source text tells them apart.
		for (const name of ['Save', 'Use the automatic translation']) {
			const hostButton = edited.find((node) => node.type === 'button' && textIn(node).trim() === name);
			expect(hostButton.props['aria-describedby'], name).toBe(sourceId);
		}

		// A long text is cut, and the box's name stays short.
		const name: string = rowOf(renderer, 'h4').findByType('textarea').props['aria-label'];
		expect(name.startsWith('Translation into Español: Sign up for our newsletter')).toBe(true);
		expect(name.endsWith('…')).toBe(true);
		expect(name.length).toBeLessThan('Translation into Español: '.length + 62);

		// A failed save adds its message to what the box is described by.
		await type(edited, 'Envío gratis');
		await leave(edited);
		const alert = rowOf(renderer, 'h2').find((node) => node.props.role === 'alert');
		expect(textIn(alert)).toBe('Something broke.');
		expect(rowOf(renderer, 'h2').findByType('textarea').props['aria-describedby']).toBe(`${sourceId} ${alert.props.id}`);
	});

	it('sizes the box to its text where the browser does not, and again when the width changes', async () => {
		interface Box {
			style: { height: string };
			scrollHeight: number;
			offsetHeight: number;
			clientHeight: number;
		}
		interface Watch {
			callback: (entries: Array<{ contentRect: { width: number } }>) => void;
			observed: unknown[];
			disconnected: boolean;
		}
		const boxes: Box[] = [];
		const watches: Watch[] = [];
		vi.stubGlobal(
			'ResizeObserver',
			class {
				private readonly watch: Watch;
				constructor(callback: Watch['callback']) {
					this.watch = { callback, observed: [], disconnected: false };
					watches.push(this.watch);
				}
				observe(element: unknown) {
					this.watch.observed.push(element);
				}
				disconnect() {
					this.watch.disconnected = true;
				}
			},
		);
		try {
			vi.mocked(apiClient.getStoreTranslationTexts).mockResolvedValue(ok(page([MACHINE, EDITED])));
			const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
			let renderer!: TestRenderer.ReactTestRenderer;
			await act(async () => {
				renderer = TestRenderer.create(createElement(QueryClientProvider, { client: queries }, createElement(TranslationEditor, { appId: 'app1', sourceLocale: 'en', languages: ES_ONLY })), {
					createNodeMock: (element) => {
						if (element.type !== 'textarea') return null;
						const box: Box = { style: { height: '' }, scrollHeight: 120, offsetHeight: 100, clientHeight: 98 };
						boxes.push(box);
						return box;
					},
				});
			});
			await settle();
			expect(boxes).toHaveLength(2);
			// The height of the text plus the border: scrollHeight + offsetHeight - clientHeight.
			expect(boxes.map((box) => box.style.height)).toEqual(['122px', '122px']);
			expect(watches).toHaveLength(2);
			expect(watches.map((watch) => watch.observed)).toEqual([[boxes[0]], [boxes[1]]]);

			// The width changed, so the text wraps differently.
			boxes[0].scrollHeight = 200;
			act(() => watches[0].callback([{ contentRect: { width: 300 } }]));
			expect(boxes[0].style.height).toBe('202px');
			// The same width again, such as the answer to the box's own new height, measures nothing.
			boxes[0].scrollHeight = 300;
			act(() => watches[0].callback([{ contentRect: { width: 300 } }]));
			expect(boxes[0].style.height).toBe('202px');
			act(() => watches[0].callback([{ contentRect: { width: 280 } }]));
			expect(boxes[0].style.height).toBe('302px');
			expect(boxes[1].style.height).toBe('122px');

			expect(watches.map((watch) => watch.disconnected)).toEqual([false, false]);
			await act(async () => renderer.unmount());
			expect(watches.map((watch) => watch.disconnected)).toEqual([true, true]);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
