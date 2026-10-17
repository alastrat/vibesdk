import { describe, expect, it } from 'vitest';
import { getSellerLimitsSettings, getUserConfigurableSettings } from './index';

function envWith(store: Map<string, string>): Env {
	return { VibecoderStore: { get: async (key: string) => store.get(key) ?? null } } as unknown as Env;
}

describe('getSellerLimitsSettings', () => {
	it("reads an admin's change at once, even after the user's settings were cached", async () => {
		const store = new Map([['user_config:u_cached', JSON.stringify({ sellerLimits: { pinnedLevel: 'established' } })]]);
		const env = envWith(store);
		expect((await getUserConfigurableSettings(env, 'u_cached')).sellerLimits.pinnedLevel).toBe('established');

		store.set('user_config:u_cached', JSON.stringify({ sellerLimits: { pinnedLevel: 'new', overrides: { weeklySalesCents: 10_000 } } }));
		const settings = await getSellerLimitsSettings(env, 'u_cached');
		expect(settings.pinnedLevel).toBe('new');
		expect(settings.overrides).toEqual({ largestOrderCents: null, weeklySalesCents: 10_000, payoutDelayDays: null });
		expect(settings.levels.new.largestOrderCents).toBe(15_000);
	});

	it('refuses to guess when the stored settings are unreadable, rather than drop an admin limit', async () => {
		const env = envWith(new Map([['user_config:u_broken', '{not json']]));
		await expect(getSellerLimitsSettings(env, 'u_broken')).rejects.toThrow();
	});
});
