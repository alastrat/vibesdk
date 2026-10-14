import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export function usePublicPlan() {
	return useQuery({
		queryKey: queryKeys.platform.plan(),
		queryFn: () => unwrap(apiClient.getPublicPlan(), "Couldn't load the plan limits"),
		retry: false,
		staleTime: 10 * 60 * 1000,
	});
}
