import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/lib/api-client.ts', '/src/components/publishing/SiteReuseBar.tsx', '/src/hooks/use-publishing.ts', '/src/routes/admin/reviews.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('showcased stores', () => {
	it('asks the API for showcased stores and lets admins change the flag', () => {
		const client = source('/src/lib/api-client.ts');
		expect(client).toContain("if (params?.showcasedOnly) queryParams.set('showcasedOnly', 'true');");
		expect(client).toContain("this.request<ShowcaseChangeData>(`/api/admin/apps/${appId}/showcase`, { method: 'PUT', body })");
	});

	it('gives admins a landing page switch next to Remove from Discover, for public stores still in Discover', () => {
		const bar = source('/src/components/publishing/SiteReuseBar.tsx');
		expect(bar).toContain('<ShowcaseSwitch');
		expect(bar).toContain('Show on the landing page');
		expect(bar).toContain('Remove from the landing page');
		expect(bar).toMatch(/app\.visibility === 'public' && !app\.removedFromDiscover/);
		expect(bar).toContain('app.isFeatured');
	});

	it('refreshes the store and the landing page data after a change', () => {
		const hooks = source('/src/hooks/use-publishing.ts');
		expect(hooks).toMatch(/export function useSetShowcased\(\) \{\s*return usePublishingMutation\(/);
		// The shared publishing mutation refreshes every app query, the landing page's showcase included.
		expect(hooks).toContain('queryClient.invalidateQueries({ queryKey: queryKeys.apps.all })');
	});

	it('tells admins how many showcased stores the moving gallery still needs', () => {
		const reviews = source('/src/routes/admin/reviews.tsx');
		expect(reviews).toContain('SHOWCASE_MOVING_MIN');
		expect(reviews).toContain('useShowcaseStores()');
	});
});
