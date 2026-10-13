import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitStore, RateLimitType } from './config';

describe('page text drafting limit', () => {
	it('allows 10 drafts per user per hour', () => {
		expect(DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.PAGE_COPY_DRAFT]).toEqual({
			enabled: true,
			store: RateLimitStore.DURABLE_OBJECT,
			limit: 10,
			period: 60 * 60,
		});
	});
});
