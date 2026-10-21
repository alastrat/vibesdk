import { cloneElement, createElement, isValidElement, type ComponentType, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { useLocale } from './index';

/** Renders a route's content again when the language changes, keeping the state of everything in it. */
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

function localizedRoute(route: RouteObject): RouteObject {
	const content = {
		...(route.Component ? { Component: localizedComponent(route.Component) } : {}),
		...(route.element ? { element: createElement(Localized, null, route.element) } : {}),
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
