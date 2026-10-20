/**
 * Subscription schedules a plan change leaves on a subscription, and the cancel that releases them first. Kept apart
 * from the actions, so the Stripe scenarios script runs the same calls.
 */

import { createLogger } from '../../logger';
import type { StripeClient, StripeSubscription } from '../payments/stripe-client';

const logger = createLogger('BillingSchedules');

export type ScheduleStripe = Pick<StripeClient, 'retrieveSubscription' | 'releaseSubscriptionSchedule' | 'cancelAtPeriodEnd'>;

/** The schedule still governing the subscription, if any; a released, completed or cancelled one no longer does. */
export function pendingScheduleId(subscription: StripeSubscription): string | null {
	const { schedule } = subscription;
	if (schedule === null) return null;
	if (typeof schedule === 'string') return schedule;
	return schedule.status === 'active' || schedule.status === 'not_started' ? schedule.id : null;
}

/**
 * Drops a schedule and reads the subscription back. The release call counts every refusal as already released, so only
 * the fresh read shows it worked; null when a schedule still governs the subscription.
 */
export async function releaseSchedule(stripe: Pick<ScheduleStripe, 'retrieveSubscription' | 'releaseSubscriptionSchedule'>, subscriptionId: string, scheduleId: string): Promise<StripeSubscription | null> {
	await stripe.releaseSubscriptionSchedule(scheduleId);
	const fresh = await stripe.retrieveSubscription(subscriptionId);
	const still = pendingScheduleId(fresh);
	if (still === null) return fresh;
	logger.warn('A subscription schedule is still attached after its release', { subscriptionId, scheduleId, still });
	return null;
}

/**
 * Ends the subscription at the period's end. Stripe won't end one a schedule manages, so whatever schedule it has goes
 * first: a pending move, or one that already moved the plan and stays through its last phase. False when it stayed.
 */
export async function cancelAtPeriodEndReleasingSchedule(stripe: ScheduleStripe, subscriptionId: string, idempotencyKey: string): Promise<boolean> {
	const scheduleId = pendingScheduleId(await stripe.retrieveSubscription(subscriptionId));
	if (scheduleId && !(await releaseSchedule(stripe, subscriptionId, scheduleId))) return false;
	await stripe.cancelAtPeriodEnd(subscriptionId, idempotencyKey);
	return true;
}
