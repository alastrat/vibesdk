import { describe, expect, it } from 'vitest';
import { EARLY_ACCESS_PARAM, earlyAccessReturnUrl, requestedCapability } from './early-access';

describe('early access return URL', () => {
	it('carries the program through a sign-in that leaves the page', () => {
		expect(EARLY_ACCESS_PARAM).toBe('request');
		expect(earlyAccessReturnUrl('/solutions/digital', 'digital-products')).toBe('/solutions/digital?request=digital-products');
	});

	it('reads back only programs that take requests', () => {
		expect(requestedCapability('?request=content-creators')).toBe('content-creators');
		expect(requestedCapability('?request=agentic-commerce')).toBeNull();
		expect(requestedCapability('?request=')).toBeNull();
		expect(requestedCapability('')).toBeNull();
	});
});
