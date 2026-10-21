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

/** The same UTC day and time `months` later, the day clamped to that month's last day. */
export function addMonths(ms: number, months: number): number {
	const date = new Date(ms);
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth() + months;
	const day = Math.min(date.getUTCDate(), daysIn(year, month));
	return Date.UTC(year, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
}

/** The sign-up days of the month whose period starts today: today's, and on a month's last day every later one too. */
export function renewalDaysOf(nowMs: number): number[] {
	const now = new Date(nowMs);
	const today = now.getUTCDate();
	const last = today === daysIn(now.getUTCFullYear(), now.getUTCMonth()) ? 31 : today;
	return Array.from({ length: last - today + 1 }, (_, index) => today + index);
}
