import { describe, expect, it } from 'vitest';
import { DRAFT_LIMIT } from './drafts';
import {
	EXTRA_CREDITS,
	PLAN_LIMITS,
	PLAN_PRICES_CENTS,
	assertWithinLimit,
	extraCreditsPriceCents,
	formatBillingDate,
	isExtraCreditsAmount,
	isPlanLimitRefusal,
	limitsFor,
	planLimitOverridesFrom,
	type PlanAccount,
	type PlanAccountInput,
} from './plans';

const RESET = Date.UTC(2026, 10, 19);

function account(overrides: Partial<PlanAccountInput> = {}): PlanAccount {
	const input: PlanAccountInput = { billing: true, plan: 'basic', adminLimits: null, ...overrides };
	return { billing: input.billing, plan: input.plan, limits: limitsFor(input), creditsResetAt: RESET };
}

const PREMIUM_ROW = { aiCredits: 100_000, storesLifetime: null, newStoresPerDay: 25, liveStores: 10, ownDomainsPerLiveStore: 1, supplierCatalog: true, extraCredits: true, draftsPerStore: 5 };

describe('the plan table', () => {
	it("holds the owner's plans, prices and limits", () => {
		expect(PLAN_PRICES_CENTS).toEqual({ pro: 4_900, premium: 19_900 });
		expect(PLAN_LIMITS).toEqual({
			basic: { aiCredits: 5_000, storesLifetime: 3, newStoresPerDay: null, liveStores: 1, ownDomainsPerLiveStore: 0, supplierCatalog: false, extraCredits: false, draftsPerStore: 5 },
			pro: { aiCredits: 20_000, storesLifetime: null, newStoresPerDay: 10, liveStores: 3, ownDomainsPerLiveStore: 1, supplierCatalog: true, extraCredits: false, draftsPerStore: 5 },
			premium: PREMIUM_ROW,
			enterprise: PREMIUM_ROW,
		});
		expect(DRAFT_LIMIT).toBe(5);
	});

	it('sells extra credits from 5,000 to 1,000,000 in steps of 1,000, at $1.50 per 1,000', () => {
		expect(EXTRA_CREDITS).toEqual({ creditsPerUnit: 1_000, unitPriceCents: 150, minCredits: 5_000, maxCredits: 1_000_000, monthsValid: 12 });
		expect(extraCreditsPriceCents(5_000)).toBe(750);
		expect(extraCreditsPriceCents(12_000)).toBe(1_800);
		for (const amount of [5_000, 6_000, 1_000_000]) expect(isExtraCreditsAmount(amount)).toBe(true);
		for (const amount of [4_000, 5_500, 1_001_000, '5000', 5_000.5, null]) expect(isExtraCreditsAmount(amount)).toBe(false);
	});
});

describe('limitsFor', () => {
	it("gives each plan its row, and an admin override wins", () => {
		expect(limitsFor({ billing: true, plan: 'pro', adminLimits: null })).toEqual(PLAN_LIMITS.pro);
		expect(limitsFor({ billing: true, plan: 'enterprise', adminLimits: { aiCredits: 1_000_000, liveStores: 50 } })).toMatchObject({ aiCredits: 1_000_000, liveStores: 50, newStoresPerDay: 25 });
		expect(limitsFor({ billing: true, plan: 'basic', adminLimits: { storesLifetime: null } }).storesLifetime).toBeNull();
	});

	it('enforces nothing new while billing is off', () => {
		expect(limitsFor({ billing: false, plan: 'premium', adminLimits: { liveStores: 2 } })).toEqual({ ...PLAN_LIMITS.basic, storesLifetime: null, liveStores: null, ownDomainsPerLiveStore: 1, supplierCatalog: true });
	});
});

