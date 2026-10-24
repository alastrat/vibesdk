import { renderToStaticMarkup } from 'react-dom/server';
import {
	QueryClient,
	QueryClientProvider,
	dehydrate,
} from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import { usePaginatedApps } from './use-paginated-apps';
import { queryKeys, type PaginatedAppsListFilters } from '@/lib/query-keys';
import { queryPersistOptions } from '@/lib/query-client';

const auth = vi.hoisted(() => ({
	user: { id: 'seller-a' } as { id: string } | null,
}));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => auth }));
const filters: PaginatedAppsListFilters = {
	sort: 'recent',
	period: 'all',
	framework: 'all',
	visibility: 'all',
	search: '',
	category: 'all',
	pricing: 'all',
	limit: 20,
};
const page = (title: string) => ({
	pages: [
		{
			apps: [{ id: 'private-store', title }],
			pagination: { total: 1, hasMore: false, limit: 20, offset: 0 },
		},
	],
	pageParams: [1],
});
function Probe({ type }: { type: 'user' | 'public' }) {
	const { apps } = usePaginatedApps({
		type,
		includeVisibility: true,
		limit: 20,
	});
	return <span>{apps.map((app) => app.title).join(',')}</span>;
}
function render(client: QueryClient, type: 'user' | 'public' = 'user') {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<Probe type={type} />
		</QueryClientProvider>,
	);
}

describe('paginated store cache ownership', () => {
	it('never displays one account’s private stores after the current account changes', () => {
		const client = new QueryClient();
		client.setQueryData(
			queryKeys.apps.user(filters, 'seller-a'),
			page('A private store'),
		);
		auth.user = { id: 'seller-a' };
		expect(render(client)).toContain('A private store');
		auth.user = { id: 'seller-b' };
		expect(render(client)).not.toContain('A private store');
		client.setQueryData(
			queryKeys.apps.user(filters, 'seller-b'),
			page('B private store'),
		);
		expect(render(client)).toContain('B private store');
		auth.user = null;
		expect(render(client)).not.toContain('private store');
		client.clear();
	});
	it('removes paginated private stores with the account caches on logout', () => {
		const client = new QueryClient();
		const key = queryKeys.apps.user(filters, 'seller-a');
		client.setQueryData(key, page('Private store'));
		client.removeQueries({ queryKey: queryKeys.account.all });
		expect(client.getQueryData(key)).toBeUndefined();
	});
	it('keeps private lists and legacy private-list entries out of browser persistence', () => {
		const shouldPersist =
			queryPersistOptions.dehydrateOptions.shouldDehydrateQuery;
		expect(
			shouldPersist({
				queryKey: queryKeys.apps.user(filters, 'seller-a'),
				state: { status: 'success' },
			}),
		).toBe(false);
		expect(
			shouldPersist({
				queryKey: ['apps', 'user', filters],
				state: { status: 'success' },
			}),
		).toBe(false);
	});
	it('discards snapshots from before private store caches were isolated', async () => {
		const oldClient = new QueryClient();
		const legacyKey = ['apps', 'user', filters];
		oldClient.setQueryData(legacyKey, page('Old private store'));
		const restored = new QueryClient();
		await persistQueryClientRestore({
			queryClient: restored,
			buster: queryPersistOptions.buster,
			maxAge: queryPersistOptions.maxAge,
			persister: {
				restoreClient: async () => ({
					timestamp: Date.now(),
					buster: 'v2',
					clientState: dehydrate(oldClient),
				}),
				persistClient: async () => {},
				removeClient: async () => {},
			},
		});
		expect(restored.getQueryData(legacyKey)).toBeUndefined();
		oldClient.clear();
		restored.clear();
	});
	it('preserves public discovery data for signed-out visitors', () => {
		const client = new QueryClient();
		auth.user = null;
		const key = queryKeys.apps.public(filters);
		client.setQueryData(key, page('Public discovery'));
		expect(render(client, 'public')).toContain('Public discovery');
		expect(
			queryPersistOptions.dehydrateOptions.shouldDehydrateQuery({
				queryKey: key,
				state: { status: 'success' },
			}),
		).toBe(true);
		client.clear();
	});
});
