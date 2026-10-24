import type { AppWithFavoriteStatus } from '@/api-types';
import { t } from '@/lib/i18n';
import type { StoreWorkspaceSection } from './store-workspace-location';

type SearchStore = Pick<AppWithFavoriteStatus, 'id' | 'title' | 'userId'>;
export interface WorkspaceSearchItem {
	id: string;
	label: string;
	path: string;
	kind: 'store' | 'destination';
}
const normalized = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().trim();

/** Search is limited to the account's owned stores and the available navigation destinations. */
export function workspaceSearchItems(apps: readonly SearchStore[], userId: string | null, query: string, options: { section?: StoreWorkspaceSection; catalogPaused: boolean }): WorkspaceSearchItem[] {
	if (!userId) return [];
	const destinations: WorkspaceSearchItem[] = [
		{ id: 'apps', label: t('My stores'), path: '/apps', kind: 'destination' },
		{ id: 'build', label: t('New build'), path: '/build', kind: 'destination' },
		{ id: 'orders', label: t('Orders'), path: '/orders', kind: 'destination' },
		{ id: 'discover', label: t('Discover'), path: '/discover', kind: 'destination' },
		...(!options.catalogPaused ? [{ id: 'catalog', label: t('Catalog'), path: '/catalog', kind: 'destination' as const }] : []),
		{ id: 'billing', label: t('Billing'), path: '/settings/billing', kind: 'destination' },
		{ id: 'profile', label: t('Profile'), path: '/profile', kind: 'destination' },
		{ id: 'settings', label: t('Settings'), path: '/settings', kind: 'destination' },
		{ id: 'help', label: t('Help and support'), path: '/contact', kind: 'destination' },
	];
	const stores: WorkspaceSearchItem[] = apps.filter((app) => app.userId === userId).map((app) => ({ id: `store:${app.id}`, label: app.title.trim() || t('Untitled store'), path: `/stores/${encodeURIComponent(app.id)}?section=${options.section ?? 'home'}`, kind: 'store' }));
	const needle = normalized(query);
	return [...stores, ...destinations].filter((item) => !needle || normalized(item.label).includes(needle));
}
