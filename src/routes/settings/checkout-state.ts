/** The checkout page's decisions, with no React and no DOM: what was asked for, when paying is allowed and where each result leads. */

import {
	BILLING_PATH,
	CHECKOUT_EXPIRED_MESSAGE,
	formatUsd,
	isExtraCreditsAmount,
	isPaidPlanId,
	type CheckoutClientStart,
	type CheckoutOrder,
	type CheckoutStatusView,
	type CheckoutTermsView,
	type PaidPlanId,
} from '@/api-types';
import type { StripeCheckoutActionResult } from '@/lib/stripe/stripe-js';

export const CHECKOUT_PATH = `${BILLING_PATH}/checkout`;

/** How long the card form gets to load before the page says it didn't. */
export const STRIPE_LOAD_TIMEOUT_MS = 10_000;

export const FORM_NOT_LOADED_MESSAGE = "The payment form didn't load. Check your connection and try again.";
export const PAYMENT_FAILED_MESSAGE = "The payment didn't go through. Check your details and try again.";
export const CODE_FAILED_MESSAGE = "Couldn't check that code. Try again.";

export type CheckoutRequest = { kind: 'plan'; plan: PaidPlanId } | { kind: 'credits'; credits: number };

/** What the address asks for: one paid plan, or one valid amount of extra credits, written as it would be by `checkoutPathOf`. */
export function checkoutRequestOf(search: string): CheckoutRequest | null {
	const params = new URLSearchParams(search);
	const plan = params.get('plan');
	const credits = params.get('credits');
	if (plan !== null) return credits === null && isPaidPlanId(plan) ? { kind: 'plan', plan } : null;
	if (credits === null) return null;
	const amount = Number(credits);
	return isExtraCreditsAmount(amount) && String(amount) === credits ? { kind: 'credits', credits: amount } : null;
}

/** True when the return left the expired mark on the address. */
export function checkoutExpiredOf(search: string): boolean {
	return new URLSearchParams(search).get('expired') === '1';
}

