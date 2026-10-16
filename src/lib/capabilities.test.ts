import { describe, expect, it } from 'vitest';
import { EARLY_ACCESS_CAPABILITIES } from '@/api-types';
import { CAPABILITIES, PLATFORM_CAPABILITIES, capabilitiesWithStatus, type CapabilityId, type CapabilityStatus } from './capabilities';

describe('capability registry', () => {
	it('gives each capability the status the spec approved', () => {
		const statuses: Record<CapabilityId, CapabilityStatus> = {
			'store-builder': 'available',
			'agentic-commerce': 'coming-soon',
			'operations-agents': 'coming-soon',
			'personalized-shopping': 'coming-soon',
			'product-catalog': 'coming-soon',
			'digital-products': 'early-access',
			'developer-templates': 'available',
			'content-creators': 'early-access',
			subscriptions: 'coming-soon',
			'email-marketing': 'coming-soon',
			'web-analytics': 'coming-soon',
			'search-optimization': 'coming-soon',
		};
		for (const [id, status] of Object.entries(statuses)) expect(CAPABILITIES[id as CapabilityId].status).toBe(status);
	});

	it('keys each entry by its own id and points it at a page on the site', () => {
		for (const [key, capability] of Object.entries(CAPABILITIES)) {
			expect(capability.id).toBe(key);
			expect(capability.path.startsWith('/')).toBe(true);
			expect(capability.name.length).toBeGreaterThan(0);
			expect(capability.description.length).toBeGreaterThan(0);
		}
	});

	it('takes early-access requests for exactly the ids the API accepts', () => {
		const ids = capabilitiesWithStatus('early-access').map((capability) => capability.id).sort();
		expect(ids).toEqual([...EARLY_ACCESS_CAPABILITIES].sort());
	});

	it('names the new platform capabilities the way the menu shows them, each at its own page', () => {
		expect(CAPABILITIES['email-marketing']).toMatchObject({ name: 'Email marketing', path: '/platform/email-marketing' });
		expect(CAPABILITIES['web-analytics']).toMatchObject({ name: 'Web analytics', path: '/platform/web-analytics' });
		expect(CAPABILITIES['search-optimization']).toMatchObject({ name: 'SEO, GEO & AEO optimization', path: '/platform/seo' });
		expect(CAPABILITIES.subscriptions.path).toBe('/solutions/subscriptions');
	});

	it('lists the Platform menu in the approved order', () => {
		expect(PLATFORM_CAPABILITIES).toEqual(['store-builder', 'operations-agents', 'personalized-shopping', 'email-marketing', 'web-analytics', 'search-optimization']);
	});
});
