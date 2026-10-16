import { describe, expect, it } from 'vitest';
import { CatalogOrderService } from './CatalogOrderService';
import { recordingD1 } from '../test-support/recording-d1';
import type { NewCatalogOrder } from '../../services/catalog/store';

const ORDER: NewCatalogOrder = {
	id: 'co_1',
	sellerUserId: 'u1',
	storeAppId: 'app_1',
	checkoutSessionId: 'cs_1',
	paymentIntentId: 'pi_1',
	totalCents: 5500,
	catalogTotalCents: 2400,
	applicationFeeCents: 2590,
	destinationCountry: 'US',
	shippingAddress: { name: 'Ada', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', phone: null, email: null },
	items: [{ id: 'ci_1', catalogVariantId: 'cv_mug', supplier: 'cjdropshipping', supplierVariantId: 'cj_mug', quantity: 2, unitPriceCents: 2500, catalogPriceCents: 1200 }],
	createdAt: new Date(1_800_000_000_000),
};

describe('CatalogOrderService', () => {
	it('writes the order and its items in one batch', async () => {
		const { d1, batches } = recordingD1();
		const orders = new CatalogOrderService({ DB: d1 } as unknown as Env);

		expect(await orders.insertPaidOrder(ORDER)).toBe(true);
		expect(batches).toHaveLength(1);
		expect(batches[0].map((entry) => entry.sql.split(' (')[0].toLowerCase())).toEqual([
			'insert into "catalog_orders"',
			'insert into "catalog_order_items"',
		]);
		expect(batches[0][0].params).toContain('cs_1');
		expect(batches[0][0].params).toContain(JSON.stringify(ORDER.shippingAddress));
	});

	it('answers false when the Checkout session already has an order', async () => {
		const { d1 } = recordingD1();
		const duplicate = { ...d1, batch: async () => Promise.reject(new Error('D1_ERROR: UNIQUE constraint failed: catalog_orders.stripe_checkout_session_id: SQLITE_CONSTRAINT')) };
		const orders = new CatalogOrderService({ DB: duplicate } as unknown as Env);

		expect(await orders.insertPaidOrder(ORDER)).toBe(false);
	});

	it("writes each item in its own statement, so a large order stays under D1's 100 parameters per statement", async () => {
		const { d1, batches } = recordingD1();
		const orders = new CatalogOrderService({ DB: d1 } as unknown as Env);
		const items = Array.from({ length: 12 }, (_, index) => ({ ...ORDER.items[0], id: `ci_${index}` }));

		expect(await orders.insertPaidOrder({ ...ORDER, items })).toBe(true);
		expect(batches[0]).toHaveLength(13);
		expect(Math.max(...batches[0].map((entry) => entry.params.length))).toBeLessThanOrEqual(100);
	});

	it('rethrows any other failure', async () => {
		const { d1 } = recordingD1();
		const broken = { ...d1, batch: async () => Promise.reject(new Error('Network connection lost')) };
		const orders = new CatalogOrderService({ DB: broken } as unknown as Env);

		await expect(orders.insertPaidOrder(ORDER)).rejects.toThrow('Network connection lost');
	});

	it('patches only the fields each patch names', async () => {
		const { d1, batches } = recordingD1();
		const orders = new CatalogOrderService({ DB: d1 } as unknown as Env);

		await orders.patchItems([
			{ itemId: 'ci_1', status: 'placed', supplierOrderId: 'cj_order_9' },
			{ itemId: 'ci_2', supplierRefunded: true },
		]);
		expect(batches[0]).toHaveLength(2);
		expect(batches[0][0].sql.toLowerCase()).toMatch(/update "catalog_order_items" set "status" = \?, "supplier_order_id" = \?, "updated_at" = \?/);
		expect(batches[0][1].sql.toLowerCase()).toMatch(/update "catalog_order_items" set "supplier_refunded" = \?, "updated_at" = \?/);
	});

	it('makes no call for an empty list of patches', async () => {
		const { d1, batches, statements } = recordingD1();
		await new CatalogOrderService({ DB: d1 } as unknown as Env).patchItems([]);
		expect(batches).toHaveLength(0);
		expect(statements).toHaveLength(0);
	});

	it('reads an order with its items and parses the address', async () => {
		const orderRow = ['co_1', 'awaiting-placement', 'pi_1', 0, JSON.stringify(ORDER.shippingAddress)];
		const itemRow = ['ci_1', 'cv_mug', 'cjdropshipping', 'cj_mug', 2, 2500, 1200, 'pending', null, null, null, 0, 0];
		const { d1 } = recordingD1((sql) => (sql.includes('from "catalog_order_items"') ? [itemRow] : [orderRow]));
		const order = await new CatalogOrderService({ DB: d1 } as unknown as Env).getOrder('co_1');

		expect(order).toEqual({
			id: 'co_1',
			status: 'awaiting-placement',
			paymentIntentId: 'pi_1',
			placementAttempts: 0,
			shippingAddress: ORDER.shippingAddress,
			items: [
				{
					id: 'ci_1',
					catalogVariantId: 'cv_mug',
					supplier: 'cjdropshipping',
					supplierVariantId: 'cj_mug',
					quantity: 2,
					unitPriceCents: 2500,
					catalogPriceCents: 1200,
					status: 'pending',
					supplierOrderId: null,
					trackingNumber: null,
					carrier: null,
					supplierRefunded: false,
					sellerReversalDueCents: 0,
				},
			],
		});
	});
});

describe('CatalogOrderService.progressForSessions', () => {
	it("groups each paid session's catalog items with their status and tracking", async () => {
		const { d1 } = recordingD1([
			['cs_1', 'cv_mug', 2, 'shipped', '9400111899223197428490', 'USPS'],
			['cs_1', 'cv_cap', 1, 'placed', null, null],
		]);
		const orders = new CatalogOrderService({ DB: d1 } as unknown as Env);
		const progress = await orders.progressForSessions(['cs_1']);
		expect(progress.get('cs_1')).toEqual([
			{ catalogVariantId: 'cv_mug', quantity: 2, status: 'shipped', trackingNumber: '9400111899223197428490', carrier: 'USPS' },
			{ catalogVariantId: 'cv_cap', quantity: 1, status: 'placed', trackingNumber: null, carrier: null },
		]);
		expect((await orders.progressForSessions([])).size).toBe(0);
	});
});

