import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitStore, RateLimitType } from './config';

const sources = import.meta.glob<string>('/worker/services/rate-limit/rateLimits.ts', {
	query: '?raw',
	import: 'default',
	eager: true,
});

function methodBody(signature: string): string {
	const text = sources['/worker/services/rate-limit/rateLimits.ts'];
	if (text === undefined) throw new Error('rateLimits.ts source not found');
	const start = text.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	const next = text.indexOf('\n\tstatic ', start + signature.length);
	return next === -1 ? text.slice(start) : text.slice(start, next);
}

describe('account email limit', () => {
	it('allows five emails per client or user per hour by default', () => {
		expect(DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.AUTH_EMAIL]).toEqual({
			enabled: true,
			store: RateLimitStore.DURABLE_OBJECT,
			limit: 5,
			period: 60 * 60,
		});
	});

	it('is keyed as authEmail', () => {
		expect(RateLimitType.AUTH_EMAIL).toBe('authEmail');
	});

	it('builds its key from the universal identifier with the AUTH_EMAIL type', () => {
		const body = methodBody('static async enforceAuthEmailRateLimit(');
		expect(body).toContain('getUniversalIdentifier(user, request)');
		expect(body).toContain('buildRateLimitKey(RateLimitType.AUTH_EMAIL');
		expect(body).toContain("'Please try again in an hour.'");
	});
});
