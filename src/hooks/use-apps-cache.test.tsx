import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { appEvents } from '@/lib/app-events';
import { queryKeys } from '@/lib/query-keys';
import { mountElement, silenceTestRendererDeprecation, unmountAll } from '@/test-support/mounted';
import { useAppsQuerySync } from './use-apps';

function Sync() { useAppsQuerySync(); return null; }
beforeAll(silenceTestRendererDeprecation);
afterEach(unmountAll);
describe('app deletion cache synchronization', () => {
	it('removes a deleted store from switcher and favorites and invalidates inactive paginated lists', async () => {
		const client = new QueryClient();
		const rows = [{ id: 'tea', title: 'Tea shop' }, { id: 'candles', title: 'Candle shop' }];
		const user = queryKeys.account.apps.user('owner');
		const favorites = queryKeys.account.apps.favorites('owner');
		const detail = queryKeys.account.apps.detail('tea', 'owner');
		const preview = queryKeys.account.apps.previewToken('tea', 'owner');
		const filters = { sort: 'recent', period: 'all', framework: 'all', visibility: 'all', search: '', category: 'all', pricing: 'all', limit: 20 };
		const paginated = queryKeys.apps.user(filters, 'owner');
		const publicList = queryKeys.apps.public(filters);
		client.setQueryData(user, rows);
		client.setQueryData(favorites, rows);
		client.setQueryData(detail, rows[0]);
		client.setQueryData(preview, 'private-preview-token');
		client.setQueryData(paginated, { pages: [{ apps: rows }], pageParams: [null] });
		client.setQueryData(publicList, { pages: [{ apps: rows }], pageParams: [null] });
		await mountElement(<QueryClientProvider client={client}><Sync /></QueryClientProvider>);
		await act(async () => { appEvents.emitAppDeleted('tea'); });
		expect(client.getQueryData(user)).toEqual([{ id: 'candles', title: 'Candle shop' }]);
		expect(client.getQueryData(favorites)).toEqual([{ id: 'candles', title: 'Candle shop' }]);
		expect(client.getQueryData(detail)).toBeUndefined();
		expect(client.getQueryData(preview)).toBeUndefined();
		expect(client.getQueryState(paginated)?.isInvalidated).toBe(true);
		expect(client.getQueryState(publicList)?.isInvalidated).toBe(false);
		await unmountAll();
		client.clear();
	});
});
