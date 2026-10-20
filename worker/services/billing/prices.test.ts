import { describe, expect, it } from 'vitest';
import { planOfPrice, stripePriceIds } from './prices';

const IDS_JSON = '{"pro":"price_p","premium":"price_m","credits":"price_c"}';

describe('Stripe prices', () => {
	it('reads the three price ids, and nothing from an incomplete or malformed value', () => {
		expect(stripePriceIds(IDS_JSON)).toEqual({ pro: 'price_p', premium: 'price_m', credits: 'price_c' });
		for (const bad of [undefined, '', 'nope', '{"pro":"price_p"}', '{"pro":"price_p","premium":"price_m","credits":"prod_c"}', '[]']) expect(stripePriceIds(bad)).toBeNull();
	});

	it("finds a price's plan from the configured ids, then from its metadata", () => {
		const ids = stripePriceIds(IDS_JSON);
		expect(planOfPrice({ id: 'price_m', metadata: null }, ids)).toBe('premium');
		expect(planOfPrice({ id: 'price_old', metadata: { estori_plan: 'pro' } }, ids)).toBe('pro');
		expect(planOfPrice({ id: 'price_c', metadata: null }, ids)).toBeNull();
		expect(planOfPrice({ id: 'price_x', metadata: { estori_plan: 'gold' } }, ids)).toBeNull();
	});
});
