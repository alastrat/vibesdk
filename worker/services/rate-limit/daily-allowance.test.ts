import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, type RateLimitSettings } from './config';
import { countDailyCall, dailyCreditsLeft, loadDailyAllowance, type DailyAllowance } from './daily-allowance';
import { RateLimitService } from './rateLimits';

function allowanceWith(llmCalls: Partial<RateLimitSettings['llmCalls']> = {}, connected = false): DailyAllowance {
	return { config: { ...DEFAULT_RATE_LIMIT_SETTINGS, llmCalls: { ...DEFAULT_RATE_LIMIT_SETTINGS.llmCalls, ...llmCalls } }, hasCloudflareConfigured: connected };
}

function envWith(store: { increment?: ReturnType<typeof vi.fn>; getRemainingLimit?: ReturnType<typeof vi.fn> }): Env {
	return { ENVIRONMENT: 'production', DORateLimitStore: { getByName: () => store }, VibecoderStore: { get: async () => null } } as unknown as Env;
}

describe('the daily allowance', () => {
	it("counts a call at the model's flat cost against the user's daily bucket, and never refuses for a spent allowance", async () => {
		const increment = vi.fn().mockResolvedValue({ success: false, exceededLimit: 'daily' });
		await expect(countDailyCall(envWith({ increment }), allowanceWith(), 'user-1', 3, 'Task')).resolves.toBeUndefined();
		expect(increment).toHaveBeenCalledWith('platform:llmCalls:user:user-1', expect.objectContaining({ limit: 200, calendarDaily: true }), 3);
	});

	it("names the caller to the limiter, Think for the agent and Task for tasks, and counts the same bucket for both", async () => {
		const increment = vi.fn().mockResolvedValue({ success: true });
		const enforce = vi.spyOn(RateLimitService, 'enforceLLMCallsRateLimit');
		await countDailyCall(envWith({ increment }), allowanceWith(), 'user-1', 3, 'Think');
		await countDailyCall(envWith({ increment }), allowanceWith(), 'user-1', 3, 'Task');
		expect(enforce.mock.calls.map((call) => call[3])).toEqual(['Think', 'Task']);
		expect(increment.mock.calls.map((call) => call[0])).toEqual(['platform:llmCalls:user:user-1', 'platform:llmCalls:user:user-1']);
		enforce.mockRestore();
	});

	it('reports what is left today, and zero once it is spent', async () => {
		const getRemainingLimit = vi.fn().mockResolvedValueOnce(17).mockResolvedValueOnce(0);
		const env = envWith({ getRemainingLimit });
		expect(await dailyCreditsLeft(env, allowanceWith(), 'user-1')).toBe(17);
		expect(await dailyCreditsLeft(env, allowanceWith(), 'user-1')).toBe(0);
	});

	it('applies no limit when the limit is off, or when the limits exempt a connected Cloudflare account', async () => {
		const getRemainingLimit = vi.fn().mockResolvedValue(0);
		const env = envWith({ getRemainingLimit });
		expect(await dailyCreditsLeft(env, allowanceWith({ enabled: false }), 'user-1')).toBeNull();
		expect(await dailyCreditsLeft(env, allowanceWith({ excludeCloudflareConnected: true }, true), 'user-1')).toBeNull();
		expect(await dailyCreditsLeft(env, allowanceWith({ excludeCloudflareConnected: true }, false), 'user-1')).toBe(0);
		expect(getRemainingLimit).toHaveBeenCalledTimes(1);
	});

	it("never counts the user's Cloudflare account as paying for calls that don't use it", async () => {
		const allowance = await loadDailyAllowance(envWith({}), 'user-1', { ownAccountPays: false });
		expect(allowance).toEqual({ config: expect.objectContaining({ llmCalls: expect.objectContaining({ limit: 200 }) }), hasCloudflareConfigured: false });
	});
});
