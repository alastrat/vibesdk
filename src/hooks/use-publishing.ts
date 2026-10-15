import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/contexts/auth-context';
import { unwrap } from '@/lib/unwrap-response';
import type { DiscoverRemovalRequest, PublishSiteRequest } from '@/api-types';

/** Publishing changes Discover, app details and the owner's lists, so all three refresh. */
function usePublishingMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.account.publishing.all() }),
				queryClient.invalidateQueries({ queryKey: queryKeys.account.apps.all() }),
				queryClient.invalidateQueries({ queryKey: queryKeys.apps.all }),
			]),
	});
}

/** `refetchOnMount: 'always'` makes a consumer that seeds form state from the result wait for fresh data. */
export function useSitePublishing(
	appId: string | undefined,
	enabled: boolean,
	options?: { refetchOnMount?: 'always' },
) {
	return useQuery({
		queryKey: queryKeys.account.publishing.app(appId ?? ''),
		queryFn: () => unwrap(apiClient.getSitePublishing(appId!), 'Failed to load publishing settings'),
		enabled: enabled && !!appId,
		retry: false,
		...options,
	});
}

export function usePublishSite(appId: string | undefined) {
	return usePublishingMutation((body: PublishSiteRequest) => {
		if (!appId) throw new Error('App ID is required');
		return unwrap(apiClient.publishSite(appId, body), 'Failed to update app visibility');
	});
}

export function useSubmitPaidUpdate(appId: string) {
	return usePublishingMutation((_input: void) =>
		unwrap(apiClient.submitPaidUpdate(appId), 'Failed to send the update for review'),
	);
}

export function useWithdrawPaidVersion(appId: string) {
	return usePublishingMutation((versionId: string) =>
		unwrap(apiClient.withdrawPaidVersion(appId, versionId), 'Failed to withdraw the version'),
	);
}

export function useMyPaidListings() {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.account.publishing.mine(user?.id),
		queryFn: () => unwrap(apiClient.getMyPaidListings(), 'Failed to load your paid listings'),
		enabled: !!user,
	});
}

export function usePendingReviews() {
	return useQuery({
		queryKey: queryKeys.account.publishing.reviews(),
		queryFn: () => unwrap(apiClient.getPendingReviews(), 'Failed to load the review queue'),
		retry: false,
	});
}

export function useReviewVersionFiles(versionId: string | null) {
	return useQuery({
		queryKey: queryKeys.account.publishing.versionFiles(versionId ?? ''),
		queryFn: () => unwrap(apiClient.getReviewVersionFiles(versionId!), 'Failed to load the files'),
		enabled: !!versionId,
	});
}

export function useReviewVersionFile(versionId: string, path: string | null) {
	return useQuery({
		queryKey: queryKeys.account.publishing.versionFile(versionId, path ?? ''),
		queryFn: () => unwrap(apiClient.getReviewVersionFile(versionId, path!), 'Failed to load the file'),
		enabled: !!path,
	});
}

export type VersionReview =
	| { versionId: string; decision: 'approve' }
	| { versionId: string; decision: 'reject'; reason: string };

export function useReviewVersion() {
	return usePublishingMutation((review: VersionReview) =>
		review.decision === 'approve'
			? unwrap(apiClient.approveReviewVersion(review.versionId), 'Failed to approve the version')
			: unwrap(apiClient.rejectReviewVersion(review.versionId, review.reason), 'Failed to reject the version'),
	);
}

export function useSetDiscoverRemoval() {
	return usePublishingMutation((input: { appId: string; body: DiscoverRemovalRequest }) =>
		unwrap(apiClient.setDiscoverRemoval(input.appId, input.body), 'Failed to change the removal'),
	);
}

/** Admins only: show a public Discover store on the landing page, or take it off. */
export function useSetShowcased() {
	return usePublishingMutation((input: { appId: string; showcased: boolean }) =>
		unwrap(apiClient.setShowcased(input.appId, { showcased: input.showcased }), "Couldn't change the landing page showcase"),
	);
}

/** Admins only: capture the showcase images Discover stores are still missing, one batch per call. */
export function useRefreshShowcaseScreenshots() {
	return usePublishingMutation((_input: void) =>
		unwrap(apiClient.refreshShowcaseScreenshots(), "Couldn't refresh the showcase images"),
	);
}
