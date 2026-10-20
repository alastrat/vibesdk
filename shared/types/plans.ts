import { DRAFT_LIMIT } from './drafts';

export const PLAN_IDS = ['basic', 'pro', 'premium', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PAID_PLAN_IDS = ['pro', 'premium'] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

/** Monthly prices in US cents. */
export const PLAN_PRICES_CENTS: Record<PaidPlanId, number> = { pro: 4_900, premium: 19_900 };

/** A plan's allowances; null means no limit. */
export interface PlanLimits {
	/** Credits in each monthly period. */
	aiCredits: number;
	/** Stores started in the account's lifetime, deleted ones included. */
	storesLifetime: number | null;
	newStoresPerDay: number | null;
	liveStores: number | null;
	ownDomainsPerLiveStore: number;
	supplierCatalog: boolean;
	extraCredits: boolean;
	draftsPerStore: number;
}

export type PlanLimitKey = Exclude<keyof PlanLimits, 'draftsPerStore'>;

/** The limits an admin may set on one account, over its plan's row. */
export type PlanLimitOverrides = Partial<Omit<PlanLimits, 'draftsPerStore'>>;

const PREMIUM_LIMITS: PlanLimits = {
	aiCredits: 100_000,
	storesLifetime: null,
	newStoresPerDay: 25,
	liveStores: 10,
	ownDomainsPerLiveStore: 1,
	supplierCatalog: true,
	extraCredits: true,
	draftsPerStore: DRAFT_LIMIT,
};

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
	basic: {
		aiCredits: 5_000,
		storesLifetime: 3,
		newStoresPerDay: null,
		liveStores: 1,
		ownDomainsPerLiveStore: 0,
		supplierCatalog: false,
		extraCredits: false,
		draftsPerStore: DRAFT_LIMIT,
	},
	pro: {
		aiCredits: 20_000,
		storesLifetime: null,
		newStoresPerDay: 10,
		liveStores: 3,
		ownDomainsPerLiveStore: 1,
		supplierCatalog: true,
		extraCredits: false,
		draftsPerStore: DRAFT_LIMIT,
	},
	premium: PREMIUM_LIMITS,
	enterprise: { ...PREMIUM_LIMITS },
};

export const EXTRA_CREDITS = {
	creditsPerUnit: 1_000,
	unitPriceCents: 150,
	minCredits: 5_000,
	maxCredits: 1_000_000,
	monthsValid: 12,
} as const;

export const PLAN_LIMIT_CODE = 'plan_limit';

/** How long a failing payment keeps its plan before the account runs as Basic. */
export const GRACE_PERIOD_DAYS = 7;

export interface PlanAccountInput {
	billing: boolean;
	plan: PlanId;
	adminLimits: PlanLimitOverrides | null;
}

export interface PlanAccount {
	billing: boolean;
	plan: PlanId;
	limits: PlanLimits;
	/** When the credit period ends and the allowance refills, in ms. */
	creditsResetAt: number;
}

export interface PlanLimitRefusal {
	code: typeof PLAN_LIMIT_CODE;
	limit: PlanLimitKey;
	plan: PlanId;
	upgradeTo: 'pro' | 'premium' | 'enterprise' | 'credits' | null;
	message: string;
}

const PLAN_NAMES: Record<PlanId, string> = { basic: 'Basic', pro: 'Pro', premium: 'Premium', enterprise: 'Enterprise' };

const LIMIT_KEYS: readonly PlanLimitKey[] = ['aiCredits', 'storesLifetime', 'newStoresPerDay', 'liveStores', 'ownDomainsPerLiveStore', 'supplierCatalog', 'extraCredits'];

const UPGRADE_TARGETS: readonly NonNullable<PlanLimitRefusal['upgradeTo']>[] = ['pro', 'premium', 'enterprise', 'credits'];

export function isPaidPlanId(value: unknown): value is PaidPlanId {
	return typeof value === 'string' && (PAID_PLAN_IDS as readonly string[]).includes(value);
}

export function planName(plan: PlanId): string {
	return PLAN_NAMES[plan];
}

