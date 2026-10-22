import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export function usePublicPlan() {
	return useQuery({
		queryKey: queryKeys.platform.plan(),
		queryFn: () => unwrap(apiClient.getPublicPlan(), "Couldn't load the plan limits"),
		retry: false,
		// Recheck rollout availability when pricing or billing mounts, even after a restored cache.
		staleTime: 60_000,
		refetchOnMount: 'always',
	});
}
