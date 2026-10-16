import { describe, expect, it } from 'vitest';
import { AUDIENCES } from './site-nav';

describe('site navigation', () => {
	it('lists who Estori is for, ending with subscriptions and communities, each at its own page', () => {
		expect(AUDIENCES.map((item) => [item.label, item.to])).toEqual([
			['Brands and store owners', '/solutions/brands'],
			['Dropshippers and resellers', '/solutions/resellers'],
			['Digital businesses', '/solutions/digital'],
			['Subscriptions', '/solutions/subscriptions'],
			['Communities', '/solutions/communities'],
		]);
	});

	it("tags subscriptions as coming soon, and communities with digital products' early access", () => {
		expect(AUDIENCES.find((item) => item.label === 'Subscriptions')?.capability).toBe('subscriptions');
		expect(AUDIENCES.find((item) => item.label === 'Communities')?.capability).toBe('digital-products');
	});
});
