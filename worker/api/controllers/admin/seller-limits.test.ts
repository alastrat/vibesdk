import { describe, expect, it } from 'vitest';
import { mergeSellerLimitsOverride, parseSellerLimitsOverride } from './seller-limits';

describe('seller limits overrides', () => {
	it('accepts a pinned level, or null to clear it, and numbers in range', () => {
		expect(parseSellerLimitsOverride({ pinnedLevel: 'established', largestOrderCents: 30_000 })).toEqual({ pinnedLevel: 'established', largestOrderCents: 30_000 });
		expect(parseSellerLimitsOverride({ pinnedLevel: null, payoutDelayDays: null })).toEqual({ pinnedLevel: null, payoutDelayDays: null });
	});

	it('refuses unknown levels, out-of-range numbers and unknown fields', () => {
		for (const body of [{ pinnedLevel: 'vip' }, { largestOrderCents: 50 }, { weeklySalesCents: 20_000_000 }, { payoutDelayDays: 1 }, { payoutDelayDays: 32 }, { costs: {} }, {}]) {
			expect(parseSellerLimitsOverride(body)).toBeNull();
		}
	});

	it("keeps the rest of the user's stored config and replaces only what was sent", () => {
		const stored = JSON.stringify({ security: { rateLimit: { appCreation: { limit: 1000 } } }, sellerLimits: { pinnedLevel: 'new', overrides: { largestOrderCents: 20_000 } } });
		const merged = JSON.parse(mergeSellerLimitsOverride(stored, { payoutDelayDays: 7 }));
		expect(merged.security.rateLimit.appCreation.limit).toBe(1000);
		expect(merged.sellerLimits).toEqual({ pinnedLevel: 'new', overrides: { largestOrderCents: 20_000, payoutDelayDays: 7 } });
		expect(JSON.parse(mergeSellerLimitsOverride(null, { pinnedLevel: 'established' }))).toEqual({ sellerLimits: { pinnedLevel: 'established', overrides: {} } });
	});
});
