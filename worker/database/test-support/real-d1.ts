/** A D1 database with every migration applied, for tests that run real SQL; each test file gets its own storage. */

import { applyD1Migrations, env } from 'cloudflare:test';
import type {} from './test-env';

export async function migratedD1(): Promise<D1Database> {
	await applyD1Migrations(env.TEST_DB, env.TEST_MIGRATIONS);
	return env.TEST_DB;
}

/** An env whose services read and write the migrated database. */
export function envWith(db: D1Database, extra: Record<string, unknown> = {}): Env {
	return { DB: db, ...extra } as unknown as Env;
}

const seconds = (at: Date): number => Math.floor(at.getTime() / 1000);

export async function insertUser(db: D1Database, id: string): Promise<void> {
	await db.prepare('INSERT INTO users (id, email, display_name, provider, provider_id) VALUES (?, ?, ?, ?, ?)').bind(id, `${id}@example.test`, id, 'email', id).run();
}

/** An app owned by `userId`, with only the columns a store needs. */
export async function insertApp(db: D1Database, app: { id: string; userId: string; title?: string }): Promise<void> {
	await db.prepare('INSERT INTO apps (id, title, original_prompt, user_id) VALUES (?, ?, ?, ?)').bind(app.id, app.title ?? app.id, 'A store', app.userId).run();
}

/** A store order with only the columns these tests read; one own line of the whole total. */
export async function insertStoreOrder(
	db: D1Database,
	order: { id: string; sellerUserId: string; mode?: 'test' | 'live'; orderNumber: number; totalCents: number; paymentStatus?: string; refundedCents?: number; checkoutSessionId?: string | null; createdAt: Date },
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO store_orders (id, mode, app_id, order_number, checkout_id, seller_user_id, stripe_checkout_session_id, subtotal_cents, shipping_cents, total_cents, application_fee_cents, payment_status, refunded_cents, created_at, updated_at)
			 VALUES (?, ?, 'app_1', ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)`,
		)
		.bind(order.id, order.mode ?? 'test', order.orderNumber, `chk_${order.id}`, order.sellerUserId, order.checkoutSessionId ?? null, order.totalCents, order.totalCents, order.paymentStatus ?? 'paid', order.refundedCents ?? 0, seconds(order.createdAt), seconds(order.createdAt))
		.run();
	await db
		.prepare(`INSERT INTO store_order_items (order_id, line_no, kind, product_id, variant_id, name, quantity, unit_price_cents) VALUES (?, 1, 'own', 'p', 'v', 'Item', 1, ?)`)
		.bind(order.id, order.totalCents)
		.run();
}

export async function insertDispute(db: D1Database, dispute: { id: string; orderId: string; status: string; createdAt: Date; closedAt?: Date | null }): Promise<void> {
	await db
		.prepare(`INSERT INTO store_disputes (id, order_id, amount_cents, reason, status, created_at, closed_at, updated_at) VALUES (?, ?, 1000, 'fraudulent', ?, ?, ?, ?)`)
		.bind(dispute.id, dispute.orderId, dispute.status, seconds(dispute.createdAt), dispute.closedAt ? seconds(dispute.closedAt) : null, seconds(dispute.createdAt))
		.run();
}

/** A catalog order for a store order's Checkout session, with one item in this status. */
export async function insertCatalogOrder(db: D1Database, order: { id: string; sellerUserId: string; checkoutSessionId: string; itemStatus: string; createdAt: Date }): Promise<void> {
	await db
		.prepare(
			`INSERT INTO catalog_orders (id, seller_user_id, store_app_id, stripe_checkout_session_id, stripe_payment_intent_id, total_cents, catalog_total_cents, application_fee_cents, destination_country, shipping_address, created_at, updated_at)
			 VALUES (?, ?, 'app_1', ?, ?, 4099, 2028, 2249, 'US', '{}', ?, ?)`,
		)
		.bind(order.id, order.sellerUserId, order.checkoutSessionId, `pi_${order.id}`, seconds(order.createdAt), seconds(order.createdAt))
		.run();
	await db
		.prepare(
			`INSERT INTO catalog_order_items (id, order_id, catalog_variant_id, supplier, supplier_variant_id, quantity, unit_price_cents, catalog_price_cents, status, updated_at)
			 VALUES (?, ?, 'cv_1', 'cjdropshipping', 'cj_1', 1, 4099, 2028, ?, ?)`,
		)
		.bind(`ci_${order.id}`, order.id, order.itemStatus, seconds(order.createdAt))
		.run();
}

/** A store checkout with only the columns the weekly cap reads. */
export async function insertCheckout(db: D1Database, checkout: { id: string; sellerUserId: string; mode?: 'test' | 'live'; status: string; weightedCents: number; createdAt: Date }): Promise<void> {
	await db
		.prepare(
			`INSERT INTO store_checkouts (id, mode, app_id, commit_hash, seller_user_id, ship_to_country, priced_cart, subtotal_cents, shipping_cents, total_cents, application_fee_cents, status, success_path, cancel_path, weighted_cents, created_at, expires_at)
			 VALUES (?, ?, 'app_1', 'c0ffee', ?, 'US', '{}', 0, 0, 0, 0, ?, '/', '/', ?, ?, ?)`,
		)
		.bind(checkout.id, checkout.mode ?? 'test', checkout.sellerUserId, checkout.status, checkout.weightedCents, seconds(checkout.createdAt), seconds(checkout.createdAt) + 35 * 60)
		.run();
}
