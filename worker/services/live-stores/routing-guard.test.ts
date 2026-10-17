import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/index.ts'], { query: '?raw', import: 'default', eager: true });

describe('live store routing', () => {
	it("looks a request's host up as a live store before any other host routing, never for Estori's own hosts", () => {
		const index = sources['/worker/index.ts'] ?? '';
		const lookup = index.indexOf('resolveStoreHost(env, hostname)');
		expect(lookup).toBeGreaterThan(-1);
		expect(index).toContain('handleLiveStore(request, env, ctx, store)');
		// Before the preview host, the main host and app subdomains are routed.
		expect(lookup).toBeLessThan(index.indexOf('if (separatePreviewDomain && hostname === previewDomain) {'));
		expect(lookup).toBeLessThan(index.indexOf('if (isMainDomainRequest) {'));
		expect(index.slice(index.lastIndexOf('\n', lookup - 200), lookup)).toContain('!isMainDomainRequest');
	});
});
