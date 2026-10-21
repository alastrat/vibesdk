/**
 * The routes and the provider mounted for real, with state, effects and subscriptions, because rendering to a string
 * can't tell a page that re-renders on a language change from one that was only rendered again from scratch.
 * `react-test-renderer` mounts them without a DOM, which the Workers test pool doesn't have.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import TestRenderer from 'react-test-renderer';
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from 'react-router';
import { protectedPage } from '@/routes/protected-page';
import { loadCatalog } from './catalog-loader';
import { I18nProvider, STORAGE_KEY, applyAccountLocale, getLocale, setLocale, t } from './index';
import { localizeRoutes } from './localize-routes';

vi.hoisted(() => {
	// React's `await act(...)` queues its work on a MessageChannel, which Workers don't have.
	class Channel {
		port1: { onmessage: ((event: unknown) => void) | null } = { onmessage: null };
		port2 = { postMessage: () => void setTimeout(() => this.port1.onmessage?.({}), 0) };
	}
	Object.assign(globalThis, { MessageChannel: Channel, IS_REACT_ACT_ENVIRONMENT: true });
});

vi.mock('./catalog-loader', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./catalog-loader')>();
	return { loadCatalog: vi.fn(actual.loadCatalog) };
});

vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false }) }));

function Layout() {
	const [typed, setTyped] = useState('');
	return createElement(
		'div',
		null,
		createElement('input', { value: typed, onChange: (event: { target: { value: string } }) => setTyped(event.target.value) }),
		createElement(Outlet),
	);
}

/** Reads `t()` with no hook, as most components will. */
function PlainPage() {
	return createElement('h1', null, t('Choose your language'));
}

function GuardedPage() {
	return createElement('h2', null, t('Choose your language'));
}

const routes = (): RouteObject[] => [
	{
		path: '/',
		Component: Layout,
		children: [
			{ path: 'plain', Component: PlainPage },
			{ path: 'guarded', Component: protectedPage(GuardedPage) },
		],
	},
];

const mounted: TestRenderer.ReactTestRenderer[] = [];

/** A route table mounted at `path`; `screen()` is everything on screen, as JSON. */
async function mount(table: RouteObject[], path: string) {
	const router = createMemoryRouter(table, { initialEntries: [path] });
	let renderer!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		renderer = TestRenderer.create(createElement(RouterProvider, { router }));
	});
	mounted.push(renderer);
	return {
		router,
		screen: (): string => JSON.stringify(renderer.toJSON()),
		input: () => renderer.root.findByType('input'),
		type: (value: string) => act(() => renderer.root.findByType('input').props.onChange({ target: { value } })),
		go: (to: string) => act(async () => void (await router.navigate(to))),
	};
}

const choose = (locale: 'en' | 'es' | 'pt-BR') => act(async () => setLocale(locale));

beforeAll(() => {
	// The test renderer announces its own deprecation on every mount.
	const error = console.error.bind(console);
	vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		if (!String(args[0]).includes('react-test-renderer is deprecated')) error(...args);
	});
});

afterEach(async () => {
	vi.unstubAllGlobals();
	// Unmounted first, so going back to English isn't an update to a page that is still on screen.
	for (const renderer of mounted.splice(0)) act(() => renderer.unmount());
	await applyAccountLocale('en');
});

