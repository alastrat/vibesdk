import { planBillingPath } from '@/lib/billing-links';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BILLING_PATH, TERMS_VERSION, type CheckoutClientStart } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { loadWithin, singleFlight } from '@/lib/async';
import { getLocale } from '@/lib/i18n';
import { queryKeys } from '@/lib/query-keys';
import { CARD_ONLY_PAYMENT_ELEMENT, loadStripe, type StripeCheckoutActionResult, type StripeCheckoutActions, type StripeCheckoutSdk, type StripePaymentElement } from '@/lib/stripe/stripe-js';
import { unwrap } from '@/lib/unwrap-response';
import {
	CODE_FAILED_MESSAGE,
	FORM_NOT_LOADED_MESSAGE,
	PAYMENT_FAILED_MESSAGE,
	canPayNow,
	checkoutPathOf,
	checkoutReducer,
	initialCheckoutState,
	isExpiredRefusal,
	readCheckoutRequest,
	startRefusalOf,
	submitPayment,
	type CheckoutRequest,
} from '@/routes/settings/checkout-state';
import { CHECKOUT_FAILED_MESSAGE } from './use-billing';
import { useAccountLocaleChange } from './use-account-locale-change';
import { useStripeAppearance } from './use-stripe-appearance';

/** Where the page keeps what it asked for, so the return route can send an open or expired checkout back to it. */
const REQUEST_KEY = 'billing:checkout-request';

export function rememberCheckoutRequest(request: CheckoutRequest): void {
	try {
		sessionStorage.setItem(REQUEST_KEY, JSON.stringify(request));
	} catch {
		// Without storage the return leaves the choice of plan or amount to the billing page.
	}
}

export function recallCheckoutRequest(): CheckoutRequest | null {
	try {
		return readCheckoutRequest(sessionStorage.getItem(REQUEST_KEY));
	} catch {
		return null;
	}
}

function openSession(request: CheckoutRequest): Promise<CheckoutClientStart> {
	const opened = request.kind === 'plan' ? apiClient.startPlanCheckout(request.plan, request.billingInterval, request.monthlyCredits) : apiClient.buyCredits(request.credits);
	return unwrap(opened, CHECKOUT_FAILED_MESSAGE);
}

/**
 * Opens the seller's checkout session when it mounts, shows Stripe's card form in `container`, and drives the page's
 * state: the terms and box, a promotion code, and the payment, which records consent before it confirms. Each start
 * opens a new session with its own Stripe instance; `restart` opens another, and so does a change of request.
 */
