import { describe, expect, it } from 'vitest';
import {
	BYO_ORDER_FEE_CENTS,
	applicationFeeCents,
	catalogPriceCents,
	checkCart,
	minimumRetailPriceCents,
	processingFeeCents,
	type CatalogCartLine,
	type CheckoutCart,
} from './catalog';

const MUG: CatalogCartLine = {
	kind: 'catalog',
	catalogVariantId: 'cv_mug',
	supplier: 'cjdropshipping',
	supplierVariantId: 'cj_mug_white',
	lockedCatalogPriceCents: 1200,
	unitPriceCents: 2500,
	quantity: 2,
};

function cart(lines: CheckoutCart['lines'], shippingCents = 0): CheckoutCart {
	return { lines, shippingCents, shipToCountry: 'US' };
}

describe('catalog prices', () => {
	it('adds the margin to the supplier cost and shipping', () => {
		// (800 + 200) plus 20%.
		expect(catalogPriceCents({ supplierCostCents: 800, shippingCents: 200 })).toBe(1200);
	});

	it("covers Stripe's standard card rate, and nothing on a zero amount", () => {
		expect(processingFeeCents(10000)).toBe(320);
		expect(processingFeeCents(0)).toBe(0);
	});

	it('sets the lowest retail price whose remainder after processing still covers the catalog price', () => {
		const minimum = minimumRetailPriceCents(1200);
		expect(minimum).toBe(1267);
		expect(minimum - processingFeeCents(minimum)).toBeGreaterThanOrEqual(1200);
		expect(minimum - 1 - processingFeeCents(minimum - 1)).toBeLessThan(1200);
	});
});

describe('application fee', () => {
	it('takes the catalog price of each catalog unit plus processing on the whole payment', () => {
		const sample = cart([MUG, { kind: 'own', unitPriceCents: 1500, quantity: 1 }], 500);
		// Total 2 x 2500 + 1500 + 500 = 7000; catalog 2 x 1200; processing round(203) + 30.
		expect(applicationFeeCents(sample)).toBe(2400 + 233);
	});

	it('takes only processing when the cart has no catalog items', () => {
		expect(applicationFeeCents(cart([{ kind: 'own', unitPriceCents: 3000, quantity: 1 }]))).toBe(processingFeeCents(3000));
	});

	it('adds the bring-your-own fee once per order, however many such items it has', () => {
		const byo = { kind: 'byo', catalogVariantId: 'cv_tee', unitPriceCents: 2000, quantity: 3 } as const;
		expect(applicationFeeCents(cart([byo, { ...byo, catalogVariantId: 'cv_cap' }]))).toBe(BYO_ORDER_FEE_CENTS + processingFeeCents(12000));
	});
});

describe('checkCart', () => {
	it('accepts a valid cart and returns its total and fee', () => {
		expect(checkCart(cart([MUG], 500))).toEqual({ ok: true, totalCents: 5500, applicationFeeCents: applicationFeeCents(cart([MUG], 500)) });
	});

	it('refuses an empty cart, and one whose total is zero', () => {
		expect(checkCart(cart([]))).toEqual({ ok: false, problem: 'empty' });
		expect(checkCart(cart([{ kind: 'own', unitPriceCents: 0, quantity: 1 }]))).toEqual({ ok: false, problem: 'fee-exceeds-total' });
	});

	it('refuses zero or fractional quantities and negative or fractional amounts', () => {
		expect(checkCart(cart([{ ...MUG, quantity: 0 }]))).toEqual({ ok: false, problem: 'invalid-amount' });
		expect(checkCart(cart([{ ...MUG, quantity: 1.5 }]))).toEqual({ ok: false, problem: 'invalid-amount' });
		expect(checkCart(cart([{ ...MUG, unitPriceCents: -1 }]))).toEqual({ ok: false, problem: 'invalid-amount' });
		expect(checkCart(cart([MUG], 99.5))).toEqual({ ok: false, problem: 'invalid-amount' });
	});

	it('refuses a catalog item priced below its minimum retail price', () => {
		expect(checkCart(cart([{ ...MUG, unitPriceCents: 1266 }]))).toEqual({ ok: false, problem: 'below-minimum-price' });
		expect(checkCart(cart([{ ...MUG, unitPriceCents: 1267 }])).ok).toBe(true);
	});
});