describe('routes mounted with localizeRoutes', () => {
	it('shows the new language on the page that is open, and keeps what was typed above it', async () => {
		const app = await mount(localizeRoutes(routes()), '/plain');
		expect(app.screen()).toContain('Choose your language');
		await app.type('my store');
		await choose('es');
		expect(getLocale()).toBe('es');
		expect(app.screen()).toContain('Elige tu idioma');
		expect(app.screen()).not.toContain('Choose your language');
		expect(app.input().props.value).toBe('my store');
	});

	it('does the same for a page behind sign-in, which is built by protectedPage inside the route', async () => {
		const app = await mount(localizeRoutes(routes()), '/guarded');
		await app.type('draft');
		await choose('pt-BR');
		expect(app.screen()).toContain('Escolha seu idioma');
		expect(app.input().props.value).toBe('draft');
		await choose('es');
		expect(app.screen()).toContain('Elige tu idioma');
	});

	it('follows the language across pages, and back to English', async () => {
		const app = await mount(localizeRoutes(routes()), '/plain');
		await choose('es');
		await app.go('/guarded');
		expect(app.screen()).toContain('Elige tu idioma');
		await choose('pt-BR');
		expect(app.screen()).toContain('Escolha seu idioma');
		await app.go('/plain');
		expect(app.screen()).toContain('Escolha seu idioma');
		await choose('en');
		expect(app.screen()).toContain('Choose your language');
	});
});

describe('routes mounted without localizeRoutes', () => {
	it('keep the old language, which is why localizeRoutes exists', async () => {
		const app = await mount(routes(), '/plain');
		await choose('es');
		expect(app.screen()).toContain('Choose your language');
		expect(app.screen()).not.toContain('Elige tu idioma');
	});
});

/** A page, and where it was last told which language it is in. */
function stubPage(options: { stored?: string; languages?: string[]; lang?: string } = {}) {
	const documentElement = { lang: options.lang ?? 'en' };
	vi.stubGlobal('document', { documentElement });
	vi.stubGlobal('localStorage', { getItem: (key: string) => (key === STORAGE_KEY ? (options.stored ?? null) : null), setItem: () => undefined });
	vi.stubGlobal('navigator', { languages: options.languages ?? ['en-US'] });
	return documentElement;
}

describe('I18nProvider mounted', () => {
	// A component, not an element made here: the text is read when the page renders, after the language is in place.
	const Child = () => createElement('h1', null, t('Choose your language'));

	/**
	 * The provider mounted around the child: what it showed straight away, and `screen()` once the language was in place.
	 * React runs the provider's update when `act` ends, so the wait is for the language, not for the screen.
	 */
	async function mountProvider(inPlace: () => boolean = () => true) {
		let renderer!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			renderer = TestRenderer.create(createElement(I18nProvider, null, createElement(Child)));
		});
		mounted.push(renderer);
		const screen = (): string => JSON.stringify(renderer.toJSON());
		const initial = screen();
		await act(async () => {
			await vi.waitFor(() => expect(inPlace()).toBe(true));
		});
		return { initial, screen };
	}

	it('shows nothing until the saved language is loaded, then shows the page in it with <html lang> to match', async () => {
		const html = stubPage({ stored: 'pt-BR', lang: 'pt-BR' });
		const { initial, screen } = await mountProvider(() => getLocale() === 'pt-BR');
		expect(initial).toBe('null');
		expect(screen()).toContain('Escolha seu idioma');
		expect(html.lang).toBe('pt-BR');
	});

	it('follows the browser languages when nothing is saved, and says so in <html lang>', async () => {
		const html = stubPage({ languages: ['es-MX', 'en'], lang: 'en' });
		const { screen } = await mountProvider(() => getLocale() === 'es');
		expect(screen()).toContain('Elige tu idioma');
		expect(html.lang).toBe('es');
	});

	it('shows the page in English, and says English, when the saved language cannot be loaded', async () => {
		// index.html declared Spanish from storage before the app ran; the text is English, so the page must say so.
		const html = stubPage({ stored: 'es', lang: 'es' });
		vi.mocked(loadCatalog).mockRejectedValueOnce(new Error('offline'));
		const { screen } = await mountProvider();
		expect(screen()).toContain('Choose your language');
		expect(getLocale()).toBe('en');
		expect(html.lang).toBe('en');
	});

	it('shows the page at once in English, with <html lang> set to English', async () => {
		const html = stubPage({ languages: ['en-US'], lang: 'es' });
		const { screen } = await mountProvider();
		expect(screen()).toContain('Choose your language');
		expect(html.lang).toBe('en');
	});
});
