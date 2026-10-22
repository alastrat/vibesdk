/** The shopper emails API on real SQL: a seller's stores, and a store's templates, reply-to, previews and test sends. */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, insertSubscription, migratedD1 } from '../../../database/test-support/real-d1';
import { DEFAULT_SHOPPER_EMAIL_TEMPLATES, SHOPPER_EMAIL_PLACEHOLDERS } from '../../../../shared/types/shopper-emails';
import { shopperEmailDepsFromEnv } from '../../../services/shopper-emails/wiring';
import { queueShopperEmail } from '../../../services/shopper-emails/outbox';
import { ShopperEmailsController } from './controller';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
	await insertApp(db, { id: 'app_draft', userId: 'seller_1', title: 'Draft Idea' });
	await db.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_tea', 'northwind-tea', 'live', 'c1', 0, 0, 0)`).run();
	await db
		.prepare(`INSERT INTO store_orders (id, mode, app_id, order_number, checkout_id, seller_user_id, subtotal_cents, shipping_cents, total_cents, application_fee_cents, created_at, updated_at) VALUES ('ord_1', 'live', 'app_tea', 1, 'chk_1', 'seller_1', 2000, 0, 2000, 200, 0, 0)`)
		.run();
	await db
		.prepare(`INSERT INTO shopper_emails (id, app_id, order_id, kind, event_key, payload, status, test, recipient, attempts, next_attempt_at, created_at, sent_at) VALUES ('em_1', 'app_tea', 'ord_1', 'order_confirmation', 'order', '{}', 'sent', 0, 'ana@example.test', 1, 0, 100, 100)`)
		.run();
});

