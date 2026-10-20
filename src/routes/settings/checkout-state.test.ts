import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKOUT_EXPIRED_MESSAGE, type CheckoutClientStart, type CheckoutStatusView } from '@/api-types';
import {
	CHECKOUT_PATH,
	FORM_NOT_LOADED_MESSAGE,
	FormLoadTimeoutError,
	PAYMENT_FAILED_MESSAGE,
	STRIPE_LOAD_TIMEOUT_MS,
	canPay,
	canPayNow,
	checkoutExpiredOf,
	checkoutPathOf,
	checkoutReducer,
	checkoutRequestOf,
	consentPartsOf,
	dueTodayLabel,
	initialCheckoutState,
	isExpiredRefusal,
	loadWithin,
	readCheckoutRequest,
	refusalOf,
	returnTargetOf,
	singleFlight,
	startRefusalOf,
	submitPayment,
	type CheckoutEvent,
	type CheckoutState,
	type PaymentSteps,
} from './checkout-state';

const idle = { consented: true, termsLoading: false, paying: false, complete: true } as const;

describe('the checkout request', () => {
	it('reads a plan or credits request and refuses junk', () => {
		expect(checkoutRequestOf('?plan=pro')).toEqual({ kind: 'plan', plan: 'pro' });
		expect(checkoutRequestOf('?plan=premium')).toEqual({ kind: 'plan', plan: 'premium' });
		expect(checkoutRequestOf('?credits=5000')).toEqual({ kind: 'credits', credits: 5000 });
		expect(checkoutRequestOf('')).toBeNull();
		expect(checkoutRequestOf('?plan=enterprise')).toBeNull();
		expect(checkoutRequestOf('?plan=basic')).toBeNull();
		expect(checkoutRequestOf('?credits=4000')).toBeNull();
		expect(checkoutRequestOf('?credits=5500')).toBeNull();
		expect(checkoutRequestOf('?credits=1001000')).toBeNull();
		expect(checkoutRequestOf('?credits=5e3')).toBeNull();
		expect(checkoutRequestOf('?credits=5000.0')).toBeNull();
		expect(checkoutRequestOf('?credits=')).toBeNull();
		expect(checkoutRequestOf('?credits=abc')).toBeNull();
		// Both asked at once is junk, not a guess.
		expect(checkoutRequestOf('?plan=pro&credits=5000')).toBeNull();
		expect(checkoutRequestOf('?plan=pro&credits=junk')).toBeNull();
	});

	it('a credits request keeps the amount from billing', () => {
		expect(checkoutRequestOf('?credits=25000')).toEqual({ kind: 'credits', credits: 25_000 });
		expect(checkoutRequestOf('?credits=1000000')).toEqual({ kind: 'credits', credits: 1_000_000 });
		const path = checkoutPathOf({ kind: 'credits', credits: 25_000 });
		expect(path).toBe('/settings/billing/checkout?credits=25000');
		expect(checkoutRequestOf(path.slice(path.indexOf('?')))).toEqual({ kind: 'credits', credits: 25_000 });
		expect(checkoutPathOf({ kind: 'plan', plan: 'premium' })).toBe('/settings/billing/checkout?plan=premium');
	});

	it('reads the expired mark the return leaves on the address', () => {
		expect(checkoutExpiredOf('?plan=pro&expired=1')).toBe(true);
		expect(checkoutExpiredOf('?plan=pro')).toBe(false);
		expect(checkoutExpiredOf('?expired=0')).toBe(false);
		expect(checkoutPathOf({ kind: 'plan', plan: 'pro' }, { expired: true })).toBe('/settings/billing/checkout?plan=pro&expired=1');
		expect(checkoutPathOf(null, { expired: true })).toBe('/settings/billing/checkout?expired=1');
		expect(checkoutPathOf(null)).toBe(CHECKOUT_PATH);
	});

	it('reads the request the page kept, and refuses anything else', () => {
		expect(readCheckoutRequest(JSON.stringify({ kind: 'plan', plan: 'pro' }))).toEqual({ kind: 'plan', plan: 'pro' });
		expect(readCheckoutRequest(JSON.stringify({ kind: 'credits', credits: 10_000 }))).toEqual({ kind: 'credits', credits: 10_000 });
		expect(readCheckoutRequest(JSON.stringify({ kind: 'credits', credits: 10_001 }))).toBeNull();
		expect(readCheckoutRequest(JSON.stringify({ kind: 'plan', plan: 'basic' }))).toBeNull();
		expect(readCheckoutRequest(JSON.stringify({ kind: 'other' }))).toBeNull();
		expect(readCheckoutRequest('not json')).toBeNull();
		expect(readCheckoutRequest(null)).toBeNull();
	});
});