/** "$99", or "$349.50" when there are cents. */
export function formatUsd(cents: number): string {
	const dollars = cents / 100;
	return `$${Number.isInteger(dollars) ? dollars.toLocaleString('en-US') : dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCredits(credits: number): string {
	return credits.toLocaleString('en-US');
}

const BILLING_DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

/** "November 19", the UTC day of a timestamp. */
export function formatBillingDate(ms: number): string {
	return BILLING_DATE.format(ms);
}

export function extraCreditsPriceCents(credits: number): number {
	return (credits / EXTRA_CREDITS.creditsPerUnit) * EXTRA_CREDITS.unitPriceCents;
}

export function isExtraCreditsAmount(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= EXTRA_CREDITS.minCredits &&
		value <= EXTRA_CREDITS.maxCredits &&
		value % EXTRA_CREDITS.creditsPerUnit === 0
	);
}

/** The limits an account runs on. With billing off nothing new is enforced, so every account runs as Basic with the caps lifted. */
export function limitsFor(input: PlanAccountInput): PlanLimits {
	if (!input.billing) {
		return { ...PLAN_LIMITS.basic, storesLifetime: null, liveStores: null, ownDomainsPerLiveStore: 1, supplierCatalog: true };
	}
	return { ...PLAN_LIMITS[input.plan], ...input.adminLimits };
}

/** True when `candidate` allows more of `key` than `current` does: it has the flag, drops the cap, or raises it. */
function lifts(key: PlanLimitKey, candidate: PlanLimits, current: PlanLimits): boolean {
	const next = candidate[key];
	const now = current[key];
	if (typeof next === 'boolean' || typeof now === 'boolean') return next === true;
	if (now === null) return false;
	return next === null || next > now;
}

function upgradeTargetFor(account: PlanAccount, key: PlanLimitKey): PlanLimitRefusal['upgradeTo'] {
	if (account.plan === 'enterprise') return null;
	if (account.plan === 'premium') return key === 'aiCredits' ? 'credits' : 'enterprise';
	const later = PLAN_IDS.slice(PLAN_IDS.indexOf(account.plan) + 1);
	const target = later.find((plan) => lifts(key, PLAN_LIMITS[plan], account.limits));
	return target === undefined || target === 'basic' ? null : target;
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** "get" before the first paid plan, "move to" after it. */
function switchTo(account: PlanAccount, plan: PaidPlanId): string {
	return `${account.plan === 'basic' ? 'get' : 'move to'} ${planName(plan)}`;
}

function creditsMessage(account: PlanAccount): string {
	const reset = formatBillingDate(account.creditsResetAt);
	switch (account.plan) {
		case 'basic':
			return `You've used this month's free AI credits. They refill on ${reset}, or get Pro for ${formatCredits(PLAN_LIMITS.pro.aiCredits)} a month.`;
		case 'pro':
			return `You've used this month's AI credits. They refill on ${reset}, or move to Premium for ${formatCredits(PLAN_LIMITS.premium.aiCredits)} a month.`;
		case 'premium':
			return `You've used this month's AI credits. Buy more credits now, or wait until ${reset}.`;
		case 'enterprise':
			return `You've used this month's AI credits. Talk to us about more, or wait until ${reset}.`;
	}
}

function newStoresMessage(account: PlanAccount, upgradeTo: PlanLimitRefusal['upgradeTo']): string {
	const started = `You've started ${count(account.limits.newStoresPerDay ?? 0, 'new store')} today. Start more tomorrow`;
	if (account.plan === 'premium') return `${started}, or talk to us about Enterprise.`;
	if (account.plan === 'enterprise') return `${started}.`;
	if (isPaidPlanId(upgradeTo)) {
		const cap = PLAN_LIMITS[upgradeTo].newStoresPerDay;
		return cap === null ? `${started}, or ${switchTo(account, upgradeTo)}.` : `${started}, or ${switchTo(account, upgradeTo)} for up to ${cap} a day.`;
	}
	return `${started}.`;
}

function liveStoresMessage(account: PlanAccount): string {
	const included = `${planName(account.plan)} includes ${count(account.limits.liveStores ?? 0, 'live store')}.`;
	switch (account.plan) {
		case 'basic':
			return `${included} Get Pro for up to ${PLAN_LIMITS.pro.liveStores}, or Premium for up to ${PLAN_LIMITS.premium.liveStores}.`;
		case 'pro':
			return `${included} Move to Premium for up to ${PLAN_LIMITS.premium.liveStores}.`;
		case 'premium':
			return `${included} Talk to us about Enterprise for more.`;
		case 'enterprise':
			return `${included} Talk to us to raise it.`;
	}
}

