/** Credit periods: a Stripe period for a subscriber, a sign-up anniversary for everyone else. */

import type { SubscriptionRecord } from '../../database/schema';
import type { LedgerPeriod } from './credit-ledger';

export const DAY_MS = 24 * 60 * 60 * 1000;

const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The monthly period holding `nowMs`, starting on the sign-up's day of the month (clamped to short months), or the 1st without one. */
export function anniversaryPeriod(signupMs: number | null, nowMs: number): { startMs: number; endMs: number } {
	const day = signupMs !== null && Number.isFinite(signupMs) ? new Date(signupMs).getUTCDate() : 1;
	const startOf = (year: number, month: number): number => Date.UTC(year, month, Math.min(day, daysIn(year, month)));
	const now = new Date(nowMs);
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth();
	const thisMonth = startOf(year, month);
	return thisMonth <= nowMs ? { startMs: thisMonth, endMs: startOf(year, month + 1) } : { startMs: startOf(year, month - 1), endMs: thisMonth };
}

/** The ledger period of an account without a Stripe subscription. */
export function accountPeriod(signupMs: number | null, nowMs: number): LedgerPeriod {
	const { startMs, endMs } = anniversaryPeriod(signupMs, nowMs);
	return { key: `acct:${startMs / 1000}`, startMs, endMs };
}

/** The ledger period of a Stripe billing period; the subscription id keeps it apart from an account month starting the same second. */
export function subscriptionPeriod(subscription: Pick<SubscriptionRecord, 'stripeSubscriptionId' | 'currentPeriodStart' | 'currentPeriodEnd'>): LedgerPeriod {
	const startMs = subscription.currentPeriodStart.getTime();
	return { key: `sub:${subscription.stripeSubscriptionId}:${startMs / 1000}`, startMs, endMs: subscription.currentPeriodEnd.getTime() };
}
