import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BILLING_PATH, type PaidPlanId } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { ApiError, apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { usePublicPlan } from './use-public-plan';

export const CHECKOUT_FAILED_MESSAGE = "Couldn't open the checkout. Try again in a moment.";
export const CHANGE_FAILED_MESSAGE = "Couldn't change your plan. Try again in a moment.";
const PORTAL_FAILED_MESSAGE = "Couldn't open billing. Try again in a moment.";

/** The signed-in account's plan, credits and what it may do; `refetchInterval` polls while a payment is being confirmed. */
export function useBilling({ refetchInterval = false }: { refetchInterval?: number | false } = {}) {
	const { isAuthenticated } = useAuth();
	return useQuery({
		queryKey: queryKeys.billing(),
		queryFn: () => unwrap(apiClient.getBilling(), "Couldn't load your plan"),
		enabled: isAuthenticated,
		staleTime: 60_000,
		refetchInterval,
	});
}

/**
 * Whether to sell Pro and Premium: billing is on for everyone, or for the signed-in account. The public plan answer can't
 * know the account, so an account billing is on for alone is told by its own billing answer.
 */
export function useBillingOn(): boolean {
	const publicPlan = usePublicPlan();
	const billing = useBilling();
	return publicPlan.data?.billing === true || billing.data?.enabled === true;
}

/** Toasts a failed billing request, unless it was a plan limit, which the Upgrade dialog already shows. */
export function showBillingError(failure: unknown, fallback: string): void {
	if (failure instanceof ApiError && failure.planLimit) return;
	toast.error(failure instanceof Error && failure.message ? failure.message : fallback);
}

/**
 * Starts Pro or Premium at Stripe. Signed-out buyers sign up first and come back to the plan they chose; an account
 * already paying goes to its billing page, which says what to do instead. `pending` is the plan being opened.
 */
export function usePlanCheckout() {
	const { isAuthenticated, setIntendedUrl } = useAuth();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState<PaidPlanId | null>(null);

	const start = async (plan: PaidPlanId) => {
		if (!isAuthenticated) {
			setIntendedUrl(`${BILLING_PATH}?plan=${plan}`);
			navigate('/signup');
			return;
		}
		setPending(plan);
		try {
			const { url } = await unwrap(apiClient.startPlanCheckout(plan), CHECKOUT_FAILED_MESSAGE);
			window.location.href = url;
		} catch (failure) {
			setPending(null);
			if (failure instanceof ApiError && failure.status === 409) {
				void queryClient.invalidateQueries({ queryKey: queryKeys.billing() });
				navigate(`${BILLING_PATH}?plan=${plan}`);
				return;
			}
			showBillingError(failure, CHECKOUT_FAILED_MESSAGE);
		}
	};

	return { start, pending };
}

export type PlanChange = { kind: 'change'; plan: PaidPlanId } | { kind: 'cancel' } | { kind: 'resume' };

function requestPlanChange(change: PlanChange) {
	switch (change.kind) {
		case 'change':
			return apiClient.changePlan(change.plan);
		case 'cancel':
			return apiClient.cancelPlan();
		case 'resume':
			return apiClient.resumePlan();
	}
}

/** Moves between Pro and Premium, cancels, or keeps the plan; the page shows the change once Stripe's webhook records it. */
export function usePlanChange() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (change: PlanChange) => unwrap(requestPlanChange(change), CHANGE_FAILED_MESSAGE),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.billing() }),
	});
}

/** Stripe's customer portal, for the card and invoices. The button stays busy until the browser leaves. */
export function useBillingPortal() {
	const portal = useMutation({
		mutationFn: () => unwrap(apiClient.openBillingPortal(), PORTAL_FAILED_MESSAGE),
		onSuccess: ({ url }) => {
			window.location.href = url;
		},
		onError: (failure) => showBillingError(failure, PORTAL_FAILED_MESSAGE),
	});
	return { open: () => portal.mutate(), isPending: portal.isPending || portal.isSuccess };
}

/** A Stripe checkout for extra credits; the caller sends the browser to its URL. */
export function useBuyCredits() {
	return useMutation({
		mutationFn: (credits: number) => unwrap(apiClient.buyCredits(credits), CHECKOUT_FAILED_MESSAGE),
	});
}