function storesLifetimeMessage(account: PlanAccount): string {
	const stores = count(account.limits.storesLifetime ?? 0, 'store');
	if (account.plan === 'basic') return `Basic includes ${stores}, counting ones you've deleted. Get Pro to start up to ${PLAN_LIMITS.pro.newStoresPerDay} a day.`;
	return `Your plan includes ${stores}. Talk to us to raise it.`;
}

function messageFor(account: PlanAccount, key: PlanLimitKey, upgradeTo: PlanLimitRefusal['upgradeTo']): string {
	switch (key) {
		case 'aiCredits':
			return creditsMessage(account);
		case 'storesLifetime':
			return storesLifetimeMessage(account);
		case 'newStoresPerDay':
			return newStoresMessage(account, upgradeTo);
		case 'liveStores':
			return liveStoresMessage(account);
		case 'ownDomainsPerLiveStore':
			return account.plan === 'basic' ? 'Own domains come with Pro and Premium.' : "Own domains aren't on your plan. Talk to us to add them.";
		case 'supplierCatalog':
			return 'Adding catalog products to your store comes with Pro and Premium. Products already live keep selling.';
		case 'extraCredits':
			return account.plan === 'enterprise' ? "Buying extra credits isn't on your plan. Talk to us to add it." : 'Buying extra credits comes with Premium.';
	}
}

/**
 * The refusal for a limit the account has reached, or null while it's within it. `current` is the usage counted against
 * the limit; for `aiCredits` it is the pool minus the credits left, so it refuses once nothing is left. Flags are reached
 * when the plan lacks them. Nothing is refused while billing is off.
 */
export function assertWithinLimit(account: PlanAccount, key: PlanLimitKey, current = 0): PlanLimitRefusal | null {
	if (!account.billing) return null;
	const limit = account.limits[key];
	const reached = typeof limit === 'boolean' ? !limit : limit !== null && current >= limit;
	if (!reached) return null;
	const upgradeTo = upgradeTargetFor(account, key);
	return { code: PLAN_LIMIT_CODE, limit: key, plan: account.plan, upgradeTo, message: messageFor(account, key, upgradeTo) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a refusal that crossed the network, so a client can show its message and next step. */
export function isPlanLimitRefusal(value: unknown): value is PlanLimitRefusal {
	if (!isRecord(value)) return false;
	return (
		value.code === PLAN_LIMIT_CODE &&
		(LIMIT_KEYS as readonly unknown[]).includes(value.limit) &&
		(PLAN_IDS as readonly unknown[]).includes(value.plan) &&
		(value.upgradeTo === null || (UPGRADE_TARGETS as readonly unknown[]).includes(value.upgradeTo)) &&
		typeof value.message === 'string'
	);
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** What an override may hold for each limit; null lifts a store cap. */
const OVERRIDE_CHECKS: Record<PlanLimitKey, (value: unknown) => boolean> = {
	aiCredits: (value) => isIntegerIn(value, 1, 100_000_000),
	storesLifetime: (value) => value === null || isIntegerIn(value, 0, 100_000),
	newStoresPerDay: (value) => value === null || isIntegerIn(value, 1, 10_000),
	liveStores: (value) => isIntegerIn(value, 0, 10_000),
	ownDomainsPerLiveStore: (value) => value === 0 || value === 1,
	supplierCatalog: (value) => typeof value === 'boolean',
	extraCredits: (value) => typeof value === 'boolean',
};

function isOverrideKey(key: string): key is PlanLimitKey {
	return Object.hasOwn(OVERRIDE_CHECKS, key);
}

/** An admin's limits for one account, or null when anything in them is unknown or out of range. */
export function planLimitOverridesFrom(value: unknown): PlanLimitOverrides | null {
	if (!isRecord(value)) return null;
	for (const [key, entry] of Object.entries(value)) {
		if (!isOverrideKey(key) || !OVERRIDE_CHECKS[key](entry)) return null;
	}
	// Every key and value passed its check above.
	return { ...value };
}