export function useBillingCheckout(request: CheckoutRequest | null, expiredOnArrival: boolean) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [state, dispatch] = useReducer(checkoutReducer, expiredOnArrival, initialCheckoutState);
	const [stale, setStale] = useState(expiredOnArrival);
	const [attempt, setAttempt] = useState(0);
	const container = useRef<HTMLDivElement | null>(null);
	const sdk = useRef<StripeCheckoutSdk | null>(null);
	const actions = useRef<StripeCheckoutActions | null>(null);
	const latest = useRef(state);
	const appearance = useStripeAppearance(sdk);

	useEffect(() => {
		latest.current = state;
	});

	// The request as primitives, so a new address for the same request doesn't open another session.
	const plan = request?.kind === 'plan' ? request.plan : null;
	const interval = request?.kind === 'plan' ? request.billingInterval ?? null : null;
	const monthlyCredits = request?.kind === 'plan' ? request.monthlyCredits ?? null : null;
	const credits = request?.kind === 'credits' ? request.credits : null;

	useEffect(() => {
		const asked: CheckoutRequest | null = plan !== null ? { kind: 'plan', plan, ...(interval !== null ? { billingInterval: interval } : {}), ...(monthlyCredits !== null ? { monthlyCredits } : {}) } : credits !== null ? { kind: 'credits', credits } : null;
		if (asked === null || stale) return;
		let current = true;
		let payment: StripePaymentElement | null = null;
		dispatch({ type: 'start' });

		const run = async () => {
			let start: CheckoutClientStart;
			try {
				start = await openSession(asked);
			} catch (failure) {
				if (!current) return;
				const refusal = startRefusalOf(failure, CHECKOUT_FAILED_MESSAGE);
				if (refusal.kind === 'refused') {
					dispatch({ type: 'refused', message: refusal.message, retryable: refusal.retryable });
					return;
				}
				void queryClient.invalidateQueries({ queryKey: queryKeys.billing() });
				navigate(asked.kind === 'plan' ? planBillingPath(asked.plan, asked.billingInterval, asked.monthlyCredits) : BILLING_PATH, { replace: true });
				return;
			}
			if (!current) return;
			rememberCheckoutRequest(asked);
			dispatch({ type: 'started', start });

			try {
				const stripe = await loadWithin(loadStripe(start.publishableKey, getLocale()));
				if (!current) return;
				const checkout = stripe.initCheckoutElementsSdk({ clientSecret: start.clientSecret, elementsOptions: { appearance: appearance() } });
				sdk.current = checkout;
				// Stripe.js refuses to confirm until the page has read the total, so every change reads it.
				checkout.on('change', (session) => dispatch({ type: 'sessionChanged', sessionId: start.sessionId, status: session.status.type, amount: session.total.total.amount }));
				const target = container.current;
				// i18n-ignore: a developer message, the seller sees the form's failure notice
				if (!target) throw new Error('The card form has nowhere to open');
				// The form is mounted before its actions load, as the store checkout does, so it shows while they are fetched.
				payment = checkout.createPaymentElement(CARD_ONLY_PAYMENT_ELEMENT);
				payment.on('change', ({ complete }) => dispatch({ type: 'cardChanged', complete }));
				payment.mount(target);
				const loaded = await loadWithin(checkout.loadActions());
				if (!current) return;
				// i18n-ignore: a developer message, the seller sees the form's failure notice
				if (loaded.type !== 'success') throw new Error('The card form could not open');
				const session = loaded.actions.getSession();
				dispatch({ type: 'sessionChanged', sessionId: start.sessionId, status: session.status.type, amount: session.total.total.amount });
				actions.current = loaded.actions;
				dispatch({ type: 'formReady' });
			} catch {
				if (current) dispatch({ type: 'refused', message: FORM_NOT_LOADED_MESSAGE, retryable: true });
			}
		};
		void run();

		return () => {
			current = false;
			payment?.destroy();
			sdk.current = null;
			actions.current = null;
		};
	}, [plan, interval, monthlyCredits, credits, stale, attempt, navigate, queryClient, appearance]);

	const refreshTerms = useCallback(async (sessionId: string) => {
		try {
			const view = await unwrap(apiClient.getCheckoutTerms(sessionId), CHECKOUT_FAILED_MESSAGE);
			dispatch({ type: 'termsLoaded', sessionId, view });
		} catch (failure) {
			dispatch(isExpiredRefusal(failure) ? { type: 'expired', sessionId } : { type: 'termsFailed', sessionId });
		}
	}, []);

	const retryTerms = useCallback(() => {
		const { sessionId } = latest.current;
		if (sessionId === null) return;
		dispatch({ type: 'termsRequested' });
		void refreshTerms(sessionId);
	}, [refreshTerms]);

	/**
	 * The terms are worded in the seller's saved language. When they switch it mid-checkout the terms are read again and
	 * the box is unticked, so what they agree to is the wording they can now read.
	 */
	const refreshTermsForLanguage = useCallback(() => {
		const { sessionId, terms } = latest.current;
		if (sessionId === null || terms === null) return;
		dispatch({ type: 'termsRequested' });
		void refreshTerms(sessionId);
	}, [refreshTerms]);
	useAccountLocaleChange(refreshTermsForLanguage);

	/** A code applied or removed changes the price, so the terms are fetched again and the box is unticked. */
	const changeCode = useCallback(
		async (change: (checkoutActions: StripeCheckoutActions) => Promise<StripeCheckoutActionResult>, applied: string | null) => {
			const checkoutActions = actions.current;
			const { sessionId } = latest.current;
			if (!checkoutActions || sessionId === null) return;
			dispatch({ type: 'codeSubmitted' });
			let result: StripeCheckoutActionResult | null;
			try {
				result = await change(checkoutActions);
			} catch {
				result = null;
			}
			// A session replaced while the call ran has nothing to learn from its answer.
			if (actions.current !== checkoutActions) return;
			if (result?.type !== 'success') {
				dispatch({ type: 'codeRejected', sessionId, message: result?.error.message || CODE_FAILED_MESSAGE });
				return;
			}
			dispatch({ type: 'codeChanged', sessionId, applied });
			await refreshTerms(sessionId);
		},
		[refreshTerms],
	);

	const applyCode = useCallback(
		(raw: string) => {
			const code = raw.trim();
			if (code !== '') void changeCode((checkoutActions) => checkoutActions.applyPromotionCode(code), code);
		},
		[changeCode],
	);

	const removeCode = useCallback(() => void changeCode((checkoutActions) => checkoutActions.removePromotionCode(), null), [changeCode]);

	/** One press at a time: a second click while the first is recording consent or confirming joins it, never repeats it. */
	const pay = useMemo(
		() =>
			singleFlight(async () => {
				const current = latest.current;
				const checkoutActions = actions.current;
				const { sessionId, order, terms } = current;
				if (!canPayNow(current) || !checkoutActions || sessionId === null || order === null) return;
				dispatch({ type: 'payStarted' });
				const outcome = await submitPayment({
					kind: order.kind,
					recordConsent: () =>
						terms?.status === 'ready'
							? unwrap(apiClient.recordCheckoutConsent({ sessionId, termsVersion: TERMS_VERSION, consentText: terms.view.consentText }), PAYMENT_FAILED_MESSAGE)
							: Promise.reject(new Error(PAYMENT_FAILED_MESSAGE)),
					confirm: () => checkoutActions.confirm(),
					readStatus: () => unwrap(apiClient.getCheckoutStatus(sessionId), CHECKOUT_FAILED_MESSAGE),
				});
				dispatch({ type: 'payOutcome', sessionId, outcome });
				if (outcome.kind === 'price-changed') await refreshTerms(sessionId);
				if (outcome.kind === 'finished') navigate(outcome.target, { replace: true });
			}),
		[navigate, refreshTerms],
	);

	const restart = useCallback(() => {
		if (stale) {
			setStale(false);
			navigate(checkoutPathOf(request), { replace: true });
			return;
		}
		setAttempt((count) => count + 1);
	}, [stale, request, navigate]);

	const toggleConsent = useCallback((consented: boolean) => dispatch({ type: 'consentToggled', consented }), []);

	return { state, container, toggleConsent, applyCode, removeCode, retryTerms, pay, restart };
}
