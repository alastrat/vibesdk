import { beforeAll, describe, expect, it } from 'vitest';
import { env as workerEnv } from 'cloudflare:test';
import {
	envWith,
	migratedD1,
	insertUser,
	insertApp,
} from '../test-support/real-d1';
import { AccountProductsService } from './AccountProductsService';
import { ProductAssetService } from '../../services/account-products/assets';
let db: D1Database;
let service: AccountProductsService;
const input = {
	name: 'Coffee',
	description: 'Fresh roast',
	category: 'Coffee',
	type: 'physical' as const,
	variants: [
		{ id: '', name: 'Bag', priceCents: 1200, sku: 'BAG', available: true },
	],
	imageAssetId: null,
	downloadAssetIds: [],
	weightGrams: 250,
};
beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'owner');
	await insertUser(db, 'other');
	await insertApp(db, { id: 'store', userId: 'owner' });
	await insertApp(db, { id: 'foreign', userId: 'other' });
	service = new AccountProductsService(envWith(db));
});
describe('private products persisted with real D1', () => {
	it('enforces ownership, revisions and archival without deleting products', async () => {
		const created = await service.create('owner', input);
		expect((await service.list('other')).products).toHaveLength(0);
		await expect(service.get('other', created.id)).rejects.toMatchObject({
			status: 404,
		});
		const updated = await service.update('owner', created.id, {
			...input,
			variants: created.variants,
			revision: 1,
			name: 'Roast',
		});
		expect(updated.revision).toBe(2);
		await expect(
			service.update('owner', created.id, {
				...input,
				variants: created.variants,
				revision: 1,
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(
			(await service.archive('owner', created.id, true, 2)).archived,
		).toBe(true);
		expect(
			(await service.archive('owner', created.id, false, 3)).archived,
		).toBe(false);
	});
	it('atomically creates and attaches, attaches idempotently and keeps detached references', async () => {
		await expect(
			service.create('owner', { ...input, storeId: 'foreign' }),
		).rejects.toMatchObject({ status: 403 });
		const created = await service.create('owner', {
			...input,
			storeId: 'store',
		});
		const first = await service.attach('owner', 'store', {
			productId: created.id,
		});
		expect(
			(await service.attach('owner', 'store', { productId: created.id }))
				.id,
		).toBe(first.id);
		await expect(
			service.attach('other', 'foreign', { productId: created.id }),
		).rejects.toMatchObject({ status: 404 });
		await service.detach('owner', 'store', created.id);
		const projection = await service.projectStore('owner', 'store');
		expect(projection.managedProductIds).toContain(created.id);
		expect(
			projection.products.find((p) => p.id === created.id),
		).toBeUndefined();
		expect((await service.get('owner', created.id)).name).toBe('Coffee');
	});
	it('refuses another accounts image attachment and asset reads', async () => {
		await db
			.prepare(
				`INSERT INTO product_assets(id,owner_id,r2_key,kind,name,content_type,size,created_at) VALUES ('asset-other','other','private/test','image','bag.png','image/png',10,1)`,
			)
			.run();
		await expect(
			service.create('owner', { ...input, imageAssetId: 'asset-other' }),
		).rejects.toMatchObject({ status: 400 });
		const assets = new ProductAssetService(
			envWith(db, { TEMPLATES_BUCKET: workerEnv.TEMPLATES_BUCKET }),
		);
		expect(await assets.getOwned('owner', 'asset-other')).toBeNull();
	});
	it('imports catalog variants once, retains real identities and validates floor price', async () => {
		await db
			.prepare(
				`INSERT INTO catalog_products(id,supplier,supplier_product_id,status,category,title,created_at,updated_at) VALUES ('catalog-one','cjdropshipping','supplier-one','active','coffee','Mug',1,1)`,
			)
			.run();
		await db
			.prepare(
				`INSERT INTO catalog_variants(id,product_id,supplier_variant_id,name,weight_grams,supplier_cost_cents,stock,status,updated_at) VALUES ('cv-one','catalog-one','sv-one','White',200,100,'{}','active',1)`,
			)
			.run();
		await db
			.prepare(
				`INSERT INTO catalog_variant_offers(variant_id,destination_country,origin_country,supplier_cost_cents,catalog_price_cents,available,updated_at) VALUES ('cv-one','US','CN',100,600,1,strftime('%s','now'))`,
			)
			.run();
		const listing = await service.attach('owner', 'store', {
			catalogProductId: 'catalog-one',
		});
		expect(listing.product.source).toBe('catalog');
		expect(listing.product.variants[0].catalogVariantId).toBe('cv-one');
		expect(
			(
				await service.attach('owner', 'store', {
					catalogProductId: 'catalog-one',
				})
			).product.id,
		).toBe(listing.product.id);
		const p = listing.product;
		await expect(
			service.update('owner', p.id, {
				...input,
				type: 'physical',
				variants: p.variants.map((v) => ({ ...v, priceCents: 50 })),
				revision: p.revision,
			}),
		).rejects.toMatchObject({ status: 400 });
	});
	it('derives mode-separated actual line revenue, orders and customers', async () => {
		const p = await service.create('owner', { ...input, storeId: 'store' });
		for (const mode of ['test', 'live']) {
			const id = `metrics-${mode}`;
			await db
				.prepare(
					`INSERT INTO store_orders(id,mode,app_id,order_number,checkout_id,seller_user_id,subtotal_cents,shipping_cents,total_cents,application_fee_cents,customer_email,created_at,updated_at) VALUES (?,?, 'store',1,?,'owner',2400,0,2400,0,'buyer@example.test',1,1)`,
				)
				.bind(id, mode, id)
				.run();
			await db
				.prepare(
					`INSERT INTO store_order_items(order_id,line_no,kind,product_id,variant_id,name,quantity,unit_price_cents) VALUES (?,1,'own',?,?,'Bag',2,1200)`,
				)
				.bind(id, p.id, p.variants[0].id)
				.run();
		}
		const row = (
			await service.collection('owner', 'store', 'live')
		).products.find((v) => v.product.id === p.id);
		expect(row).toMatchObject({
			revenueCents: 2400,
			orders: 1,
			customers: 1,
			unitsSold: 2,
			published: false,
			pendingChanges: true,
		});
	});
});

it('adopts only verified owned published legacy products once and projects explicit adoption', async () => {
	await insertApp(db, { id: 'legacy-store', userId: 'owner' });
	await db
		.prepare(
			`INSERT INTO live_stores(app_id,slug,status,published_commit,published_at,created_at,updated_at) VALUES ('legacy-store','legacy-store','live','commit',1,1,1)`,
		)
		.run();
	const legacy = {
		id: 'old-mug',
		name: 'Old mug',
		image: '/mug.jpg',
		variants: [{ id: 'old-small', name: 'Small', priceCents: 900 }],
	};
	const snapshot = {
		commitHash: 'commit',
		manifest: JSON.stringify({
			version: 1,
			currency: 'usd',
			shipping: { countries: ['US'], flatRateCents: 0 },
			products: [legacy],
		}),
	};
	const legacyService = new AccountProductsService(
		envWith(db, {
			SPACE_DO: {
				idFromName: (name: string) => name,
				get: () => ({ getStoreManifest: async () => snapshot }),
			},
		}),
	);
	expect(
		(await legacyService.collection('owner', 'legacy-store')).products[0],
	).toMatchObject({
		id: 'published:old-mug',
		published: true,
		pendingChanges: false,
	});
	await expect(
		legacyService.attach('other', 'legacy-store', {
			publishedProductId: 'old-mug',
		}),
	).rejects.toMatchObject({ status: 403 });
	await expect(
		legacyService.attach('owner', 'legacy-store', {
			publishedProductId: 'forged',
		}),
	).rejects.toMatchObject({ status: 404 });
	await db
		.prepare(
			`INSERT INTO store_orders(id,mode,app_id,order_number,checkout_id,seller_user_id,subtotal_cents,shipping_cents,total_cents,application_fee_cents,customer_email,created_at,updated_at) VALUES ('legacy-sale','test','legacy-store',1,'legacy-sale','owner',900,0,900,0,'legacy@example.test',1,1)`,
		)
		.run();
	await db
		.prepare(
			`INSERT INTO store_order_items(order_id,line_no,kind,product_id,variant_id,name,quantity,unit_price_cents) VALUES ('legacy-sale',1,'own','old-mug','old-small','Old mug',1,900)`,
		)
		.run();
	const attached = await legacyService.attach('owner', 'legacy-store', {
		publishedProductId: 'old-mug',
	});
	expect(attached.product.id).not.toBe('old-mug');
	expect(attached).toMatchObject({
		revenueCents: 900,
		orders: 1,
		customers: 1,
		unitsSold: 1,
	});
	expect(attached.product.variants[0].id).not.toBe('old-small');
	expect(attached.product.variants[0].priceCents).toBe(900);
	expect(
		(
			await legacyService.attach('owner', 'legacy-store', {
				publishedProductId: 'old-mug',
			})
		).id,
	).toBe(attached.id);
	const projection = await legacyService.projectStore(
		'owner',
		'legacy-store',
	);
	expect(projection.managedProductIds).toContain('old-mug');
	expect(projection.adoptedProductIds).toEqual(['old-mug']);
	expect(
		(await legacyService.collection('owner', 'legacy-store')).products,
	).toHaveLength(1);
});

it('stores actual private upload sizes, streams safe downloads, and rejects disguised executable/PDF files', async () => {
	const assets = new ProductAssetService(
		envWith(db, { TEMPLATES_BUCKET: workerEnv.TEMPLATES_BUCKET }),
	);
	const request = (contentType: string, body: string) =>
		new Request('https://example.test', {
			method: 'POST',
			headers: {
				'X-File-Name': 'guide.pdf',
				'Content-Type': contentType,
			},
			body,
		});
	await expect(
		assets.upload(
			'owner',
			request('application/pdf', 'MZ executable'),
			'download',
		),
	).rejects.toMatchObject({ status: 415 });
	await expect(
		assets.upload(
			'owner',
			request('application/pdf', '<html>bad</html>'),
			'download',
		),
	).rejects.toMatchObject({ status: 415 });
	const file = await assets.upload(
		'owner',
		request('application/pdf', '%PDF-1.7\n%guide'),
		'download',
	);
	expect(file.size).toBe(15);
	await expect(assets.serveOwned('other', file.id)).rejects.toMatchObject({
		status: 404,
	});
	const response = await assets.serveOwned('owner', file.id);
	expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(response.headers.get('Content-Disposition')).toContain('attachment');
	expect(response.headers.get('Cache-Control')).toBe('private, no-store');
	expect(await response.text()).toBe('%PDF-1.7\n%guide');
});

it('refuses stale catalog offers, paused imports and account catalog restrictions', async () => {
	await insertCatalogFixture();
	await insertUser(db, 'restricted');
	await insertApp(db, { id: 'restricted-store', userId: 'restricted' });
	const paused = new AccountProductsService(
		envWith(db, {
			ENVIRONMENT: 'dev',
			FEATURE_FLAG_OVERRIDES: 'catalog-paused=on',
		}),
	);
	await expect(
		paused.attach('restricted', 'restricted-store', {
			catalogProductId: 'catalog-one',
		}),
	).rejects.toMatchObject({ status: 409 });
	await db
		.prepare(
			"INSERT INTO plan_overrides(id,user_id,plan,limits,admin_user_id,reason,created_at) VALUES ('private-products-override','restricted','basic','{\"supplierCatalog\":false}','owner','Restriction',1)",
		)
		.run();
	const restricted = new AccountProductsService(
		envWith(db, { ENVIRONMENT: 'dev', BILLING: 'on' }),
	);
	await expect(
		restricted.attach('restricted', 'restricted-store', {
			catalogProductId: 'catalog-one',
		}),
	).rejects.toMatchObject({ status: 403 });
	await db
		.prepare(
			"UPDATE catalog_variant_offers SET updated_at=1 WHERE variant_id='cv-one'",
		)
		.run();
	await expect(
		service.attach('other', 'foreign', { catalogProductId: 'catalog-one' }),
	).rejects.toMatchObject({ status: 400 });
});

it('keeps line revenue net of confirmed refunds', async () => {
	const p = await service.create('owner', { ...input, storeId: 'store' });
	await db
		.prepare(
			`INSERT INTO store_orders(id,mode,app_id,order_number,checkout_id,seller_user_id,payment_status,subtotal_cents,shipping_cents,total_cents,application_fee_cents,refunded_cents,customer_email,created_at,updated_at) VALUES ('partial-refund','test','store',90,'partial-refund','owner','partially_refunded',2400,0,2400,0,1200,'buyer@example.test',1,1)`,
		)
		.run();
	await db
		.prepare(
			`INSERT INTO store_order_items(order_id,line_no,kind,product_id,variant_id,name,quantity,unit_price_cents) VALUES ('partial-refund',1,'own',?,?,'Bag',2,1200)`,
		)
		.bind(p.id, p.variants[0].id)
		.run();
	await db
		.prepare(
			`INSERT INTO store_refunds(id,order_id,line_no,amount_cents,request_id,initiated_by,stripe_refund_id,created_at) VALUES ('refund-partial','partial-refund',1,1200,'refund-partial','seller','re_partial',1)`,
		)
		.run();
	expect(
		(await service.collection('owner', 'store', 'test')).products.find(
			(v) => v.product.id === p.id,
		),
	).toMatchObject({
		revenueCents: 1200,
		orders: 1,
		customers: 1,
		unitsSold: 2,
	});
});

it('keeps a separately adopted supplier product price and new identities when the account already imported that supplier', async () => {
	await insertCatalogFixture();
	await service.attach('owner', 'store', { catalogProductId: 'catalog-one' });
	await db
		.prepare(
			"UPDATE catalog_variant_offers SET updated_at=strftime('%s','now') WHERE variant_id='cv-one'",
		)
		.run();
	const existing = (await service.list('owner')).products.find(
		(p) => p.sourceCatalogProductId === 'catalog-one',
	);
	expect(existing).toBeDefined();
	await insertApp(db, { id: 'legacy-catalog-store', userId: 'owner' });
	await db
		.prepare(
			`INSERT INTO live_stores(app_id,slug,status,published_commit,published_at,created_at,updated_at) VALUES ('legacy-catalog-store','legacy-catalog-store','live','commit-cat',1,1,1)`,
		)
		.run();
	const original = {
		id: 'old-catalog-mug',
		name: 'Special mug',
		variants: [
			{
				id: 'old-catalog-white',
				name: 'White',
				priceCents: 5000,
				catalogVariantId: 'cv-one',
			},
		],
	};
	const snapshot = {
		commitHash: 'commit-cat',
		manifest: JSON.stringify({
			version: 1,
			currency: 'usd',
			shipping: { countries: ['US'], flatRateCents: 0 },
			products: [original],
		}),
	};
	const legacyService = new AccountProductsService(
		envWith(db, {
			SPACE_DO: {
				idFromName: (name: string) => name,
				get: () => ({ getStoreManifest: async () => snapshot }),
			},
		}),
	);
	const imported = await legacyService.attach(
		'owner',
		'legacy-catalog-store',
		{ publishedProductId: original.id },
	);
	expect(imported.product.id).not.toBe(existing?.id);
	expect(imported.product.id).not.toBe(original.id);
	expect(imported.product.variants[0]).toMatchObject({
		priceCents: 5000,
		catalogVariantId: 'cv-one',
	});
	expect(imported.product.variants[0].id).not.toBe(original.variants[0].id);
});

it('compares published semantic product fields and leaves an edited version draft until publish', async () => {
	await insertApp(db, { id: 'status-store', userId: 'owner' });
	const product = await service.create('owner', {
		...input,
		storeId: 'status-store',
	});
	const projection = await service.projectStore('owner', 'status-store');
	await db
		.prepare(
			`INSERT INTO live_stores(app_id,slug,status,published_commit,published_at,created_at,updated_at) VALUES ('status-store','status-store','live','status-commit',1,1,1)`,
		)
		.run();
	const snapshot = {
		commitHash: 'status-commit',
		manifest: JSON.stringify({
			version: 1,
			currency: 'usd',
			shipping: { countries: ['US'], flatRateCents: 0 },
			products: projection.products,
		}),
	};
	const liveService = new AccountProductsService(
		envWith(db, {
			SPACE_DO: {
				idFromName: (name: string) => name,
				get: () => ({ getStoreManifest: async () => snapshot }),
			},
		}),
	);
	expect(
		(await liveService.collection('owner', 'status-store')).products[0],
	).toMatchObject({ published: true, pendingChanges: false });
	await liveService.update('owner', product.id, {
		...input,
		variants: product.variants,
		name: 'Edited coffee',
		revision: 1,
	});
	expect(
		(await liveService.collection('owner', 'status-store')).products[0],
	).toMatchObject({ published: true, pendingChanges: true });
	expect(JSON.parse(snapshot.manifest).products[0].name).toBe('Coffee');
});

async function insertCatalogFixture(): Promise<void> {
	await db
		.prepare(
			`INSERT INTO catalog_products(id,supplier,supplier_product_id,status,category,title,created_at,updated_at) VALUES ('catalog-one','cjdropshipping','supplier-one','active','coffee','Mug',1,1)`,
		)
		.run();
	await db
		.prepare(
			`INSERT INTO catalog_variants(id,product_id,supplier_variant_id,name,weight_grams,supplier_cost_cents,stock,status,updated_at) VALUES ('cv-one','catalog-one','sv-one','White',200,100,'{}','active',1)`,
		)
		.run();
	await db
		.prepare(
			`INSERT INTO catalog_variant_offers(variant_id,destination_country,origin_country,supplier_cost_cents,catalog_price_cents,available,updated_at) VALUES ('cv-one','US','CN',100,600,1,strftime('%s','now'))`,
		)
		.run();
}

it.each(['hide', 'detach', 'archive'] as const)(
	'keeps adopted live product removal pending after %s before the first private-product publication',
	async (action) => {
		const appId = `adoption-removal-${action}`;
		await insertApp(db, { id: appId, userId: 'owner' });
		await db
			.prepare(
				`INSERT INTO live_stores(app_id,slug,status,published_commit,published_at,created_at,updated_at) VALUES (?,?,'live','adoption-commit',1,1,1)`,
			)
			.bind(appId, appId)
			.run();
		const original = {
			id: 'legacy-coffee',
			name: 'Coffee',
			variants: [{ id: 'legacy-bag', name: 'Bag', priceCents: 1200 }],
		};
		const manifest = {
			version: 1,
			currency: 'usd',
			shipping: { countries: ['US'], flatRateCents: 0 },
			products: [original],
		};
		const snapshot = {
			commitHash: 'adoption-commit',
			manifest: JSON.stringify(manifest),
		};
		const adoptedService = new AccountProductsService(
			envWith(db, {
				SPACE_DO: {
					idFromName: (name: string) => name,
					get: () => ({ getStoreManifest: async () => snapshot }),
				},
			}),
		);
		const listing = await adoptedService.attach('owner', appId, {
			publishedProductId: original.id,
		});
		expect(listing.pendingChanges).toBe(true);
		if (action === 'hide')
			await adoptedService.setVisibility(
				'owner',
				appId,
				listing.product.id,
				'hidden',
			);
		else if (action === 'detach')
			await adoptedService.detach('owner', appId, listing.product.id);
		else
			await adoptedService.archive(
				'owner',
				listing.product.id,
				true,
				listing.product.revision,
			);
		const collection = await adoptedService.collection('owner', appId);
		expect(collection.hasUnpublishedChanges).toBe(true);
		if (action === 'detach') expect(collection.products).toHaveLength(0);
		else
			expect(collection.products[0]).toMatchObject({
				published: true,
				pendingChanges: true,
			});
		const projection = await adoptedService.projectStore('owner', appId);
		expect(projection.managedProductIds).toContain(original.id);
		expect(projection.products).toEqual([]);
		// Once publication removes the original, the collection must stop prompting to publish.
		snapshot.manifest = JSON.stringify({
			...manifest,
			products: projection.products,
		});
		expect(
			(await adoptedService.collection('owner', appId))
				.hasUnpublishedChanges,
		).toBe(false);
	},
);
