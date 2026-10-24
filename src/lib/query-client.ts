import {
	QueryClient,
	defaultShouldDehydrateQuery,
} from '@tanstack/react-query';
import type {
	PersistedClient,
	Persister,
} from '@tanstack/react-query-persist-client';
import { get, set, del } from 'idb-keyval';
import { queryKeys } from './query-keys';

const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24; // 24 hours

export function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				// Must be >= persist maxAge so restored cache is not GC'd early
				gcTime: PERSIST_MAX_AGE,
				refetchOnWindowFocus: true,
				retry: 1,
			},
		},
	});
}

export function createIDBPersister(
	idbValidKey: IDBValidKey = 'reactQuery',
): Persister {
	return {
		persistClient: async (client: PersistedClient) => {
			await set(idbValidKey, client);
		},
		restoreClient: async () => {
			return await get<PersistedClient>(idbValidKey);
		},
		removeClient: async () => {
			await del(idbValidKey);
		},
	};
}

// Auth and account caches must never be persisted. Restoring a stale
// `auth.session()` (e.g. a logged-out `null` captured before an OAuth redirect)
// would survive the full-page reload of the OAuth callback and, because the
// session query is still within its staleTime, would not refetch — leaving the
// user looking signed out after a successful Cloudflare/OAuth login. It also
// avoids leaking user-scoped data across account switches. Product pages carry
// a signed preview URL and a per-viewer offer, so they stay out of storage too.
// The landing showcase carries screenshot links that expire after six hours.
const PRIVATE_ACCOUNT_KEY_PREFIXES: readonly (readonly unknown[])[] = [
	queryKeys.account.all,
	// These owner-only queries predate the shared `account` hierarchy.
	[queryKeys.liveStore('')[0]],
	[queryKeys.drafts('')[0]],
	// Defense in depth for any legacy cache entries retained during rollout.
	['apps', 'user'],
	queryKeys.apps.sitePageAll(),
];

const NON_PERSISTED_KEY_PREFIXES: readonly (readonly unknown[])[] = [
	queryKeys.auth.all,
	...PRIVATE_ACCOUNT_KEY_PREFIXES,
	queryKeys.apps.showcase(),
	// Rollout settings decide which upgrade action is available and must be refreshed.
	queryKeys.platform.plan(),
];

function hasKeyPrefix(
	queryKey: readonly unknown[],
	prefix: readonly unknown[],
): boolean {
	return prefix.every((part, index) => queryKey[index] === part);
}

/** All viewer-specific caches, including older store keys outside `account`. */
export function isPrivateAccountQuery(query: {
	queryKey: readonly unknown[];
}): boolean {
	return PRIVATE_ACCOUNT_KEY_PREFIXES.some((prefix) =>
		hasKeyPrefix(query.queryKey, prefix),
	);
}

export const queryPersistOptions = {
	persister: createIDBPersister(),
	maxAge: PERSIST_MAX_AGE,
	// v4 also discards old snapshots containing private live-store and draft data.
	buster: 'v4',
	dehydrateOptions: {
		shouldDehydrateQuery: (query: {
			queryKey: readonly unknown[];
			state: { status: string };
		}) => {
			if (
				NON_PERSISTED_KEY_PREFIXES.some((prefix) =>
					hasKeyPrefix(query.queryKey, prefix),
				)
			) {
				return false;
			}
			// Preserve the library default (only persist successful queries).
			return defaultShouldDehydrateQuery(
				query as Parameters<typeof defaultShouldDehydrateQuery>[0],
			);
		},
	},
};