describe('assertWithinLimit', () => {
	it('refuses Basic at each limit with the copy from the spec, pointing at the next plan that lifts it', () => {
		const basic = account();
		expect(assertWithinLimit(basic, 'aiCredits', 4_999)).toBeNull();
		expect(assertWithinLimit(basic, 'aiCredits', 5_000)).toEqual({
			code: 'plan_limit',
			limit: 'aiCredits',
			plan: 'basic',
			upgradeTo: 'pro',
			message: "You've used this month's free AI credits. They refill on November 19, or get Pro for 20,000 a month.",
		});
		expect(assertWithinLimit(basic, 'storesLifetime', 2)).toBeNull();
		expect(assertWithinLimit(basic, 'storesLifetime', 3)).toMatchObject({ upgradeTo: 'pro', message: "Basic includes 3 stores, counting ones you've deleted. Get Pro to start up to 10 a day." });
		expect(assertWithinLimit(basic, 'newStoresPerDay', 99)).toBeNull();
		expect(assertWithinLimit(basic, 'liveStores', 1)).toMatchObject({ upgradeTo: 'pro', message: 'Basic includes 1 live store. Get Pro for up to 3, or Premium for up to 10.' });
		expect(assertWithinLimit(basic, 'ownDomainsPerLiveStore', 0)).toMatchObject({ upgradeTo: 'pro', message: 'Own domains come with Pro and Premium.' });
		expect(assertWithinLimit(basic, 'supplierCatalog')).toMatchObject({ upgradeTo: 'pro', message: 'Adding catalog products to your store comes with Pro and Premium. Products already live keep selling.' });
		expect(assertWithinLimit(basic, 'extraCredits')).toMatchObject({ upgradeTo: 'premium', message: 'Buying extra credits comes with Premium.' });
	});

	it('points Pro at Premium, Premium at extra credits or Enterprise, and Enterprise nowhere', () => {
		const pro = account({ plan: 'pro' });
		expect(assertWithinLimit(pro, 'aiCredits', 20_000)).toMatchObject({ upgradeTo: 'premium', message: "You've used this month's AI credits. They refill on November 19, or move to Premium for 100,000 a month." });
		expect(assertWithinLimit(pro, 'newStoresPerDay', 10)).toMatchObject({ upgradeTo: 'premium', message: "You've started 10 new stores today. Start more tomorrow, or move to Premium for up to 25 a day." });
		expect(assertWithinLimit(pro, 'liveStores', 3)).toMatchObject({ upgradeTo: 'premium', message: 'Pro includes 3 live stores. Move to Premium for up to 10.' });
		expect(assertWithinLimit(pro, 'supplierCatalog')).toBeNull();
		const premium = account({ plan: 'premium' });
		expect(assertWithinLimit(premium, 'aiCredits', 100_000)).toMatchObject({ upgradeTo: 'credits', message: "You've used this month's AI credits. Buy more credits now, or wait until November 19." });
		expect(assertWithinLimit(premium, 'newStoresPerDay', 25)).toMatchObject({ upgradeTo: 'enterprise', message: "You've started 25 new stores today. Start more tomorrow, or talk to us about Enterprise." });
		expect(assertWithinLimit(premium, 'liveStores', 10)).toMatchObject({ upgradeTo: 'enterprise', message: 'Premium includes 10 live stores. Talk to us about Enterprise for more.' });
		expect(assertWithinLimit(premium, 'extraCredits')).toBeNull();
		expect(assertWithinLimit(account({ plan: 'enterprise', adminLimits: { liveStores: 3 } }), 'liveStores', 3)).toMatchObject({ upgradeTo: null, message: 'Enterprise includes 3 live stores. Talk to us to raise it.' });
		expect(assertWithinLimit(account({ plan: 'enterprise' }), 'aiCredits', 100_000)).toMatchObject({ upgradeTo: null, message: "You've used this month's AI credits. Talk to us about more, or wait until November 19." });
	});

	it('refuses nothing while billing is off, and recognizes a refusal that crossed the network', () => {
		const off = account({ billing: false });
		for (const key of ['aiCredits', 'storesLifetime', 'liveStores', 'supplierCatalog', 'extraCredits'] as const) expect(assertWithinLimit(off, key, 1_000_000)).toBeNull();
		expect(isPlanLimitRefusal(JSON.parse(JSON.stringify(assertWithinLimit(account(), 'supplierCatalog'))))).toBe(true);
		for (const value of [null, 'plan_limit', { code: 'plan_limit', limit: 'nope', plan: 'basic', upgradeTo: null, message: 'x' }, { code: 'plan_limit', limit: 'liveStores', plan: 'gold', upgradeTo: null, message: 'x' }]) {
			expect(isPlanLimitRefusal(value)).toBe(false);
		}
	});
});

describe('admin limit overrides', () => {
	it('reads only known limits within range, with null lifting a store cap', () => {
		expect(planLimitOverridesFrom({ aiCredits: 300_000, liveStores: 25, storesLifetime: null, extraCredits: true })).toEqual({ aiCredits: 300_000, liveStores: 25, storesLifetime: null, extraCredits: true });
		expect(planLimitOverridesFrom({})).toEqual({});
		for (const bad of [{ aiCredits: 0 }, { liveStores: 1.5 }, { supplierCatalog: 'yes' }, { draftsPerStore: 9 }, { ownDomainsPerLiveStore: 2 }, { liveStores: null }, { toString: 1 }, 'x', null, []]) {
			expect(planLimitOverridesFrom(bad)).toBeNull();
		}
	});
});

describe('formatBillingDate', () => {
	it('names the day in UTC', () => {
		expect(formatBillingDate(Date.UTC(2026, 10, 19, 23, 59))).toBe('November 19');
	});
});
