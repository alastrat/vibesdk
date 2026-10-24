import { describe, expect, it } from 'vitest';
import { NEW_ORDER_EMAILS_PER_DAY, newOrderNotifier, notifySellerOfNewOrder, type NewOrderEmailDeps } from './order-emails';
import type { OutgoingEmail } from '../email/types';
import type { StoreOrderView } from './store';

const ORDER: StoreOrderView = {
	id: 'ord_1', orderNumber: 1042, mode: 'live', appId: 'app_tea', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
	subtotalCents: 4599, shippingCents: 0, totalCents: 4599, applicationFeeCents: 460, currency: 'usd',
	customerEmail: 'ana@example.test', customerName: 'Ana Ruiz',
	shippingAddress: { name: 'Ana Ruiz', line1: '12 Elm St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null },
	note: 'Happy birthday,\n<b>Mom</b>!', needsAttention: null, stripeCheckoutSessionId: 'cs_1', stripePaymentIntentId: 'pi_1', sellerUserId: 'seller_1', sellerStripeAccountId: 'acct_1', refundedCents: 0, createdAt: new Date(0),
	items: [
		{ lineNo: 1, kind: 'own', productId: 'tea', variantId: 'tea-100', name: 'Oolong, 100 g', quantity: 2, unitPriceCents: 1500, catalogVariantId: null, lockedCatalogPriceCents: null },
		{ lineNo: 2, kind: 'catalog', productId: 'pot', variantId: 'pot-1', name: 'Glass teapot', quantity: 1, unitPriceCents: 1599, catalogVariantId: 'cv_1', lockedCatalogPriceCents: 800 },
	],
};

function world(input: { order?: StoreOrderView; sellerEmail?: string | null; storeTitle?: string | null; now?: Date; sentToday?: number } = {}) {
	const kv = new Map<string, { value: string; ttl: number }>();
	const now = input.now ?? new Date('2026-10-18T23:59:00Z');
	if (input.sentToday) kv.set(`seller-order-emails:seller_1:${now.toISOString().slice(0, 10)}`, { value: String(input.sentToday), ttl: 0 });
	const sent: OutgoingEmail[] = [];
	const deps: NewOrderEmailDeps = {
		order: async () => input.order ?? ORDER,
		facts: async () => ({ storeTitle: input.storeTitle === undefined ? 'Northwind Tea' : input.storeTitle, sellerEmail: input.sellerEmail === undefined ? 'seller@example.test' : input.sellerEmail }),
		sender: { send: async (email) => void sent.push(email) },
		counter: { get: async (key) => kv.get(key)?.value ?? null, put: async (key, value, options) => void kv.set(key, { value, ttl: options.expirationTtl }) },
		baseUrl: 'https://estori.app',
		now: () => now,
	};
	return { deps, sent, kv };
}

describe('the new-order email', () => {
	it('never asks sellers to ship snapshot-identified digital items', async () => {
  const {deps, sent} = world({order: {...ORDER, shippingAddress: null, items: [ORDER.items[0]]}});
  deps.facts = async () => ({storeTitle: 'Store', sellerEmail: 'seller@example.test', digitalLineNos: [1]});
  expect(await notifySellerOfNewOrder(deps, 'ord_1')).toBe('sent');
  expect(sent[0].text).toContain('2 × Oolong, 100 g');
  expect(sent[0].text).not.toContain('Ship these items');
  expect(sent[0].text).not.toContain('Ship to:');
 });
	it('tells the seller what was sold, their share, where it ships, the note, and what to ship themselves', async () => {
		const { deps, sent } = world();
		expect(await notifySellerOfNewOrder(deps, 'ord_1')).toBe('sent');
		const [email] = sent;
		expect(email.to).toBe('seller@example.test');
		expect(email.subject).toBe('New order #1042 at Northwind Tea: $45.99');
		expect(email.text).toContain('2 × Oolong, 100 g');
		expect(email.text).toContain('1 × Glass teapot');
		expect(email.text).toContain('Your share: $41.39');
		expect(email.text).toContain('Ship to: Ana Ruiz, Austin, TX, US');
		expect(email.text).not.toContain('12 Elm St');
		expect(email.text).toContain('Ship these items: Oolong, 100 g.');
		expect(email.text).toContain("Estori ships Glass teapot. You don't need to do anything for these.");
		expect(email.text).toContain('Open the order: https://estori.app/orders/ord_1');
		expect(email.html).toContain('Happy birthday,\n&lt;b&gt;Mom&lt;/b&gt;!');
	});

	it('marks a test order and says nothing ships', async () => {
		const { deps, sent } = world({ order: { ...ORDER, mode: 'test' } });
		await notifySellerOfNewOrder(deps, 'ord_1');
		expect(sent[0].subject).toBe('[Test] New order #1042 at Northwind Tea: $45.99');
		expect(sent[0].text).toContain('This was a test order. No money was charged and nothing ships.');
		expect(sent[0].text).not.toContain('Ship these items');
		expect(sent[0].text).not.toContain('Estori ships');
	});

	it('names "your store" when the store is gone, and sends nothing to a seller without an email', async () => {
		const gone = world({ storeTitle: null });
		await notifySellerOfNewOrder(gone.deps, 'ord_1');
		expect(gone.sent[0].subject).toBe('New order #1042 at your store: $45.99');
		const noEmail = world({ sellerEmail: null });
		expect(await notifySellerOfNewOrder(noEmail.deps, 'ord_1')).toBe('not-sent');
		expect(noEmail.sent).toHaveLength(0);
	});

	it(`sends at most ${NEW_ORDER_EMAILS_PER_DAY} a UTC day per seller, counted for two days`, async () => {
		const capped = world({ sentToday: NEW_ORDER_EMAILS_PER_DAY });
		expect(await notifySellerOfNewOrder(capped.deps, 'ord_1')).toBe('capped');
		expect(capped.sent).toHaveLength(0);
		const lastMinute = world({ now: new Date('2026-10-18T23:59:00Z') });
		await notifySellerOfNewOrder(lastMinute.deps, 'ord_1');
		expect(lastMinute.kv.get('seller-order-emails:seller_1:2026-10-18')).toEqual({ value: '1', ttl: 2 * 24 * 60 * 60 });
	});

	it('never throws to the order it is about, when the send or a lookup fails', async () => {
		const failing = world();
		const notify = newOrderNotifier({ ...failing.deps, sender: { send: async () => { throw new Error('E_DAILY_LIMIT_EXCEEDED'); } } });
		await expect(notify('ord_1')).resolves.toBeUndefined();
		const lost = newOrderNotifier({ ...failing.deps, order: async () => { throw new Error('D1_ERROR'); } });
		await expect(lost('ord_1')).resolves.toBeUndefined();
	});
});

