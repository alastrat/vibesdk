import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertApp, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { SellerOrdersController } from './controller';
import { StoreOrdersController } from '../stores/controller';
import { ShopperEmailsController } from '../shopperEmails/controller';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
const later: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void later.push(p) } as ExecutionContext;
const context = (plan: string, params: Record<string, string> = {}): RouteContext =>
	({ user: { id: `pc_${plan}`, email: `pc_${plan}@example.test` }, pathParams: params }) as RouteContext;
const body = (data: unknown) => new Request('https://estori.app/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const env = () => envWith(db, { BILLING: 'on' });
const template = { enabled: true, subject: 'Premium custom subject', heading: 'Our brand', body: 'Custom message' };

beforeAll(async () => {
	db = await migratedD1();
	for (const plan of ['basic', 'pro', 'premium'] as const) {
		await insertUser(db, `pc_${plan}`, { emailVerified: true });
		await insertApp(db, { id: `pc_app_${plan}`, userId: `pc_${plan}` });
		if (plan !== 'basic')
			await insertSubscription(db, {
				userId: `pc_${plan}`,
				stripeSubscriptionId: `sub_pc_${plan}`,
				plan,
				status: 'active',
				currentPeriodStart: new Date(Date.now() - 60000),
				currentPeriodEnd: new Date(Date.now() + 86400000 * 30),
			});
		await db
			.prepare(
				`INSERT INTO store_orders (id,mode,app_id,order_number,checkout_id,seller_user_id,subtotal_cents,shipping_cents,total_cents,application_fee_cents,created_at,updated_at) VALUES (?,'live',?,1,?,?,1000,0,1000,100,0,0)`,
			)
			.bind(`pc_order_${plan}`, `pc_app_${plan}`, `pc_checkout_${plan}`, `pc_${plan}`)
			.run();
		await db
			.prepare(`INSERT INTO store_order_items (order_id,line_no,kind,product_id,variant_id,name,quantity,unit_price_cents) VALUES (?,1,'own','tea','tea-1','Tea',1,1000)`)
			.bind(`pc_order_${plan}`)
			.run();
	}
});
afterEach(() => vi.restoreAllMocks());
const check = (run: () => Promise<void>) => async () => {
	try {
		await run();
	} finally {
		await Promise.all(later.splice(0));
	}
};

describe('Premium commerce permissions', () => {
	it(
		'refuses Basic and Pro tracking writes before changing the order, while ordinary shipping still works',
		check(async () => {
			expect(
				(await SellerOrdersController.shipment(body({ shipped: true, carrier: 'ups', trackingNumber: '1Z123' }), env(), ctx, context('basic', { id: 'missing' }))).status,
			).toBe(404);
			expect(
				(await SellerOrdersController.shipment(body({ shipped: true, carrier: 'ups', trackingNumber: '1Z123' }), env(), ctx, context('basic', { id: 'pc_order_premium' })))
					.status,
			).toBe(404);
			for (const plan of ['basic', 'pro']) {
				const target = context(plan, { id: `pc_order_${plan}` });
				const refused = await SellerOrdersController.shipment(body({ shipped: true, carrier: 'ups', trackingNumber: '1Z123' }), env(), ctx, target);
				expect(refused.status).toBe(402);
				expect(await refused.json()).toMatchObject({ error: { planLimit: { limit: 'shipmentTracking', upgradeTo: 'premium' } } });
				expect(await db.prepare('SELECT tracking_number,shipped_at FROM store_orders WHERE id=?').bind(`pc_order_${plan}`).first()).toEqual({
					tracking_number: null,
					shipped_at: null,
				});
				expect((await SellerOrdersController.shipment(body({ shipped: true }), env(), ctx, target)).status).toBe(200);
			}
		}),
	);
	it(
		'allows Premium tracking and refuses refunds through both seller entry points on lower plans without calling Stripe',
		check(async () => {
			expect(
				(
					await SellerOrdersController.shipment(
						body({ shipped: true, carrier: 'ups', trackingNumber: '1Z123' }),
						env(),
						ctx,
						context('premium', { id: 'pc_order_premium' }),
					)
				).status,
			).toBe(200);
			const fetchSpy = vi.spyOn(globalThis, 'fetch');
			for (const plan of ['basic', 'pro']) {
				const request = { lineNos: [1], requestId: crypto.randomUUID() };
				const responses = [
					await SellerOrdersController.refund(body(request), env(), ctx, context(plan, { id: `pc_order_${plan}` })),
					await StoreOrdersController.refund(body(request), env(), ctx, context(plan, { id: `pc_app_${plan}`, orderId: `pc_order_${plan}` })),
				];
				for (const response of responses) {
					expect(response.status).toBe(402);
					expect(await response.json()).toMatchObject({ error: { planLimit: { limit: 'orderRefunds', upgradeTo: 'premium' } } });
				}
			}
			expect(fetchSpy).not.toHaveBeenCalled();
			// Premium reaches the normal Stripe configuration check rather than an entitlement refusal.
			expect(
				(await SellerOrdersController.refund(body({ lineNos: [1], requestId: crypto.randomUUID() }), env(), ctx, context('premium', { id: 'pc_order_premium' }))).status,
			).toBe(400);
		}),
	);
	it(
		'blocks Pro template, reset and reply-to writes, but allows preview and self-test with the default wording',
		check(async () => {
			const target = context('pro', { id: 'pc_app_pro', kind: 'order_confirmation' });
			for (const response of [
				await ShopperEmailsController.saveTemplate(body(template), env(), ctx, target),
				await ShopperEmailsController.resetTemplate(body({}), env(), ctx, target),
				await ShopperEmailsController.saveSettings(body({ replyTo: 'custom@example.test' }), env(), ctx, target),
			]) {
				expect(response.status).toBe(402);
				expect(await response.json()).toMatchObject({ error: { planLimit: { limit: 'customShopperEmails', upgradeTo: 'premium' } } });
			}
			const basicPreview = await ShopperEmailsController.preview(body(template), env(), ctx, context('basic', { id: 'pc_app_basic', kind: 'order_confirmation' }));
			expect(basicPreview.status).toBe(402);
			expect(await basicPreview.json()).toMatchObject({ error: { planLimit: { limit: 'shopperEmails', upgradeTo: 'pro' } } });
			expect((await ShopperEmailsController.preview(body(template), env(), ctx, target)).status).toBe(200);
			const sent: Array<{ subject: string; to: string }> = [];
			const testEnv = envWith(db, {
				BILLING: 'on',
				EMAIL: {
					send: async (email: { subject: string; to: string }) => {
						sent.push(email);
						return { messageId: 'test_pc' };
					},
				},
				VibecoderStore: { get: async () => null, put: async () => undefined },
			});
			expect((await ShopperEmailsController.test(body(template), testEnv, ctx, target)).status).toBe(200);
			expect(sent[0].to).toBe('pc_pro@example.test');
			expect(sent[0].subject).not.toContain('Premium custom subject');
		}),
	);
	it(
		'allows Premium customization and hides saved wording and reply-to after a downgrade without deleting it',
		check(async () => {
			const target = context('premium', { id: 'pc_app_premium', kind: 'order_confirmation' });
			expect((await ShopperEmailsController.saveTemplate(body(template), env(), ctx, target)).status).toBe(200);
			expect((await ShopperEmailsController.saveSettings(body({ replyTo: 'premium@example.test' }), env(), ctx, target)).status).toBe(200);
			await db.prepare("UPDATE subscriptions SET plan='pro' WHERE user_id='pc_premium'").run();
			const response = await ShopperEmailsController.read(new Request('https://estori.app'), env(), ctx, target);
			expect(await response.json()).toMatchObject({
				data: { replyTo: null, templates: expect.arrayContaining([expect.objectContaining({ kind: 'order_confirmation', edited: false })]) },
			});
			expect(await db.prepare('SELECT subject FROM shopper_email_templates WHERE app_id=?').bind('pc_app_premium').first()).toMatchObject({
				subject: 'Premium custom subject',
			});
		}),
	);
});
