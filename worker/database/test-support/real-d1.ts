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

export async function insertUser(db: D1Database, id: string, options: { createdAt?: Date; emailVerified?: boolean } = {}): Promise<void> {
	const columns = ['id', 'email', 'display_name', 'provider', 'provider_id'];
	const values: (string | number)[] = [id, `${id}@example.test`, id, 'email', id];
	if (options.createdAt) {
		columns.push('created_at');
		values.push(seconds(options.createdAt));
	}
	if (options.emailVerified !== undefined) {
		columns.push('email_verified');
		values.push(options.emailVerified ? 1 : 0);
	}
	await db.prepare(`INSERT INTO users (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...values).run();
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

/** A subscription row with only the columns billing reads; Stripe created it when its current period began. */
export async function insertSubscription(
	db: D1Database,
	subscription: { userId: string; stripeSubscriptionId: string; status: string; plan?: 'pro' | 'premium'; currentPeriodStart: Date; currentPeriodEnd: Date; cancelAtPeriodEnd?: boolean },
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO subscriptions (user_id, stripe_subscription_id, status, plan, current_period_start, current_period_end, cancel_at_period_end, stripe_created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			subscription.userId,
			subscription.stripeSubscriptionId,
			subscription.status,
			subscription.plan ?? 'pro',
			seconds(subscription.currentPeriodStart),
			seconds(subscription.currentPeriodEnd),
			subscription.cancelAtPeriodEnd ? 1 : 0,
			seconds(subscription.currentPeriodStart),
			seconds(subscription.currentPeriodStart),
		)
		.run();
}

export async function insertBillingCustomer(db: D1Database, userId: string, stripeCustomerId: string): Promise<void> {
	await db.prepare('INSERT INTO billing_customers (user_id, stripe_customer_id, created_at) VALUES (?, ?, ?)').bind(userId, stripeCustomerId, seconds(new Date())).run();
}

/** An extra-credits purchase; `amountCents` defaults to the standard $1.50 per 1,000 credits. */
export async function insertPurchase(
	db: D1Database,
	purchase: { id: string; userId: string; credits: number; amountCents?: number; purchasedAt: Date; expiresAt: Date; used?: number; sessionId?: string; paymentIntentId?: string },
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO credit_purchases (id, user_id, credits, amount_cents, stripe_checkout_session_id, stripe_payment_intent_id, purchased_at, expires_at, used)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			purchase.id,
			purchase.userId,
			purchase.credits,
			purchase.amountCents ?? (purchase.credits / 1000) * 150,
			purchase.sessionId ?? `cs_${purchase.id}`,
			purchase.paymentIntentId ?? `pi_${purchase.id}`,
			seconds(purchase.purchasedAt),
			seconds(purchase.expiresAt),
			purchase.used ?? 0,
		)
		.run();
}
