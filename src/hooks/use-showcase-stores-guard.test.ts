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
});