describe('paying', () => {
	it('a plan needs consent before paying', () => {
		expect(canPay({ ...idle, kind: 'plan', consented: false })).toBe(false);
		expect(canPay({ ...idle, kind: 'plan', consented: true })).toBe(true);
		// A box ticked for the old price doesn't count while the new terms load.
		expect(canPay({ ...idle, kind: 'plan', consented: true, termsLoading: true })).toBe(false);
		expect(canPay({ ...idle, kind: 'plan', complete: false })).toBe(false);
	});

	it('credits need no consent', () => {
		expect(canPay({ ...idle, kind: 'credits', consented: false })).toBe(true);
		expect(canPay({ ...idle, kind: 'credits', consented: false, complete: false })).toBe(false);
	});

	it('paying disables the button', () => {
		expect(canPay({ ...idle, kind: 'plan', paying: true })).toBe(false);
		expect(canPay({ ...idle, kind: 'credits', paying: true })).toBe(false);
	});
});

describe('the return', () => {
	const status = (state: CheckoutStatusView['state'], kind: CheckoutStatusView['kind']): CheckoutStatusView => ({ state, kind });

	it('paid and processing return to billing to confirm', () => {
		expect(returnTargetOf(status('paid', 'plan'))).toBe('/settings/billing?confirm=plan');
		expect(returnTargetOf(status('processing', 'plan'))).toBe('/settings/billing?confirm=plan');
		expect(returnTargetOf(status('paid', 'credits'))).toBe('/settings/billing?confirm=credits');
		expect(returnTargetOf(status('processing', 'credits'))).toBe('/settings/billing?confirm=credits');
	});

	it('an expired session returns to a fresh checkout', () => {
		expect(returnTargetOf(status('expired', 'plan'))).toBe('/settings/billing/checkout?expired=1');
		expect(returnTargetOf(status('open', 'plan'))).toBe('/settings/billing/checkout');
	});

	it('returns an open or expired session to what it was for, when the page kept that', () => {
		const pro = { kind: 'plan', plan: 'pro' } as const;
		const credits = { kind: 'credits', credits: 15_000 } as const;
		expect(returnTargetOf(status('expired', 'plan'), pro)).toBe('/settings/billing/checkout?plan=pro&expired=1');
		expect(returnTargetOf(status('open', 'credits'), credits)).toBe('/settings/billing/checkout?credits=15000');
		expect(returnTargetOf(status('paid', 'credits'), credits)).toBe('/settings/billing?confirm=credits');
	});
});

describe('what the page says', () => {
	it('links the word Terms in the sentence the server wrote, and nothing else', () => {
		expect(consentPartsOf('I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel.')).toEqual({
			before: 'I agree to the ',
			link: 'Terms',
			after: ', and that Estori Pro renews at $49 a month until I cancel.',
		});
		expect(consentPartsOf('I agree to the Terms, and that Estori Premium costs $24.50 a month for 3 months, then $99 a month, until I cancel.').link).toBe('Terms');
		expect(consentPartsOf('Agree to everything.')).toEqual({ before: 'Agree to everything.', link: null, after: '' });
	});

	it("shows Stripe's total once it has read it, and the server's figure until then", () => {
		expect(dueTodayLabel(null, 4900)).toBe('$49');
		expect(dueTodayLabel('', 2450)).toBe('$24.50');
		expect(dueTodayLabel('$24.50', 4900)).toBe('$24.50');
		expect(dueTodayLabel('$0.00', 4900)).toBe('$0.00');
	});
});

const PLAN_START: CheckoutClientStart = {
	clientSecret: 'cs_secret',
	publishableKey: 'pk_test_1',
	sessionId: 'cs_test_1',
	order: { kind: 'plan', plan: 'pro', priceCents: 4900, includes: ['5,000 AI credits a month'] },
	terms: { consentText: 'I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel.', buttonText: 'Subscribe: $49 a month', dueTodayCents: 4900 },
};

const CREDITS_START: CheckoutClientStart = {
	clientSecret: 'cs_secret',
	publishableKey: 'pk_test_1',
	sessionId: 'cs_test_2',
	order: { kind: 'credits', credits: 5000, amountCents: 750 },
	terms: null,
};

