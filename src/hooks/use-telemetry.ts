import { useQuery } from '@tanstack/react-query';
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
