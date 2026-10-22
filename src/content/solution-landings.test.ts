import { describe, expect, it } from 'vitest';
import { SOLUTION_LANDINGS } from './solution-landings';

// These pages must stay truthful about availability while sharing a presentation.
describe('audience solution pages', () => {
	it('covers all five public routes with distinct copy and three clearly labeled examples', () => {
		expect(Object.keys(SOLUTION_LANDINGS)).toEqual(['brands', 'resellers', 'digital', 'subscriptions', 'communities']);
		const titles = new Set<string>();
		for (const [id, page] of Object.entries(SOLUTION_LANDINGS)) {
			expect(page.head.path).toBe(`/solutions/${id}`);
			expect(page.copy.features).toHaveLength(4);
			expect(page.copy.examples).toHaveLength(3);
			expect(page.art.features).toHaveLength(4);
			for (const example of page.copy.examples) expect(example.prompt.length).toBeGreaterThan(20);
			titles.add(page.copy.title);
		}
		expect(titles.size).toBe(5);
	});
	it('preserves capability anchors and early-access distinctions', () => {
		expect(SOLUTION_LANDINGS.brands.future.map((item) => item.id)).toEqual(['agentic-commerce', 'operations', 'personalization']);
		expect(SOLUTION_LANDINGS.resellers.sectionId).toBe('catalog');
		expect(SOLUTION_LANDINGS.resellers.more?.to).toBe('/platform/catalog-fulfillment');
		expect(SOLUTION_LANDINGS.digital.capability).toBe('digital-products');
		expect(SOLUTION_LANDINGS.communities.capability).toBe('digital-products');
		expect(SOLUTION_LANDINGS.subscriptions.capability).toBe('subscriptions');
	});
});
