/** The card page's decisions, with no React and no DOM: what was asked for, when saving is allowed and where each result leads. */

import { BILLING_CARD_PATH, BILLING_CARD_RETURN_PATH, BILLING_PATH, type CardSetupMode } from '@/api-types';
import type { SettledPayment } from '@/lib/stripe/next-action';
import type { StripeSessionStatus } from '@/lib/stripe/session';
import type { StripeCheckoutActionResult } from '@/lib/stripe/stripe-js';
import { PAYMENT_FAILED_MESSAGE, refusalOf } from './checkout-state';

export const CARD_FAILED_MESSAGE = "Couldn't open the card form. Try again in a moment.";
export const CARD_EXPIRED_MESSAGE = 'This card form timed out.';

/** Shown on the return page when the card could not be checked; the webhook sets the card either way. */
export const CARD_NOT_CHECKED_MESSAGE = "We couldn't check your card. If you saved it, it shows on the billing page in a minute.";

/** The card page saves the card unless its address asks to pay the failed invoice with it too. */
export function cardModeOf(search: string): CardSetupMode {
	return new URLSearchParams(search).get('mode') === 'pay' ? 'pay' : 'save';
}

/** The card page's address for a mode, which `cardModeOf` reads back. */
export function cardPathOf(mode: CardSetupMode): string {
	return mode === 'pay' ? `${BILLING_CARD_PATH}?${new URLSearchParams({ mode })}` : BILLING_CARD_PATH;
}

/**
 * The return route's address for a saved card's session, the page Stripe sends the seller to; the card page goes straight
 * there when its session is already complete.
 */
export function cardReturnPathOf(sessionId: string): string {
	return `${BILLING_CARD_RETURN_PATH}?${new URLSearchParams({ session_id: sessionId })}`;
}

/** The session the return route was opened for, or null when the address names none. */
export function sessionIdOfReturn(search: string): string | null {
	const sessionId = new URLSearchParams(search).get('session_id');
	return sessionId === null || sessionId === '' ? null : sessionId;
}

/** The button's words: saving the card, and in pay mode paying the failed invoice with it. */
export function saveLabelFor(mode: CardSetupMode): string {
	return mode === 'pay' ? 'Save card and pay' : 'Save card';
}

export interface CardRefusal {
	message: string;
	retryable: boolean;
}

/**
 * What a refused call means. The server's own words (no billing details, a missing key, a pause) replace the form, and a
 * retry is offered for any 503 (a missing key, a pause) or a failure that may pass. Anything else is the `plain` failure.
 */
export function cardRefusalOf(error: unknown, plain: string = CARD_FAILED_MESSAGE): CardRefusal {
	const { status, message } = refusalOf(error, plain);
	if (status === 503) return { message, retryable: true };
	if (status !== null && status >= 400 && status < 500) return { message, retryable: false };
	return { message: plain, retryable: true };
}

/** What pressing save led to; `redirecting` and `finished` leave the button disabled, because the page is going away. */
export type SaveOutcome =
	| { kind: 'redirecting' }
	| { kind: 'declined'; message: string }
	| { kind: 'expired' }
	| { kind: 'finished' }
	| { kind: 'failed'; message: string };

export interface CardSteps {
	confirm(): Promise<StripeCheckoutActionResult>;
	/** Where the setup session stands in Stripe.js; may throw when there is no session to read. */
	readStatus(): StripeSessionStatus;
}

/**
 * A confirm that failed, by an error result or by throwing, is told apart by where the session stands: it may have
 * expired, or been saved after all. Otherwise `otherwise` is what to show under the form.
 */
function settleFailedConfirm(steps: CardSteps, otherwise: SaveOutcome): SaveOutcome {
	try {
		const status = steps.readStatus();
		if (status === 'expired') return { kind: 'expired' };
		if (status === 'complete') return { kind: 'finished' };
	} catch {
		// Without the status, the failure's own message is all there is to show.
	}
	return otherwise;
}

/** Confirms the card form; Stripe then sends the seller to the return route, which makes the card the default. */
export async function submitCard(steps: CardSteps): Promise<SaveOutcome> {
	let result: StripeCheckoutActionResult;
	try {
		result = await steps.confirm();
	} catch {
		return settleFailedConfirm(steps, { kind: 'failed', message: PAYMENT_FAILED_MESSAGE });
	}
	if (result.type === 'success') return { kind: 'redirecting' };
	return settleFailedConfirm(steps, { kind: 'declined', message: result.error.message || PAYMENT_FAILED_MESSAGE });
}

export type CardPhase = { name: 'starting' } | { name: 'ready' } | { name: 'expired' } | { name: 'refused'; message: string; retryable: boolean };

export interface CardState {
	phase: CardPhase;
	sessionId: string | null;
	/** The card form is on the page. */
	formReady: boolean;
	/** The card form's fields are all filled in. */
	complete: boolean;
	saving: boolean;
	/** Shown under the form: a declined card or a failed save. */
	notice: string | null;
}

export function initialCardState(): CardState {
	return { phase: { name: 'starting' }, sessionId: null, formReady: false, complete: false, saving: false, notice: null };
}

/** Events from a call that finishes later carry the session they were made for, so a replaced session's answers are dropped. */
export type CardEvent =
	| { type: 'start' }
	| { type: 'started'; sessionId: string }
	| { type: 'refused'; message: string; retryable: boolean }
	| { type: 'formReady' }
	| { type: 'sessionStatus'; sessionId: string; status: StripeSessionStatus }
	| { type: 'cardChanged'; complete: boolean }
	| { type: 'saveStarted' }
	| { type: 'saveOutcome'; sessionId: string; outcome: SaveOutcome };

/** True when pressing save is allowed: the form is up, the card is filled in and no save is running. */
export function canSaveNow(state: CardState): boolean {
	return state.phase.name === 'ready' && state.formReady && state.complete && !state.saving;
}

function afterSave(state: CardState, outcome: SaveOutcome): CardState {
	switch (outcome.kind) {
		case 'redirecting':
		case 'finished':
			return state;
		case 'declined':
		case 'failed':
			return { ...state, saving: false, notice: outcome.message };
		case 'expired':
			return { ...state, saving: false, phase: { name: 'expired' } };
	}
}

export function cardReducer(state: CardState, event: CardEvent): CardState {
	if ('sessionId' in event && event.type !== 'started' && event.sessionId !== state.sessionId) return state;
	switch (event.type) {
		case 'start':
			return initialCardState();
		case 'started':
			return { ...state, phase: { name: 'ready' }, sessionId: event.sessionId };
		case 'refused':
			return { ...state, saving: false, phase: { name: 'refused', message: event.message, retryable: event.retryable } };
		case 'formReady':
			return { ...state, formReady: true };
		case 'sessionStatus':
			return event.status === 'expired' ? { ...state, saving: false, phase: { name: 'expired' } } : state;
		case 'cardChanged':
			return { ...state, complete: event.complete };
		case 'saveStarted':
			return canSaveNow(state) ? { ...state, saving: true, notice: null } : state;
		case 'saveOutcome':
			return afterSave(state, event.outcome);
	}
}

/**
 * Where the return route goes once the card is saved: back to billing, which waits for a renewal that was paid and shows
 * a saved card at once. A declined payment returns null, because the seller has to read it and choose what to do.
 */
export function returnTargetFor(result: SettledPayment): string | null {
	switch (result.state) {
		case 'saved':
			return BILLING_PATH;
		case 'paid':
		case 'nothing_due':
			return `${BILLING_PATH}?confirm=renewal`;
		case 'declined':
			return null;
	}
}
