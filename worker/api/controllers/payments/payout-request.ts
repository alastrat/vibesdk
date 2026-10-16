/** The seller's payout frequency choice, and the schedule Stripe expects for it. */

import { PAYOUT_INTERVALS, type PayoutInterval } from '../../../../shared/types/store-payments';
import type { PayoutSchedule, Weekday } from '../../../services/payments/stripe-client';

const WEEKDAYS: readonly Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

export function parsePayoutRequest(body: unknown): { interval: PayoutInterval; anchor: string } | null {
	if (typeof body !== 'object' || body === null) return null;
	const { interval, anchor } = body as { interval?: unknown; anchor?: unknown };
	if (typeof interval !== 'string' || !(PAYOUT_INTERVALS as readonly string[]).includes(interval) || typeof anchor !== 'string') return null;
	if (interval === 'weekly' && !(WEEKDAYS as readonly string[]).includes(anchor)) return null;
	if (interval === 'monthly' && !/^([1-9]|1\d|2[0-8])$/.test(anchor)) return null;
	return { interval: interval as PayoutInterval, anchor: interval === 'daily' ? '' : anchor };
}

export function scheduleOf(choice: { interval: PayoutInterval; anchor: string }): PayoutSchedule {
	return {
		interval: choice.interval,
		weeklyAnchor: choice.interval === 'weekly' ? (choice.anchor as Weekday) : null,
		monthlyAnchor: choice.interval === 'monthly' ? Number(choice.anchor) : null,
		delayDays: null,
	};
}
