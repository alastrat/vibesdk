/**
 * Shopper emails on real SQL: a store's templates and reply-to setting, and the outbox that sends each order event's
 * email once. Each test's writes are rolled back after it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { ShopperEmailService } from './ShopperEmailService';

const NOW = new Date(1_800_000_000_000);
const MINUTE = 60 * 1000;
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertUser(db, 'seller_2');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
	await insertApp(db, { id: 'app_home', userId: 'seller_1', title: 'Lumen Home' });
	await insertApp(db, { id: 'app_draft', userId: 'seller_1', title: 'Draft Idea' });
	await insertApp(db, { id: 'app_other', userId: 'seller_2', title: 'Other Shop' });
	await db.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_tea', 'northwind-tea', 'live', 'c1', 0, 0, 0)`).run();
	await db
		.prepare(`INSERT INTO store_orders (id, mode, app_id, order_number, checkout_id, seller_user_id, stripe_checkout_session_id, subtotal_cents, shipping_cents, total_cents, application_fee_cents, created_at, updated_at) VALUES ('ord_home', 'live', 'app_home', 7, 'chk_home', 'seller_1', 'cs_home', 2000, 0, 2000, 200, ?, ?)`)
		.bind(seconds(NOW), seconds(NOW))
		.run();
});

const service = () => new ShopperEmailService(envWith(db));
const queue = (id: string, eventKey = 'order', orderId = 'ord_home', at = NOW) => service().enqueue({ id, appId: 'app_home', orderId, kind: 'order_confirmation', eventKey, payload: { lineNos: [1] }, now: at });

describe('shopper email templates and settings on real SQL', () => {
	it('saves a template, reads it back, and resets it to the default by forgetting it', async () => {
		await service().saveTemplate('app_tea', 'order_shipped', { enabled: false, subject: 'Shipped', heading: 'On its way', body: 'Soon.' }, NOW);
		await service().saveTemplate('app_tea', 'order_shipped', { enabled: true, subject: 'Shipped!', heading: 'On its way', body: 'Soon.' }, NOW);
		expect([...(await service().templates('app_tea')).entries()]).toEqual([['order_shipped', { enabled: true, subject: 'Shipped!', heading: 'On its way', body: 'Soon.' }]]);
		await service().resetTemplate('app_tea', 'order_shipped', NOW);
		expect((await service().templates('app_tea')).size).toBe(0);
	});

	it('keeps where shoppers replies go, or null for the seller account email', async () => {
		expect(await service().replyTo('app_tea')).toBeNull();
		await service().saveReplyTo('app_tea', 'help@northwind.test', NOW);
		await service().saveReplyTo('app_tea', 'orders@northwind.test', NOW);
		expect(await service().replyTo('app_tea')).toBe('orders@northwind.test');
	});

	it("lists a seller's stores: apps with a live store or an order, not drafts or other sellers' apps", async () => {
		expect(await service().storesOf('seller_1')).toEqual([
			{ appId: 'app_home', title: 'Lumen Home' },
			{ appId: 'app_tea', title: 'Northwind Tea' },
		]);
	});
});

describe('the shopper email outbox on real SQL', () => {
	it('queues an event once, so a repeated event writes nothing', async () => {
		expect(await queue('em_1')).toBe(true);
		expect(await queue('em_2')).toBe(false);
		expect(await queue('em_3', 'own')).toBe(true);
	});

	it('lets one run claim a due email, holds it until the lease ends, and retries it later', async () => {
		await queue('em_1');
		const claimed = await service().claim('em_1', NOW, new Date(NOW.getTime() + 15 * MINUTE));
		expect(claimed).toMatchObject({ id: 'em_1', attempts: 1, status: 'queued', payload: { lineNos: [1] } });
		expect(await service().claim('em_1', NOW, new Date(NOW.getTime() + 15 * MINUTE))).toBeNull();
		await service().retry('em_1', new Date(NOW.getTime() + 60 * MINUTE), 'E_RATE_LIMIT_EXCEEDED');
		expect(await service().due(new Date(NOW.getTime() + 30 * MINUTE), 10)).toEqual([]);
		expect(await service().due(new Date(NOW.getTime() + 61 * MINUTE), 10)).toEqual(['em_1']);
		expect(await service().claim('em_1', new Date(NOW.getTime() + 61 * MINUTE), new Date(NOW.getTime() + 76 * MINUTE))).toMatchObject({ attempts: 2, error: 'E_RATE_LIMIT_EXCEEDED' });
	});

	it('records how a send ended, counts what a store sent today, and lists recent emails newest first with the order number', async () => {
		await queue('em_1', 'order', 'ord_home', new Date(NOW.getTime() - 2 * MINUTE));
		await queue('em_2', 'own', 'ord_home', new Date(NOW.getTime() - MINUTE));
		await service().finish('em_1', { status: 'sent', recipient: 'ana@example.test', test: false, messageId: 'msg_1', sentAt: NOW });
		await service().finish('em_2', { status: 'suppressed', recipient: 'ana@example.test', test: false, error: 'E_RECIPIENT_SUPPRESSED' });
		expect(await service().sentSince('app_home', new Date(NOW.getTime() - 60 * MINUTE))).toBe(1);
		expect(await service().sentSince('app_home', new Date(NOW.getTime() + MINUTE))).toBe(0);
		const recent = await service().recent('app_home', 10);
		expect(recent.map((email) => [email.id, email.status, email.orderNumber])).toEqual([
			['em_2', 'suppressed', 7],
			['em_1', 'sent', 7],
		]);
		expect(recent[1]).toMatchObject({ messageId: 'msg_1', recipient: 'ana@example.test', sentAt: NOW });
		expect(await service().due(NOW, 10)).toEqual([]);
	});

	it('forgets emails older than the cutoff', async () => {
		await queue('em_old', 'order', 'ord_home', new Date(NOW.getTime() - 100 * 24 * 60 * MINUTE));
		await queue('em_new', 'own', 'ord_home', NOW);
		await service().prune(new Date(NOW.getTime() - 90 * 24 * 60 * MINUTE));
		expect((await service().recent('app_home', 10)).map((email) => email.id)).toEqual(['em_new']);
	});
});

describe("a store's facts for its shopper emails on real SQL", () => {
	it("reads the store's title, its seller's email and its slug while it's live", async () => {
		expect(await service().storeFacts('app_tea')).toEqual({ title: 'Northwind Tea', sellerEmail: 'seller_1@example.test', sellerEmailConfirmed: false, liveSlug: 'northwind-tea' });
		await db.prepare(`UPDATE users SET email_verified = 1 WHERE id = 'seller_1'`).run();
		expect(await service().storeFacts('app_home')).toEqual({ title: 'Lumen Home', sellerEmail: 'seller_1@example.test', sellerEmailConfirmed: true, liveSlug: null });
		await db.prepare(`UPDATE live_stores SET status = 'offline' WHERE app_id = 'app_tea'`).run();
		expect((await service().storeFacts('app_tea'))?.liveSlug).toBeNull();
		expect(await service().storeFacts('app_gone')).toBeNull();
	});
});

describe('what the outbox still owes a shopper, from the order records, on real SQL', () => {
	const at = (offsetMs: number) => seconds(new Date(NOW.getTime() + offsetMs));
	const refund = (lineNo: number, stripeRefundId: string | null, amountCents: number, createdAt = at(-20 * MINUTE), orderId = 'ord_home') =>
		db
			.prepare(`INSERT INTO store_refunds (id, order_id, line_no, amount_cents, request_id, initiated_by, stripe_refund_id, created_at) VALUES (?, ?, ?, ?, 'req_00000001', 'seller', ?, ?)`)
			.bind(`sr_${orderId}_${lineNo}`, orderId, lineNo, amountCents, stripeRefundId, createdAt)
			.run();
	const email = (kind: string, eventKey: string, payload: object, orderId = 'ord_home') =>
		service().enqueue({ id: `em_${kind}_${eventKey}`, appId: 'app_home', orderId, kind: kind as 'refund_issued', eventKey, payload, now: NOW });
	const shipCatalog = async () => {
		await db
			.prepare(`INSERT INTO catalog_orders (id, seller_user_id, store_app_id, stripe_checkout_session_id, stripe_payment_intent_id, total_cents, catalog_total_cents, application_fee_cents, destination_country, shipping_address, created_at, updated_at) VALUES ('co_1', 'seller_1', 'app_home', 'cs_home', 'pi_home', 2000, 800, 200, 'US', '{}', 0, 0)`)
			.run();
		const item = (id: string, variant: string, status: string, supplierOrderId: string | null, tracking: string | null, carrier: string | null) =>
			db
				.prepare(`INSERT INTO catalog_order_items (id, order_id, catalog_variant_id, supplier, supplier_variant_id, quantity, unit_price_cents, catalog_price_cents, status, supplier_order_id, tracking_number, carrier, updated_at) VALUES (?, 'co_1', ?, 'cjdropshipping', ?, 1, 1000, 400, ?, ?, ?, ?, ?)`)
				.bind(id, variant, `sv_${variant}`, status, supplierOrderId, tracking, carrier, at(-5 * MINUTE))
				.run();
		await item('ci_1', 'cv_lamp', 'shipped', 'SD1', 'T1', 'USPS');
		await item('ci_2', 'cv_mug', 'delivered', 'SD1', 'T1', 'USPS');
		await item('ci_3', 'cv_cap', 'placed', 'SD2', null, null);
		await item('ci_4', 'cv_hat', 'shipped', 'SD3', 'T3', 'UPS');
	};

	it('lists the refunded lines no refund email has named yet, leaving out a refund Stripe never made', async () => {
		await refund(1, 're_1', 1500);
		await refund(2, 're_2', 1000);
		await refund(3, null, 700);
		expect(await service().refundsToEmail('ord_home')).toEqual([
			{ lineNo: 1, amountCents: 1500 },
			{ lineNo: 2, amountCents: 1000 },
		]);
		await email('refund_issued', 'catalog:re_1', { lineNos: [1], amountCents: 1500 });
		expect(await service().refundsToEmail('ord_home')).toEqual([{ lineNo: 2, amountCents: 1000 }]);
	});

	it("groups the order's catalog shipments with tracking by supplier order, leaving out ones already emailed", async () => {
		await shipCatalog();
		expect(await service().catalogShipmentsToEmail('ord_home')).toEqual([
			{ supplierOrderId: 'SD1', carrier: 'USPS', trackingNumber: 'T1', catalogVariantIds: ['cv_lamp', 'cv_mug'] },
			{ supplierOrderId: 'SD3', carrier: 'UPS', trackingNumber: 'T3', catalogVariantIds: ['cv_hat'] },
		]);
		await email('order_shipped', 'catalog:SD1', {});
		expect((await service().catalogShipmentsToEmail('ord_home')).map((shipment) => shipment.supplierOrderId)).toEqual(['SD3']);
	});

	it('finds orders owed a refund or shipment email, only among orders whose confirmation the outbox wrote, and only settled refunds', async () => {
		await refund(2, 're_2', 1000);
		await shipCatalog();
		const since = new Date(NOW.getTime() - 7 * 24 * 60 * MINUTE);
		const settled = new Date(NOW.getTime() - 10 * MINUTE);
		// No confirmation yet: an order from before shopper emails, which the sweep leaves alone.
		expect(await service().ordersWithRefundsToEmail(since, settled, 10)).toEqual([]);
		expect(await service().ordersWithShipmentsToEmail(since, 10)).toEqual([]);
		await email('order_confirmation', 'order', {});
		expect(await service().ordersWithRefundsToEmail(since, settled, 10)).toEqual(['ord_home']);
		expect(await service().ordersWithRefundsToEmail(since, new Date(NOW.getTime() - 30 * MINUTE), 10)).toEqual([]);
		expect(await service().ordersWithShipmentsToEmail(since, 10)).toEqual(['ord_home']);
		await email('refund_issued', 'lines:2', { lineNos: [2], amountCents: 1000 });
		await email('order_shipped', 'catalog:SD1', {});
		await email('order_shipped', 'catalog:SD3', {});
		expect(await service().ordersWithRefundsToEmail(since, settled, 10)).toEqual([]);
		expect(await service().ordersWithShipmentsToEmail(since, 10)).toEqual([]);
	});
});
