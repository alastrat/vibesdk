import { describe, expect, it } from 'vitest';
import { MAX_SEND_ATTEMPTS, SEND_BACKOFF_MS, STORE_DAILY_EMAIL_CAP, queueShopperEmail, sendDueShopperEmails, type ShopperEmailDeps, type ShopperEmailEvent } from './outbox';
import type { ShopperEmailRow } from '../../database/services/ShopperEmailService';
import type { OutgoingEmail } from '../email/types';
import type { StoreOrderView } from '../store-payments/store';
import type { ShopperEmailTemplate } from '../../../shared/types/shopper-emails';

const NOW = new Date('2026-10-18T12:00:00Z');
const ORDER: StoreOrderView = {
	id: 'ord_1', orderNumber: 1042, mode: 'live', appId: 'app_tea', paymentStatus: 'paid', fulfillmentStatus: 'unfulfilled',
	subtotalCents: 4599, shippingCents: 0, totalCents: 4599, applicationFeeCents: 460, currency: 'usd',
	customerEmail: 'ana@example.test', customerName: 'Ana Ruiz',
	shippingAddress: { name: 'Ana Ruiz', line1: '12 Elm St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null },
	note: null, needsAttention: null, stripeCheckoutSessionId: 'cs_1', stripePaymentIntentId: 'pi_1', sellerUserId: 'seller_1', sellerStripeAccountId: 'acct_1', refundedCents: 0, createdAt: new Date(0),
	items: [
		{ lineNo: 1, kind: 'own', productId: 'tea', variantId: 'tea-100', name: 'Oolong', quantity: 2, unitPriceCents: 1500, catalogVariantId: null, lockedCatalogPriceCents: null },
		{ lineNo: 2, kind: 'catalog', productId: 'pot', variantId: 'pot-1', name: 'Glass teapot', quantity: 1, unitPriceCents: 1599, catalogVariantId: 'cv_1', lockedCatalogPriceCents: 800 },
	],
};
const CONFIRMATION: ShopperEmailEvent = { orderId: 'ord_1', kind: 'order_confirmation', eventKey: 'order', payload: {} };

function world(input: { order?: Partial<StoreOrderView>; template?: ShopperEmailTemplate; replyTo?: string | null; sellerEmail?: string | null; sentToday?: number; sendError?: unknown; attempts?: number; enqueueFails?: boolean } = {}) {
	const rows = new Map<string, ShopperEmailRow>();
	const sent: OutgoingEmail[] = [];
	const alerts: string[] = [];
	let ids = 0;
	let now = NOW;
	const deps: ShopperEmailDeps = {
		emails: {
			enqueue: async (row) => {
				if (input.enqueueFails) throw new Error('D1_ERROR: database is locked');
				if ([...rows.values()].some((existing) => existing.orderId === row.orderId && existing.kind === row.kind && existing.eventKey === row.eventKey)) return false;
				rows.set(row.id, { id: row.id, appId: row.appId, orderId: row.orderId, kind: row.kind, eventKey: row.eventKey, payload: row.payload, status: 'queued', test: false, recipient: null, attempts: input.attempts ?? 0, nextAttemptAt: row.now, messageId: null, error: null, createdAt: row.now, sentAt: null });
				return true;
			},
			claim: async (id, at, leaseUntil) => {
				const row = rows.get(id);
				if (!row || row.status !== 'queued' || row.nextAttemptAt > at) return null;
				const claimed = { ...row, attempts: row.attempts + 1, nextAttemptAt: leaseUntil };
				rows.set(id, claimed);
				return claimed;
			},
			finish: async (id, update) => {
				const row = rows.get(id);
				if (row) rows.set(id, { ...row, ...update, messageId: update.messageId ?? null, error: update.error ?? null, sentAt: update.sentAt ?? null });
			},
			retry: async (id, nextAttemptAt, error) => {
				const row = rows.get(id);
				if (row) rows.set(id, { ...row, nextAttemptAt, error });
			},
			due: async (at) => [...rows.values()].filter((row) => row.status === 'queued' && row.nextAttemptAt <= at).map((row) => row.id),
			templates: async () => new Map(input.template ? [['order_confirmation', input.template]] : []),
			replyTo: async () => input.replyTo ?? null,
			sentSince: async () => input.sentToday ?? 0,
		},
		order: async () => ({ ...ORDER, ...input.order }),
		store: async () => ({ title: 'Northwind Tea', sellerEmail: input.sellerEmail === undefined ? 'seller@example.test' : input.sellerEmail, storeUrl: 'https://northwind-tea.estori.shop' }),
		sender: {
			send: async (email) => {
				if (input.sendError) throw input.sendError;
				sent.push(email);
				return { messageId: 'msg_1' };
			},
		},
		fromEmail: 'orders@estori.app',
		alert: async (alert) => void alerts.push(alert.kind),
		now: () => now,
		newId: () => `em_${(ids += 1)}`,
	};
	return { deps, rows, sent, alerts, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

const coded = (code: string) => Object.assign(new Error(code), { code });

describe('the shopper email outbox', () => {
	it("sends an event's email once, to the shopper, from the store's name with its reply-to and headers", async () => {
		const { deps, rows, sent } = world({ replyTo: 'help@northwind.test' });
		await queueShopperEmail(deps, CONFIRMATION);
		await queueShopperEmail(deps, CONFIRMATION);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ to: 'ana@example.test', fromEmail: 'orders@estori.app', fromName: 'Northwind Tea', replyTo: 'help@northwind.test', headers: { 'X-Estori-Store': 'app_tea', 'X-Estori-Email': 'order_confirmation' } });
		expect(sent[0].subject).toBe('Your Northwind Tea order #1042');
		expect([...rows.values()][0]).toMatchObject({ status: 'sent', recipient: 'ana@example.test', messageId: 'msg_1', sentAt: NOW, test: false });
	});

	it("has replies reach the seller's account email when the store set no reply-to", async () => {
		const { deps, sent } = world();
		await queueShopperEmail(deps, CONFIRMATION);
		expect(sent[0].replyTo).toBe('seller@example.test');
	});

	it('sends a test order to the seller, marked as a test', async () => {
		const { deps, rows, sent } = world({ order: { mode: 'test' } });
		await queueShopperEmail(deps, CONFIRMATION);
		expect(sent[0].to).toBe('seller@example.test');
		expect(sent[0].subject).toBe('[Test] Your Northwind Tea order #1042');
		expect([...rows.values()][0]).toMatchObject({ status: 'sent', test: true });
	});

	it('sends nothing for a template the seller turned off, or past the store daily cap, which alerts', async () => {
		const off = world({ template: { enabled: false, subject: 'x', heading: 'x', body: '' } });
		await queueShopperEmail(off.deps, CONFIRMATION);
		expect(off.sent).toHaveLength(0);
		expect([...off.rows.values()][0].status).toBe('disabled');
		const capped = world({ sentToday: STORE_DAILY_EMAIL_CAP });
		await queueShopperEmail(capped.deps, CONFIRMATION);
		expect(capped.sent).toHaveLength(0);
		expect([...capped.rows.values()][0].status).toBe('capped');
		expect(capped.alerts).toEqual(['shopper-email-capped']);
	});

	it('stops for a suppressed address, and fails readably for an order without an email', async () => {
		const suppressed = world({ sendError: coded('E_RECIPIENT_SUPPRESSED') });
		await queueShopperEmail(suppressed.deps, CONFIRMATION);
		expect([...suppressed.rows.values()][0].status).toBe('suppressed');
		const noEmail = world({ order: { customerEmail: null } });
		await queueShopperEmail(noEmail.deps, CONFIRMATION);
		expect([...noEmail.rows.values()][0]).toMatchObject({ status: 'failed', error: 'The order has no email address' });
	});

	it(`waits and tries again when Cloudflare defers it, and gives up with an alert on attempt ${MAX_SEND_ATTEMPTS}`, async () => {
		const deferred = world({ sendError: coded('E_RATE_LIMIT_EXCEEDED') });
		await queueShopperEmail(deferred.deps, CONFIRMATION);
		expect([...deferred.rows.values()][0]).toMatchObject({ status: 'queued', attempts: 1, nextAttemptAt: new Date(NOW.getTime() + SEND_BACKOFF_MS[0]), error: 'E_RATE_LIMIT_EXCEEDED' });
		const last = world({ sendError: coded('E_DAILY_LIMIT_EXCEEDED'), attempts: MAX_SEND_ATTEMPTS - 1 });
		await queueShopperEmail(last.deps, CONFIRMATION);
		expect([...last.rows.values()][0]).toMatchObject({ status: 'failed', attempts: MAX_SEND_ATTEMPTS });
		expect(last.alerts).toEqual(['shopper-email-failed']);
	});

	it("tells about only a shipment's own items, with its carrier and tracking", async () => {
		const { deps, sent } = world();
		await queueShopperEmail(deps, { orderId: 'ord_1', kind: 'order_shipped', eventKey: 'catalog:SD1', payload: { catalogVariantIds: ['cv_1'], carrier: 'USPS', trackingNumber: '9400 1' } });
		expect(sent[0].text).toContain('1 × Glass teapot');
		expect(sent[0].text).not.toContain('Oolong');
		expect(sent[0].text).toContain('Tracking: 9400 1');
	});

	it('never throws to the operation that raised the event', async () => {
		const { deps } = world({ enqueueFails: true });
		await expect(queueShopperEmail(deps, CONFIRMATION)).resolves.toBeUndefined();
	});

	it('sends the emails that came due on the schedule, and skips those still waiting', async () => {
		const deferred = world({ sendError: coded('E_RATE_LIMIT_EXCEEDED') });
		await queueShopperEmail(deferred.deps, CONFIRMATION);
		expect(await sendDueShopperEmails(deferred.deps, 100)).toBe(0);
		deferred.advance(SEND_BACKOFF_MS[0]);
		expect(await sendDueShopperEmails(deferred.deps, 100)).toBe(1);
		expect([...deferred.rows.values()][0].attempts).toBe(2);
	});
});
