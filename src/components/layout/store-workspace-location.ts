import { matchPath } from 'react-router';

const STORE_SECTIONS = ['home', 'analytics', 'products', 'customers', 'payments', 'emails', 'translations', 'settings'] as const;
export type StoreWorkspaceSection = (typeof STORE_SECTIONS)[number];

/** Nested order details retain store chrome, but switching stores leaves the old order behind. */
export function storeWorkspaceLocation(pathname: string, search: string): { appId: string; section: StoreWorkspaceSection } | null {
	const match = matchPath('/stores/:appId/*', pathname);
	if (!match?.params.appId) return null;
	const requested = new URLSearchParams(search).get('section');
	const section = STORE_SECTIONS.find((value) => value === requested) ?? (match.params['*']?.startsWith('orders/') ? 'payments' : 'home');
	return { appId: match.params.appId, section };
}

