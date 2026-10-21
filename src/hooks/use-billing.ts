import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BILLING_CHECKOUT_PATH, BILLING_PATH, type PaidPlanId } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { ApiError, apiClient } from '@/lib/api-client';
import { singleFlight } from '@/lib/async';
import { downloadFailureMessage, saveBlob } from '@/lib/download';
import { msg, t } from '@/lib/i18n';
import { queryKeys } from '@/lib/query-keys';
import { settlePayment, type SettledPayment } from '@/lib/stripe/next-action';
import { unwrap } from '@/lib/unwrap-response';
import { usePublicPlan } from './use-public-plan';

// The messages below are translated where they are shown, so a language picked meanwhile still applies.
export const CHECKOUT_FAILED_MESSAGE = msg("Couldn't open the checkout. Try again in a moment.");
export const CHANGE_FAILED_MESSAGE = msg("Couldn't change your plan. Try again in a moment.");
export const PAY_FAILED_MESSAGE = msg("Couldn't take the payment. Try again in a moment.");
export const HISTORY_FAILED_MESSAGE = msg("Couldn't load your invoices");
export const INVOICE_DOWNLOAD_FAILED_MESSAGE = msg("Couldn't download the invoice. Try again in a moment.");

/** The signed-in account's plan, credits and what it may do; `refetchInterval` polls while a payment is being confirmed. */
export function useBilling({ refetchInterval = false }: { refetchInterval?: number | false } = {}) {
	const { isAuthenticated } = useAuth();
	return useQuery({
		queryKey: queryKeys.billing(),
		queryFn: () => unwrap(apiClient.getBilling(), msg("Couldn't load your plan")),
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
	toast.error(t(failure instanceof Error && failure.message ? failure.message : fallback));
}

/**
 * Takes the seller to the checkout page for Pro or Premium. Signed-out buyers sign up first and come back to the plan they
 * chose; an account already paying is sent back to its billing page by the checkout page, which says what to do instead.
 */
export function usePlanCheckout() {
	const { isAuthenticated, setIntendedUrl } = useAuth();
	const navigate = useNavigate();

	const start = (plan: PaidPlanId) => {
		if (!isAuthenticated) {
			setIntendedUrl(`${BILLING_PATH}?plan=${plan}`);
			navigate('/signup');
			return;
		}
		navigate(`${BILLING_CHECKOUT_PATH}?plan=${plan}`);
	};

	return { start };
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

/** Takes the seller to the checkout page for an amount of extra credits; the page opens the Stripe session itself. */
export function useBuyCredits() {
	const navigate = useNavigate();
	return (credits: number) => navigate(`${BILLING_CHECKOUT_PATH}?credits=${credits}`);
}

/** The account's last 24 invoices, newest first. */
export function useBillingHistory() {
	const { isAuthenticated } = useAuth();
	return useQuery({
		queryKey: queryKeys.billingHistory(),
		queryFn: () => unwrap(apiClient.getBillingHistory(), HISTORY_FAILED_MESSAGE),
		enabled: isAuthenticated,
		staleTime: 60_000,
	});
}

/**
 * Pays the failed renewal with the card on file, and finishes the bank's confirmation on the page when it asks for one.
 * It runs one payment at a time, and `isPending` holds from the press until the result, the confirmation included. A
 * settled result, a declined card too, refreshes the plan and the history, and goes to `onSettled`.
 */
export function usePayNow(onSettled: (result: SettledPayment) => void) {
	const queryClient = useQueryClient();
	const pay = useMemo(() => singleFlight(async () => settlePayment(await unwrap(apiClient.payOpenInvoice(), PAY_FAILED_MESSAGE))), []);
	return useMutation({
		mutationFn: pay,
		onSuccess: (result) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.billing() });
			onSettled(result);
		},
		onError: (failure) => showBillingError(failure, PAY_FAILED_MESSAGE),
	});
}

/** Saves an invoice's PDF through the API, so a refusal shows the server's message instead of a page of JSON. */
export function useInvoiceDownload() {
	return useMutation({
		mutationFn: async (invoiceId: string) => {
			const file = await apiClient.downloadInvoicePdf(invoiceId);
			saveBlob(file.blob, file.filename);
		},
		onError: (failure) => toast.error(t(downloadFailureMessage(failure, INVOICE_DOWNLOAD_FAILED_MESSAGE))),
	});
}
