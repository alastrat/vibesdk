import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitStore, RateLimitType } from './config';

describe('live store checkout limit', () => {
	it('allows twenty checkouts per shopper per store every ten minutes by default', () => {
		expect(DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.STORE_CHECKOUT]).toEqual({
			enabled: true,
			store: RateLimitStore.DURABLE_OBJECT,
			limit: 20,
			period: 10 * 60,
		});
	});
});
