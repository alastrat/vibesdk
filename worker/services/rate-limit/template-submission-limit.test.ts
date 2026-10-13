import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitStore, RateLimitType } from './config';

describe('template submission limit', () => {
	it('allows five submissions per user per day by default', () => {
		expect(DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.TEMPLATE_SUBMISSION]).toEqual({
			enabled: true,
			store: RateLimitStore.DURABLE_OBJECT,
			limit: 5,
			period: 24 * 60 * 60,
		});
	});
});
