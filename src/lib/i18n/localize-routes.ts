import { Children, cloneElement, createElement, isValidElement, type ComponentType, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { useLocale } from './index';

/** Route fields that hold content localizeRoutes does not render again; a route that sets one is refused. */
const UNSUPPORTED_FIELDS = ['lazy', 'ErrorBoundary', 'errorElement', 'HydrateFallback', 'hydrateFallbackElement'] as const;

function nameOf(route: RouteObject): string {
	return route.path ?? route.id ?? (route.index ? '(index)' : '(layout)');
}

/** Renders a route's element again when the language changes, keeping the state of everything in it. */
function Localized({ children }: { children: ReactNode }): ReactNode {
	useLocale();
	return isValidElement(children) ? cloneElement(children) : children;
}

function localizedComponent(Component: ComponentType): ComponentType {
	function LocalizedRoute() {
		useLocale();
		return createElement(Component);
	}
	LocalizedRoute.displayName = `Localized(${Component.displayName ?? Component.name})`;
	return LocalizedRoute;
}

/**
 * An element is cloned, and React skips the elements inside it, which were built once when the route table loaded. So an
 * element with elements inside it would keep the old language: such a route must be a `Component` that builds them.
 */
function localizedElement(route: RouteObject, element: ReactNode): ReactNode {
	if (isValidElement<{ children?: ReactNode }>(element) && Children.toArray(element.props.children).some(isValidElement)) {
		// i18n-ignore: a developer error
		throw new Error(`Route "${nameOf(route)}" has an element with elements inside it, which would keep the old language. Make it a Component that builds them, as protectedPage does.`);
	}
	return createElement(Localized, null, element);
}

function localizedRoute(route: RouteObject): RouteObject {
	for (const field of UNSUPPORTED_FIELDS) {
		// i18n-ignore: a developer error
		if (route[field] != null) throw new Error(`Route "${nameOf(route)}" sets ${field}, which localizeRoutes does not render again on a language change.`);
	}
	const content = {
		...(route.Component ? { Component: localizedComponent(route.Component) } : {}),
		...(route.element ? { element: localizedElement(route, route.element) } : {}),
	};
	if (route.index) return { ...route, ...content };
	return { ...route, ...content, ...(route.children ? { children: localizeRoutes(route.children) } : {}) };
}

/**
 * The routes, each rendering again on a language change. React Router renders a route again only when its own state
 * changes, even a layout route above the one navigated to, so a route that reads `t()` would keep the old language, and
 * so would every route that doesn't call `useI18n()` itself.
 */
export function localizeRoutes(routes: readonly RouteObject[]): RouteObject[] {
	return routes.map(localizedRoute);
}
