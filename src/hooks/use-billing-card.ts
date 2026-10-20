import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CardSetupMode, CardSetupStart } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { loadWithin, singleFlight } from '@/lib/async';
import { sessionStatusOf } from '@/lib/stripe/session';
import { CARD_ONLY_PAYMENT_ELEMENT, loadStripe, type StripeCheckoutActions, type StripeCheckoutSdk, type StripePaymentElement } from '@/lib/stripe/stripe-js';
import { unwrap } from '@/lib/unwrap-response';
import { CARD_FAILED_MESSAGE, canSaveNow, cardReducer, cardRefusalOf, cardReturnPathOf, initialCardState, submitCard } from '@/routes/settings/card-state';
import { FORM_NOT_LOADED_MESSAGE } from '@/routes/settings/checkout-state';
import { useStripeAppearance } from './use-stripe-appearance';

/**
 * Opens the seller's card setup session when it mounts and shows Stripe's card form in `container`. Saving confirms the
 * form and Stripe sends the seller to the return route, which makes the card the default. Each start opens a new session
 * with its own Stripe instance; `restart` opens another. A session that is already complete when the page opens (the seller
 * left before the return route ran) goes straight to the return route instead of showing a form that cannot be used.
 */
export function useBillingCard(mode: CardSetupMode) {
	const navigate = useNavigate();
	const [state, dispatch] = useReducer(cardReducer, undefined, initialCardState);
	const [attempt, setAttempt] = useState(0);
	const container = useRef<HTMLDivElement | null>(null);
	const sdk = useRef<StripeCheckoutSdk | null>(null);
	const actions = useRef<StripeCheckoutActions | null>(null);
	const latest = useRef(state);
	const appearance = useStripeAppearance(sdk);

	useEffect(() => {
		latest.current = state;
	});

	useEffect(() => {
		let current = true;
		let payment: StripePaymentElement | null = null;
		dispatch({ type: 'start' });

		const run = async () => {
			let start: CardSetupStart;
			try {
				start = await unwrap(apiClient.startCardSetup(mode), CARD_FAILED_MESSAGE);
			} catch (failure) {
				if (current) dispatch({ type: 'refused', ...cardRefusalOf(failure) });
				return;
			}
			if (!current) return;
			const { sessionId } = start;
			dispatch({ type: 'started', sessionId });

			try {
				const stripe = await loadWithin(loadStripe(start.publishableKey));
				if (!current) return;
				const checkout = stripe.initCheckoutElementsSdk({ clientSecret: start.clientSecret, elementsOptions: { appearance: appearance() } });
				sdk.current = checkout;
				// Stripe.js refuses to confirm until the page has read the session's total, so every change reads it.
				checkout.on('change', (session) => dispatch({ type: 'sessionStatus', sessionId, status: sessionStatusOf(session) }));
				const target = container.current;
				if (!target) throw new Error('The card form has nowhere to open');
				payment = checkout.createPaymentElement(CARD_ONLY_PAYMENT_ELEMENT);
				payment.on('change', ({ complete }) => dispatch({ type: 'cardChanged', complete }));
				payment.mount(target);
				const loaded = await loadWithin(checkout.loadActions());
				if (!current) return;
				if (loaded.type !== 'success') throw new Error('The card form could not open');
				const status = sessionStatusOf(loaded.actions.getSession());
				if (status === 'complete') {
					navigate(cardReturnPathOf(sessionId), { replace: true });
					return;
				}
				actions.current = loaded.actions;
				dispatch({ type: 'sessionStatus', sessionId, status });
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
	}, [mode, attempt, navigate, appearance]);

	/** One press at a time: a second click while the first is confirming joins it, never repeats it. */
	const save = useMemo(
		() =>
			singleFlight(async () => {
				const current = latest.current;
				const checkoutActions = actions.current;
				const { sessionId } = current;
				if (!canSaveNow(current) || !checkoutActions || sessionId === null) return;
				dispatch({ type: 'saveStarted' });
				const outcome = await submitCard({
					confirm: () => checkoutActions.confirm(),
					readStatus: () => sessionStatusOf(checkoutActions.getSession()),
				});
				dispatch({ type: 'saveOutcome', sessionId, outcome });
				if (outcome.kind === 'finished') navigate(cardReturnPathOf(sessionId), { replace: true });
			}),
		[navigate],
	);

	const restart = useCallback(() => setAttempt((count) => count + 1), []);

	return { state, container, save, restart };
}