/** The checkout page's address for a request, which `checkoutRequestOf` reads back. */
export function checkoutPathOf(request: CheckoutRequest | null, options: { expired?: boolean } = {}): string {
	const params = new URLSearchParams();
	if (request?.kind === 'plan') params.set('plan', request.plan);
	if (request?.kind === 'credits') params.set('credits', String(request.credits));
	if (options.expired) params.set('expired', '1');
	const query = params.toString();
	return query === '' ? CHECKOUT_PATH : `${CHECKOUT_PATH}?${query}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A request the page stored for the return route, or null when there is none or it isn't one. */
export function readCheckoutRequest(text: string | null): CheckoutRequest | null {
	if (text === null) return null;
	try {
		const value: unknown = JSON.parse(text);
		if (!isRecord(value)) return null;
		if (value.kind === 'plan' && isPaidPlanId(value.plan)) return { kind: 'plan', plan: value.plan };
		if (value.kind === 'credits' && isExtraCreditsAmount(value.credits)) return { kind: 'credits', credits: value.credits };
		return null;
	} catch {
		return null;
	}
}

export interface PayState {
	consented: boolean;
	/** True while the terms are being fetched again, so a box ticked for the old price doesn't count. */
	termsLoading: boolean;
	paying: boolean;
	/** The card form's fields are all filled in. */
	complete: boolean;
	kind: 'plan' | 'credits';
}

/** A plan needs the box ticked on the terms shown; credits have no renewal to agree to. */
export function canPay(state: PayState): boolean {
	if (state.paying || !state.complete) return false;
	return state.kind === 'credits' || (state.consented && !state.termsLoading);
}

/** Where the seller goes once Stripe's return, or a failed confirm, shows where the checkout stands. */
export function returnTargetOf(status: CheckoutStatusView, request: CheckoutRequest | null = null): string {
	switch (status.state) {
		case 'paid':
		case 'processing':
			return `${BILLING_PATH}?confirm=${status.kind}`;
		case 'open':
			return checkoutPathOf(request);
		case 'expired':
			return checkoutPathOf(request, { expired: true });
	}
}

const TERMS_WORD = 'Terms';

/** The consent sentence split around the word the page links to the Terms; the sentence itself is the server's. */
export function consentPartsOf(text: string): { before: string; link: string | null; after: string } {
	const at = text.indexOf(TERMS_WORD);
	if (at < 0) return { before: text, link: null, after: '' };
	return { before: text.slice(0, at), link: TERMS_WORD, after: text.slice(at + TERMS_WORD.length) };
}

/** What is due today: the total Stripe reports once it has, and the server's figure until then. */
export function dueTodayLabel(stripeAmount: string | null, fallbackCents: number): string {
	return stripeAmount !== null && stripeAmount.trim() !== '' ? stripeAmount : formatUsd(fallbackCents);
}

export interface Refusal {
	status: number | null;
	message: string;
}

/** The status and message of a failed request, or the fallback for a failure that has no words of its own. */
export function refusalOf(error: unknown, fallback: string): Refusal {
	const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : null;
	return { status, message: error instanceof Error && error.message !== '' ? error.message : fallback };
}

/** True for the server's answer to a call on a checkout that has timed out. */
export function isExpiredRefusal(error: unknown): boolean {
	const { status, message } = refusalOf(error, '');
	return status === 400 && message === CHECKOUT_EXPIRED_MESSAGE;
}

export type StartRefusal = { kind: 'already-paying' } | { kind: 'refused'; message: string; retryable: boolean };

/**
 * What a refused start means. An account that already has a plan goes back to billing. The server's own words (a pause,
 * a missing key, a closed flag, a plan limit) replace the form, with a retry only for the pause. Anything else is the
 * plain failure, which a retry may fix.
 */
export function startRefusalOf(error: unknown, fallback: string): StartRefusal {
	const { status, message } = refusalOf(error, fallback);
	if (status === 409) return { kind: 'already-paying' };
	if (status === 503) return { kind: 'refused', message, retryable: true };
	if (status !== null && status >= 400 && status < 500) return { kind: 'refused', message, retryable: false };
	return { kind: 'refused', message: fallback, retryable: true };
}

export class FormLoadTimeoutError extends Error {
	constructor() {
		super('The card form took too long to load');
		this.name = 'FormLoadTimeoutError';
	}
}

/** Rejects with `FormLoadTimeoutError` when `load` hasn't settled in `ms`; a result that arrives later is ignored. */
export function loadWithin<T>(load: Promise<T>, ms: number = STRIPE_LOAD_TIMEOUT_MS): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new FormLoadTimeoutError()), ms);
		load.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** Runs `task` once at a time: a call made while it runs gets the running call's result instead of starting another. */
export function singleFlight<A extends unknown[], R>(task: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
	let running: Promise<R> | null = null;
	return (...args) => {
		running ??= task(...args).finally(() => {
			running = null;
		});
		return running;
	};
}

/** What pressing pay led to; only `redirecting` leaves the button disabled, because the page is going away. */
export type PaymentOutcome =
	| { kind: 'redirecting' }
	| { kind: 'declined'; message: string }
	| { kind: 'price-changed'; message: string }
	| { kind: 'expired' }
	| { kind: 'finished'; target: string }
	| { kind: 'failed'; message: string };

export interface PaymentSteps {
	kind: 'plan' | 'credits';
	/** Stores the seller's agreement to the terms shown; rejects when the server refuses it. */
	recordConsent(): Promise<unknown>;
	confirm(): Promise<StripeCheckoutActionResult>;
	readStatus(): Promise<CheckoutStatusView>;
}

function consentRefusal(error: unknown): PaymentOutcome {
	if (isExpiredRefusal(error)) return { kind: 'expired' };
	const { status, message } = refusalOf(error, PAYMENT_FAILED_MESSAGE);
	return status === 409 ? { kind: 'price-changed', message } : { kind: 'failed', message };
}

/** A confirm that came back as an error is told apart by where the checkout stands: it may have expired, or been paid. */
async function settleFailedConfirm(steps: PaymentSteps, message: string): Promise<PaymentOutcome> {
	try {
		const status = await steps.readStatus();
		if (status.state === 'expired') return { kind: 'expired' };
		if (status.state === 'paid' || status.state === 'processing') return { kind: 'finished', target: returnTargetOf(status) };
	} catch {
		// Without the status, the card's own message is all there is to show.
	}
	return { kind: 'declined', message: message || PAYMENT_FAILED_MESSAGE };
}

/** Records consent for a plan, and only then confirms; nothing is confirmed on a refused consent. */
export async function submitPayment(steps: PaymentSteps): Promise<PaymentOutcome> {
	if (steps.kind === 'plan') {
		try {
			await steps.recordConsent();
		} catch (error) {
			return consentRefusal(error);
		}
	}
	let result: StripeCheckoutActionResult;
	try {
		result = await steps.confirm();
	} catch {
		return { kind: 'failed', message: PAYMENT_FAILED_MESSAGE };
	}
	return result.type === 'success' ? { kind: 'redirecting' } : settleFailedConfirm(steps, result.error.message);
}

export type CheckoutPhase = { name: 'starting' } | { name: 'ready' } | { name: 'expired' } | { name: 'refused'; message: string; retryable: boolean };

export type TermsState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; view: CheckoutTermsView };

export interface CheckoutState {
	phase: CheckoutPhase;
	sessionId: string | null;
	order: CheckoutOrder | null;
	/** The consent and button wording of a plan; null for credits. */
	terms: TermsState | null;
	/** The card form is on the page. */
	formReady: boolean;
	consented: boolean;
	/** The card form's fields are all filled in. */
	complete: boolean;
	paying: boolean;
	/** What Stripe says is due today, as it formats it; null until it has said. */
	dueToday: string | null;
	code: { applied: string | null; busy: boolean; error: string | null };
	/** Shown under the form: a declined card, a changed price, a failed consent. */
	notice: string | null;
}

export function initialCheckoutState(expired: boolean): CheckoutState {
	return {
		phase: expired ? { name: 'expired' } : { name: 'starting' },
		sessionId: null,
		order: null,
		terms: null,
		formReady: false,
		consented: false,
		complete: false,
		paying: false,
		dueToday: null,
		code: { applied: null, busy: false, error: null },
		notice: null,
	};
}

export type CheckoutEvent =
	| { type: 'start' }
	| { type: 'started'; start: CheckoutClientStart }
	| { type: 'refused'; message: string; retryable: boolean }
	| { type: 'expired' }
	| { type: 'formReady' }
	| { type: 'sessionChanged'; status: 'open' | 'expired' | 'complete'; amount: string }
	| { type: 'cardChanged'; complete: boolean }
	| { type: 'consentToggled'; consented: boolean }
	| { type: 'codeSubmitted' }
	| { type: 'codeRejected'; message: string }
	| { type: 'codeChanged'; applied: string | null }
	| { type: 'termsRequested' }
	| { type: 'termsLoaded'; view: CheckoutTermsView }
	| { type: 'termsFailed' }
	| { type: 'payStarted' }
	| { type: 'payOutcome'; outcome: PaymentOutcome };

/** True when pressing pay is allowed: the form is up and every condition of `canPay` holds. */
export function canPayNow(state: CheckoutState): boolean {
	if (state.phase.name !== 'ready' || state.order === null || !state.formReady) return false;
	const plan = state.order.kind === 'plan';
	return canPay({
		kind: state.order.kind,
		consented: state.consented,
		termsLoading: state.code.busy || (plan && state.terms?.status !== 'ready'),
		paying: state.paying,
		complete: state.complete,
	});
}

function canTick(state: CheckoutState): boolean {
	return state.phase.name === 'ready' && state.terms?.status === 'ready' && !state.paying && !state.code.busy;
}

function afterPayment(state: CheckoutState, outcome: PaymentOutcome): CheckoutState {
	switch (outcome.kind) {
		case 'redirecting':
		case 'finished':
			return state;
		case 'declined':
		case 'failed':
			return { ...state, paying: false, notice: outcome.message };
		case 'price-changed':
			return { ...state, paying: false, notice: outcome.message, consented: false, terms: { status: 'loading' } };
		case 'expired':
			return { ...state, paying: false, phase: { name: 'expired' } };
	}
}

export function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {
	switch (event.type) {
		case 'start':
			return initialCheckoutState(false);
		case 'started':
			return {
				...state,
				phase: { name: 'ready' },
				sessionId: event.start.sessionId,
				order: event.start.order,
				terms: event.start.terms ? { status: 'ready', view: event.start.terms } : null,
			};
		case 'refused':
			return { ...state, paying: false, phase: { name: 'refused', message: event.message, retryable: event.retryable } };
		case 'expired':
			return { ...state, paying: false, phase: { name: 'expired' } };
		case 'formReady':
			return { ...state, formReady: true };
		case 'sessionChanged':
			return event.status === 'expired' ? { ...state, dueToday: event.amount, paying: false, phase: { name: 'expired' } } : { ...state, dueToday: event.amount };
		case 'cardChanged':
			return { ...state, complete: event.complete };
		case 'consentToggled':
			return canTick(state) ? { ...state, consented: event.consented } : state;
		case 'codeSubmitted':
			return { ...state, code: { ...state.code, busy: true, error: null } };
		case 'codeRejected':
			return { ...state, code: { ...state.code, busy: false, error: event.message } };
		case 'codeChanged':
			return { ...state, code: { applied: event.applied, busy: false, error: null }, consented: false, terms: { status: 'loading' }, notice: null };
		case 'termsRequested':
			return { ...state, consented: false, terms: { status: 'loading' } };
		case 'termsLoaded':
			return { ...state, consented: false, terms: { status: 'ready', view: event.view } };
		case 'termsFailed':
			return { ...state, consented: false, terms: { status: 'failed' } };
		case 'payStarted':
			return canPayNow(state) ? { ...state, paying: true, notice: null } : state;
		case 'payOutcome':
			return afterPayment(state, event.outcome);
	}
}
