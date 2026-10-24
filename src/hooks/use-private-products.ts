import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { t } from '@/lib/i18n';
export function usePrivateProducts() {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.privateProducts.list(user?.id),
		queryFn: () =>
			unwrap(apiClient.getMyProducts(), t("Couldn't load your products")),
		enabled: !!user,
		retry: false,
	});
}
export function useRefreshProducts() {
	const client = useQueryClient();
	return async () => {
		await Promise.all([
			client.invalidateQueries({
				queryKey: queryKeys.privateProducts.all,
			}),
			client.invalidateQueries({ queryKey: queryKeys.account.all }),
			client.invalidateQueries({ queryKey: ['live-store'] }),
		]);
	};
}

export function useStoreProductCollection(
	appId: string,
	mode: 'live' | 'test' = 'live',
) {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.privateProducts.collection(user?.id, appId, mode),
		queryFn: () =>
			unwrap(
				apiClient.getStoreCollection(appId, mode),
				t("Couldn't load your products"),
			),
		enabled: !!user && !!appId,
		retry: false,
	});
}
