import { formatDollars, formatMonthDay, formatNumber } from '../i18n/format';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { ENGLISH, type Translator } from '../i18n/translate';
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

/** Older paths charged a flat cost per call; Sonnet's 8 matches its typical 136 credits a step, so one old credit is 17 new ones. */
export const LEGACY_CREDIT_FACTOR = 17;

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
	/** The renewal's payment failed, so the next step is updating the card rather than another plan. */
	paymentFailed?: true;
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

/** "$99", or "$349.50" when there are cents; "USD 99" in Spanish and "US$ 99" in Portuguese. */
export function formatUsd(cents: number, locale: Locale = DEFAULT_LOCALE): string {
	return formatDollars(cents / 100, locale);
}

export function formatCredits(credits: number, locale: Locale = DEFAULT_LOCALE): string {
	return formatNumber(credits, locale);
}

/** "November 19", or "19 de noviembre": the UTC day of a timestamp. */
export function formatBillingDate(ms: number, locale: Locale = DEFAULT_LOCALE): string {
	return formatMonthDay(ms, locale);
}

/** "Up to 3 live stores, 10 new stores a day", from a paid plan's limits. English unless a translator is passed. */
export function storeAllowance(plan: PaidPlanId, i18n: Translator = ENGLISH): string {
	const { liveStores, newStoresPerDay } = PLAN_LIMITS[plan];
	const parts: string[] = [];
	if (liveStores !== null) parts.push(i18n.tn('Up to {count} live store', 'Up to {count} live stores', liveStores));
	if (newStoresPerDay !== null) parts.push(i18n.tn('{count} new store a day', '{count} new stores a day', newStoresPerDay));
	return parts.join(', ');
}

/**
 * A paid plan's limits as short feature lines; with `over`, only the lines that plan doesn't already have. English
 * unless a translator is passed, so the public pricing page keeps its English.
 */
export function limitFeatures(plan: PaidPlanId, over?: PaidPlanId, i18n: Translator = ENGLISH): string[] {
	const limits = PLAN_LIMITS[plan];
	const lines = [storeAllowance(plan, i18n)];
	if (limits.ownDomainsPerLiveStore > 0) lines.push(i18n.t('Your own domain on each live store'));
	if (limits.supplierCatalog) lines.push(i18n.t('The supplier catalog'));
	if (limits.extraCredits) lines.push(i18n.t('Buy extra credits any time'));
	if (over === undefined) return lines;
	const already = limitFeatures(over, undefined, i18n);
	return lines.filter((line) => !already.includes(line));
}

