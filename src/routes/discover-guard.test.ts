import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/home.tsx',
		'/src/routes/discover/index.tsx',
		'/src/components/shared/AppCard.tsx',
		'/src/components/publishing/DiscoverStrip.tsx',
		'/src/components/layout/app-sidebar.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('one Discover gallery', () => {
	it('filters Discover by category and price', () => {
		const discover = source('/src/routes/discover/index.tsx');
		expect(discover).toContain('category,');
		expect(discover).toContain('pricing,');
		expect(discover).toContain('DISCOVER_PRICING_FILTERS');
	});

	it('shows the price of paid sites and the use count on cards', () => {
		const card = source('/src/components/shared/AppCard.tsx');
		expect(card).toContain('formatTemplatePrice(');
		expect(card).toContain('STATS_ICONS.forkCount');
	});

	it('starts from a published site on the home page', () => {
		expect(source('/src/routes/home.tsx')).toContain('<DiscoverStrip />');
		const strip = source('/src/components/publishing/DiscoverStrip.tsx');
		expect(strip).toContain('reusableOnly: true');
		expect(strip).toContain('Start from a published site');
		expect(strip).toContain('to={`/discover/${app.id}`}');
	});

	it('opens product pages from Discover and the home page community cards', () => {
		expect(source('/src/routes/discover/index.tsx')).toContain('navigate(`/discover/${appId}`)');
		expect(source('/src/routes/home.tsx')).toContain('navigate(`/discover/${app.id}`)');
	});

	it('redirects the old template URLs and drops the Templates entry', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain('<Navigate to="/discover" replace />');
		expect(routes).toContain('<Navigate to="/admin/reviews" replace />');
		expect(routes).toContain("path: 'admin/reviews'");
		expect(source('/src/components/layout/app-sidebar.tsx')).not.toContain("navigate('/templates')");
	});
});
