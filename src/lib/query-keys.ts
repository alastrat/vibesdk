import type { TemplateCategory } from '@/api-types';

export type PaginatedAppsListFilters = {
	sort: string;
	period: string;
	framework: string;
	visibility: string;
	search: string;
	limit: number;
};

export type TemplateGalleryFilters = {
	category: TemplateCategory | null;
	search: string;
	limit: number;
};

export const queryKeys = {
	auth: {
		all: ['auth'] as const,
		session: () => [...queryKeys.auth.all, 'session'] as const,
		providers: () => [...queryKeys.auth.all, 'providers'] as const,
	},
	/** Unauthenticated / list-scoped app feeds (public + paginated user lists). */
	apps: {
		all: ['apps'] as const,
		publicAll: () => [...queryKeys.apps.all, 'public'] as const,
		public: (filters: PaginatedAppsListFilters) =>
			[...queryKeys.apps.publicAll(), filters] as const,
		userAll: () => [...queryKeys.apps.all, 'user'] as const,
		user: (filters: PaginatedAppsListFilters) =>
			[...queryKeys.apps.userAll(), filters] as const,
	},
	templates: {
		all: ['templates'] as const,
		gallery: (filters: TemplateGalleryFilters) => [...queryKeys.templates.all, 'gallery', filters] as const,
		detail: (slug: string, userId?: string | null) =>
			[...queryKeys.templates.all, 'detail', slug, userId ?? 'anonymous'] as const,
		mine: (userId?: string | null) => [...queryKeys.templates.all, 'mine', userId ?? 'anonymous'] as const,
		app: (appId: string) => [...queryKeys.templates.all, 'app', appId] as const,
		pending: () => [...queryKeys.templates.all, 'pending'] as const,
		versionFiles: (versionId: string) => [...queryKeys.templates.all, 'version-files', versionId] as const,
		versionFile: (versionId: string, path: string) =>
			[...queryKeys.templates.all, 'version-file', versionId, path] as const,
	},
	account: {
		all: ['account'] as const,
		user: {
			all: () => [...queryKeys.account.all, 'user'] as const,
			statsAll: () => [...queryKeys.account.user.all(), 'stats'] as const,
			stats: (userId?: string | null) =>
				[
					...queryKeys.account.user.statsAll(),
					userId ?? 'anonymous',
				] as const,
			activityAll: () =>
				[...queryKeys.account.user.all(), 'activity'] as const,
			activity: (userId?: string | null) =>
				[
					...queryKeys.account.user.activityAll(),
					userId ?? 'anonymous',
				] as const,
		},
		settings: {
			all: () => [...queryKeys.account.all, 'settings'] as const,
			activeSessionsAll: () =>
				[...queryKeys.account.settings.all(), 'active-sessions'] as const,
			activeSessions: (userId?: string | null) =>
				[
					...queryKeys.account.settings.activeSessionsAll(),
					userId ?? 'anonymous',
				] as const,
			apiKeysAll: () =>
				[...queryKeys.account.settings.all(), 'api-keys'] as const,
			apiKeys: (userId?: string | null) =>
				[
					...queryKeys.account.settings.apiKeysAll(),
					userId ?? 'anonymous',
				] as const,
		},
		apps: {
			all: () => [...queryKeys.account.all, 'apps'] as const,
			userAll: () => [...queryKeys.account.apps.all(), 'user'] as const,
			user: (userId?: string | null) =>
				[
					...queryKeys.account.apps.userAll(),
					userId ?? 'anonymous',
				] as const,
			favoritesAll: () =>
				[...queryKeys.account.apps.all(), 'favorites'] as const,
			favorites: (userId?: string | null) =>
				[
					...queryKeys.account.apps.favoritesAll(),
					userId ?? 'anonymous',
				] as const,
			detailAll: (appId: string) =>
				[...queryKeys.account.apps.all(), 'detail', appId] as const,
			detail: (appId: string, userId?: string | null) =>
				[
					...queryKeys.account.apps.detailAll(appId),
					userId ?? 'anonymous',
				] as const,
			previewTokenAll: (appId: string) =>
				[...queryKeys.account.apps.all(), 'preview-token', appId] as const,
			previewToken: (appId: string, userId?: string | null) =>
				[
					...queryKeys.account.apps.previewTokenAll(appId),
					userId ?? 'anonymous',
				] as const,
		},
		limits: {
			all: () => [...queryKeys.account.all, 'limits'] as const,
			usageAll: () =>
				[...queryKeys.account.limits.all(), 'usage'] as const,
			usage: (userId?: string | null) =>
				[
					...queryKeys.account.limits.usageAll(),
					userId ?? 'anonymous',
				] as const,
		},
	},
};
