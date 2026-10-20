import { describe, expect, it } from 'vitest';
import type { StripeCheckoutActionResult } from '@/lib/stripe/stripe-js';
import {
	CARD_FAILED_MESSAGE,
	CARD_NOT_CHECKED_MESSAGE,
	canSaveNow,
	cardModeOf,
	cardPathOf,
	cardRefusalOf,
	cardReducer,
	cardReturnPathOf,
	initialCardState,
	returnTargetFor,
	saveLabelFor,
	sessionIdOfReturn,
	submitCard,
	type CardEvent,
	type CardState,
	type CardSteps,
} from './card-state';
import { FORM_NOT_LOADED_MESSAGE, PAYMENT_FAILED_MESSAGE } from './checkout-state';

const SESSION = 'cs_card_1';

function refused(status: number, message: string): Error {
	return Object.assign(new Error(message), { status });
}

function run(state: CardState, ...events: CardEvent[]): CardState {
	return events.reduce(cardReducer, state);
}

/** A card page with its form up and every field filled in. */
function ready(): CardState {
	return run(initialCardState(), { type: 'started', sessionId: SESSION }, { type: 'formReady' }, { type: 'cardChanged', complete: true });
}

describe('the card page address', () => {
	it('saves a card unless the address asks to pay with it', () => {
		expect(cardModeOf('')).toBe('save');
		expect(cardModeOf('?mode=pay')).toBe('pay');
		expect(cardModeOf('?mode=save')).toBe('save');
		expect(cardModeOf('?mode=PAY')).toBe('save');
		expect(cardModeOf('?mode=pay&mode=save')).toBe('pay');
		expect(cardModeOf('?mode=refund')).toBe('save');
	});

	it('writes the address of each mode, which cardModeOf reads back', () => {
		expect(cardPathOf('save')).toBe('/settings/billing/card');
		expect(cardPathOf('pay')).toBe('/settings/billing/card?mode=pay');
		const path = cardPathOf('pay');
		expect(cardModeOf(path.slice(path.indexOf('?')))).toBe('pay');
	});

	it("names the page Stripe sends the seller back to, and reads the session from it", () => {
		expect(cardReturnPathOf('cs_card_1')).toBe('/settings/billing/card/return?session_id=cs_card_1');
		expect(sessionIdOfReturn('?session_id=cs_card_1')).toBe('cs_card_1');
		expect(sessionIdOfReturn('')).toBeNull();
		expect(sessionIdOfReturn('?session_id=')).toBeNull();
	});

	it('words the button by what saving the card goes on to do', () => {
		expect(saveLabelFor('save')).toBe('Save card');
		expect(saveLabelFor('pay')).toBe('Save card and pay');
	});
});

describe('the card page opening', () => {
	it('shows the server words for a refusal, retries only the pause and plain failures', () => {
		expect(cardRefusalOf(refused(404, "You don't have billing details yet."))).toEqual({ message: "You don't have billing details yet.", retryable: false });
		expect(cardRefusalOf(refused(503, "Payments aren't set up yet."))).toEqual({ message: "Payments aren't set up yet.", retryable: true });
		expect(cardRefusalOf(refused(400, 'Choose whether to save the card or pay with it.'))).toEqual({ message: 'Choose whether to save the card or pay with it.', retryable: false });
	});

	it('shows the plain failure, with a retry, for a server error or a call that never arrived', () => {
		expect(cardRefusalOf(refused(502, 'Stripe said no'))).toEqual({ message: CARD_FAILED_MESSAGE, retryable: true });
		expect(cardRefusalOf(new Error('offline'))).toEqual({ message: CARD_FAILED_MESSAGE, retryable: true });
		expect(cardRefusalOf('boom')).toEqual({ message: CARD_FAILED_MESSAGE, retryable: true });
	});

	it("shows the caller's own plain failure when it has one, and still the server words for a refusal", () => {
		expect(cardRefusalOf(refused(502, 'Stripe said no'), CARD_NOT_CHECKED_MESSAGE)).toEqual({ message: CARD_NOT_CHECKED_MESSAGE, retryable: true });
		expect(cardRefusalOf(refused(400, 'This checkout timed out.'), CARD_NOT_CHECKED_MESSAGE)).toEqual({ message: 'This checkout timed out.', retryable: false });
	});

	it('starts a session, then a form, and replaces the form with the refusal when it does not load', () => {
		let state = run(initialCardState(), { type: 'start' });
		expect(state.phase).toEqual({ name: 'starting' });
		state = run(state, { type: 'started', sessionId: SESSION });
		expect(state).toMatchObject({ phase: { name: 'ready' }, sessionId: SESSION, formReady: false });
		state = run(state, { type: 'refused', message: FORM_NOT_LOADED_MESSAGE, retryable: true });
		expect(state.phase).toEqual({ name: 'refused', message: FORM_NOT_LOADED_MESSAGE, retryable: true });
		expect(canSaveNow(state)).toBe(false);
		expect(run(state, { type: 'start' })).toEqual(initialCardState());
	});
});

