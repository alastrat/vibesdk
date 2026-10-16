import { describe, expect, it } from 'vitest';
import type { StoreManifest } from '../../../shared/types/store-payments';
import { priceCart, requestedCatalogVariantIds, toCheckoutCart, type CatalogLock } from './pricing';

const MANIFEST: StoreManifest = {
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US', 'CA'], flatRateCents: 600, freeOverCents: 7500 },
	products: [
		{
			id: 'trail-mug',
			name: 'Trail Mug',
			variants: [
				{ id: 'trail-mug-blue', name: 'Blue', priceCents: 2000 },
				{ id: 'trail-mug-red', name: 'Red', priceCents: 2000, available: false },
			],
		},
		{ id: 'desk-lamp', name: 'Desk Lamp', variants: [{ id: 'desk-lamp-black', name: 'Black', priceCents: 3500, catalogVariantId: 'cv_lamp' }] },
		{ id: 'poster', name: 'Poster', variants: [{ id: 'poster-big', name: 'Big', priceCents: 1_000_000 }] },
	],
};

const CONTEXT = { mode: 'test', storeAppId: 'app_1', storeVersionId: null, commitHash: 'c0ffee', sellerStripeAccountId: 'acct_1' } as const;
const LAMP_LOCK: CatalogLock = { ok: true, catalogVariantId: 'cv_lamp', supplier: 'cjdropshipping', supplierVariantId: 'cj_vid_lamp', lockedCatalogPriceCents: 1200 };

function price(items: { variantId: string; quantity: number }[], options: { shipTo?: string; locks?: CatalogLock[] } = {}) {
	return priceCart({
		manifest: MANIFEST,
		request: { items, shipTo: options.shipTo ?? 'US' },
		catalogLocks: new Map((options.locks ?? [LAMP_LOCK]).map((lock) => [lock.catalogVariantId, lock])),
		context: CONTEXT,
	});
}

describe('priceCart', () => {
	it("prices a cart from the manifest, with the fee covering Stripe's processing", () => {
		const result = price([{ variantId: 'trail-mug-blue', quantity: 2 }]);
		expect(result).toEqual({
			ok: true,
			applicationFeeCents: 163,
			cart: {
				...CONTEXT,
				currency: 'usd',
				shipToCountry: 'US',
				lines: [{ kind: 'own', productId: 'trail-mug', variantId: 'trail-mug-blue', name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000 }],
				subtotalCents: 4000,
				shippingCents: 600,
				totalCents: 4600,
			},
		});
	});

	it('merges repeated variants into one line', () => {
		const result = price([
			{ variantId: 'trail-mug-blue', quantity: 1 },
			{ variantId: 'trail-mug-blue', quantity: 2 },
		]);
		expect(result.ok && result.cart.lines).toEqual([expect.objectContaining({ variantId: 'trail-mug-blue', quantity: 3 })]);
	});

	it('ships free at or above the threshold', () => {
		const result = price([{ variantId: 'trail-mug-blue', quantity: 4 }]);
		expect(result.ok && result.cart.shippingCents).toBe(0);
	});

	it('refuses unknown and sold-out variants, and countries the store does not ship to', () => {
		expect(price([{ variantId: 'nope', quantity: 1 }])).toEqual({ ok: false, reason: 'unknown_item' });
		expect(price([{ variantId: 'trail-mug-red', quantity: 1 }])).toEqual({ ok: false, reason: 'item_unavailable' });
		expect(price([{ variantId: 'trail-mug-blue', quantity: 1 }], { shipTo: 'FR' })).toEqual({ ok: false, reason: 'ships_to_unsupported' });
	});

	it("refuses quantities and totals outside one order's limits", () => {
		for (const quantity of [0, 100, 1.5]) {
			expect(price([{ variantId: 'trail-mug-blue', quantity }])).toEqual({ ok: false, reason: 'cart_limits' });
		}
		expect(price([{ variantId: 'poster-big', quantity: 2 }])).toEqual({ ok: false, reason: 'cart_limits' });
	});

	it('prices catalog lines from their lock, and takes the locked price in the fee', () => {
		const result = price([{ variantId: 'desk-lamp-black', quantity: 1 }]);
		expect(result.ok && result.cart.lines).toEqual([
			{
				kind: 'catalog',
				productId: 'desk-lamp',
				variantId: 'desk-lamp-black',
				name: 'Desk Lamp, Black',
				quantity: 1,
				unitPriceCents: 3500,
				catalogVariantId: 'cv_lamp',
				supplier: 'cjdropshipping',
				supplierVariantId: 'cj_vid_lamp',
				destinationCountry: 'US',
				lockedCatalogPriceCents: 1200,
			},
		]);
		// 4100 total: 1200 catalog + round(4100 x 2.9%) + 30.
		expect(result.ok && result.applicationFeeCents).toBe(1349);
	});

	it('refuses catalog lines that cannot be locked', () => {
		expect(price([{ variantId: 'desk-lamp-black', quantity: 1 }], { locks: [] })).toEqual({ ok: false, reason: 'unknown_item' });
		const refusals = { unknown: 'unknown_item', unavailable: 'item_unavailable', ships_to_unsupported: 'ships_to_unsupported' } as const;
		for (const [reason, refusal] of Object.entries(refusals)) {
			const lock = { ok: false, catalogVariantId: 'cv_lamp', reason } as CatalogLock;
			expect(price([{ variantId: 'desk-lamp-black', quantity: 1 }], { locks: [lock] })).toEqual({ ok: false, reason: refusal });
		}
	});

	it('refuses a catalog retail price under the minimum for its locked price', () => {
		const dearer: CatalogLock = { ...LAMP_LOCK, lockedCatalogPriceCents: 3400 };
		expect(price([{ variantId: 'desk-lamp-black', quantity: 1 }], { locks: [dearer] })).toEqual({ ok: false, reason: 'below_minimum_price' });
	});
});

describe('requestedCatalogVariantIds', () => {
	it('names each catalog variant the request asks for, once', () => {
		const request = { shipTo: 'US', items: [{ variantId: 'desk-lamp-black', quantity: 1 }, { variantId: 'trail-mug-blue', quantity: 1 }, { variantId: 'desk-lamp-black', quantity: 2 }] };
		expect(requestedCatalogVariantIds(MANIFEST, request)).toEqual(['cv_lamp']);
	});
});

describe('toCheckoutCart', () => {
	it('keeps what the catalog fee reads', () => {
		const result = price([{ variantId: 'desk-lamp-black', quantity: 1 }, { variantId: 'trail-mug-blue', quantity: 1 }]);
		if (!result.ok) throw new Error('expected a priced cart');
		expect(toCheckoutCart(result.cart)).toEqual({
			shippingCents: 600,
			shipToCountry: 'US',
			lines: [
				{ kind: 'catalog', unitPriceCents: 3500, quantity: 1, catalogVariantId: 'cv_lamp', supplier: 'cjdropshipping', supplierVariantId: 'cj_vid_lamp', lockedCatalogPriceCents: 1200 },
				{ kind: 'own', unitPriceCents: 2000, quantity: 1 },
			],
		});
	});
});
