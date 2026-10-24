import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../../shared/i18n/locales';
import { STORAGE_KEY } from './index';

const sources = import.meta.glob<string>(
	[
		'/src/main.tsx',
		'/src/routes.tsx',
		'/src/routes/protected-page.ts',
		'/src/lib/i18n/index.ts',
		'/src/lib/api-client.ts',
		'/src/api-types.ts',
		'/src/contexts/auth-context.tsx',
		'/src/routes/settings/index.tsx',
		'/src/components/settings/LanguageCard.tsx',
		'/src/components/account-settings/preferences.tsx',
		'/src/components/layout/PublicLanguageMenu.tsx',
		'/src/components/auth/AuthPageLayout.tsx',
		'/src/components/layout/PublicUtilityBar.tsx',
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
	it('shares the account dialog language and privacy controls', () => {
		const settings = source('/src/routes/settings/index.tsx');
		expect(settings).toContain('<AppearanceSettings />');
		expect(settings).toContain('<PrivacySettings />');
		const preferences = source('/src/components/account-settings/preferences.tsx');
		expect(preferences).toContain('LOCALES.map');
		expect(preferences).toContain('LOCALE_NAMES[code]');
		expect(preferences).toContain('await chooseLocale(value)');
	});

	it('offers each language by its own name, never translated', () => {
		const card = source('/src/components/settings/LanguageCard.tsx');
		expect(card).toContain('LOCALE_NAMES[code]');
		expect(card).toContain('LOCALES.map');
		expect(card).toContain('lang={code}');
	});
});

describe('the public language menu', () => {
	it('lives in the public header instead of the authentication forms', () => {
		expect(source('/src/components/layout/PublicUtilityBar.tsx')).toContain('<PublicLanguageMenu />');
		expect(source('/src/components/auth/AuthPageLayout.tsx')).not.toContain('<LanguagePicker />');
		expect(source('/src/components/auth/login-modal.tsx')).not.toContain('<LanguagePicker />');
	});

	it('switch the language through chooseLocale, which says when that did not work', () => {
		expect(source('/src/components/layout/PublicLanguageMenu.tsx')).toContain('chooseLocale(value)');
		expect(source('/src/components/settings/LanguageCard.tsx')).toContain('await chooseLocale(value)');
	});

	it('offer each language by its own name, never translated', () => {
		const picker = source('/src/components/layout/PublicLanguageMenu.tsx');
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

	it('keeps no route as an element with elements inside it, which React would skip on a language change', () => {
		const table = source('/src/routes.tsx');
		// An `element` may only be a bare <Navigate>; a page behind sign-in is `Component: protectedPage(Page)`.
		expect(table.match(/\belement:\s*\(?\s*<(?!Navigate\b)/g)).toBeNull();
		expect(table).not.toContain('<ProtectedRoute');
		expect(table).toContain('Component: protectedPage(Settings)');
		expect(source('/src/routes/protected-page.ts')).toContain('createElement(ProtectedRoute, null, createElement(Page))');
	});

	it('uses none of the route fields localizeRoutes cannot render again', () => {
		expect(source('/src/routes.tsx')).not.toMatch(/\b(lazy|ErrorBoundary|errorElement|HydrateFallback|hydrateFallbackElement)\s*:/);
	});

	it('follows the saved language of the signed-in account, and tells the account about a new choice', () => {
		const auth = source('/src/contexts/auth-context.tsx');
		expect(auth).toContain('applyAccountLocale(accountLocale)');
		expect(auth).toContain('bindAccountSaver(');
		expect(auth).toContain('apiClient.setLocale(locale)');
	});

	it('stops a profile request that is still in flight before it saves the new language in the cached session', () => {
		const auth = source('/src/contexts/auth-context.tsx');
		const saver = auth.slice(auth.indexOf('bindAccountSaver('), auth.indexOf('[signedIn, queryClient]'));
		expect(saver).toContain('cancelQueries({ queryKey: queryKeys.auth.session() })');
		expect(saver.indexOf('cancelQueries')).toBeLessThan(saver.indexOf('setQueryData<CachedAuthSession | null>'));
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

	it('only takes a saved value that is exactly one of our language codes, and all of them', () => {
		const listed = /\[((?:'[^']+',?\s*)+)\]\.indexOf\(stored\)/.exec(indexHtml)?.[1];
		expect(listed).toBeDefined();
		const codes = (listed ?? '').split(',').map((code) => code.trim().replace(/^'|'$/g, '')).filter((code) => code !== '');
		expect(codes).toEqual([...LOCALES]);
	});
});
