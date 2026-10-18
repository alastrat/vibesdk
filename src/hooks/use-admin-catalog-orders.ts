import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminCatalogOrderView } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

/** Admins' catalog orders in a view, a page at a time. */
export function useAdminCatalogOrders(view: AdminCatalogOrderView) {
	return useInfiniteQuery({
		queryKey: queryKeys.account.catalogOrders.list(view),
		queryFn: ({ pageParam }) => unwrap(apiClient.getAdminCatalogOrders(view, pageParam), "Couldn't load catalog orders"),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor,
		retry: false,
	});
}

export function useAdminCatalogOrder(orderId: string) {
	return useQuery({
		queryKey: queryKeys.account.catalogOrders.detail(orderId),
		queryFn: () => unwrap(apiClient.getAdminCatalogOrder(orderId), "Couldn't load the order"),
		retry: false,
	});
}

export type CatalogOrderActionRequest = { kind: 'sync' | 'retry' | 'release' } | { kind: 'sandbox'; move: 'ship' | 'deliver' };

/** Runs one of the order's actions, then reads the order and the lists again. */
export function useCatalogOrderAction(orderId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (action: CatalogOrderActionRequest) => {
			switch (action.kind) {
				case 'sync':
					return unwrap(apiClient.syncCatalogOrder(orderId), "Couldn't sync the order");
				case 'retry':
					return unwrap(apiClient.retryCatalogOrder(orderId), "Couldn't retry the order");
				case 'release':
					return unwrap(apiClient.releaseCatalogOrder(orderId), "Couldn't release the order");
				case 'sandbox':
					return unwrap(apiClient.moveSandboxCatalogOrder(orderId, action.move), "Couldn't move the sandbox order");
			}
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.account.catalogOrders.all() });
		},
	});
}
