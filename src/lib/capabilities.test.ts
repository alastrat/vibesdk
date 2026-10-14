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

	it('lists the Platform menu in the approved order', () => {
		expect(PLATFORM_CAPABILITIES).toEqual(['store-builder', 'agentic-commerce', 'operations-agents', 'personalized-shopping', 'product-catalog', 'digital-products']);
	});
});
