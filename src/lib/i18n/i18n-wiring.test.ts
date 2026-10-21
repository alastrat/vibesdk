import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../../shared/i18n/locales';
import { STORAGE_KEY } from './index';

const sources = import.meta.glob<string>(
	[
		'/src/main.tsx',
		'/src/lib/i18n/index.ts',
		'/src/lib/api-client.ts',
		'/src/api-types.ts',
		'/src/contexts/auth-context.tsx',
		'/src/routes/settings/index.tsx',
		'/src/components/settings/LanguageCard.tsx',
		'/src/components/auth/LanguagePicker.tsx',
		'/src/components/auth/AuthPageLayout.tsx',
		'/src/components/auth/login-modal.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

const indexHtml = Object.values(import.meta.glob<string>('/index.html', { import: 'default', eager: true }))[0] ?? '';

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the settings page', () => {
	it('has a language card after the analytics card', () => {
		const settings = source('/src/routes/settings/index.tsx');
		expect(settings).toContain('<LanguageCard />');
		expect(settings.indexOf('<AnalyticsPreferenceCard />')).toBeLessThan(settings.indexOf('<LanguageCard />'));
	});

	it('offers each language by its own name, never translated', () => {
		const card = source('/src/components/settings/LanguageCard.tsx');
		expect(card).toContain('LOCALE_NAMES[code]');
		expect(card).toContain('LOCALES.map');
		expect(card).toContain('lang={code}');
	});
});

describe('the sign-in and sign-up screens', () => {
	it('have a language picker on the pages and in the sign-in window', () => {
		expect(source('/src/components/auth/AuthPageLayout.tsx')).toContain('<LanguagePicker />');
		expect(source('/src/components/auth/login-modal.tsx')).toContain('<LanguagePicker />');
	});

	it('offer each language by its own name, never translated', () => {
		const picker = source('/src/components/auth/LanguagePicker.tsx');
		expect(picker).toContain('LOCALE_NAMES[code]');
		expect(picker).toContain('LOCALES.map');
		expect(picker).toContain('lang={code}');
	});
});

describe('the app', () => {
	it('puts the router inside the language provider', () => {
		const main = source('/src/main.tsx');
		expect(main).toContain('<I18nProvider>');
		expect(main.indexOf('<I18nProvider>')).toBeLessThan(main.indexOf('<RouterProvider'));
	});

	it('renders every route again on a language change, which React Router does not do by itself', () => {
		expect(source('/src/main.tsx')).toContain('createBrowserRouter(localizeRoutes(routes)');
	});

	it('follows the saved language of the signed-in account, and tells the account about a new choice', () => {
		const auth = source('/src/contexts/auth-context.tsx');
		expect(auth).toContain('applyAccountLocale(accountLocale)');
		expect(auth).toContain('bindAccountSaver(');
		expect(auth).toContain('apiClient.setLocale(locale)');
	});

	it('sends the visitor language with the sign-up request', () => {
		expect(source('/src/contexts/auth-context.tsx')).toContain('apiClient.register({ ...data, locale: getLocale() })');
		expect(source('/src/lib/api-client.ts')).toContain('locale?: Locale;');
		expect(source('/src/lib/api-client.ts')).toContain("'/api/user/locale'");
	});

	it('takes its language types from api-types', () => {
		const types = source('/src/api-types.ts');
		for (const name of ['Locale', 'LOCALES', 'LOCALE_NAMES', 'isLocale', 'negotiateLocale']) expect(types).toContain(name);
	});
});

describe('the page before the app loads', () => {
	it('starts <html lang> from the saved language, so the right language is declared before the first render', () => {
		const page = indexHtml;
		expect(page).toContain(`localStorage.getItem('${STORAGE_KEY}')`);
		expect(page).toContain('document.documentElement.lang');
	});

	it('only takes a saved value that looks like one of our language codes', () => {
		const page = indexHtml;
		const accepts = /\.test\(stored\)/.test(page);
		expect(accepts).toBe(true);
		const pattern = /var pattern = (\/[^;]+\/);/.exec(page)?.[1];
		expect(pattern).toBeDefined();
		const shape = new RegExp((pattern ?? '').slice(1, -1));
		for (const locale of LOCALES) expect(shape.test(locale), locale).toBe(true);
		expect(shape.test('<script>')).toBe(false);
		expect(shape.test('')).toBe(false);
	});
});