const DISCOUNTED_TERMS = { consentText: 'I agree to the Terms, and that Estori Pro costs $24.50 today, then $49 a month, until I cancel.', buttonText: 'Subscribe: $24.50 today, then $49 a month', dueTodayCents: 2450 };

function run(initial: CheckoutState, ...events: CheckoutEvent[]): CheckoutState {
	return events.reduce(checkoutReducer, initial);
}

/** A plan checkout with the form up, the card filled in and the box ticked. */
function readyToPay(): CheckoutState {
	return run(
		initialCheckoutState(false),
		{ type: 'started', start: PLAN_START },
		{ type: 'formReady' },
		{ type: 'cardChanged', complete: true },
		{ type: 'consentToggled', consented: true },
	);
}

describe('the checkout page state', () => {
	it('starts with a loader, then waits for the card form', () => {
		const starting = initialCheckoutState(false);
		expect(starting.phase).toEqual({ name: 'starting' });
		const started = run(starting, { type: 'started', start: PLAN_START });
		expect(started.phase).toEqual({ name: 'ready' });
		expect(started.terms).toEqual({ status: 'ready', view: PLAN_START.terms });
		expect(canPayNow(run(started, { type: 'cardChanged', complete: true }, { type: 'consentToggled', consented: true }))).toBe(false);
		expect(canPayNow(readyToPay())).toBe(true);
	});

	it('takes credits with no terms and no box to tick', () => {
		const state = run(initialCheckoutState(false), { type: 'started', start: CREDITS_START }, { type: 'formReady' }, { type: 'cardChanged', complete: true });
		expect(state.terms).toBeNull();
		expect(canPayNow(state)).toBe(true);
	});

	it('opens on the timed-out message when the return said the session expired', () => {
		expect(initialCheckoutState(true).phase).toEqual({ name: 'expired' });
	});

	it('unticks the box when a code applies or comes off, and waits for the new terms', () => {
		for (const applied of ['SAVE50', null]) {
			const changed = run(readyToPay(), { type: 'codeChanged', applied });
			expect(changed.consented).toBe(false);
			expect(changed.terms).toEqual({ status: 'loading' });
			expect(changed.code).toEqual({ applied, busy: false, error: null });
			expect(canPayNow(changed)).toBe(false);
			// Ticking while the price is being checked changes nothing.
			expect(run(changed, { type: 'consentToggled', consented: true }).consented).toBe(false);
			const loaded = run(changed, { type: 'termsLoaded', view: DISCOUNTED_TERMS });
			expect(loaded.terms).toEqual({ status: 'ready', view: DISCOUNTED_TERMS });
			expect(loaded.consented).toBe(false);
			expect(canPayNow(loaded)).toBe(false);
			expect(canPayNow(run(loaded, { type: 'consentToggled', consented: true }))).toBe(true);
		}
	});

	it('asks for the terms again on request, unticked, and lets a failed ask be asked again', () => {
		const failed = run(readyToPay(), { type: 'termsFailed' });
		const asking = run(failed, { type: 'termsRequested' });
		expect(asking.terms).toEqual({ status: 'loading' });
		expect(asking.consented).toBe(false);
		expect(run(asking, { type: 'termsLoaded', view: PLAN_START.terms as NonNullable<typeof PLAN_START.terms> }).terms?.status).toBe('ready');
	});

	it('keeps the buyer from paying on terms it could not refresh', () => {
		const failed = run(readyToPay(), { type: 'codeChanged', applied: 'SAVE50' }, { type: 'termsFailed' });
		expect(failed.terms).toEqual({ status: 'failed' });
		expect(canPayNow(run(failed, { type: 'consentToggled', consented: true }))).toBe(false);
	});

	it('holds the button while a code is being checked, and shows why one was refused', () => {
		const busy = run(readyToPay(), { type: 'codeSubmitted' });
		expect(busy.code.busy).toBe(true);
		expect(canPayNow(busy)).toBe(false);
		const refused = run(busy, { type: 'codeRejected', message: 'That code is not valid.' });
		expect(refused.code).toEqual({ applied: null, busy: false, error: 'That code is not valid.' });
		expect(refused.consented).toBe(true);
		expect(canPayNow(refused)).toBe(true);
	});

	it("reads what Stripe will charge from the session's changes", () => {
		const changed = run(readyToPay(), { type: 'sessionChanged', status: 'open', amount: '$24.50' });
		expect(changed.dueToday).toBe('$24.50');
		expect(changed.phase).toEqual({ name: 'ready' });
	});

	it('replaces the form with the timed-out message when Stripe says the session expired', () => {
		const expired = run(readyToPay(), { type: 'sessionChanged', status: 'expired', amount: '$49.00' });
		expect(expired.phase).toEqual({ name: 'expired' });
		expect(canPayNow(expired)).toBe(false);
	});

	it('disables the button from the press until the result, and keeps it disabled while the page leaves', () => {
		const paying = run(readyToPay(), { type: 'payStarted' });
		expect(paying.paying).toBe(true);
		expect(canPayNow(paying)).toBe(false);
		const leaving = run(paying, { type: 'payOutcome', outcome: { kind: 'redirecting' } });
		expect(leaving.paying).toBe(true);
		expect(canPayNow(leaving)).toBe(false);
	});

	it('does not start a payment that is not allowed', () => {
		const unticked = run(initialCheckoutState(false), { type: 'started', start: PLAN_START }, { type: 'formReady' }, { type: 'cardChanged', complete: true });
		expect(run(unticked, { type: 'payStarted' }).paying).toBe(false);
	});

	it("a declined card shows the bank's message with the box still ticked", () => {
		const declined = run(readyToPay(), { type: 'payStarted' }, { type: 'payOutcome', outcome: { kind: 'declined', message: 'Your card was declined.' } });
		expect(declined.paying).toBe(false);
		expect(declined.notice).toBe('Your card was declined.');
		expect(declined.consented).toBe(true);
		expect(canPayNow(declined)).toBe(true);
		// The next try clears the message.
		expect(run(declined, { type: 'payStarted' }).notice).toBeNull();
	});

	it('an expired payment shows the timed-out message', () => {
		const expired = run(readyToPay(), { type: 'payStarted' }, { type: 'payOutcome', outcome: { kind: 'expired' } });
		expect(expired.phase).toEqual({ name: 'expired' });
		expect(expired.paying).toBe(false);
	});

	it('a changed price shows the message and unticks the box', () => {
		const changed = run(readyToPay(), { type: 'payStarted' }, { type: 'payOutcome', outcome: { kind: 'price-changed', message: 'The price changed. Check it and agree again.' } });
		expect(changed.notice).toBe('The price changed. Check it and agree again.');
		expect(changed.consented).toBe(false);
		expect(changed.terms).toEqual({ status: 'loading' });
		expect(changed.paying).toBe(false);
	});

	it('a failed consent call shows its message and lets the buyer try again', () => {
		const failed = run(readyToPay(), { type: 'payStarted' }, { type: 'payOutcome', outcome: { kind: 'failed', message: PAYMENT_FAILED_MESSAGE } });
		expect(failed.notice).toBe(PAYMENT_FAILED_MESSAGE);
		expect(canPayNow(failed)).toBe(true);
	});

	it('shows a refusal in place of the form, with a retry only when one could help', () => {
		const refused = run(initialCheckoutState(false), { type: 'refused', message: 'Payments are paused.', retryable: true });
		expect(refused.phase).toEqual({ name: 'refused', message: 'Payments are paused.', retryable: true });
		expect(canPayNow(run(readyToPay(), { type: 'refused', message: 'x', retryable: false }))).toBe(false);
	});

	it('starts clean again, forgetting the box, the code and the old session', () => {
		const again = run(readyToPay(), { type: 'codeChanged', applied: 'SAVE50' }, { type: 'sessionChanged', status: 'expired', amount: '$1.00' }, { type: 'start' });
		expect(again).toEqual(initialCheckoutState(false));
	});
});

