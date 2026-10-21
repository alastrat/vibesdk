import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAN_LIMITS, type PlanId } from '../../../shared/types/plans';
import { RateLimitExceededError } from '../../../shared/types/errors';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitType, type RateLimitSettings } from '../rate-limit/config';
import { RateLimitService } from '../rate-limit/rateLimits';
import type { AuthUser } from '../../types/auth-types';
import type { BillingAccount } from './account';
import { checkStoreStart, storeStartDepsFromEnv, type StoreStartDeps } from './store-limits';

function account(plan: PlanId, billing = true): BillingAccount {
	const period = { key: 'acct:1', startMs: 0, endMs: Date.UTC(2026, 10, 12) };
	return { billing, userId: 'u1', plan, limits: billing ? PLAN_LIMITS[plan] : { ...PLAN_LIMITS.basic, storesLifetime: null, liveStores: null }, creditsResetAt: period.endMs, source: 'free', period, graceEndsAtMs: null, subscription: null };
}

function counters(started: number, today: number) {
	const calls: string[] = [];
	const deps: StoreStartDeps = {
		reserveStore: async (cap) => {
			calls.push(`reserve:${cap}`);
			if (cap !== null && started >= cap) return { reserved: false, started };
			started += 1;
			return { reserved: true, started };
		},
		takeDailyStore: async (limit) => {
			calls.push(`daily:${limit}`);
			if (today >= limit) return false;
			today += 1;
			return true;
		},
	};
	return { deps, calls };
}

describe('checkStoreStart', () => {
	it("starts Basic's stores up to its third, counting deleted ones, and refuses after", async () => {
		const { deps, calls } = counters(2, 0);
		expect(await checkStoreStart(deps, account('basic'))).toBeNull();
		expect(await checkStoreStart(deps, account('basic'))).toMatchObject({ limit: 'storesLifetime', upgradeTo: 'pro', message: "Basic includes 3 stores, counting ones you've deleted. Get Pro to start up to 10 a day." });
		expect(calls).toEqual(['reserve:3', 'reserve:3']);
	});

	it('limits Pro and Premium per day, and still counts their stores in case they move to Basic', async () => {
		const pro = counters(40, 9);
		expect(await checkStoreStart(pro.deps, account('pro'))).toBeNull();
		expect(await checkStoreStart(pro.deps, account('pro'))).toMatchObject({ limit: 'newStoresPerDay', upgradeTo: 'premium' });
		expect(pro.calls).toEqual(['daily:10', 'reserve:null', 'daily:10']);
		const premium = counters(0, 25);
		expect(await checkStoreStart(premium.deps, account('premium'))).toMatchObject({ limit: 'newStoresPerDay', upgradeTo: 'enterprise' });
	});

	it("refuses nothing while billing is off, but still counts the store; today's daily limit stays with the controller", async () => {
		const { deps, calls } = counters(99, 99);
		expect(await checkStoreStart(deps, account('basic', false))).toBeNull();
		expect(calls).toEqual(['reserve:null']);
	});

	it('lets a start through when the count fails while billing is off, logging it, but fails it while billing is on', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const failing: StoreStartDeps = {
			reserveStore: async () => {
				throw new Error('D1 unavailable');
			},
			takeDailyStore: async () => true,
		};
		try {
			expect(await checkStoreStart(failing, account('basic', false))).toBeNull();
			const lines = JSON.stringify(logged.mock.calls);
			expect(lines).toContain('A new store could not be counted');
			expect(lines).toContain('u1');
			await expect(checkStoreStart(failing, account('basic'))).rejects.toThrow('D1 unavailable');
			await expect(checkStoreStart(failing, account('pro'))).rejects.toThrow('D1 unavailable');
		} finally {
			logged.mockRestore();
		}
	});
});

describe('storeStartDepsFromEnv', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("takes today's place on the app-creation limiter at the plan's daily limit, even where that limiter is off", async () => {
		const seen: RateLimitSettings[] = [];
		const enforce = vi.spyOn(RateLimitService, 'enforceAppCreationRateLimit').mockImplementation(async (_env, config) => {
			seen.push(config);
			if (seen.length > 1) throw new RateLimitExceededError('App creation rate limit exceeded', RateLimitType.APP_CREATION, 10, 86_400);
		});
		const off = { ...DEFAULT_RATE_LIMIT_SETTINGS, appCreation: { ...DEFAULT_RATE_LIMIT_SETTINGS.appCreation, enabled: false } };
		const deps = storeStartDepsFromEnv({} as Env, { id: 'u1' } as AuthUser, new Request('https://estori.app/api/agent'), off);
		expect(await deps.takeDailyStore(10)).toBe(true);
		expect(seen[0]?.appCreation).toMatchObject({ enabled: true, limit: 10, dailyLimit: 10, period: 86_400 });
		expect(seen[0]?.llmCalls).toBe(off.llmCalls);
		expect(await deps.takeDailyStore(10)).toBe(false);
		enforce.mockRejectedValueOnce(new Error('limiter unreachable'));
		await expect(deps.takeDailyStore(10)).rejects.toThrow('limiter unreachable');
	});
});

const controllerSources = import.meta.glob<string>('/worker/api/controllers/agent/controller.ts', { query: '?raw', import: 'default', eager: true });

describe('starting a store', () => {
	it('checks the plan after credits and counts every start, keeping the old rate limit only while billing is off', () => {
		const controller = Object.values(controllerSources)[0] ?? '';
		const credits = controller.indexOf('checkCreditsBeforeTurn(env, user.id)');
		const billingOff = controller.indexOf('if (!credits.billing) {');
		const rateLimit = controller.indexOf('enforceAppCreationRateLimit(');
		const start = controller.indexOf('checkStoreStart(storeStartDepsFromEnv(env, user, request, context.config.security.rateLimit), await loadAccount(env, user.id))');
		expect(credits).toBeGreaterThan(-1);
		expect(billingOff).toBeGreaterThan(credits);
		expect(rateLimit).toBeGreaterThan(billingOff);
		expect(start).toBeGreaterThan(rateLimit);
		expect(start).toBeLessThan(controller.indexOf('const agentId = generateId()'));
		expect(controller).toContain('createPlanLimitResponse(storeRefusal)');
	});
});
