import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { toShowcaseStore } from '@/lib/showcase';
import { unwrap } from '@/lib/unwrap-response';

/** Popular reusable Discover stores for the landing page's logo strip and showcase. */
export function useShowcaseStores() {
	return useQuery({
		queryKey: queryKeys.apps.showcase(),
		queryFn: async () =>
			(
				await unwrap(apiClient.getPublicApps({ sort: 'popular', limit: 24, reusableOnly: true }), "Couldn't load Discover stores")
			).apps.map(toShowcaseStore),
		// Each fetch re-signs every image URL, so a short cache would download every tall image again.
		staleTime: 30 * 60_000,
	});
}