describe('how a refusal reads', () => {
	const failure = (status: number, message: string) => Object.assign(new Error(message), { status });

	it('takes the status and message of a failed request, and a fallback for anything else', () => {
		expect(refusalOf(failure(409, 'The price changed.'), 'fallback')).toEqual({ status: 409, message: 'The price changed.' });
		expect(refusalOf(new Error('Network down'), 'fallback')).toEqual({ status: null, message: 'Network down' });
		expect(refusalOf(failure(500, ''), 'fallback')).toEqual({ status: 500, message: 'fallback' });
		expect(refusalOf('boom', 'fallback')).toEqual({ status: null, message: 'fallback' });
	});

	it("knows the server's answer for a checkout that timed out", () => {
		expect(isExpiredRefusal(failure(400, CHECKOUT_EXPIRED_MESSAGE))).toBe(true);
		expect(isExpiredRefusal(failure(400, 'This checkout is already finished.'))).toBe(false);
		expect(isExpiredRefusal(failure(409, CHECKOUT_EXPIRED_MESSAGE))).toBe(false);
		expect(isExpiredRefusal(new Error(CHECKOUT_EXPIRED_MESSAGE))).toBe(false);
	});

	it('sends an account that already has a plan back to billing', () => {
		expect(startRefusalOf(failure(409, 'You already have a plan. Change it on the billing page.'), 'fallback')).toEqual({ kind: 'already-paying' });
	});

	it("shows the server's words for a pause, a missing key or a closed flag, and offers a retry only for the pause", () => {
		expect(startRefusalOf(failure(503, 'Plan changes and credit purchases are paused for a few minutes.'), 'fallback')).toEqual({
			kind: 'refused',
			message: 'Plan changes and credit purchases are paused for a few minutes.',
			retryable: true,
		});
		expect(startRefusalOf(failure(403, "Plans aren't open for your account yet."), 'fallback')).toEqual({ kind: 'refused', message: "Plans aren't open for your account yet.", retryable: false });
		expect(startRefusalOf(failure(402, 'Extra credits come with Premium.'), 'fallback')).toEqual({ kind: 'refused', message: 'Extra credits come with Premium.', retryable: false });
	});

	it('says the plain failure for anything it cannot explain, and offers a retry', () => {
		expect(startRefusalOf(failure(502, 'Stripe said no'), "Couldn't open the checkout.")).toEqual({ kind: 'refused', message: "Couldn't open the checkout.", retryable: true });
		expect(startRefusalOf(failure(0, 'Failed to fetch'), "Couldn't open the checkout.")).toEqual({ kind: 'refused', message: "Couldn't open the checkout.", retryable: true });
		expect(startRefusalOf(new Error('x'), "Couldn't open the checkout.")).toEqual({ kind: 'refused', message: "Couldn't open the checkout.", retryable: true });
	});
});

