import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/contexts/auth-context';
import type { ApiResponse } from '@/api-types';

/** The data of a successful response, or an error carrying the server's message. */
async function unwrap<T>(request: Promise<ApiResponse<T>>, fallback: string): Promise<T> {
	const response = await request;
	if (!response.success || response.data === undefined) {
		throw new Error(response.error?.message || fallback);
	}
	return response.data;
}

export function useStripeConnectStatus(enabled: boolean) {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.account.payments.status(user?.id),
		queryFn: () => unwrap(apiClient.getStripeConnectStatus(), 'Failed to load your Stripe status'),
		enabled: enabled && !!user,
		retry: false,
	});
}

/** Starts or resumes Stripe-hosted onboarding; the caller sends the browser to the returned URL. */
export function useStartStripeOnboarding() {
	return useMutation({
		mutationFn: () => unwrap(apiClient.startStripeOnboarding(), 'Failed to start Stripe onboarding'),
	});
}

export function useStripeDashboardLink() {
	return useMutation({
		mutationFn: () => unwrap(apiClient.getStripeDashboardLink(), 'Failed to open the Stripe dashboard'),
	});
}

/** Creates a Stripe Checkout session; the caller sends the browser to `checkoutUrl`. */
export function useCreateSiteCheckout() {
	return useMutation({
		mutationFn: (appId: string) => unwrap(apiClient.createSiteCheckout(appId), 'Failed to start checkout'),
	});
}

/** Records a purchase on return from Checkout; app details and lists refresh so "Use this site" appears. */
export function useConfirmSitePurchase() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { appId: string; sessionId: string }) =>
			unwrap(apiClient.confirmSitePurchase(input.appId, input.sessionId), 'Failed to confirm your payment'),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.account.apps.all() }),
				queryClient.invalidateQueries({ queryKey: queryKeys.account.publishing.all() }),
			]),
	});
}

export function useAdminSales() {
	return useQuery({
		queryKey: queryKeys.account.payments.sales(),
		queryFn: () => unwrap(apiClient.getAdminSales(), 'Failed to load sales'),
		retry: false,
	});
}
