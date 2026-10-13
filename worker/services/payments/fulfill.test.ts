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
	const listing = { exists: listingExists };
	const sessions = new Set<string>();
	const buyers = new Set<string>();
	const records: StripePurchaseRecord[] = [];
	const deps: FulfillDeps = {
		listingExists: async () => listing.exists,
		recordStripePurchase: async (record) => {
			const buyer = `${record.listingId}:${record.userId}`;
			if (sessions.has(record.checkoutSessionId) || buyers.has(buyer)) return false;
			sessions.add(record.checkoutSessionId);
			buyers.add(buyer);
			records.push(record);
			return true;
		},
		sessionRecorded: async (checkoutSessionId) => sessions.has(checkoutSessionId),
	};
	return { deps, records, listing };
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

	it('ignores unpaid sessions and sessions without our metadata', async () => {
		expect(await fulfillCheckoutSession(harness().deps, { ...PAID, payment_status: 'unpaid' })).toBe('not-paid');
		expect(await fulfillCheckoutSession(harness().deps, { ...PAID, metadata: {} })).toBe('not-ours');
	});

	it('flags a paid session whose listing was deleted after checkout', async () => {
		const { deps, records } = harness(false);
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('listing-missing');
		expect(records).toHaveLength(0);
	});

	it('treats a redelivered session as recorded after its listing is deleted', async () => {
		const { deps, records, listing } = harness();
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('recorded');
		listing.exists = false;
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('already-recorded');
		expect(records).toHaveLength(1);
	});

	it('flags a second paid session for a listing the buyer already owns', async () => {
		const { deps, records } = harness();
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('recorded');
		expect(await fulfillCheckoutSession(deps, { ...PAID, id: 'cs_2', payment_intent: 'pi_2' })).toBe('duplicate-purchase');
		expect(records).toHaveLength(1);
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
