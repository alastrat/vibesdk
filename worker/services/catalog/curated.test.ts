import { describe, expect, it } from 'vitest';
import { CURATED_PRODUCTS } from './curated';
import { SUPPLIER_NAMES } from '../../../src/routes/copy-rules';

describe('the curated catalog', () => {
	it('lists 5 to 10 distinct supplier products, each with a category and no supplier name', () => {
		expect(CURATED_PRODUCTS.length).toBeGreaterThanOrEqual(5);
		expect(CURATED_PRODUCTS.length).toBeLessThanOrEqual(10);
		expect(new Set(CURATED_PRODUCTS.map((entry) => entry.supplierProductId)).size).toBe(CURATED_PRODUCTS.length);
		for (const entry of CURATED_PRODUCTS) {
			expect(entry.category.length).toBeGreaterThan(0);
			const text = `${entry.title ?? ''} ${entry.category}`.toLowerCase();
			for (const name of SUPPLIER_NAMES) expect(text).not.toContain(name);
		}
	});
});
