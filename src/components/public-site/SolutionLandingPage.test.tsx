import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { SOLUTION_LANDINGS, type SolutionId } from '@/content/solution-landings';
import { SolutionLandingPage } from './SolutionLandingPage';
import { SolutionCarousel } from './SolutionCarousel';

vi.mock('@/hooks/use-early-access', () => ({ useEarlyAccessFromUrl: vi.fn() }));
vi.mock('./StartBuildingButton', () => ({ StartBuildingButton: () => <a href="/signup">Start building free</a> }));
vi.mock('./EarlyAccessButton', () => ({
	EarlyAccessButton: ({ capability }: { capability: string }) => <button data-capability={capability}>Request early access</button>,
}));

const renderPage = (id: SolutionId) =>
	renderToStaticMarkup(
		<MemoryRouter>
			<SolutionLandingPage id={id} />
		</MemoryRouter>,
	);

describe('solution audience layout', () => {
	it('renders each audience once with four visual benefits and three labeled example slides', () => {
		for (const id of Object.keys(SOLUTION_LANDINGS) as SolutionId[]) {
			const html = renderPage(id);
			expect(html.match(/<h1\b/g), id).toHaveLength(1);
			for (const feature of SOLUTION_LANDINGS[id].copy.features) expect(html, id).toContain(feature.title);
			expect(html.match(/aria-roledescription="slide"/g), id).toHaveLength(3);
			expect(html, id).toContain('Example use case');
			expect(html, id).not.toContain('What your store comes with today');
		}
	});
	it('keeps complete step instructions available to screen readers without a replay control', () => {
		const html = renderPage('resellers');
		for (const step of SOLUTION_LANDINGS.resellers.copy.steps) expect(html).toContain(step);
		expect(html).not.toContain('Replay');
		expect(html).toContain('From idea to storefront');
	});
	it('retains deep links and catalog details without repeating the full landing-page sections', () => {
		const brands = renderPage('brands');
		expect(brands).toContain('href="/agentic-commerce"');
		for (const id of ['agentic-commerce', 'operations', 'personalization']) expect(brands).toContain(`id="${id}"`);
		const resellers = renderPage('resellers');
		expect(resellers).toContain('id="catalog"');
		expect(resellers).toContain('href="/platform/catalog-fulfillment"');
	});
	it('keeps early-access requests connected to digital products and labels future store subscriptions', () => {
		for (const id of ['digital', 'communities'] as const) {
			const html = renderPage(id);
			expect(html).toContain('Early access');
			expect(html).toContain('data-capability="digital-products"');
			expect(html).toContain('Concept preview');
		}
		const subscriptions = renderPage('subscriptions');
		expect(subscriptions).toContain('Coming soon');
		expect(subscriptions).not.toContain('Request early access');
	});
});

describe('use-case carousel', () => {
	it('exposes named controls, slide positions and keyboard instructions with the first previous action disabled', () => {
		const page = SOLUTION_LANDINGS.brands;
		const html = renderToStaticMarkup(<SolutionCarousel title={page.copy.carouselTitle} examples={page.copy.examples} art={page.art.examples} />);
		expect(html).toContain('aria-roledescription="carousel"');
		expect(html).toContain('aria-label="Previous example"');
		expect(html).toContain('aria-label="Next example"');
		expect(html).toContain('Use left and right arrow keys');
		const previous = html.match(/<button[^>]*aria-label="Previous example"[^>]*>/)?.[0];
		expect(previous).toContain('disabled=""');
		expect(html).toContain('aria-live="polite"');
		expect(html).toContain('1 of 3:');
		expect(html).toContain('3 of 3:');
	});
});
