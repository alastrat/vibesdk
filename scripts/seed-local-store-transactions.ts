/**
 * Local-only sample transactions: bun scripts/seed-local-store-transactions.ts [--as-of YYYY-MM-DD] [--days 180] [--dry-run]
 * Writes only the two explicitly configured sample stores after verifying ownership.
 * No API calls, Stripe identifiers, provider events, checkout records, or fulfillment jobs are created.
 */
import { Database } from 'bun:sqlite';
import { realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_OWNER_ID = 'b95e9ebe-fbd8-4ea4-8a19-1925bf5c1e5f';
export const SAMPLE_STORE_IDS = [
	'288ff929-4557-4dfa-babb-610b1320cab7',
	'935397b9-8471-4214-afa5-a6ce8f350945',
] as const;
const DATABASE_FILE =
	'.wrangler/state/v3/d1/miniflare-D1DatabaseObject/65fb73f4b482216abfe276db82de59ed0446a94f9b09c5c75aaff43e560aec1c.sqlite';
const SAMPLE_NOTE =
	'SAMPLE DATA — Local analytics demonstration. No payment was taken. Payment statuses and fulfillment are illustrative; no provider action or shipment is scheduled.';
const DAY_SECONDS = 86400;
const prefix = (appId: string) => `sample-estori-analytics-${appId}-`;
interface SampleLine {
	lineNo: number;
	kind: 'own' | 'catalog';
	productId: string;
	variantId: string;
	name: string;
	quantity: number;
	unitPriceCents: number;
}
interface SampleOrder {
	id: string;
	appId: string;
	orderNumber: number;
	createdAt: number;
	paymentStatus:
		| 'paid'
		| 'refunded'
		| 'partially_refunded'
		| 'disputed'
		| 'dispute_lost';
	fulfillmentStatus: 'fulfilled' | 'unfulfilled';
	subtotalCents: number;
	shippingCents: number;
	totalCents: number;
	refundedCents: number;
	customerEmail: string;
	customerName: string;
	shippedAt: number | null;
	lines: SampleLine[];
}
interface SeedOptions {
	asOf?: string;
	days?: number;
	dryRun?: boolean;
}
interface ExistingSample {
	id: string;
	app_id: string;
	seller_user_id: string;
	mode: string;
	note: string | null;
	seller_stripe_account_id: string | null;
	stripe_checkout_session_id: string | null;
	stripe_payment_intent_id: string | null;
}

/** Resolve symlinks as well as lexical traversal; this CLI cannot target any remote or non-Wrangler database. */
export function assertLocalSamplePath(
	databasePath: string,
	repositoryRoot: string,
): string {
	const root = realpathSync(repositoryRoot);
	const localRoot = resolve(root, '.wrangler/state/v3/d1') + sep;
	const requested = resolve(databasePath);
	if (!requested.startsWith(localRoot) || !requested.endsWith('.sqlite'))
		throw new Error(
			'Use an existing local Wrangler D1 SQLite file in this repository.',
		);
	const actual = realpathSync(requested);
	if (!actual.startsWith(localRoot))
		throw new Error(
			'The database must remain inside local Wrangler D1 storage.',
		);
	return actual;
}

function sampleOrders(options: SeedOptions): SampleOrder[] {
	const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
	const days = options.days ?? 180;
	const end = Date.parse(`${asOf}T00:00:00Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
		!Number.isFinite(end) ||
		new Date(end).toISOString().slice(0, 10) !== asOf
	)
		throw new Error('Use a valid --as-of date in YYYY-MM-DD format.');
	if (!Number.isInteger(days) || days < 120 || days > 180)
		throw new Error('--days must be an integer from 120 to 180.');
	const result: SampleOrder[] = [];
	for (const [storeIndex, appId] of SAMPLE_STORE_IDS.entries()) {
		for (let day = 0; day < days; day++) {
			const value =
				((day + 17) * 1103515245 + (storeIndex + 3) * 12345) >>> 0;
			const count =
				(day + 5) % 11 === 0
					? 0
					: 1 + (value % (day < 45 ? 5 : day < 100 ? 4 : 3));
			for (let ordinal = 0; ordinal < count; ordinal++) {
				const seed = (value + ordinal * 7919) >>> 0;
				// Keep the sample ID within the seller pagination cursor's 64-character limit.
				const id = `${prefix(appId)}${day.toString(36).padStart(2, '0')}${ordinal}`;
				const createdAt =
					end / 1000 - day * DAY_SECONDS + 3600 + ordinal * 900;
				const lines: SampleLine[] = Array.from(
					{ length: 1 + (seed % 3) },
					(_, index) => {
						const product = (seed + index) % 4;
						const kind =
							(seed + index) % 4 === 0
								? ('catalog' as const)
								: ('own' as const);
						const names =
							storeIndex === 0
								? [
										'House blend',
										'Single origin',
										'Ceramic dripper',
										'Coffee subscription',
									]
								: [
										'Ceramic vase',
										'Linen throw',
										'Desk tray',
										'Art print',
									];
						return {
							lineNo: index + 1,
							kind,
							productId: `sample-product-${storeIndex}-${product}`,
							variantId: `sample-variant-${product}`,
							name: `[Sample] ${names[product]}`,
							quantity: 1 + ((seed + index * 3) % 3),
							unitPriceCents: (storeIndex === 0
								? [1800, 2400, 3200, 4800]
								: [3500, 5200, 6800, 2600])[product],
						};
					},
				);
				const subtotalCents = lines.reduce(
					(sum, line) => sum + line.quantity * line.unitPriceCents,
					0,
				);
				const shippingCents = seed % 3 === 0 ? 500 : 0;
				const totalCents = subtotalCents + shippingCents;
				const status = seed % 100;
				const paymentStatus =
					status < 6
						? 'refunded'
						: status < 11
							? 'partially_refunded'
							: status < 14
								? 'disputed'
								: status < 16
									? 'dispute_lost'
									: 'paid';
				const fulfilled = day >= 3 && seed % 5 !== 0;
				const buyer = (day * 7 + ordinal * 11 + storeIndex * 3) % 55;
				result.push({
					id,
					appId,
					orderNumber: 9000000 + day * 10 + ordinal,
					createdAt,
					paymentStatus,
					fulfillmentStatus: fulfilled ? 'fulfilled' : 'unfulfilled',
					subtotalCents,
					shippingCents,
					totalCents,
					refundedCents:
						paymentStatus === 'refunded'
							? totalCents
							: paymentStatus === 'partially_refunded'
								? Math.round(totalCents / 3)
								: 0,
					customerEmail: `sample-${storeIndex}-${buyer}@example.test`,
					customerName: `Sample customer ${buyer + 1}`,
					shippedAt: fulfilled ? createdAt + 2 * DAY_SECONDS : null,
					lines,
				});
			}
		}
	}
	return result;
}

/** One atomic replacement of this seeder's own marked test rows. Other orders are never changed. */
export function seedSampleTransactions(
	db: Database,
	options: SeedOptions = {},
) {
	const planned = sampleOrders(options);
	const summary = {
		local: true,
		mode: 'test',
		orders: planned.length,
		items: planned.reduce((sum, order) => sum + order.lines.length, 0),
		stores: SAMPLE_STORE_IDS.map((appId) => ({
			appId,
			orders: planned.filter((order) => order.appId === appId).length,
		})),
		days: options.days ?? 180,
		asOf: options.asOf ?? new Date().toISOString().slice(0, 10),
	};
	return db
		.transaction(() => {
			for (const appId of SAMPLE_STORE_IDS) {
				const app = db
					.query<
						{ user_id: string },
						[string]
					>('SELECT user_id FROM apps WHERE id=?')
					.get(appId);
				if (!app || app.user_id !== SAMPLE_OWNER_ID)
					throw new Error(
						`Sample store ownership check failed: ${appId}`,
					);
				const existing = db
					.query<
						ExistingSample,
						[string]
					>('SELECT id,app_id,seller_user_id,mode,note,seller_stripe_account_id,stripe_checkout_session_id,stripe_payment_intent_id FROM store_orders WHERE id LIKE ?')
					.all(prefix(appId) + '%');
				if (
					existing.some(
						(order) =>
							order.app_id !== appId ||
							order.seller_user_id !== SAMPLE_OWNER_ID ||
							order.mode !== 'test' ||
							order.note !== SAMPLE_NOTE ||
							order.seller_stripe_account_id !== null ||
							order.stripe_checkout_session_id !== null ||
							order.stripe_payment_intent_id !== null,
					)
				)
					throw new Error(
						`Sample order conflict: ${appId}. Refusing to overwrite an unrecognized or changed order.`,
					);
			}
			for (const order of planned) {
				const collision = db
					.query<
						{ id: string },
						[string, number]
					>("SELECT id FROM store_orders WHERE app_id=? AND mode='test' AND order_number=?")
					.get(order.appId, order.orderNumber);
				if (collision && !collision.id.startsWith(prefix(order.appId)))
					throw new Error(
						'Sample order number conflict; no data was changed.',
					);
			}
			if (options.dryRun) return summary;
			for (const appId of SAMPLE_STORE_IDS) {
				db.query(
					'DELETE FROM store_order_items WHERE order_id IN (SELECT id FROM store_orders WHERE id LIKE ?)',
				).run(prefix(appId) + '%');
				db.query('DELETE FROM store_orders WHERE id LIKE ?').run(
					prefix(appId) + '%',
				);
			}
			const insertOrder = db.query(
				`INSERT INTO store_orders (id,mode,app_id,order_number,checkout_id,seller_user_id,payment_status,fulfillment_status,subtotal_cents,shipping_cents,total_cents,application_fee_cents,refunded_cents,currency,customer_email,customer_name,note,created_at,updated_at,shipped_at) VALUES (?,'test',?,?,?,?,?,?,?,?,?,?,?,'usd',?,?,?,?,?,?)`,
			);
			const insertLine = db.query(
				`INSERT INTO store_order_items (order_id,line_no,kind,product_id,variant_id,name,quantity,unit_price_cents,catalog_variant_id,locked_catalog_price_cents) VALUES (?,?,?,?,?,?,?,?,?,?)`,
			);
			for (const order of planned) {
				insertOrder.run(
					order.id,
					order.appId,
					order.orderNumber,
					`sample-checkout-${order.id}`,
					SAMPLE_OWNER_ID,
					order.paymentStatus,
					order.fulfillmentStatus,
					order.subtotalCents,
					order.shippingCents,
					order.totalCents,
					Math.round(order.subtotalCents * 0.03),
					order.refundedCents,
					order.customerEmail,
					order.customerName,
					SAMPLE_NOTE,
					order.createdAt,
					order.createdAt,
					order.shippedAt,
				);
				for (const line of order.lines)
					insertLine.run(
						order.id,
						line.lineNo,
						line.kind,
						line.productId,
						line.variantId,
						line.name,
						line.quantity,
						line.unitPriceCents,
						line.kind === 'catalog'
							? `sample-catalog-${line.productId}`
							: null,
						line.kind === 'catalog'
							? Math.round(line.unitPriceCents * 0.45)
							: null,
					);
			}
			return summary;
		})
		.immediate();
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const options: SeedOptions = {};
	for (let index = 0; index < args.length; index++) {
		if (args[index] === '--dry-run') options.dryRun = true;
		else if (args[index] === '--as-of') {
			const value = args[++index];
			if (!value || value.startsWith('--'))
				throw new Error('--as-of requires YYYY-MM-DD.');
			options.asOf = value;
		} else if (args[index] === '--days')
			options.days = Number(args[++index]);
		else
			throw new Error(
				`Unsupported argument: ${args[index]}. This script only writes local sample data.`,
			);
	}
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const dbPath = assertLocalSamplePath(resolve(root, DATABASE_FILE), root);
	const db = new Database(dbPath, { create: false, readwrite: true });
	try {
		db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
		console.log(
			JSON.stringify(
				{
					...seedSampleTransactions(db, options),
					dryRun: Boolean(options.dryRun),
					database: dbPath,
				},
				null,
				2,
			),
		);
	} finally {
		db.close();
	}
}
