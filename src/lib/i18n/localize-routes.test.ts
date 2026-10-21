import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RouteObject } from 'react-router';
import { applyAccountLocale, t } from './index';
import { localizeRoutes } from './localize-routes';

function Heading() {
	return createElement('h1', null, t('Choose your language'));
}

function Outer() {
	return createElement('main', null, createElement(Heading));
}

const html = (node: ReactElement): string => renderToStaticMarkup(node);

afterEach(async () => {
	vi.unstubAllGlobals();
	await applyAccountLocale('en');
});

describe('localizeRoutes', () => {
	const loader = () => null;
	const routes: RouteObject[] = [
		{
			path: '/',
			id: 'root',
			Component: Outer,
			children: [
				{ index: true, Component: Heading },
				{ path: 'page', element: createElement(Heading), handle: { crumb: 'Page' } },
				{ path: 'data', loader, Component: Heading, children: [{ path: 'deep', element: createElement('p', null, 'deep') }] },
				{ path: 'bare' },
			],
		},
	];

	it('keeps the shape of the routes: paths, ids, indexes and nesting', () => {
		const shape = (list: readonly RouteObject[]): unknown[] => list.map((route) => ({ path: route.path, id: route.id, index: route.index, children: route.children && shape(route.children) }));
		expect(shape(localizeRoutes(routes))).toEqual(shape(routes));
	});

	it('leaves every other field of a route alone', () => {
		const [root] = localizeRoutes(routes);
		const data = root.children?.[2];
		expect(data?.loader).toBe(loader);
		expect(root.children?.[1].handle).toEqual({ crumb: 'Page' });
		expect('children' in (root.children?.[0] ?? {})).toBe(false);
		expect(root.children?.[3]).toEqual({ path: 'bare' });
	});

	it('does not change the routes it is given', () => {
		const before = routes[0].Component;
		localizeRoutes(routes);
		expect(routes[0].Component).toBe(before);
		expect(routes[0].children?.[1].element).toBeDefined();
	});

	it('wraps each component and element, and they render what the route rendered', () => {
		const [root] = localizeRoutes(routes);
		expect(root.Component).not.toBe(Outer);
		expect(html(createElement(root.Component!))).toBe(html(createElement(Outer)));
		expect(html(root.children?.[1].element as ReactElement)).toBe('<h1>Choose your language</h1>');
		expect(html(root.children?.[2].children?.[0].element as ReactElement)).toBe('<p>deep</p>');
	});

	it('names a wrapped component after the one it wraps, for the React tools', () => {
		const [root] = localizeRoutes(routes);
		expect(root.Component?.displayName).toBe('Localized(Outer)');
	});

	it('renders the new language the next time a route renders', async () => {
		const [root] = localizeRoutes(routes);
		const page = (): string => html(createElement(root.children![0].Component!));
		expect(page()).toBe('<h1>Choose your language</h1>');
		vi.stubGlobal('document', { documentElement: { lang: 'en' } });
		await applyAccountLocale('es');
		expect(page()).toBe('<h1>Elige tu idioma</h1>');
	});
});
