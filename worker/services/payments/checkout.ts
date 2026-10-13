/** Who may pay for a site, and whether a returning buyer's Checkout session is theirs and paid. Pure. */

import type { TemplateListingStatus } from '../../../shared/types/templates';
import { SITE_NOT_YET_AVAILABLE_MESSAGE, SITE_UNAVAILABLE_MESSAGE } from '../templates/reuse';
import { ALREADY_OWNED_MESSAGE, PAYMENT_INCOMPLETE_MESSAGE, SELLER_NOT_READY_MESSAGE } from './config';
import type { StripeCheckoutSession } from './stripe-client';

export interface CheckoutInput {
	appPublic: boolean;
	removed: boolean;
	listing: { status: TemplateListingStatus; currentVersionId: string | null; priceCents: number } | null;
	isCreator: boolean;
	hasPurchase: boolean;
	sellerTransfersActive: boolean;
}

export type CheckoutDecision = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };
export type ConfirmDecision = { ok: true } | { ok: false; status: 403 | 409; error: string };

export function checkoutDecision(input: CheckoutInput): CheckoutDecision {
	if (!input.appPublic || input.removed) return { ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE };
	if (input.listing?.status === 'listed' && input.listing.currentVersionId === null) {
		return { ok: false, status: 409, error: SITE_NOT_YET_AVAILABLE_MESSAGE };
	}
	const paid = input.listing !== null && input.listing.status === 'listed' && input.listing.currentVersionId !== null;
	if (!paid) return { ok: false, status: 400, error: 'This site is free' };
	if (input.isCreator) return { ok: false, status: 400, error: 'You published this site' };
	if (input.hasPurchase) return { ok: false, status: 400, error: ALREADY_OWNED_MESSAGE };
	if (!input.sellerTransfersActive) return { ok: false, status: 409, error: SELLER_NOT_READY_MESSAGE };
	return { ok: true };
}

export function confirmDecision(
	session: StripeCheckoutSession,
	expected: { appId: string; userId: string },
): ConfirmDecision {
	if (session.metadata?.appId !== expected.appId || session.client_reference_id !== expected.userId) {
		return { ok: false, status: 403, error: 'This payment belongs to someone else' };
	}
	if (session.payment_status !== 'paid') return { ok: false, status: 409, error: PAYMENT_INCOMPLETE_MESSAGE };
	return { ok: true };
}