describe('saving the card', () => {
	it('needs the form up, the card filled in and no save already running', () => {
		expect(canSaveNow(initialCardState())).toBe(false);
		const started = run(initialCardState(), { type: 'started', sessionId: SESSION });
		expect(canSaveNow(started)).toBe(false);
		const loaded = run(started, { type: 'formReady' });
		expect(canSaveNow(loaded)).toBe(false);
		expect(canSaveNow(run(loaded, { type: 'cardChanged', complete: true }))).toBe(true);
		expect(canSaveNow(run(loaded, { type: 'cardChanged', complete: true }, { type: 'cardChanged', complete: false }))).toBe(false);
	});

	it('disables the button from the press until the result, and keeps it disabled while the page leaves', () => {
		const pressed = run(ready(), { type: 'saveStarted' });
		expect(pressed.saving).toBe(true);
		expect(canSaveNow(pressed)).toBe(false);
		// A second press while the first runs changes nothing.
		expect(run(pressed, { type: 'saveStarted' })).toEqual(pressed);
		expect(run(pressed, { type: 'saveOutcome', sessionId: SESSION, outcome: { kind: 'redirecting' } }).saving).toBe(true);
		expect(run(pressed, { type: 'saveOutcome', sessionId: SESSION, outcome: { kind: 'finished' } }).saving).toBe(true);
	});

	it('shows a declined card under the form and lets the seller try another', () => {
		const declined = run(ready(), { type: 'saveStarted' }, { type: 'saveOutcome', sessionId: SESSION, outcome: { kind: 'declined', message: 'Your card was declined.' } });
		expect(declined).toMatchObject({ saving: false, notice: 'Your card was declined.', phase: { name: 'ready' } });
		expect(canSaveNow(declined)).toBe(true);
		expect(run(declined, { type: 'saveStarted' }).notice).toBeNull();
		const failed = run(ready(), { type: 'saveStarted' }, { type: 'saveOutcome', sessionId: SESSION, outcome: { kind: 'failed', message: PAYMENT_FAILED_MESSAGE } });
		expect(failed).toMatchObject({ saving: false, notice: PAYMENT_FAILED_MESSAGE });
	});

	it('shows the timed-out page when the session expired, however the seller found out', () => {
		expect(run(ready(), { type: 'sessionStatus', sessionId: SESSION, status: 'expired' }).phase).toEqual({ name: 'expired' });
		const afterSave = run(ready(), { type: 'saveStarted' }, { type: 'saveOutcome', sessionId: SESSION, outcome: { kind: 'expired' } });
		expect(afterSave).toMatchObject({ saving: false, phase: { name: 'expired' } });
		expect(run(ready(), { type: 'sessionStatus', sessionId: SESSION, status: 'open' })).toEqual(ready());
		expect(run(ready(), { type: 'sessionStatus', sessionId: SESSION, status: 'complete' })).toEqual(ready());
	});

	it("ignores a replaced session's answers", () => {
		const replaced = run(ready(), { type: 'start' }, { type: 'started', sessionId: 'cs_card_2' });
		expect(run(replaced, { type: 'sessionStatus', sessionId: SESSION, status: 'expired' })).toEqual(replaced);
		expect(run(replaced, { type: 'saveOutcome', sessionId: SESSION, outcome: { kind: 'expired' } })).toEqual(replaced);
		expect(run(initialCardState(), { type: 'sessionStatus', sessionId: SESSION, status: 'expired' })).toEqual(initialCardState());
	});
});

