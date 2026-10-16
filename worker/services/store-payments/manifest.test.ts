import { describe, expect, it } from 'vitest';
import { parseStoreManifest } from './manifest';

const VALID = {
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US', 'CA'], flatRateCents: 600, freeOverCents: 7500 },
	products: [
		{
			id: 'trail-mug',
			name: 'Trail Mug',
			description: 'Enamel camping mug.',
			image: '/images/trail-mug.jpg',
			variants: [
				{ id: 'trail-mug-blue', name: 'Blue', priceCents: 2400 },
				{ id: 'trail-mug-red', name: 'Red', priceCents: 2400, available: false },
			],
		},
	],
};

function parse(value: unknown) {
	return parseStoreManifest(JSON.stringify(value));
}

function errorsOf(value: unknown): string[] {
	const result = parse(value);
	return result.ok ? [] : result.errors;
}

describe('parseStoreManifest', () => {
	it('reads a valid file', () => {
		expect(parse(VALID)).toEqual({ ok: true, manifest: VALID });
	});

	it('rejects unknown fields, naming their path', () => {
		expect(errorsOf({ ...VALID, amount: 5 })).toContain('amount: unknown field');
		const product = { ...VALID.products[0], variants: [{ ...VALID.products[0].variants[0], fee: 1 }] };
		expect(errorsOf({ ...VALID, products: [product] })).toContain('products[0].variants[0].fee: unknown field');
	});

	it('rejects malformed and duplicate ids', () => {
		expect(errorsOf({ ...VALID, products: [{ ...VALID.products[0], id: 'Trail Mug' }] })).toContain(
			'products[0].id: lowercase letters, digits and dashes, starting with a letter or digit',
		);
		const copy = { ...VALID.products[0], id: 'trail-mug-2' };
		expect(errorsOf({ ...VALID, products: [VALID.products[0], copy] })).toContain('products[1].variants[0].id: duplicate variant id "trail-mug-blue"');
	});

	it('keeps prices between 50 cents and $10,000, in whole cents', () => {
		for (const priceCents of [49, 1_000_001, 24.5]) {
			const product = { ...VALID.products[0], variants: [{ id: 'v', name: 'V', priceCents }] };
			expect(errorsOf({ ...VALID, products: [product] })).toContain('products[0].variants[0].priceCents: whole cents from 50 to 1000000');
		}
	});

	it('limits the file to 200 products', () => {
		const products = Array.from({ length: 201 }, (_, index) => ({ id: `p-${index}`, name: 'P', variants: [{ id: `v-${index}`, name: 'V', priceCents: 500 }] }));
		expect(errorsOf({ ...VALID, products })).toContain('products: at most 200 products');
	});

	it('refuses ship-to codes that are not two capital letters', () => {
		expect(errorsOf({ ...VALID, shipping: { ...VALID.shipping, countries: ['us'] } })).toContain('shipping.countries[0]: a two-letter country code such as US');
	});

	it('accepts catalog variants and images served by Estori', () => {
		const lamp = {
			id: 'desk-lamp',
			name: 'Desk Lamp',
			image: 'https://estori.app/api/catalog/images/p1/a1b2.jpg',
			variants: [{ id: 'desk-lamp-black', name: 'Black', priceCents: 3500, catalogVariantId: '5e0c1d64-8f1e-4a7b-9b55-2f7f6c1d9a10' }],
		};
		expect(parse({ ...VALID, products: [lamp] }).ok).toBe(true);
		expect(errorsOf({ ...VALID, products: [{ ...lamp, image: '//cdn.example/x.jpg' }] })).toContain('products[0].image: a path on the store such as /images/mug.jpg, or an https address');
	});

	it('refuses text that is not JSON', () => {
		expect(parseStoreManifest('{')).toEqual({ ok: false, errors: ['estori-store.json: not valid JSON'] });
	});
});
