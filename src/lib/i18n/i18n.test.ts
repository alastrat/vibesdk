import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadCatalog } from './catalog-loader';
import { I18nProvider, LocaleLoadError, LocaleSaveError, STORAGE_KEY, T, applyAccountLocale, bindAccountSaver, getLocale, initialLocale, setLocale, subscribe, t, tn, useI18n } from './index';

vi.mock('./catalog-loader', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./catalog-loader')>();
	return { loadCatalog: vi.fn(actual.loadCatalog) };
});

/** A page whose `<html lang>` and storage a test can read. */
function stubBrowser(options: { stored?: string; storageThrows?: boolean; languages?: string[] } = {}) {
	const documentElement = { lang: 'en' };
	const store = new Map<string, string>(options.stored === undefined ? [] : [[STORAGE_KEY, options.stored]]);
	vi.stubGlobal('document', { documentElement });
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => {
			if (options.storageThrows) throw new Error('blocked');
			return store.get(key) ?? null;
		},
		setItem: (key: string, value: string) => {
			if (options.storageThrows) throw new Error('blocked');
			store.set(key, value);
		},
	});
	vi.stubGlobal('navigator', { languages: options.languages ?? ['en-US'] });
	return { documentElement, store };
}

afterEach(async () => {
	vi.unstubAllGlobals();
	bindAccountSaver(null);
	vi.mocked(loadCatalog).mockClear();
	await applyAccountLocale('en');
});

