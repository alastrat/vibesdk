import { describe, expect, it } from 'vitest';
import { DRAFT_LIMIT } from './drafts';
import {
	EXTRA_CREDITS,
	PLAN_LIMITS,
	PLAN_PRICES_CENTS,
	assertWithinLimit,
	extraCreditsPriceCents,
	formatBillingDate,
	formatCredits,
	formatUsd,
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

const PREMIUM_ROW = { aiCredits: 100_000, storesLifetime: 20, newStoresPerDay: null, liveStores: 20, ownDomainsPerLiveStore: 1, supplierCatalog: true, extraCredits: true, shopperEmails: true, customShopperEmails: true, shipmentTracking: true, orderRefunds: true, flexiblePayouts: true, draftsPerStore: 5 };

describe('the plan table', () => {
	it("holds the owner's plans, prices and limits", () => {
		expect(PLAN_PRICES_CENTS).toEqual({ pro: 4_900, premium: 19_900 });
		expect(PLAN_LIMITS).toEqual({
			basic: { aiCredits: 5_000, storesLifetime: 2, newStoresPerDay: null, liveStores: 2, ownDomainsPerLiveStore: 0, supplierCatalog: true, extraCredits: true, shopperEmails: false, customShopperEmails: false, shipmentTracking: false, orderRefunds: false, flexiblePayouts: false, draftsPerStore: 5 },
			pro: { aiCredits: 20_000, storesLifetime: 5, newStoresPerDay: null, liveStores: 5, ownDomainsPerLiveStore: 1, supplierCatalog: true, extraCredits: true, shopperEmails: true, customShopperEmails: false, shipmentTracking: false, orderRefunds: false, flexiblePayouts: true, draftsPerStore: 5 },
			premium: PREMIUM_ROW,
			enterprise: PREMIUM_ROW,
		});
		expect(DRAFT_LIMIT).toBe(5);
	});

	it('reserves shopper emails, customization and payout schedule changes for Pro and above', () => {
		for (const key of ['shopperEmails', 'flexiblePayouts'] as const) {
			expect(PLAN_LIMITS.basic[key]).toBe(false);
			for (const plan of ['pro', 'premium', 'enterprise'] as const) expect(PLAN_LIMITS[plan][key]).toBe(true);
			expect(assertWithinLimit(account(), key)).toMatchObject({ limit: key, plan: 'basic', upgradeTo: 'pro' });
			expect(assertWithinLimit(account({ plan: 'pro' }), key)).toBeNull();
			expect(assertWithinLimit(account({ billing: false }), key)).toBeNull();
		}
	});

	it('includes the supplier catalog on every plan while preserving explicit account restrictions', () => {
		for (const plan of ['basic', 'pro', 'premium', 'enterprise'] as const) {
			expect(assertWithinLimit(account({ plan }), 'supplierCatalog')).toBeNull();
			expect(assertWithinLimit(account({ plan, adminLimits: { supplierCatalog: false } }), 'supplierCatalog')).toMatchObject({ limit: 'supplierCatalog', upgradeTo: null, message: 'Catalog access is disabled for your account. Products already live keep selling. Contact support for help.' });
		}
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
		expect(limitsFor({ billing: true, plan: 'enterprise', adminLimits: { aiCredits: 1_000_000, liveStores: 50 } })).toMatchObject({ aiCredits: 1_000_000, liveStores: 50, newStoresPerDay: null });
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
		expect(assertWithinLimit(basic, 'storesLifetime', 1)).toBeNull();
		expect(assertWithinLimit(basic, 'storesLifetime', 2)).toMatchObject({ upgradeTo: 'pro', message: "Basic includes 2 stores, counting ones you've deleted. Upgrade to Pro for up to 5." });
		expect(assertWithinLimit(basic, 'newStoresPerDay', 99)).toBeNull();
		expect(assertWithinLimit(basic, 'liveStores', 2)).toMatchObject({ upgradeTo: 'pro', message: 'Basic includes 2 live stores. Get Pro for up to 5, or Premium for up to 20.' });
		expect(assertWithinLimit(basic, 'ownDomainsPerLiveStore', 0)).toMatchObject({ upgradeTo: 'pro', message: 'Own domains come with Pro and Premium.' });
		expect(assertWithinLimit(basic, 'supplierCatalog')).toBeNull();
		expect(assertWithinLimit(basic, 'extraCredits')).toBeNull();
	});

	it('points Pro at Premium, Premium at extra credits or Enterprise, and Enterprise nowhere', () => {
		const pro = account({ plan: 'pro' });
		expect(assertWithinLimit(pro, 'aiCredits', 20_000)).toMatchObject({ upgradeTo: 'premium', message: "You've used this month's AI credits. They refill on November 19, or move to Premium for 100,000 a month." });
		expect(assertWithinLimit(pro, 'newStoresPerDay', 999)).toBeNull();
		expect(assertWithinLimit(pro, 'storesLifetime', 5)).toMatchObject({ upgradeTo: 'premium', message: "Pro includes 5 stores, counting ones you've deleted. Upgrade to Premium for up to 20." });
		expect(assertWithinLimit(pro, 'liveStores', 5)).toMatchObject({ upgradeTo: 'premium', message: 'Pro includes 5 live stores. Move to Premium for up to 20.' });
		expect(assertWithinLimit(pro, 'supplierCatalog')).toBeNull();
		expect(assertWithinLimit(pro, 'ownDomainsPerLiveStore', 0)).toBeNull();
		expect(assertWithinLimit(pro, 'ownDomainsPerLiveStore', 1)).toMatchObject({ message: 'Your plan includes 1 own domain per live store. Talk to us to add more.' });
		const premium = account({ plan: 'premium' });
		expect(assertWithinLimit(premium, 'aiCredits', 100_000)).toMatchObject({ upgradeTo: 'credits', message: "You've used this month's AI credits. Buy more credits now, or wait until November 19." });
		expect(assertWithinLimit(premium, 'newStoresPerDay', 999)).toBeNull();
		expect(assertWithinLimit(premium, 'storesLifetime', 20)).toMatchObject({ upgradeTo: 'enterprise' });
		expect(assertWithinLimit(premium, 'liveStores', 20)).toMatchObject({ upgradeTo: 'enterprise', message: 'Premium includes 20 live stores. Talk to us about Enterprise for more.' });
		expect(assertWithinLimit(premium, 'extraCredits')).toBeNull();
		expect(assertWithinLimit(premium, 'ownDomainsPerLiveStore', 1)).toMatchObject({ upgradeTo: 'enterprise', message: 'Your plan includes 1 own domain per live store. Talk to us to add more.' });
		expect(assertWithinLimit(account({ plan: 'enterprise', adminLimits: { liveStores: 3 } }), 'liveStores', 3)).toMatchObject({ upgradeTo: null, message: 'Enterprise includes 3 live stores. Talk to us to raise it.' });
		expect(assertWithinLimit(account({ plan: 'enterprise' }), 'aiCredits', 100_000)).toMatchObject({ upgradeTo: null, message: "You've used this month's AI credits. Talk to us about more, or wait until November 19." });
	});

	it('refuses nothing while billing is off, and recognizes a refusal that crossed the network', () => {
		const off = account({ billing: false });
		for (const key of ['aiCredits', 'storesLifetime', 'liveStores', 'supplierCatalog', 'extraCredits'] as const) expect(assertWithinLimit(off, key, 1_000_000)).toBeNull();
		expect(isPlanLimitRefusal(JSON.parse(JSON.stringify(assertWithinLimit(account({ adminLimits: { supplierCatalog: false } }), 'supplierCatalog'))))).toBe(true);
		expect(isPlanLimitRefusal({ code: 'plan_limit', limit: 'aiCredits', plan: 'pro', upgradeTo: null, paymentFailed: true, message: 'x' })).toBe(true);
		for (const value of [
			null,
			'plan_limit',
			{ code: 'plan_limit', limit: 'nope', plan: 'basic', upgradeTo: null, message: 'x' },
			{ code: 'plan_limit', limit: 'liveStores', plan: 'gold', upgradeTo: null, message: 'x' },
			{ code: 'plan_limit', limit: 'aiCredits', plan: 'pro', upgradeTo: null, paymentFailed: 'yes', message: 'x' },
		]) {
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

	it('names the month in the seller\'s language, still without a year', () => {
		expect(formatBillingDate(Date.UTC(2026, 10, 20), 'en')).toBe('November 20');
		expect(formatBillingDate(Date.UTC(2026, 10, 20), 'es')).toBe('20 de noviembre');
		expect(formatBillingDate(Date.UTC(2026, 10, 20), 'pt-BR')).toBe('20 de novembro');
		expect(formatBillingDate(Date.UTC(2026, 0, 1, 23, 59), 'pt-BR')).toBe('1 de janeiro');
	});
});

// Intl writes a no-break space between the currency and the amount in Spanish and Portuguese.
const NBSP = '\u00a0';

describe('formatUsd', () => {
	it('keeps the English outputs it always had', () => {
		expect(formatUsd(9_900)).toBe('$99');
		expect(formatUsd(0)).toBe('$0');
		expect(formatUsd(34_950)).toBe('$349.50');
		expect(formatUsd(123_456_00)).toBe('$123,456');
		expect(formatUsd(4_900, 'en')).toBe('$49');
	});

	it('writes dollars the local way, never as pesos or reais', () => {
		expect(formatUsd(4_900, 'es')).toBe(`USD${NBSP}49`);
		expect(formatUsd(4_900, 'pt-BR')).toBe(`US$${NBSP}49`);
		expect(formatUsd(0, 'es')).toBe(`USD${NBSP}0`);
		expect(formatUsd(0, 'pt-BR')).toBe(`US$${NBSP}0`);
	});

	it('shows cents only when there are some, with the language\'s decimal mark', () => {
		expect(formatUsd(2_450, 'en')).toBe('$24.50');
		expect(formatUsd(2_450, 'es')).toBe(`USD${NBSP}24.50`);
		expect(formatUsd(2_450, 'pt-BR')).toBe(`US$${NBSP}24,50`);
	});

	it('groups thousands the local way', () => {
		expect(formatUsd(123_450, 'es')).toBe(`USD${NBSP}1,234.50`);
		expect(formatUsd(123_450, 'pt-BR')).toBe(`US$${NBSP}1.234,50`);
		expect(formatUsd(1_990_000, 'pt-BR')).toBe(`US$${NBSP}19.900`);
	});
});

describe('formatCredits', () => {
	it('keeps the English outputs it always had', () => {
		expect(formatCredits(20_000)).toBe('20,000');
		expect(formatCredits(500, 'en')).toBe('500');
	});

	it('groups by language: Spanish like Mexico, Portuguese with points', () => {
		expect(formatCredits(100_000, 'es')).toBe('100,000');
		expect(formatCredits(100_000, 'pt-BR')).toBe('100.000');
		expect(formatCredits(1_500, 'pt-BR')).toBe('1.500');
	});
});


it('reserves custom email wording, reply-to, tracking and refunds for Premium, with valid overrides', () => {
 for (const key of ['customShopperEmails','shipmentTracking','orderRefunds'] as const) {
  for (const plan of ['basic','pro'] as const) expect(assertWithinLimit(account({plan}),key)).toMatchObject({limit:key,upgradeTo:'premium'});
  expect(assertWithinLimit(account({plan:'premium'}),key)).toBeNull();
  expect(assertWithinLimit(account({billing:false}),key)).toBeNull();
  expect(planLimitOverridesFrom({[key]:true})).toEqual({[key]:true});
 }
});