const as = (pathParams: Record<string, string> = {}) => ({ user: { id: 'seller_1', email: 'seller_1@example.test' }, pathParams }) as unknown as RouteContext;
const json = async (response: Response) => ({ status: response.status, body: (await response.json()) as { data?: Record<string, unknown>; error?: { message?: string } } });
const send = (method: string, body: unknown) => new Request('https://estori.app/api/stores/app_tea/emails', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const SHIPPED = { enabled: false, subject: 'Order {{order_number}} shipped', heading: 'On its way', body: 'Track it: {{ tracking_number }}' };

describe('the shopper emails API', () => {
	it("lists the seller's stores: those with a live store or an order", async () => {
		const answer = await json(await ShopperEmailsController.stores(new Request('https://estori.app/api/emails/stores'), envWith(db), {} as ExecutionContext, as()));
		expect(answer.body.data).toEqual({ stores: [{ appId: 'app_tea', title: 'Northwind Tea' }] });
	});

	it("reads a store's templates with Estori's defaults, the placeholders, where replies go and its recent emails, masked", async () => {
		const answer = await json(await ShopperEmailsController.read(new Request('https://estori.app/api/stores/app_tea/emails'), envWith(db), {} as ExecutionContext, as({ id: 'app_tea' })));
		const data = answer.body.data as Record<string, unknown>;
		expect((data.templates as Array<{ kind: string; edited: boolean; enabled: boolean }>).map((template) => [template.kind, template.edited, template.enabled])).toEqual([
			['order_confirmation', false, true],
			['order_shipped', false, true],
			['refund_issued', false, true],
		]);
		expect(data).toMatchObject({ placeholders: SHOPPER_EMAIL_PLACEHOLDERS, replyTo: null, sellerEmail: 'seller_1@example.test', senderEmail: 'no-reply@estori.app' });
		const onDomain = await json(await ShopperEmailsController.read(new Request('https://estori.app/api/stores/app_tea/emails'), envWith(db, { SHOPPER_EMAIL_FROM: 'no-reply@orders.estori.app' }), {} as ExecutionContext, as({ id: 'app_tea' })));
		expect(onDomain.body.data?.senderEmail).toBe('northwind-tea@orders.estori.app');
		expect(data.recent).toEqual([{ id: 'em_1', kind: 'order_confirmation', orderNumber: 1, recipient: 'a***@example.test', status: 'sent', test: false, createdAt: new Date(100_000).toISOString(), sentAt: new Date(100_000).toISOString() }]);
		const missing = await ShopperEmailsController.read(new Request('https://estori.app/api/stores/app_gone/emails'), envWith(db), {} as ExecutionContext, as({ id: 'app_gone' }));
		expect(missing.status).toBe(404);
	});

	it('keeps email history readable but refuses Basic customization before any write', async () => {
		const env = envWith(db, { BILLING: 'on' });
		const context = as({ id: 'app_tea', kind: 'order_shipped' });
		for (const response of [
			await ShopperEmailsController.saveTemplate(send('PUT', SHIPPED), env, {} as ExecutionContext, context),
			await ShopperEmailsController.resetTemplate(send('DELETE', {}), env, {} as ExecutionContext, context),
			await ShopperEmailsController.saveSettings(send('PUT', { replyTo: 'replies@example.test' }), env, {} as ExecutionContext, context),
		]) {
			expect(response.status).toBe(402);
			expect(await response.json()).toMatchObject({ error: { planLimit: { limit: 'customShopperEmails', upgradeTo: 'premium' } } });
		}
		expect((await ShopperEmailsController.read(new Request('https://estori.app/api/stores/app_tea/emails'), env, {} as ExecutionContext, context)).status).toBe(200);
	});

	it('skips every shopper email on Basic using the real billing account and outbox', async () => {
		const sent: unknown[] = [];
		const env = envWith(db, { BILLING: 'on', ENVIRONMENT: 'dev', SHOPPER_EMAIL_FROM: 'no-reply@orders.estori.app', EMAIL: { send: async (email: unknown) => { sent.push(email); return { messageId: 'unexpected' }; } } });
		const deps = shopperEmailDepsFromEnv(env);
		expect((await deps.access('seller_1')).canSend).toBe(false);
		expect((await shopperEmailDepsFromEnv(envWith(db)).access('seller_1')).canSend).toBe(true);
		await db.prepare("INSERT INTO store_orders (id, mode, app_id, order_number, checkout_id, seller_user_id, subtotal_cents, shipping_cents, total_cents, application_fee_cents, created_at, updated_at) VALUES ('ord_basic_gate', 'live', 'app_tea', 2, 'chk_basic_gate', 'seller_1', 2000, 0, 2000, 200, 0, 0)").run();
		for (const kind of ['order_confirmation', 'order_shipped', 'refund_issued'] as const) await queueShopperEmail(deps, { orderId: 'ord_basic_gate', kind, eventKey: 'plan-gate', payload: {} });
		expect(sent).toEqual([]);
		const rows = await db.prepare("SELECT kind, status FROM shopper_emails WHERE order_id = 'ord_basic_gate' ORDER BY kind").all();
		expect(rows.results).toEqual([{ kind: 'order_confirmation', status: 'disabled' }, { kind: 'order_shipped', status: 'disabled' }, { kind: 'refund_issued', status: 'disabled' }]);
		const read = await json(await ShopperEmailsController.read(new Request('https://estori.app/api/stores/app_tea/emails'), env, {} as ExecutionContext, as({ id: 'app_tea' })));
		expect(read.body.data?.senderEmail).toBe('no-reply@orders.estori.app');
		const test = await ShopperEmailsController.test(send('POST', SHIPPED), env, {} as ExecutionContext, as({ id: 'app_tea', kind: 'order_shipped' }));
		expect(test.status).toBe(402);
		expect(await test.json()).toMatchObject({ error: { planLimit: { limit: 'shopperEmails', upgradeTo: 'pro' } } });
		expect(sent).toEqual([]);
	});

	it('lets Premium customize emails while preserving saved settings after a downgrade', async () => {
		await insertUser(db, 'seller_custom_pro');
		await insertApp(db, { id: 'app_custom_pro', userId: 'seller_custom_pro', title: 'Pro Store' });
		const now = Date.now();
		await insertSubscription(db, { userId: 'seller_custom_pro', stripeSubscriptionId: 'sub_custom_pro', plan: 'premium', status: 'active', currentPeriodStart: new Date(now), currentPeriodEnd: new Date(now + 30 * 86_400_000) });
		const context = { ...as({ id: 'app_custom_pro', kind: 'order_shipped' }), user: { ...as().user!, id: 'seller_custom_pro' } };
		const delivered: Array<{ from: { email: string }; to: string }> = [];
		const env = envWith(db, { BILLING: 'on', SHOPPER_EMAIL_FROM: 'no-reply@orders.estori.app', EMAIL: { send: async (email: { from: { email: string }; to: string }) => { delivered.push(email); return { messageId: 'pro_email' }; } } });
		expect((await shopperEmailDepsFromEnv(env).access('seller_custom_pro')).canSend).toBe(true);
		expect((await ShopperEmailsController.saveTemplate(send('PUT', SHIPPED), env, {} as ExecutionContext, context)).status).toBe(200);
		await db.prepare("INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_custom_pro', 'pro-store', 'live', 'c1', 0, 0, 0)").run();
		await db.prepare("INSERT INTO store_orders (id, mode, app_id, order_number, checkout_id, seller_user_id, customer_email, subtotal_cents, shipping_cents, total_cents, application_fee_cents, created_at, updated_at) VALUES ('ord_pro_gate', 'live', 'app_custom_pro', 1, 'chk_pro_gate', 'seller_custom_pro', 'buyer@example.test', 2000, 0, 2000, 200, 0, 0)").run();
		await queueShopperEmail(shopperEmailDepsFromEnv(env), { orderId: 'ord_pro_gate', kind: 'order_confirmation', eventKey: 'plan-gate', payload: {} });
		expect(delivered).toHaveLength(1);
		expect(delivered[0]).toMatchObject({ from: { email: 'pro-store@orders.estori.app' }, to: 'buyer@example.test' });
		await db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE user_id = 'seller_custom_pro'").run();
		expect((await shopperEmailDepsFromEnv(env).access('seller_custom_pro')).canSend).toBe(false);
		await queueShopperEmail(shopperEmailDepsFromEnv(env), { orderId: 'ord_pro_gate', kind: 'refund_issued', eventKey: 'plan-gate', payload: { amountCents: 2000 } });
		expect(delivered).toHaveLength(1);
		expect((await ShopperEmailsController.saveTemplate(send('PUT', { ...SHIPPED, subject: 'Another subject' }), env, {} as ExecutionContext, context)).status).toBe(402);
		const read = await json(await ShopperEmailsController.read(new Request('https://estori.app/api/stores/app_custom_pro/emails'), env, {} as ExecutionContext, context));
		expect(read.status).toBe(200);
		expect(read.body.data?.templates).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'order_shipped', enabled: false, edited: false, ...DEFAULT_SHOPPER_EMAIL_TEMPLATES.order_shipped })]));
		expect((await shopperEmailDepsFromEnv(env).emails.templates('app_custom_pro')).get('order_shipped')).toMatchObject(SHIPPED);
	});

	it("saves a template and resets it to Estori's default, naming a placeholder the email can't use", async () => {
		const save = (kind: string, body: unknown) => ShopperEmailsController.saveTemplate(send('PUT', body), envWith(db), {} as ExecutionContext, as({ id: 'app_tea', kind }));
		const saved = await json(await save('order_shipped', SHIPPED));
		expect(saved.body.data).toEqual({ kind: 'order_shipped', edited: true, ...SHIPPED });
		const bad = await json(await save('order_shipped', { ...SHIPPED, body: 'You got {{refund_amount}} back' }));
		expect(bad.status).toBe(400);
		expect(bad.body.error?.message).toContain('{{refund_amount}}');
		expect((await save('order_shipped', { subject: 'No switch' })).status).toBe(400);
		expect((await save('newsletter', SHIPPED)).status).toBe(404);

		// The saved email is switched off; resetting its text keeps it off.
		const reset = await json(await ShopperEmailsController.resetTemplate(send('DELETE', {}), envWith(db), {} as ExecutionContext, as({ id: 'app_tea', kind: 'order_shipped' })));
		expect(reset.body.data).toEqual({ kind: 'order_shipped', edited: false, ...DEFAULT_SHOPPER_EMAIL_TEMPLATES.order_shipped, enabled: false });
		await save('order_shipped', { ...SHIPPED, enabled: true });
		const resetOn = await json(await ShopperEmailsController.resetTemplate(send('DELETE', {}), envWith(db), {} as ExecutionContext, as({ id: 'app_tea', kind: 'order_shipped' })));
		expect(resetOn.body.data).toMatchObject({ kind: 'order_shipped', edited: false, enabled: true });
		// Turning Estori's default off keeps its text, so it still reads as the default.
		const off = await json(await save('order_shipped', { ...DEFAULT_SHOPPER_EMAIL_TEMPLATES.order_shipped, enabled: false }));
		expect(off.body.data).toMatchObject({ kind: 'order_shipped', edited: false, enabled: false });
	});

	it('saves where replies go, and refuses anything but one email address', async () => {
		const save = (body: unknown) => ShopperEmailsController.saveSettings(send('PUT', body), envWith(db), {} as ExecutionContext, as({ id: 'app_tea' }));
		expect((await json(await save({ replyTo: ' help@northwind.test ' }))).body.data).toEqual({ replyTo: 'help@northwind.test' });
		for (const replyTo of ['not an email', 'help@northwind.test\r\nBcc: x@example.test', 42]) expect((await save({ replyTo })).status, String(replyTo)).toBe(400);
		expect((await json(await save({ replyTo: '' }))).body.data).toEqual({ replyTo: null });
	});

	it('previews an unsaved template filled in with a sample order', async () => {
		const preview = (body: unknown) => ShopperEmailsController.preview(send('POST', body), envWith(db, { STORES_DOMAIN: 'estori.shop', CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod' }), {} as ExecutionContext, as({ id: 'app_tea', kind: 'order_shipped' }));
		const answer = await json(await preview({ subject: 'Hi {{customer_first_name}}', heading: 'Shipped', body: '' }));
		expect(answer.body.data).toMatchObject({ subject: 'Hi Ana' });
		expect(answer.body.data?.text).toContain('Visit Northwind Tea: https://northwind-tea.estori.shop');
		expect((await preview({ subject: '', heading: 'Shipped', body: '' })).status).toBe(400);
	});

	it("sends a test to the store's seller once their email is confirmed, marked as a test, at most 10 an hour", async () => {
		const sent: Array<{ to: string; subject: string; from: unknown }> = [];
		const counts = new Map<string, string>();
		const env = envWith(db, {
			SHOPPER_EMAIL_FROM: 'no-reply@orders.estori.app',
			EMAIL: { send: async (message: { to: string; subject: string; from: unknown }) => (sent.push(message), { messageId: 'msg_1' }) },
			VibecoderStore: { get: async (key: string) => counts.get(key) ?? null, put: async (key: string, value: string) => void counts.set(key, value) },
		});
		const test = () => ShopperEmailsController.test(send('POST', SHIPPED), env, {} as ExecutionContext, as({ id: 'app_tea', kind: 'order_shipped' }));
		const unconfirmed = await json(await test());
		expect(unconfirmed.status).toBe(403);
		expect(unconfirmed.body.error?.message).toContain('Confirm your email address');
		expect(sent).toHaveLength(0);
		await db.prepare(`UPDATE users SET email_verified = 1 WHERE id = 'seller_1'`).run();
		const first = await json(await test());
		expect(first.body.data).toEqual({ sentTo: 'seller_1@example.test' });
		expect(sent[0]).toMatchObject({ to: 'seller_1@example.test', subject: '[Test] Order 1042 shipped', from: { email: 'northwind-tea@orders.estori.app', name: 'Northwind Tea' } });
		for (let i = 1; i < 10; i += 1) expect((await test()).status).toBe(200);
		expect((await test()).status).toBe(429);
		expect(sent).toHaveLength(10);
	});
});
