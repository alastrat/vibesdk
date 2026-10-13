import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/contexts/auth-context';
import { unwrap } from '@/lib/unwrap-response';
import { PAGE_DRAFT_FAILED_MESSAGE, SITE_PAGE_UNAVAILABLE_MESSAGE } from '@/api-types';

/** Waits for the session, so the page's offer matches the viewer. */
export function useSitePage(appId: string | undefined) {
	const { user, isLoading } = useAuth();
	return useQuery({
		queryKey: queryKeys.apps.sitePage(appId ?? '', user?.id),
		queryFn: () => unwrap(apiClient.getSitePage(appId!), SITE_PAGE_UNAVAILABLE_MESSAGE),
		enabled: !!appId && !isLoading,
		retry: false,
		// Each fetch signs a new preview URL, which reloads the frame; keep the stale time under the 30-minute token.
		refetchOnWindowFocus: false,
		staleTime: 20 * 60 * 1000,
	});
}

export function useDraftPageCopy(appId: string) {
	return useMutation({
		mutationFn: () => unwrap(apiClient.draftPageCopy(appId), PAGE_DRAFT_FAILED_MESSAGE),
	});
}