describe('the active language', () => {
	it('starts in English, where t answers the English text with its values filled in', () => {
		expect(getLocale()).toBe('en');
		expect(t('Choose your language')).toBe('Choose your language');
		expect(t('Hello {name}', { name: 'Ana' })).toBe('Hello Ana');
	});

	it('loads the catalog on setLocale, so t answers in that language, and follows back to English', async () => {
		stubBrowser();
		await setLocale('es');
		expect(getLocale()).toBe('es');
		expect(t('Choose your language')).toBe('Elige tu idioma');
		await setLocale('pt-BR');
		expect(getLocale()).toBe('pt-BR');
		expect(t('Choose your language')).toBe('Escolha seu idioma');
		await setLocale('en');
		expect(getLocale()).toBe('en');
		expect(t('Choose your language')).toBe('Choose your language');
	});

	it('loads no catalog for English', async () => {
		stubBrowser();
		await setLocale('en');
		expect(loadCatalog).not.toHaveBeenCalledWith('es');
		await setLocale('es');
		expect(loadCatalog).toHaveBeenCalledWith('es');
	});

	it('falls back to the English text for a string with no translation', async () => {
		stubBrowser();
		await setLocale('es');
		expect(t('A sentence nobody translated')).toBe('A sentence nobody translated');
	});

	it('counts and formats plurals in the language, falling back to the English forms', async () => {
		stubBrowser();
		expect(tn('{count} credit', '{count} credits', 1)).toBe('1 credit');
		expect(tn('{count} credit', '{count} credits', 1500)).toBe('1,500 credits');
		await setLocale('pt-BR');
		expect(tn('{count} credit', '{count} credits', 1500)).toBe('1.500 credits');
	});

	it('sets <html lang> to the language', async () => {
		const { documentElement } = stubBrowser();
		await setLocale('pt-BR');
		expect(documentElement.lang).toBe('pt-BR');
		await setLocale('es');
		expect(documentElement.lang).toBe('es');
	});

	it('remembers the choice in this browser, and still works when storage is blocked', async () => {
		const { store } = stubBrowser();
		await setLocale('es');
		expect(store.get(STORAGE_KEY)).toBe('es');
		vi.unstubAllGlobals();
		stubBrowser({ storageThrows: true });
		await expect(setLocale('pt-BR')).resolves.toBeUndefined();
		expect(getLocale()).toBe('pt-BR');
	});

	it('tells subscribers about a change once, and about no change not at all', async () => {
		stubBrowser();
		const listener = vi.fn();
		const unsubscribe = subscribe(listener);
		await setLocale('es');
		expect(listener).toHaveBeenCalledTimes(1);
		await setLocale('es');
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		await setLocale('pt-BR');
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('lets the last request win when two overlap', async () => {
		stubBrowser();
		await Promise.all([setLocale('es'), setLocale('pt-BR')]);
		expect(getLocale()).toBe('pt-BR');
		expect(t('Choose your language')).toBe('Escolha seu idioma');
	});

	it('saves only the request that won, so an earlier one never overwrites the account', async () => {
		stubBrowser();
		const save = vi.fn(async () => undefined);
		bindAccountSaver(save);
		await Promise.all([setLocale('es'), setLocale('pt-BR')]);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith('pt-BR');
	});

	it('keeps the current language, and rejects, when a catalog cannot be loaded', async () => {
		stubBrowser();
		await setLocale('es');
		vi.mocked(loadCatalog).mockRejectedValueOnce(new Error('offline'));
		const failure = await setLocale('pt-BR').catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(LocaleLoadError);
		expect((failure as Error).cause).toEqual(new Error('offline'));
		expect(getLocale()).toBe('es');
		expect(t('Choose your language')).toBe('Elige tu idioma');
	});
});

describe('the signed-in account', () => {
	it('is told the new language when someone chooses it', async () => {
		stubBrowser();
		const save = vi.fn(async () => undefined);
		const unbind = bindAccountSaver(save);
		await setLocale('es');
		expect(save).toHaveBeenCalledWith('es');
		unbind();
		await setLocale('pt-BR');
		expect(save).toHaveBeenCalledTimes(1);
	});

	it('is told again when the language is chosen again, so a failed save can be retried', async () => {
		stubBrowser();
		const save = vi.fn(async () => undefined);
		bindAccountSaver(save);
		await setLocale('es');
		await setLocale('es');
		expect(save).toHaveBeenCalledTimes(2);
	});

	it('is not told when its own saved language is applied', async () => {
		stubBrowser();
		const save = vi.fn(async () => undefined);
		bindAccountSaver(save);
		await applyAccountLocale('pt-BR');
		expect(getLocale()).toBe('pt-BR');
		expect(save).not.toHaveBeenCalled();
	});

	it('keeps the language shown, and rejects, when the account cannot be saved', async () => {
		stubBrowser();
		bindAccountSaver(async () => {
			throw new Error('offline');
		});
		const failure = await setLocale('es').catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(LocaleSaveError);
		expect((failure as Error).cause).toEqual(new Error('offline'));
		expect(getLocale()).toBe('es');
	});

	it('remembers the account language in this browser, so the sign-in page follows it after signing out', async () => {
		const { store } = stubBrowser();
		await applyAccountLocale('pt-BR');
		expect(store.get(STORAGE_KEY)).toBe('pt-BR');
	});

	it('replaces the saver of an earlier binding, and unbinding an old one leaves the new one', async () => {
		stubBrowser();
		const first = vi.fn(async () => undefined);
		const second = vi.fn(async () => undefined);
		const unbindFirst = bindAccountSaver(first);
		bindAccountSaver(second);
		unbindFirst();
		await setLocale('es');
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledWith('es');
	});
});

describe('the language a visit starts in', () => {
	it('is the one saved in this browser', () => {
		stubBrowser({ stored: 'es', languages: ['pt-BR'] });
		expect(initialLocale()).toBe('es');
	});

	it('ignores a saved value that is not a language we speak', () => {
		stubBrowser({ stored: 'fr', languages: ['pt-BR'] });
		expect(initialLocale()).toBe('pt-BR');
	});

	it('follows the browser languages otherwise, Brazilian for any Portuguese and Latin American for any Spanish', () => {
		stubBrowser({ languages: ['pt-PT', 'en'] });
		expect(initialLocale()).toBe('pt-BR');
		vi.unstubAllGlobals();
		stubBrowser({ languages: ['es-ES'] });
		expect(initialLocale()).toBe('es');
		vi.unstubAllGlobals();
		stubBrowser({ languages: ['fr-FR', 'de'] });
		expect(initialLocale()).toBe('en');
	});

	it('is English with no browser to ask, or one that blocks its storage', () => {
		vi.stubGlobal('navigator', undefined);
		expect(initialLocale()).toBe('en');
		vi.unstubAllGlobals();
		stubBrowser({ storageThrows: true, languages: ['es'] });
		expect(initialLocale()).toBe('es');
	});
});

const link = (children: ReactNode): ReactNode => createElement('a', { href: '/terms' }, children);
const strong = (children: ReactNode): ReactNode => createElement('strong', null, children);
const html = (node: ReactNode): string => renderToStaticMarkup(node);

describe('<T>', () => {
	it('renders rich text with the components its tags name', () => {
		expect(html(createElement(T, { text: 'Read the <link>terms</link>, please.', components: { link } }))).toBe('Read the <a href="/terms">terms</a>, please.');
	});

	it('nests tags and fills values in the text between them', () => {
		const text = '<b>{name}</b> agreed to the <link>terms</link>';
		expect(html(createElement(T, { text, values: { name: 'Ana' }, components: { link, b: strong } }))).toBe('<strong>Ana</strong> agreed to the <a href="/terms">terms</a>');
		expect(html(createElement(T, { text: '<link>Read <b>this</b></link>', components: { link, b: strong } }))).toBe('<a href="/terms">Read <strong>this</strong></a>');
	});

	it('never turns a value into a tag, so a store named with markup stays text', () => {
		const text = 'Welcome to {store}, see the <link>terms</link>';
		const output = html(createElement(T, { text, values: { store: '<link>Evil</link> & <b>Shop</b>' }, components: { link, b: strong } }));
		expect(output).toBe('Welcome to &lt;link&gt;Evil&lt;/link&gt; &amp; &lt;b&gt;Shop&lt;/b&gt;, see the <a href="/terms">terms</a>');
		expect(output.match(/<a /g)).toHaveLength(1);
		expect(output).not.toContain('<strong>');
	});

	it('does not expand a placeholder that arrives inside a value', () => {
		expect(html(createElement(T, { text: '{a} and {b}', values: { a: '{b}', b: 'x' } }))).toBe('{b} and x');
	});

	it('renders the children of a tag with no component as plain text', () => {
		expect(html(createElement(T, { text: 'Read the <link>terms</link> and <em>this</em>.' }))).toBe('Read the terms and this.');
		expect(html(createElement(T, { text: 'Read the <link>terms</link>.', components: { b: strong } }))).toBe('Read the terms.');
	});

	it('does not look tags up on the prototype', () => {
		expect(html(createElement(T, { text: 'a <constructor>b</constructor> <toString>c</toString>', components: {} }))).toBe('a b c');
	});

	it('leaves tags that are not paired as text', () => {
		expect(html(createElement(T, { text: '1 < 2 and <link>open', components: { link } }))).toBe('1 &lt; 2 and &lt;link&gt;open');
	});

	it('translates the text before it reads the tags', async () => {
		stubBrowser();
		await setLocale('es');
		expect(html(createElement(T, { text: 'Choose your language' }))).toBe('Elige tu idioma');
	});
});

describe('useI18n', () => {
	function Probe() {
		const { locale, t: translated } = useI18n();
		return createElement('p', null, `${locale}: ${translated('Choose your language')}`);
	}

	it('reads the current language, so a component shows the new one the next time it renders', async () => {
		stubBrowser();
		expect(html(createElement(Probe))).toBe('<p>en: Choose your language</p>');
		await setLocale('es');
		expect(html(createElement(Probe))).toBe('<p>es: Elige tu idioma</p>');
		await setLocale('pt-BR');
		expect(html(createElement(Probe))).toBe('<p>pt-BR: Escolha seu idioma</p>');
	});

	it('hands out a different t for each language, so memoised text that lists it refreshes', async () => {
		stubBrowser();
		const seen: unknown[] = [];
		function Capture() {
			seen.push(useI18n().t);
			return null;
		}
		html(createElement(Capture));
		html(createElement(Capture));
		await setLocale('es');
		html(createElement(Capture));
		expect(seen[0]).toBe(seen[1]);
		expect(seen[2]).not.toBe(seen[0]);
	});

	it('gives the same setLocale as the module, which saves to the account', async () => {
		stubBrowser();
		const save = vi.fn(async () => undefined);
		bindAccountSaver(save);
		let chosen: (locale: 'es') => Promise<void> = async () => undefined;
		function Capture() {
			chosen = useI18n().setLocale;
			return null;
		}
		html(createElement(Capture));
		await chosen('es');
		expect(save).toHaveBeenCalledWith('es');
	});
});

describe('I18nProvider', () => {
	const page = createElement('p', null, 'page');

	it('shows its child at once when the visit starts in English', () => {
		stubBrowser();
		expect(html(createElement(I18nProvider, null, page))).toBe('<p>page</p>');
	});
});
