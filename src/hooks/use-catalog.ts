import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export function useCatalogProducts(query: string) {
	return useQuery({
		queryKey: queryKeys.account.catalog.products(query),
		queryFn: () => unwrap(apiClient.getCatalogProducts(query), "Couldn't load the catalog"),
		retry: false,
	});
}
