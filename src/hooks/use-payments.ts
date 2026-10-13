import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { useAuth } from '@/contexts/auth-context';

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
				queryClient.invalidateQueries({ queryKey: queryKeys.apps.all }),
			]),
	});
}

/**
 * Confirms the purchase when Stripe Checkout returns to `?purchase=success&session_id=...`, once per
 * session, then clears those params. Call it from a component that stays mounted while the app and the
 * session load: Stripe returns with a full page load, and a component that remounts would confirm twice.
 */
export function useConfirmCheckoutReturn(app: { id: string; title: string } | null | undefined) {
	const { user, isLoading: authLoading } = useAuth();
	const [searchParams, setSearchParams] = useSearchParams();
	const { mutateAsync } = useConfirmSitePurchase();
	const confirmedSession = useRef<string | null>(null);
	const appId = app?.id;
	const appTitle = app?.title;
	const signedIn = !!user;
	const sessionId = searchParams.get('purchase') === 'success' ? searchParams.get('session_id') : null;

	useEffect(() => {
		if (!appId || !sessionId || authLoading || !signedIn || confirmedSession.current === sessionId) return;
		confirmedSession.current = sessionId;
		mutateAsync({ appId, sessionId })
			.then(() => toast.success(`Payment received. You can use ${appTitle} now.`))
			.catch((error: Error) => toast.error(error.message))
			.finally(() =>
				setSearchParams(
					(prev) => {
						const next = new URLSearchParams(prev);
						next.delete('purchase');
						next.delete('session_id');
						return next;
					},
					{ replace: true },
				),
			);
	}, [appId, appTitle, sessionId, authLoading, signedIn, mutateAsync, setSearchParams]);
}

export function useAdminSales() {
	return useQuery({
		queryKey: queryKeys.account.payments.sales(),
		queryFn: () => unwrap(apiClient.getAdminSales(), 'Failed to load sales'),
		retry: false,
	});
}
