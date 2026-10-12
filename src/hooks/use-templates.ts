import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys, type TemplateGalleryFilters } from '@/lib/query-keys';
import { useAuth } from '@/contexts/auth-context';
import type { ApiResponse, SubmitTemplateRequest } from '@/api-types';

/** The data of a successful response, or an error carrying the server's message. */
async function unwrap<T>(request: Promise<ApiResponse<T>>, fallback: string): Promise<T> {
	const response = await request;
	if (!response.success || response.data === undefined) {
		throw new Error(response.error?.message || fallback);
	}
	return response.data;
}

/** Any template change can move a template between lists, so every template query refreshes. */
function useTemplateMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.templates.all }),
	});
}

export function useTemplateGallery(filters: TemplateGalleryFilters) {
	return useInfiniteQuery({
		queryKey: queryKeys.templates.gallery(filters),
		initialPageParam: 1,
		queryFn: ({ pageParam }) =>
			unwrap(
				apiClient.getTemplates({
					page: pageParam,
					limit: filters.limit,
					category: filters.category ?? undefined,
					search: filters.search || undefined,
				}),
				'Failed to load templates',
			),
		getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
	});
}

export function useTemplateDetail(slug: string | undefined) {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.templates.detail(slug ?? '', user?.id),
		queryFn: () => unwrap(apiClient.getTemplate(slug!), 'Failed to load the template'),
		enabled: !!slug,
		retry: false,
	});
}

export function useMyTemplates() {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.templates.mine(user?.id),
		queryFn: () => unwrap(apiClient.getMyTemplates(), 'Failed to load your templates'),
		enabled: !!user,
	});
}

export function useAppTemplate(appId: string | undefined, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.templates.app(appId ?? ''),
		queryFn: () => unwrap(apiClient.getAppTemplate(appId!), 'Failed to load the template status'),
		enabled: enabled && !!appId,
		retry: false,
	});
}

export function useSubmitTemplate(appId: string) {
	return useTemplateMutation((body: SubmitTemplateRequest) =>
		unwrap(apiClient.submitTemplate(appId, body), 'Failed to submit the template'),
	);
}

export function useWithdrawTemplateVersion() {
	return useTemplateMutation((input: { templateId: string; versionId: string }) =>
		unwrap(apiClient.withdrawTemplateVersion(input.templateId, input.versionId), 'Failed to withdraw the version'),
	);
}

export function useSetTemplateListing() {
	return useTemplateMutation((input: { templateId: string; listed: boolean }) =>
		unwrap(apiClient.setTemplateListing(input.templateId, input.listed), 'Failed to change the listing'),
	);
}

export function usePurchaseTemplate() {
	return useTemplateMutation((templateId: string) =>
		unwrap(apiClient.purchaseTemplate(templateId), 'Failed to buy the template'),
	);
}

export function usePendingTemplateVersions() {
	return useQuery({
		queryKey: queryKeys.templates.pending(),
		queryFn: () => unwrap(apiClient.getPendingTemplateVersions(), 'Failed to load the review queue'),
		retry: false,
	});
}

export function useTemplateVersionFiles(versionId: string | null) {
	return useQuery({
		queryKey: queryKeys.templates.versionFiles(versionId ?? ''),
		queryFn: () => unwrap(apiClient.getTemplateVersionFiles(versionId!), 'Failed to load the files'),
		enabled: !!versionId,
	});
}

export function useTemplateVersionFile(versionId: string, path: string | null) {
	return useQuery({
		queryKey: queryKeys.templates.versionFile(versionId, path ?? ''),
		queryFn: () => unwrap(apiClient.getTemplateVersionFile(versionId, path!), 'Failed to load the file'),
		enabled: !!path,
	});
}

export type TemplateReview =
	| { versionId: string; decision: 'approve' }
	| { versionId: string; decision: 'reject'; reason: string };

export function useReviewTemplateVersion() {
	return useTemplateMutation((review: TemplateReview) =>
		review.decision === 'approve'
			? unwrap(apiClient.approveTemplateVersion(review.versionId), 'Failed to approve the version')
			: unwrap(apiClient.rejectTemplateVersion(review.versionId, review.reason), 'Failed to reject the version'),
	);
}
