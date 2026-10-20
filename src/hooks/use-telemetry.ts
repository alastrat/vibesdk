import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { applyAnalyticsChoice } from '@/lib/analytics/posthog-browser';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

/** Visitors' replay pause and the local opt-in token; the same for every viewer. */
export function useTelemetryConfig() {
	return useQuery({
		queryKey: queryKeys.platform.telemetry(),
		queryFn: () => unwrap(apiClient.getTelemetryConfig(), "Couldn't load the analytics config"),
		staleTime: 10 * 60_000,
		retry: false,
	});
}

export function useAnalyticsPreference() {
	const { user, isAuthenticated } = useAuth();
	return useQuery({
		queryKey: queryKeys.account.analytics(user?.id),
		queryFn: () => unwrap(apiClient.getAnalyticsPreference(), "Couldn't load your analytics setting"),
		enabled: isAuthenticated,
		retry: false,
	});
}

export function useSetAnalyticsPreference() {
	const queryClient = useQueryClient();
	const { user, refreshUser } = useAuth();
	return useMutation({
		mutationFn: (optedOut: boolean) => unwrap(apiClient.setAnalyticsPreference(optedOut), "Couldn't save your analytics setting"),
		onSuccess: async (data) => {
			queryClient.setQueryData(queryKeys.account.analytics(user?.id), data);
			applyAnalyticsChoice(data.optedOut);
			await refreshUser();
		},
		onError: (error: Error) => toast.error(error.message),
	});
}
