import { t, useI18n } from '@/lib/i18n';
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
	useI18n();
	return useQuery({
		queryKey: queryKeys.account.publishing.app(appId ?? ''),
		queryFn: () => unwrap(apiClient.getSitePublishing(appId!), t("Failed to load publishing settings")),
		enabled: enabled && !!appId,
		retry: false,
		...options,
	});
}

export function usePublishSite(appId: string | undefined) {
	useI18n();
	return usePublishingMutation((body: PublishSiteRequest) => {
		if (!appId) throw new Error(t("App ID is required"));
		return unwrap(apiClient.publishSite(appId, body), t("Failed to update app visibility"));
	});
}

export function useSubmitPaidUpdate(appId: string) {
	useI18n();
	return usePublishingMutation((_input: void) =>
		unwrap(apiClient.submitPaidUpdate(appId), t("Failed to send the update for review")),
	);
}

export function useWithdrawPaidVersion(appId: string) {
	useI18n();
	return usePublishingMutation((versionId: string) =>
		unwrap(apiClient.withdrawPaidVersion(appId, versionId), t("Failed to withdraw the version")),
	);
}

export function useMyPaidListings() {
	useI18n();
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.account.publishing.mine(user?.id),
		queryFn: () => unwrap(apiClient.getMyPaidListings(), t("Failed to load your paid listings")),
		enabled: !!user,
	});
}

export function usePendingReviews() {
	useI18n();
	return useQuery({
		queryKey: queryKeys.account.publishing.reviews(),
		queryFn: () => unwrap(apiClient.getPendingReviews(), t("Failed to load the review queue")),
		retry: false,
	});
}

export function useReviewVersionFiles(versionId: string | null) {
	useI18n();
	return useQuery({
		queryKey: queryKeys.account.publishing.versionFiles(versionId ?? ''),
		queryFn: () => unwrap(apiClient.getReviewVersionFiles(versionId!), t("Failed to load the files")),
		enabled: !!versionId,
	});
}

export function useReviewVersionFile(versionId: string, path: string | null) {
	useI18n();
	return useQuery({
		queryKey: queryKeys.account.publishing.versionFile(versionId, path ?? ''),
		queryFn: () => unwrap(apiClient.getReviewVersionFile(versionId, path!), t("Failed to load the file")),
		enabled: !!path,
	});
}

export type VersionReview =
	| { versionId: string; decision: 'approve' }
	| { versionId: string; decision: 'reject'; reason: string };

export function useReviewVersion() {
	useI18n();
	return usePublishingMutation((review: VersionReview) =>
		review.decision === 'approve'
			? unwrap(apiClient.approveReviewVersion(review.versionId), t("Failed to approve the version"))
			: unwrap(apiClient.rejectReviewVersion(review.versionId, review.reason), t("Failed to reject the version")),
	);
}

export function useSetDiscoverRemoval() {
	useI18n();
	return usePublishingMutation((input: { appId: string; body: DiscoverRemovalRequest }) =>
		unwrap(apiClient.setDiscoverRemoval(input.appId, input.body), t("Failed to change the removal")),
	);
}

/** Admins only: show a public Discover store on the landing page, or take it off. */
export function useSetShowcased() {
	useI18n();
	return usePublishingMutation((input: { appId: string; showcased: boolean }) =>
		unwrap(apiClient.setShowcased(input.appId, { showcased: input.showcased }), t("Couldn't change the landing page showcase")),
	);
}

/** Admins only: capture the showcase images Discover stores are still missing, one batch per call. */
export function useRefreshShowcaseScreenshots() {
	useI18n();
	return usePublishingMutation((_input: void) =>
		unwrap(apiClient.refreshShowcaseScreenshots(), t("Couldn't refresh the showcase images")),
	);
}
