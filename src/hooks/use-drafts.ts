import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import type { DraftStart, DraftsSnapshot } from '@/api-types';

/** `refreshKey` changes whenever the preview reloads (a deploy or a switch), so states follow them. */
export function useDrafts(appId: string, enabled: boolean, refreshKey: string | undefined) {
	const query = useQuery({
		queryKey: queryKeys.drafts(appId),
		queryFn: () => unwrap(apiClient.getDrafts(appId), "Couldn't load your drafts"),
		enabled: enabled && !!appId,
		retry: false,
	});
	const { refetch } = query;
	useEffect(() => {
		if (enabled && appId && refreshKey) void refetch();
	}, [enabled, appId, refreshKey, refetch]);
	return query;
}

/** Every call answers the store's drafts; a switch or a new draft also changes what Publish sends. */
function useDraftsMutation<TInput>(appId: string, call: (input: TInput) => Promise<DraftsSnapshot>, changesPublish: boolean) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: call,
		onSuccess: (snapshot) => {
			queryClient.setQueryData(queryKeys.drafts(appId), snapshot);
			if (changesPublish) void queryClient.invalidateQueries({ queryKey: queryKeys.liveStore(appId) });
		},
	});
}

export function useCreateDraft(appId: string) {
	return useDraftsMutation(appId, (input: { name: string; from: DraftStart }) => unwrap(apiClient.createDraft(appId, input), "Couldn't start the draft"), true);
}

export function useActivateDraft(appId: string) {
	return useDraftsMutation(appId, (draftId: string) => unwrap(apiClient.activateDraft(appId, draftId), "Couldn't switch drafts"), true);
}

export function useRenameDraft(appId: string) {
	return useDraftsMutation(appId, (input: { draftId: string; name: string }) => unwrap(apiClient.renameDraft(appId, input.draftId, { name: input.name }), "Couldn't rename the draft"), true);
}

export function useDeleteDraft(appId: string) {
	return useDraftsMutation(appId, (draftId: string) => unwrap(apiClient.deleteDraft(appId, draftId), "Couldn't delete the draft"), false);
}