describe('confirming the payment', () => {
	const failure = (status: number, message: string) => Object.assign(new Error(message), { status });

	/** Steps that record what they were called with, in order. */
	function steps(overrides: Partial<PaymentSteps> = {}): { steps: PaymentSteps; calls: string[] } {
		const calls: string[] = [];
		const base: PaymentSteps = {
			kind: 'plan',
			recordConsent: async () => {
				calls.push('consent');
			},
			confirm: async () => {
				calls.push('confirm');
				return { type: 'success', session: { canConfirm: true, status: { type: 'complete' }, total: { total: { amount: '$49.00', minorUnitsAmount: 4900 } } } };
			},
			readStatus: async () => {
				calls.push('status');
				return { state: 'open', kind: 'plan' };
			},
		};
		return { steps: { ...base, ...overrides }, calls };
	}

	const declined = { type: 'error', error: { message: 'Your card was declined.', code: 'paymentFailed' } } as const;

	it('records consent before it confirms', async () => {
		const { steps: plan, calls } = steps();
		expect(await submitPayment(plan)).toEqual({ kind: 'redirecting' });
		expect(calls).toEqual(['consent', 'confirm']);
	});

	it('confirms credits without a consent call', async () => {
		const { steps: credits, calls } = steps({ kind: 'credits' });
		expect(await submitPayment(credits)).toEqual({ kind: 'redirecting' });
		expect(calls).toEqual(['confirm']);
	});

	it('never confirms when the price changed since the box was ticked', async () => {
		const { steps: plan, calls } = steps({
			recordConsent: async () => {
				throw failure(409, 'The price changed. Check it and agree again.');
			},
		});
		expect(await submitPayment(plan)).toEqual({ kind: 'price-changed', message: 'The price changed. Check it and agree again.' });
		expect(calls).toEqual([]);
	});

	it('never confirms a session that expired, whichever call found out', async () => {
		const { steps: plan, calls } = steps({
			recordConsent: async () => {
				throw failure(400, CHECKOUT_EXPIRED_MESSAGE);
			},
		});
		expect(await submitPayment(plan)).toEqual({ kind: 'expired' });
		expect(calls).toEqual([]);
	});

	it('shows any other failure to record consent, and does not confirm', async () => {
		const { steps: plan, calls } = steps({
			recordConsent: async () => {
				throw failure(400, 'This checkout is already finished.');
			},
		});
		expect(await submitPayment(plan)).toEqual({ kind: 'failed', message: 'This checkout is already finished.' });
		expect(calls).toEqual([]);
	});

	it("shows the bank's message for a declined card, after asking where the checkout stands", async () => {
		const { steps: plan, calls } = steps({
			confirm: async () => {
				calls.push('confirm');
				return declined;
			},
		});
		expect(await submitPayment(plan)).toEqual({ kind: 'declined', message: 'Your card was declined.' });
		expect(calls).toEqual(['consent', 'confirm', 'status']);
	});

	it('calls an expiry that Stripe reports as an error an expired checkout, found from the status', async () => {
		const { steps: plan } = steps({
			confirm: async () => ({ type: 'error', error: { message: 'Session expired', code: null } }),
			readStatus: async () => ({ state: 'expired', kind: 'plan' }),
		});
		expect(await submitPayment(plan)).toEqual({ kind: 'expired' });
	});

	it('leaves for billing when the failed confirm was in fact a paid or processing checkout', async () => {
		for (const state of ['paid', 'processing'] as const) {
			const { steps: credits } = steps({ kind: 'credits', confirm: async () => declined, readStatus: async () => ({ state, kind: 'credits' }) });
			expect(await submitPayment(credits)).toEqual({ kind: 'finished', target: '/settings/billing?confirm=credits' });
		}
	});

	it("shows the bank's message when the status can't be read", async () => {
		const { steps: plan } = steps({
			confirm: async () => declined,
			readStatus: async () => {
				throw new Error('offline');
			},
		});
		expect(await submitPayment(plan)).toEqual({ kind: 'declined', message: 'Your card was declined.' });
	});

	it('shows the plain failure when confirming throws', async () => {
		const { steps: plan } = steps({
			confirm: async () => {
				throw new Error('socket closed');
			},
		});
		expect(await submitPayment(plan)).toEqual({ kind: 'failed', message: PAYMENT_FAILED_MESSAGE });
	});

	it('a double click sends one consent and one confirm', async () => {
		const { steps: plan, calls } = steps({
			recordConsent: async () => {
				calls.push('consent');
				await Promise.resolve();
				await Promise.resolve();
			},
		});
		const press = singleFlight(() => submitPayment(plan));
		const first = press();
		const second = press();
		await Promise.all([first, second]);
		expect(calls).toEqual(['consent', 'confirm']);
		// Once the result is in, the next press runs.
		await press();
		expect(calls).toEqual(['consent', 'confirm', 'consent', 'confirm']);
	});

	it('lets the next press through after a run that threw', async () => {
		let runs = 0;
		const press = singleFlight(async () => {
			runs += 1;
			if (runs === 1) throw new Error('first run fails');
		});
		await expect(press()).rejects.toThrow('first run fails');
		await press();
		expect(runs).toBe(2);
	});
});