function steps(overrides: Partial<CardSteps> = {}): { steps: CardSteps; calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		steps: {
			confirm: async () => {
				calls.push('confirm');
				return { type: 'success', session: { canConfirm: false, status: { type: 'complete' }, total: { total: { amount: '$0.00', minorUnitsAmount: 0 } } } } satisfies StripeCheckoutActionResult;
			},
			readStatus: () => {
				calls.push('status');
				return 'open';
			},
			...overrides,
		},
	};
}

describe('confirming the card', () => {
	it('leaves the page to Stripe once it saved the card, without asking where the session stands', async () => {
		const { steps: saved, calls } = steps();
		expect(await submitCard(saved)).toEqual({ kind: 'redirecting' });
		expect(calls).toEqual(['confirm']);
	});

	it("shows the card's own message when Stripe refuses it and the session is still open", async () => {
		const { steps: refused, calls } = steps({ confirm: async () => ({ type: 'error', error: { message: 'Your card number is incorrect.', code: 'paymentFailed' } }) });
		expect(await submitCard(refused)).toEqual({ kind: 'declined', message: 'Your card number is incorrect.' });
		expect(calls).toEqual(['status']);
		const bare = steps({ confirm: async () => ({ type: 'error', error: { message: '', code: null } }) });
		expect(await submitCard(bare.steps)).toEqual({ kind: 'declined', message: PAYMENT_FAILED_MESSAGE });
	});

	it('finds an expired session when confirming fails, so the seller never retries a dead form', async () => {
		const { steps: expired } = steps({
			confirm: async () => ({ type: 'error', error: { message: 'Something went wrong.', code: null } }),
			readStatus: () => 'expired',
		});
		expect(await submitCard(expired)).toEqual({ kind: 'expired' });
	});

	it('goes on to completion when confirming fails on a session that was in fact saved', async () => {
		const { steps: saved } = steps({
			confirm: async () => {
				throw new Error('socket closed');
			},
			readStatus: () => 'complete',
		});
		expect(await submitCard(saved)).toEqual({ kind: 'finished' });
	});

	it('shows the plain failure when confirming throws and the session cannot be read', async () => {
		const { steps: broken } = steps({
			confirm: async () => {
				throw new Error('socket closed');
			},
			readStatus: () => {
				throw new Error('no session');
			},
		});
		expect(await submitCard(broken)).toEqual({ kind: 'failed', message: PAYMENT_FAILED_MESSAGE });
		const open = steps({
			confirm: async () => {
				throw new Error('socket closed');
			},
		});
		expect(await submitCard(open.steps)).toEqual({ kind: 'failed', message: PAYMENT_FAILED_MESSAGE });
	});
});

describe('what the card return does with the result', () => {
	it('goes back to billing, which waits for a paid renewal and shows a saved card at once', () => {
		expect(returnTargetFor({ state: 'saved' })).toBe('/settings/billing');
		expect(returnTargetFor({ state: 'paid' })).toBe('/settings/billing?confirm=renewal');
		expect(returnTargetFor({ state: 'nothing_due' })).toBe('/settings/billing?confirm=renewal');
	});

	it('stays on the return page for a declined payment, which the seller has to read and act on', () => {
		expect(returnTargetFor({ state: 'declined', message: 'Your card has insufficient funds.' })).toBeNull();
	});
});
