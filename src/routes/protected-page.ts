import { createElement, type ComponentType } from 'react';
import { ProtectedRoute } from './protected-route';

/**
 * A route component for a page behind sign-in. The page's element is created each time the route renders, so it renders
 * again when the language changes; a route given `element: <ProtectedRoute><Page /></ProtectedRoute>` keeps the one
 * element it was built with, and React skips it.
 */
export function protectedPage(Page: ComponentType): ComponentType {
	function ProtectedPage() {
		return createElement(ProtectedRoute, null, createElement(Page));
	}
	ProtectedPage.displayName = `ProtectedPage(${Page.displayName ?? Page.name})`;
	return ProtectedPage;
}
