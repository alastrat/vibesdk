import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/hooks/use-showcase-stores.ts'], { query: '?raw', import: 'default', eager: true });

describe('useShowcaseStores', () => {
	it('reads popular reusable Discover stores under its own query key', () => {
		const hook = sources['/src/hooks/use-showcase-stores.ts'];
		expect(hook).toBeDefined();
		expect(hook).toContain("getPublicApps({ sort: 'popular', limit: 24, reusableOnly: true })");
		expect(hook).toContain('queryKeys.apps.showcase()');
		expect(hook).toContain('.map(toShowcaseStore)');
	});

	it('keeps the stores for 30 minutes, well inside the 6-hour image signatures, so images are not downloaded again on every visit', () => {
		expect(sources['/src/hooks/use-showcase-stores.ts']).toContain('staleTime: 30 * 60_000');
	});
});
