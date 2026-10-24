import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import type { LiveStoreView, PublishLiveStoreRequest } from '@/api-types';

export function useLiveStore(appId: string, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.liveStore(appId),
		queryFn: () => unwrap(apiClient.getLiveStore(appId), "Couldn't load your store's address"),
		enabled: enabled && !!appId,
		retry: false,
	});
}

/**
 * Every call answers the store's whole view, so the panel takes it as it is.
 * The drafts' badges and delete rule follow what is live, and Publish or going offline don't reload the preview, so they refetch.
 */
function useLiveStoreMutation<TInput>(appId: string, call: (input: TInput) => Promise<LiveStoreView>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: call,
		onSuccess: (view) => {
			queryClient.setQueryData(queryKeys.liveStore(appId), view);
			void queryClient.invalidateQueries({ queryKey: queryKeys.drafts(appId) });
			void queryClient.invalidateQueries({ queryKey: queryKeys.account.storeProducts(appId).slice(0, 3) });
		},
	});
}

/** Names the draft to publish, so a switch while the panel is open can't change what goes live. */
export function usePublishLiveStore(appId: string) {
	return useLiveStoreMutation(appId, ({ slug, draftId }: PublishLiveStoreRequest) =>
		unwrap(apiClient.publishLiveStore(appId, { slug, draftId }), "Couldn't publish your store"),
	);
}

export function useTakeLiveStoreOffline(appId: string) {
	return useLiveStoreMutation(appId, () => unwrap(apiClient.takeLiveStoreOffline(appId), "Couldn't take your store offline"));
}

export function useAddStoreDomain(appId: string) {
	return useLiveStoreMutation(appId, (hostname: string) => unwrap(apiClient.addStoreDomain(appId, { hostname }), "Couldn't add the domain"));
}

export function useCheckStoreDomain(appId: string) {
	return useLiveStoreMutation(appId, () => unwrap(apiClient.checkStoreDomain(appId), "Couldn't check the domain"));
}

export function useRemoveStoreDomain(appId: string) {
	return useLiveStoreMutation(appId, () => unwrap(apiClient.removeStoreDomain(appId), "Couldn't remove the domain"));
}
