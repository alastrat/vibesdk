import { describe, expect, it } from 'vitest';
import { checkoutDecision, confirmDecision, confirmResponse, type CheckoutInput } from './checkout';
import { ALREADY_OWNED_MESSAGE, PAYMENT_INCOMPLETE_MESSAGE, SELLER_NOT_READY_MESSAGE } from './config';
import { SITE_NOT_YET_AVAILABLE_MESSAGE, SITE_UNAVAILABLE_MESSAGE } from '../templates/reuse';
import type { StripeCheckoutSession } from './stripe-client';

const READY: CheckoutInput = {
	appPublic: true,
	removed: false,
	listing: { status: 'listed', currentVersionId: 'v2', priceCents: 2900 },
	isCreator: false,
	hasPurchase: false,
	sellerTransfersActive: true,
};

describe('checkoutDecision', () => {
	it('lets a buyer pay for an approved paid site', () => {
		expect(checkoutDecision(READY)).toEqual({ ok: true });
	});

	it('refuses hidden, free, not-yet-approved, own and already-owned sites', () => {
		expect(checkoutDecision({ ...READY, appPublic: false })).toEqual({ ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE });
		expect(checkoutDecision({ ...READY, removed: true })).toEqual({ ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE });
		expect(checkoutDecision({ ...READY, listing: null })).toEqual({ ok: false, status: 400, error: 'This site is free' });
		expect(checkoutDecision({ ...READY, listing: { status: 'listed', currentVersionId: null, priceCents: 0 } })).toEqual({
			ok: false,
			status: 409,
			error: SITE_NOT_YET_AVAILABLE_MESSAGE,
		});
		expect(checkoutDecision({ ...READY, listing: { status: 'unlisted', currentVersionId: 'v1', priceCents: 2900 } })).toEqual({
			ok: false,
			status: 400,
			error: 'This site is free',
		});
		expect(checkoutDecision({ ...READY, isCreator: true })).toEqual({ ok: false, status: 400, error: 'You published this site' });
		expect(checkoutDecision({ ...READY, hasPurchase: true })).toEqual({ ok: false, status: 400, error: ALREADY_OWNED_MESSAGE });
	});

	it('refuses checkout when the seller cannot receive transfers', () => {
		expect(checkoutDecision({ ...READY, sellerTransfersActive: false })).toEqual({
			ok: false,
			status: 409,
			error: SELLER_NOT_READY_MESSAGE,
		});
	});
});

describe('confirmDecision', () => {
	const session: StripeCheckoutSession = {
		id: 'cs_1',
		url: null,
		payment_status: 'paid',
		status: 'complete',
		client_reference_id: 'buyer1',
		metadata: { appId: 'app1' },
		amount_total: 2900,
		currency: 'usd',
		payment_intent: 'pi_1',
	};

	it('confirms the buyer own paid session', () => {
		expect(confirmDecision(session, { appId: 'app1', userId: 'buyer1' })).toEqual({ ok: true });
	});

	it('refuses a session that belongs to another buyer or site', () => {
		const forbidden = { ok: false, status: 403, error: 'This payment belongs to someone else' };
		expect(confirmDecision(session, { appId: 'app1', userId: 'someone' })).toEqual(forbidden);
		expect(confirmDecision(session, { appId: 'app2', userId: 'buyer1' })).toEqual(forbidden);
	});

	it('waits for an unpaid session', () => {
		expect(confirmDecision({ ...session, payment_status: 'unpaid' }, { appId: 'app1', userId: 'buyer1' })).toEqual({
			ok: false,
			status: 409,
			error: PAYMENT_INCOMPLETE_MESSAGE,
		});
	});
});

describe('confirmResponse', () => {
	it('confirms a recorded or already recorded purchase', () => {
		expect(confirmResponse('recorded')).toEqual({ ok: true });
		expect(confirmResponse('already-recorded')).toEqual({ ok: true });
	});

	it('confirms a duplicate payment, because the buyer already owns the site', () => {
		expect(confirmResponse('duplicate-purchase')).toEqual({ ok: true });
	});

	it('reports a deleted listing as unavailable', () => {
		expect(confirmResponse('listing-missing')).toEqual({ ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE });
	});

	it('does not confirm a session that recorded nothing', () => {
		const incomplete = { ok: false, status: 409, error: PAYMENT_INCOMPLETE_MESSAGE };
		expect(confirmResponse('not-ours')).toEqual(incomplete);
		expect(confirmResponse('not-paid')).toEqual(incomplete);
	});
});
