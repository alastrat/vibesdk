import { describe, expect, it } from 'vitest';
import { queryPersistOptions } from './query-client';
import { queryKeys } from './query-keys';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';

const { shouldDehydrateQuery } = queryPersistOptions.dehydrateOptions;

describe('query persistence', () => {
	it.each([
		queryKeys.liveStore('private-store'),
		queryKeys.drafts('private-store'),
	])('never persists owner-only store data under %s', (...queryKey) => {
		expect(
			shouldDehydrateQuery({ queryKey, state: { status: 'success' } }),
		).toBe(false);
	});

	it('discards older persisted snapshots containing private store drafts', async () => {
		const oldClient = new QueryClient();
		oldClient.setQueryData(['drafts', 'private-store'], ['private draft']);
		const client = new QueryClient();
		await persistQueryClientRestore({
			queryClient: client,
			buster: queryPersistOptions.buster,
			maxAge: queryPersistOptions.maxAge,
			persister: {
				restoreClient: async () => ({
					timestamp: Date.now(),
					buster: 'v3',
					clientState: dehydrate(oldClient),
				}),
				persistClient: async () => {},
				removeClient: async () => {},
			},
		});
		expect(
			client.getQueryData(['drafts', 'private-store']),
		).toBeUndefined();
		oldClient.clear();
		client.clear();
	});

	it('does not persist the public plan rollout, so upgrades follow the current configuration', () => {
		expect(
			shouldDehydrateQuery({
				queryKey: queryKeys.platform.plan(),
				state: { status: 'success' },
			}),
		).toBe(false);
	});

	it('never persists product pages, which carry a signed preview URL and a per-viewer offer', () => {
		expect(
			shouldDehydrateQuery({
				queryKey: queryKeys.apps.sitePage('app1', 'u1'),
				state: { status: 'success' },
			}),
		).toBe(false);
	});

	it('never persists the landing showcase, whose screenshot links expire', () => {
		expect(
			shouldDehydrateQuery({
				queryKey: queryKeys.apps.showcase(),
				state: { status: 'success' },
			}),
		).toBe(false);
	});
});
