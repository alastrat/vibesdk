/** Record a paid Checkout session as a purchase. The webhook and the return confirmation share it. */

import { platformFeeCents } from '../../../shared/types/templates';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';
import type { StripeAccount, StripeCheckoutSession } from './stripe-client';

export interface FulfillDeps {
	listingExists(listingId: string): Promise<boolean>;
	/** False when the session (or this buyer's purchase) is already recorded. */
	recordStripePurchase(record: StripePurchaseRecord): Promise<boolean>;
	/** Whether a purchase already exists for this Checkout session. */
	sessionRecorded(checkoutSessionId: string): Promise<boolean>;
}

/**
 * 'duplicate-purchase' and 'listing-missing' are paid sessions that record nothing:
 * the buyer was charged twice for one listing, or for a listing deleted after checkout.
 * Both need a refund in the Stripe dashboard.
 */
export type FulfillResult = 'recorded' | 'already-recorded' | 'duplicate-purchase' | 'listing-missing' | 'not-paid' | 'not-ours';

export async function fulfillCheckoutSession(deps: FulfillDeps, session: StripeCheckoutSession): Promise<FulfillResult> {
	const metadata = session.metadata ?? {};
	const listingId = metadata.listingId;
	const appId = metadata.appId;
	const buyerUserId = metadata.buyerUserId;
	const sellerStripeAccountId = metadata.sellerStripeAccountId;
	if (!listingId || !appId || !buyerUserId || !sellerStripeAccountId || session.amount_total === null) return 'not-ours';
	if (session.payment_status !== 'paid') return 'not-paid';
	if (!(await deps.listingExists(listingId))) return 'listing-missing';

	const priceCents = session.amount_total;
	const fee = platformFeeCents(priceCents);
	const recorded = await deps.recordStripePurchase({
		listingId,
		sourceAppId: appId,
		versionId: metadata.versionId ?? null,
		userId: buyerUserId,
		priceCents,
		platformFeeCents: fee,
		sellerAmountCents: priceCents - fee,
		currency: session.currency ?? 'usd',
		checkoutSessionId: session.id,
		paymentIntentId: session.payment_intent,
		sellerStripeAccountId,
	});
	if (recorded) return 'recorded';
	return (await deps.sessionRecorded(session.id)) ? 'already-recorded' : 'duplicate-purchase';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function isCheckoutSession(value: unknown): value is StripeCheckoutSession {
	return isRecord(value) && typeof value.id === 'string' && typeof value.payment_status === 'string';
}

export function isStripeAccount(value: unknown): value is StripeAccount {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.details_submitted === 'boolean' &&
		typeof value.charges_enabled === 'boolean' &&
		typeof value.payouts_enabled === 'boolean'
	);
}
