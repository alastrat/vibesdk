import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SellerOrderModeFilter, SellerOrderView, SellerShipmentRequest } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export interface SellerOrderFilters {
	view: SellerOrderView;
	mode: SellerOrderModeFilter;
	store: string | null;
}

export function useSellerOrders(filters: SellerOrderFilters) {
	return useInfiniteQuery({
		queryKey: queryKeys.account.sellerOrders.list(filters.view, filters.mode, filters.store),
		queryFn: ({ pageParam }) => unwrap(apiClient.getSellerOrders({ ...filters, cursor: pageParam }), "Couldn't load your orders"),
		initialPageParam: null as string | null,
		getNextPageParam: (page) => page.nextCursor,
		retry: false,
	});
}

export function useSellerOrder(orderId: string) {
	return useQuery({
		queryKey: queryKeys.account.sellerOrders.detail(orderId),
		queryFn: () => unwrap(apiClient.getSellerOrder(orderId), "Couldn't load the order"),
		retry: false,
	});
}

/** Marks the order shipped or not, then shows the answer and reads the lists again. */
export function useSellerOrderShipment(orderId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (body: SellerShipmentRequest) => unwrap(apiClient.setSellerOrderShipment(orderId, body), "Couldn't update the shipment"),
		onSuccess: (order) => {
			queryClient.setQueryData(queryKeys.account.sellerOrders.detail(orderId), order);
			void queryClient.invalidateQueries({ queryKey: queryKeys.account.sellerOrders.all() });
		},
	});
}

/** Refunds lines through the store refund endpoint; one request id per attempt, so a retry never refunds twice. */
export function useRefundSellerOrder(appId: string, orderId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (request: { lineNos: number[]; requestId: string }) => unwrap(apiClient.refundStoreOrder(appId, orderId, request), "Couldn't refund the items"),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.account.sellerOrders.all() });
		},
	});
}
