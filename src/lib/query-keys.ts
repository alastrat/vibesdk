export type PaginatedAppsListFilters = {
	sort: string;
	period: string;
	framework: string;
	visibility: string;
	search: string;
	category: string;
	pricing: string;
	limit: number;
};

export const queryKeys = {
	/** A store's live address, published version and own domain, for its owner. */
	liveStore: (appId: string) => ['live-store', appId] as const,
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
		strip: () => [...queryKeys.apps.all, 'strip'] as const,
		/** The landing page's logo strip and showcase; carries signed screenshot links. */
		showcase: () => [...queryKeys.apps.all, 'showcase'] as const,
		sitePageAll: () => [...queryKeys.apps.all, 'site-page'] as const,
		/** A Discover product page; its offer depends on the viewer. */
		sitePage: (appId: string, userId?: string | null) =>
			[...queryKeys.apps.sitePageAll(), appId, userId ?? 'anonymous'] as const,
	},
	/** Public platform facts that don't depend on the viewer. */
	platform: {
		all: ['platform'] as const,
		plan: () => [...queryKeys.platform.all, 'plan'] as const,
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
		/** Publishing, paid-listing and review data: never persisted, and dropped on logout with the rest of `account`. */
		publishing: {
			all: () => [...queryKeys.account.all, 'publishing'] as const,
			app: (appId: string) => [...queryKeys.account.publishing.all(), 'app', appId] as const,
			mine: (userId?: string | null) =>
				[...queryKeys.account.publishing.all(), 'mine', userId ?? 'anonymous'] as const,
			reviews: () => [...queryKeys.account.publishing.all(), 'reviews'] as const,
			versionFiles: (versionId: string) => [...queryKeys.account.publishing.all(), 'version-files', versionId] as const,
			versionFile: (versionId: string, path: string) =>
				[...queryKeys.account.publishing.all(), 'version-file', versionId, path] as const,
		},
		/** Seller payout status and admin sales: never persisted. */
		payments: {
			all: () => [...queryKeys.account.all, 'payments'] as const,
			status: (userId?: string | null) => [...queryKeys.account.payments.all(), 'status', userId ?? 'anonymous'] as const,
			sales: () => [...queryKeys.account.payments.all(), 'sales'] as const,
		},
		/** Early-access requests, the user's own and the admin list: never persisted, like the rest of `account`. */
		earlyAccess: {
			all: () => [...queryKeys.account.all, 'early-access'] as const,
			mine: (userId?: string | null) => [...queryKeys.account.earlyAccess.all(), 'mine', userId ?? 'anonymous'] as const,
			admin: () => [...queryKeys.account.earlyAccess.all(), 'admin'] as const,
		},
		contactRequests: {
			admin: () => [...queryKeys.account.all, 'contact-requests', 'admin'] as const,
		},
		catalog: {
			products: (query: string) => [...queryKeys.account.all, 'catalog', query] as const,
		},
		/** The seller's orders: never persisted, like the rest of `account`. */
		sellerOrders: {
			all: () => [...queryKeys.account.all, 'seller-orders'] as const,
			list: (view: string, mode: string, store: string | null) => [...queryKeys.account.sellerOrders.all(), 'list', view, mode, store ?? 'all'] as const,
			detail: (orderId: string) => [...queryKeys.account.sellerOrders.all(), 'detail', orderId] as const,
		},
		/** Admins' catalog orders: never persisted, like the rest of `account`. */
		catalogOrders: {
			all: () => [...queryKeys.account.all, 'catalog-orders'] as const,
			list: (view: string) => [...queryKeys.account.catalogOrders.all(), 'list', view] as const,
			detail: (orderId: string) => [...queryKeys.account.catalogOrders.all(), 'detail', orderId] as const,
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
