/** A subscription row rebuilt from Stripe's subscription, and the emails a change between two rows calls for. Pure. */

import type { SubscriptionRecord } from '../../database/schema';
import { LIVE_SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '../../../shared/types/billing';
import { PAID_PLAN_IDS, PLAN_LIMITS, type PaidPlanId } from '../../../shared/types/plans';
import type { StripeInvoice, StripePrice, StripeSubscription, StripeSubscriptionSchedule } from '../payments/stripe-client';
import { graceEndsAt } from './account';
import type { PlannedNotice } from './notices';
import { subscriptionPeriod } from './periods';
import { creditsOfPrice, intervalOfPrice, planOfPrice, type StripePriceIds } from './prices';

type PendingChange = Pick<SubscriptionRecord, 'pendingPlan' | 'pendingPlanAt' | 'stripeScheduleId' | 'pendingBillingInterval' | 'pendingMonthlyCredits'>;

const NO_PENDING_CHANGE: PendingChange = { pendingPlan: null, pendingPlanAt: null, stripeScheduleId: null, pendingBillingInterval: null, pendingMonthlyCredits: null };

const ENDED_STATUSES: readonly SubscriptionStatus[] = ['canceled', 'unpaid', 'incomplete_expired'];

const isLive = (status: SubscriptionStatus): boolean => LIVE_SUBSCRIPTION_STATUSES.includes(status);
const isPaying = (status: SubscriptionStatus): boolean => status === 'active' || status === 'trialing';
const seconds = (at: Date): number => Math.floor(at.getTime() / 1000);

function priceOf(price: string | StripePrice): StripePrice {
	return typeof price === 'string' ? { id: price, metadata: null } : price;
}

/** The plan a schedule moves to after its current phase; nothing for a schedule that no longer governs, or one only named by id. */
function pendingChangeOf(schedule: string | StripeSubscriptionSchedule | null, plan: PaidPlanId, interval: 'month' | 'year', monthlyCredits: number | null, ids: StripePriceIds | null): PendingChange {
	if (schedule === null || typeof schedule === 'string') return NO_PENDING_CHANGE;
	if (schedule.status !== 'active' && schedule.status !== 'not_started') return NO_PENDING_CHANGE;
	const currentStart = schedule.current_phase?.start_date ?? Number.NEGATIVE_INFINITY;
	const next = schedule.phases.find((phase) => phase.start_date > currentStart);
	const item = next?.items[0];
	if (!next || !item) return NO_PENDING_CHANGE;
	const pendingPlan = planOfPrice(priceOf(item.price), ids);
	const pendingBillingInterval = intervalOfPrice(priceOf(item.price), ids);
	if (pendingPlan === null || pendingBillingInterval === null) return NO_PENDING_CHANGE;
	const pendingMonthlyCredits = creditsOfPrice(priceOf(item.price), pendingPlan, pendingBillingInterval);
	if (pendingMonthlyCredits === 'invalid' || pendingPlan === plan && pendingBillingInterval === interval && pendingMonthlyCredits === monthlyCredits) return NO_PENDING_CHANGE;
	return { pendingPlan, pendingBillingInterval, pendingMonthlyCredits, pendingPlanAt: new Date(next.start_date * 1000), stripeScheduleId: schedule.id };
}

/** The row for the subscription as Stripe returned it; null when its price is neither Pro nor Premium. */
export function subscriptionRowFrom(subscription: StripeSubscription, userId: string, ids: StripePriceIds | null, nowMs: number): SubscriptionRecord | null {
	const item = subscription.items.data[0];
	if (!item) return null;
	const plan = planOfPrice(item.price, ids);
	const billingInterval = intervalOfPrice(item.price, ids);
	if (plan === null || billingInterval === null) return null;
	const monthlyCredits = creditsOfPrice(item.price, plan, billingInterval);
	if (monthlyCredits === 'invalid') return null;
	return {
		userId,
		stripeSubscriptionId: subscription.id,
		status: subscription.status,
		plan,
		billingInterval,
		monthlyCredits,
		currentPeriodStart: new Date(item.current_period_start * 1000),
		currentPeriodEnd: new Date(item.current_period_end * 1000),
		cancelAtPeriodEnd: subscription.cancel_at_period_end || subscription.cancel_at !== null,
		...pendingChangeOf(subscription.schedule, plan, billingInterval, monthlyCredits, ids),
		stripeCreatedAt: new Date(subscription.created * 1000),
		updatedAt: new Date(nowMs),
	};
}

const isMoveDown = (from: PaidPlanId, to: PaidPlanId): boolean => PAID_PLAN_IDS.indexOf(to) < PAID_PLAN_IDS.indexOf(from);

/** The emails moving from `previous` to `next` calls for, each under the key that sends it once. */
export function noticesFor(previous: SubscriptionRecord | null, next: SubscriptionRecord, context: { eventType: string; invoice: StripeInvoice | null }): PlannedNotice[] {
	const { eventType, invoice } = context;
	const subscriptionId = next.stripeSubscriptionId;
	const same = previous !== null && previous.stripeSubscriptionId === subscriptionId ? previous : null;
	const periodStart = next.currentPeriodStart.getTime();
	const periodEnd = next.currentPeriodEnd.getTime();
	const notices: PlannedNotice[] = [];

	if (isPaying(next.status) && (same === null || !isLive(same.status))) {
		notices.push({ key: `plan_started:${subscriptionId}`, email: { kind: 'plan_started', plan: next.plan, renewsAt: periodEnd, ...(next.monthlyCredits != null ? { monthlyCredits: next.monthlyCredits } : {}), ...(next.billingInterval === 'year' ? { billingInterval: next.billingInterval } : {}) } });
	}
	// Every payment gets its receipt, whatever the stored row was: a returning seller's first invoice can come before the new subscription's events.
	const paid = eventType === 'invoice.paid' ? invoice : null;
	if (paid && paid.amount_paid > 0) {
		notices.push({
			key: `receipt:${paid.id}`,
			email: { kind: 'receipt', plan: next.plan, amountCents: paid.amount_paid, currency: paid.currency, periodStart, periodEnd, invoiceNumber: paid.number },
		});
	}
	if (paid && paid.billing_reason === 'subscription_cycle') {
		notices.push({ key: `credits_renewed:${subscriptionPeriod(next).key}`, email: { kind: 'credits_renewed', credits: next.monthlyCredits ?? PLAN_LIMITS[next.plan].aiCredits, renewsAt: subscriptionPeriod(next).endMs } });
	}
	// The rest compare the subscription with its own earlier state.
	if (previous !== null && same === null) return notices;

	if (same && same.plan === 'pro' && next.plan === 'premium') {
		notices.push({ key: `plan_upgraded:${subscriptionId}:${seconds(next.currentPeriodStart)}`, email: { kind: 'plan_upgraded', plan: next.plan, ...(next.monthlyCredits != null ? { monthlyCredits: next.monthlyCredits } : {}), ...(next.billingInterval === 'year' ? { billingInterval: next.billingInterval } : {}) } });
	}
	// The move-down email names the plan the account moves to; Estori schedules no other kind of move.
	if (next.pendingPlan && next.pendingPlanAt && next.stripeScheduleId && next.pendingPlan !== same?.pendingPlan && isMoveDown(next.plan, next.pendingPlan)) {
		notices.push({ key: `downgrade_scheduled:${next.stripeScheduleId}`, email: { kind: 'downgrade_scheduled', plan: next.pendingPlan, at: next.pendingPlanAt.getTime(), ...(next.pendingMonthlyCredits != null ? { monthlyCredits: next.pendingMonthlyCredits } : {}), ...(next.pendingBillingInterval === 'year' ? { billingInterval: next.pendingBillingInterval } : {}) } });
	}
	const graceEnd = graceEndsAt(next);
	// Stripe sends payment_failed and payment_action_required for one failed invoice and they share this key. The event words
	// the email here; the webhook rewords a payment_failed one from the invoice's payment before it goes out.
	if ((eventType === 'invoice.payment_failed' || eventType === 'invoice.payment_action_required') && invoice && graceEnd !== null) {
		notices.push({
			key: `payment_failed:${invoice.id}`,
			email: { kind: 'payment_failed', plan: next.plan, graceEndsAt: graceEnd, needsConfirmation: eventType === 'invoice.payment_action_required' },
		});
	}
	if (next.cancelAtPeriodEnd && !same?.cancelAtPeriodEnd && isLive(next.status)) {
		notices.push({ key: `plan_ending:${subscriptionId}:${seconds(next.currentPeriodEnd)}`, email: { kind: 'plan_ending', plan: next.plan, endsAt: periodEnd } });
	}
	if (same && isLive(same.status) && ENDED_STATUSES.includes(next.status)) {
		notices.push({ key: `plan_ended:${subscriptionId}`, email: { kind: 'plan_ended', plan: next.plan, reason: same.status === 'past_due' ? 'payment-failed' : 'cancelled' } });
	}
	return notices;
}
