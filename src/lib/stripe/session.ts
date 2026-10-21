import type { StripeCheckoutSession } from './stripe-js';

export type StripeSessionStatus = StripeCheckoutSession['status']['type'];

/**
 * A session's status. Stripe.js throws on `confirm()` until the page has read the session's total, so a page reads the
 * status through here. A setup session has no amount to show and may carry no total, which is why the read is optional.
 */
export function sessionStatusOf(session: StripeCheckoutSession): StripeSessionStatus {
	void session.total?.total.amount;
	return session.status.type;
}
