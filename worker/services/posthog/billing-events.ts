/**
 * Billing's seven events, sent from billing's own code points. Billing calls these only after it records what
 * triggered them the first time, so Stripe's retries never count twice.
 */

import type { BillingEventName, ServerEventProperties } from '../../../shared/types/analytics-events';
import { PLAN_IDS, type PlanId } from '../../../shared/types/plans';
import { serverAnalytics } from './analytics';
import { personUpdateOf } from './person';

export type BillingAnalyticsEvent = { [N in BillingEventName]: { name: N; properties: ServerEventProperties<N> } }[BillingEventName];

/** What these events read from billing's subscription row; the row fits it as it is. */
export interface SubscriptionState {
	stripeSubscriptionId: string;
	status: string;
	plan: PlanId;
	cancelAtPeriodEnd: boolean;
}

const LIVE_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing']);
/** A subscription in these has never been paid for. */
const NEVER_STARTED: ReadonlySet<string> = new Set(['incomplete', 'incomplete_expired']);

export function planDirection(from: PlanId, to: PlanId): 'up' | 'down' {
	return PLAN_IDS.indexOf(to) > PLAN_IDS.indexOf(from) ? 'up' : 'down';
}

/** Sellers can only cancel at the period's end; an immediate cancel came from an admin or the Stripe Dashboard. */
export function cancelReasonOf(previous: SubscriptionState | null): 'seller' | 'payment_failed' | 'admin' {
	if (previous?.status === 'past_due' || previous?.status === 'unpaid') return 'payment_failed';
	if (previous?.cancelAtPeriodEnd) return 'seller';
	return 'admin';
}

/**
 * The events in one recorded Stripe event, from the row billing had and the row it just stored. Whichever event first
 * stores a change sends it, so Stripe's order doesn't matter. `failedAttempt` is set for invoice.payment_failed only;
 * like billing's own payment-failed email, it counts only a renewal, which leaves the subscription past due.
 */
export function subscriptionEventsFor(input: { previous: SubscriptionState | null; next: SubscriptionState; failedAttempt: number | null }): BillingAnalyticsEvent[] {
	const { previous, next, failedAttempt } = input;
	const events: BillingAnalyticsEvent[] = [];
	const same = previous !== null && previous.stripeSubscriptionId === next.stripeSubscriptionId;
	const startedBefore = same && !NEVER_STARTED.has(previous.status);
	if (LIVE_STATUSES.has(next.status) && !startedBefore) {
		events.push({ name: 'subscription_started', properties: { plan: next.plan } });
	}
	if (startedBefore && LIVE_STATUSES.has(next.status) && previous.plan !== next.plan) {
		events.push({ name: 'subscription_changed', properties: { from_plan: previous.plan, to_plan: next.plan, direction: planDirection(previous.plan, next.plan) } });
	}
	if (startedBefore && next.status === 'canceled' && previous.status !== 'canceled') {
		events.push({ name: 'subscription_cancelled', properties: { plan: next.plan, reason: cancelReasonOf(previous) } });
	}
	if (failedAttempt !== null && next.status === 'past_due') {
		events.push({ name: 'subscription_payment_failed', properties: { plan: next.plan, attempt: failedAttempt } });
	}
	return events;
}

/** Sends billing's events about one account, with its person properties read after billing's write. Never throws. */
export async function trackBilling(env: Env, userId: string, events: readonly BillingAnalyticsEvent[]): Promise<void> {
	if (events.length === 0) return;
	try {
		const analytics = serverAnalytics(env);
		const person = await personUpdateOf(env, userId);
		for (const event of events) analytics.capture(event.name, userId, event.properties, person);
	} catch {
		// Analytics never fails a webhook or a turn; serverAnalytics and personUpdateOf don't throw, this is a backstop.
	}
}