describe('waiting for the card form', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('gives Stripe ten seconds, then says the form did not load', async () => {
		expect(STRIPE_LOAD_TIMEOUT_MS).toBe(10_000);
		expect(FORM_NOT_LOADED_MESSAGE).toBe("The payment form didn't load. Check your connection and try again.");
		const never = new Promise<string>(() => {});
		const settled = vi.fn();
		const waiting = loadWithin(never).catch((error: unknown) => settled(error));
		await vi.advanceTimersByTimeAsync(STRIPE_LOAD_TIMEOUT_MS - 1);
		expect(settled).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await waiting;
		expect(settled).toHaveBeenCalledWith(expect.any(FormLoadTimeoutError));
	});

	it('returns what loaded in time and leaves no timer behind', async () => {
		await expect(loadWithin(Promise.resolve('stripe'))).resolves.toBe('stripe');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('passes on a load that failed, and leaves no timer behind', async () => {
		await expect(loadWithin(Promise.reject(new Error('Stripe could not load')))).rejects.toThrow('Stripe could not load');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('ignores a load that finishes after the time is up', async () => {
		let finish: (value: string) => void = () => {};
		const slow = new Promise<string>((resolve) => {
			finish = resolve;
		});
		const waiting = loadWithin(slow, 1_000);
		const outcome = waiting.then(
			() => 'loaded',
			(error: unknown) => (error instanceof FormLoadTimeoutError ? 'timed out' : 'other'),
		);
		await vi.advanceTimersByTimeAsync(1_000);
		finish('late');
		expect(await outcome).toBe('timed out');
	});

	it('shows the not-loaded message with a retry in place of the form', () => {
		const state = run(initialCheckoutState(false), { type: 'started', start: PLAN_START }, { type: 'refused', message: FORM_NOT_LOADED_MESSAGE, retryable: true });
		expect(state.phase).toEqual({ name: 'refused', message: FORM_NOT_LOADED_MESSAGE, retryable: true });
	});
});
