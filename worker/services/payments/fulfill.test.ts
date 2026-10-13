import { describe, expect, it } from 'vitest';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';
import { fulfillCheckoutSession, isCheckoutSession, isStripeAccount, type FulfillDeps } from './fulfill';
import type { StripeCheckoutSession } from './stripe-client';

const PAID: StripeCheckoutSession = {
	id: 'cs_1',
	url: null,
	payment_status: 'paid',
	status: 'complete',
	client_reference_id: 'buyer1',
	metadata: { appId: 'app1', listingId: 'l1', versionId: 'v2', buyerUserId: 'buyer1', sellerStripeAccountId: 'acct_1' },
	amount_total: 2900,
	currency: 'usd',
	payment_intent: 'pi_1',
};

function harness(listingExists = true) {
	const sessions = new Set<string>();
	const records: StripePurchaseRecord[] = [];
	const deps: FulfillDeps = {
		listingExists: async () => listingExists,
		recordStripePurchase: async (record) => {
			if (sessions.has(record.checkoutSessionId)) return false;
			sessions.add(record.checkoutSessionId);
			records.push(record);
			return true;
		},
	};
	return { deps, records };
}

describe('fulfillCheckoutSession', () => {
	it('records the price, the 5% fee and the seller amount', async () => {
		const { deps, records } = harness();
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('recorded');
		expect(records).toEqual([
			{
				listingId: 'l1',
				sourceAppId: 'app1',
				versionId: 'v2',
				userId: 'buyer1',
				priceCents: 2900,
				platformFeeCents: 145,
				sellerAmountCents: 2755,
				currency: 'usd',
				checkoutSessionId: 'cs_1',
				paymentIntentId: 'pi_1',
				sellerStripeAccountId: 'acct_1',
			},
		]);
	});

	it('records a session once', async () => {
		const { deps, records } = harness();
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('recorded');
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('already-recorded');
		expect(records).toHaveLength(1);
	});

	it('ignores unpaid sessions, foreign sessions and deleted listings', async () => {
		expect(await fulfillCheckoutSession(harness().deps, { ...PAID, payment_status: 'unpaid' })).toBe('not-paid');
		expect(await fulfillCheckoutSession(harness().deps, { ...PAID, metadata: {} })).toBe('not-ours');
		expect(await fulfillCheckoutSession(harness(false).deps, PAID)).toBe('not-ours');
	});
});

describe('type guards', () => {
	it('recognizes Checkout sessions and accounts in webhook payloads', () => {
		expect(isCheckoutSession(PAID)).toBe(true);
		expect(isCheckoutSession({ id: 'cs_1' })).toBe(false);
		expect(isStripeAccount({ id: 'acct_1', details_submitted: true, charges_enabled: true, payouts_enabled: true })).toBe(true);
		expect(isStripeAccount({ id: 'acct_1' })).toBe(false);
	});
});