/** "$1.50 per 1,000", the price of extra credits. English unless a translator is passed. */
export function extraCreditsPriceLabel(i18n: Translator = ENGLISH): string {
	return i18n.t('{price} per {credits}', { price: formatUsd(EXTRA_CREDITS.unitPriceCents, i18n.locale), credits: formatCredits(EXTRA_CREDITS.creditsPerUnit, i18n.locale) });
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

function creditsMessage(account: PlanAccount, i18n: Translator): string {
	const reset = formatBillingDate(account.creditsResetAt, i18n.locale);
	switch (account.plan) {
		case 'basic':
			return i18n.t("You've used this month's free AI credits. They refill on {reset}, or get Pro for {credits} a month.", { reset, credits: formatCredits(PLAN_LIMITS.pro.aiCredits, i18n.locale) });
		case 'pro':
			return i18n.t("You've used this month's AI credits. They refill on {reset}, or move to Premium for {credits} a month.", { reset, credits: formatCredits(PLAN_LIMITS.premium.aiCredits, i18n.locale) });
		case 'premium':
			return i18n.t("You've used this month's AI credits. Buy more credits now, or wait until {reset}.", { reset });
		case 'enterprise':
			return i18n.t("You've used this month's AI credits. Talk to us about more, or wait until {reset}.", { reset });
	}
}

function newStoresMessage(account: PlanAccount, upgradeTo: PlanLimitRefusal['upgradeTo'], i18n: Translator): string {
	const used = account.limits.newStoresPerDay ?? 0;
	if (account.plan === 'premium') return i18n.tn("You've started {count} new store today. Start more tomorrow, or talk to us about Enterprise.", "You've started {count} new stores today. Start more tomorrow, or talk to us about Enterprise.", used);
	if (isPaidPlanId(upgradeTo)) {
		const values = { plan: planName(upgradeTo), cap: formatNumber(PLAN_LIMITS[upgradeTo].newStoresPerDay ?? 0, i18n.locale) };
		if (PLAN_LIMITS[upgradeTo].newStoresPerDay === null) {
			return account.plan === 'basic'
				? i18n.tn("You've started {count} new store today. Start more tomorrow, or get {plan}.", "You've started {count} new stores today. Start more tomorrow, or get {plan}.", used, values)
				: i18n.tn("You've started {count} new store today. Start more tomorrow, or move to {plan}.", "You've started {count} new stores today. Start more tomorrow, or move to {plan}.", used, values);
		}
		return account.plan === 'basic'
			? i18n.tn("You've started {count} new store today. Start more tomorrow, or get {plan} for up to {cap} a day.", "You've started {count} new stores today. Start more tomorrow, or get {plan} for up to {cap} a day.", used, values)
			: i18n.tn("You've started {count} new store today. Start more tomorrow, or move to {plan} for up to {cap} a day.", "You've started {count} new stores today. Start more tomorrow, or move to {plan} for up to {cap} a day.", used, values);
	}
	return i18n.tn("You've started {count} new store today. Start more tomorrow.", "You've started {count} new stores today. Start more tomorrow.", used);
}

function liveStoresMessage(account: PlanAccount, i18n: Translator): string {
	const count = account.limits.liveStores ?? 0;
	const values = { plan: planName(account.plan), pro: formatNumber(PLAN_LIMITS.pro.liveStores ?? 0, i18n.locale), premium: formatNumber(PLAN_LIMITS.premium.liveStores ?? 0, i18n.locale) };
	switch (account.plan) {
		case 'basic':
			return i18n.tn('{plan} includes {count} live store. Get Pro for up to {pro}, or Premium for up to {premium}.', '{plan} includes {count} live stores. Get Pro for up to {pro}, or Premium for up to {premium}.', count, values);
		case 'pro':
			return i18n.tn('{plan} includes {count} live store. Move to Premium for up to {premium}.', '{plan} includes {count} live stores. Move to Premium for up to {premium}.', count, values);
		case 'premium':
			return i18n.tn('{plan} includes {count} live store. Talk to us about Enterprise for more.', '{plan} includes {count} live stores. Talk to us about Enterprise for more.', count, values);
		case 'enterprise':
			return i18n.tn('{plan} includes {count} live store. Talk to us to raise it.', '{plan} includes {count} live stores. Talk to us to raise it.', count, values);
	}
}

function storesLifetimeMessage(account: PlanAccount, i18n: Translator): string {
	const count = account.limits.storesLifetime ?? 0;
	if (account.plan === 'basic') return i18n.tn("Basic includes {count} store, counting ones you've deleted. Get Pro to start up to {cap} a day.", "Basic includes {count} stores, counting ones you've deleted. Get Pro to start up to {cap} a day.", count, { cap: formatNumber(PLAN_LIMITS.pro.newStoresPerDay ?? 0, i18n.locale) });
	return i18n.tn('Your plan includes {count} store. Talk to us to raise it.', 'Your plan includes {count} stores. Talk to us to raise it.', count);
}

/** With an allowance the refusal is for one more than it covers; with none, the plan lacks own domains. */
function ownDomainsMessage(account: PlanAccount, i18n: Translator): string {
	const allowed = account.limits.ownDomainsPerLiveStore;
	if (allowed > 0) return i18n.tn('Your plan includes {count} own domain per live store. Talk to us to add more.', 'Your plan includes {count} own domains per live store. Talk to us to add more.', allowed);
	return account.plan === 'basic' ? i18n.t('Own domains come with Pro and Premium.') : i18n.t("Own domains aren't on your plan. Talk to us to add them.");
}

function messageFor(account: PlanAccount, key: PlanLimitKey, upgradeTo: PlanLimitRefusal['upgradeTo'], i18n: Translator): string {
	switch (key) {
		case 'aiCredits':
			return creditsMessage(account, i18n);
		case 'storesLifetime':
			return storesLifetimeMessage(account, i18n);
		case 'newStoresPerDay':
			return newStoresMessage(account, upgradeTo, i18n);
		case 'liveStores':
			return liveStoresMessage(account, i18n);
		case 'ownDomainsPerLiveStore':
			return ownDomainsMessage(account, i18n);
		case 'supplierCatalog':
			return i18n.t('Adding catalog products to your store comes with Pro and Premium. Products already live keep selling.');
		case 'extraCredits':
			return account.plan === 'enterprise' ? i18n.t("Buying extra credits isn't on your plan. Talk to us to add it.") : i18n.t('Buying extra credits comes with Premium.');
	}
}

/**
 * The refusal for a limit the account has reached, or null while it's within it. `current` is the usage counted against
 * the limit; for `aiCredits` it is the pool minus the credits left, so it refuses once nothing is left. Flags are reached
 * when the plan lacks them. Nothing is refused while billing is off.
 */
export function assertWithinLimit(account: PlanAccount, key: PlanLimitKey, current = 0, i18n: Translator = ENGLISH): PlanLimitRefusal | null {
	if (!account.billing) return null;
	const limit = account.limits[key];
	const reached = typeof limit === 'boolean' ? !limit : limit !== null && current >= limit;
	if (!reached) return null;
	const upgradeTo = upgradeTargetFor(account, key);
	return { code: PLAN_LIMIT_CODE, limit: key, plan: account.plan, upgradeTo, message: messageFor(account, key, upgradeTo, i18n) };
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
		(value.paymentFailed === undefined || value.paymentFailed === true) &&
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
