import { describe, expect, it } from 'vitest';
import { mergeSellerLimitsOverride, parseSellerLimitsOverride, SellerLimitsAdminController } from './seller-limits';
import { recordingD1 } from '../../../database/test-support/recording-d1';
import type { RouteContext } from '../../types/route-context';

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

	it("refuses names inherited from Object's prototype instead of failing", () => {
		for (const body of [{ toString: 1 }, { constructor: 1 }, JSON.parse('{"__proto__": 1}'), JSON.parse('{"hasOwnProperty": null}')]) {
			expect(parseSellerLimitsOverride(body)).toBeNull();
		}
	});

	it('answers 404 for a user who does not exist, and stores nothing', async () => {
		const { d1 } = recordingD1([]);
		const puts: string[] = [];
		const env = { DB: d1, VibecoderStore: { get: async () => null, put: async (key: string) => void puts.push(key) } } as unknown as Env;
		const request = new Request('https://estori.test/api/admin/sellers/u_missing/limits', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinnedLevel: 'new' }) });
		const response = await SellerLimitsAdminController.setLimits(request, env, {} as ExecutionContext, { pathParams: { userId: 'u_missing' } } as unknown as RouteContext);
		expect(response.status).toBe(404);
		expect(puts).toEqual([]);
	});
});
