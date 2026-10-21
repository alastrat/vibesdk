/**
 * Feature flags from PostHog, for the registry in shared/types/feature-flags.ts. Every flag defaults off, so a flag
 * PostHog leaves out (disabled or deleted), a failure, a timeout, a quota-limited answer or one computed with errors
 * pauses nothing and rolls nothing out. Billing is the exception: an account on a paid plan has it on whatever PostHog
 * answers, or if it fails, and a failed answer keeps an account's last billing answer from PostHog in this isolate.
 * Answers are cached in the isolate for 60 s per user; failures for 10 s. Outside production, FEATURE_FLAG_OVERRIDES
 * wins. Billing's own switches keep billing on whatever PostHog says. Nothing here throws.
 */

import { FLAG_KEYS, defaultFlagValues, isFlagKey, type FlagKey, type FlagValues } from '../../../shared/types/feature-flags';
import type { PlanId } from '../../../shared/types/plans';
import { isBillingOn } from '../billing/flag';
import { POSTHOG_INGEST_HOST, posthogConfig, type PostHogConfig } from './config';
import { planOf } from './person';

export const FLAG_CACHE_MS = 60_000;
export const FLAG_FAILURE_CACHE_MS = 10_000;
export const FLAG_TIMEOUT_MS = 1_500;
export const FLAGS_URL = `https://${POSTHOG_INGEST_HOST}/flags?v=2`;
/** Visitors who aren't signed in share one subject, so a flag's global setting reaches them. */
export const ANONYMOUS_FLAG_SUBJECT = 'anonymous-visitor';
const MAX_CACHED_SUBJECTS = 1_000;
/** Ids only, so many more than the cached answers; the oldest is forgotten first. */
const MAX_BILLED_SUBJECTS = 10_000;

export interface FlagSubject {
	distinctId: string;
	/** Read only when PostHog is asked, so a cached answer costs no plan lookup. */
	plan(): Promise<PlanId | 'none'>;
}

export interface FlagEvaluation {
	values: FlagValues;
	/** posthog: PostHog answered; defaults: it didn't, so every flag is off except billing (see above); off: no project key. */
	source: 'posthog' | 'defaults' | 'off';
	/** Flags PostHog answered for; the rest are off. */
	inPostHog: FlagKey[];
}

export interface FlagEvaluatorDeps {
	config: PostHogConfig | null;
	fetcher: typeof fetch;
	nowMs(): number;
	overrides: Partial<FlagValues>;
	timeoutMs?: number;
}

/** "billing=on,catalog-paused=on"; unknown keys and values are ignored. */
export function parseFlagOverrides(text: string | undefined): Partial<FlagValues> {
	const overrides: Partial<FlagValues> = {};
	for (const pair of (text ?? '').split(',')) {
		const [key, value] = pair.split('=').map((part) => part.trim());
		if (key && isFlagKey(key) && (value === 'on' || value === 'off')) overrides[key] = value === 'on';
	}
	return overrides;
}

export function flagOverridesOf(env: { ENVIRONMENT?: string; FEATURE_FLAG_OVERRIDES?: string }): Partial<FlagValues> {
	return env.ENVIRONMENT === 'prod' ? {} : parseFlagOverrides(env.FEATURE_FLAG_OVERRIDES);
}

/**
 * The registry flags in a /flags?v=2 answer. Null, a failure, when it isn't one, when PostHog paused flags for quota,
 * or when it reports errors while computing them: those values can't be trusted.
 */
export function readFlagsAnswer(body: unknown): Partial<FlagValues> | null {
	if (typeof body !== 'object' || body === null) return null;
	const answer = body as { flags?: unknown; quotaLimited?: unknown; errorsWhileComputingFlags?: unknown };
	if (Array.isArray(answer.quotaLimited) && answer.quotaLimited.includes('feature_flags')) return null;
	if (answer.errorsWhileComputingFlags === true) return null;
	if (typeof answer.flags !== 'object' || answer.flags === null) return null;
	const flags = answer.flags as Record<string, unknown>;
	const values: Partial<FlagValues> = {};
	for (const key of FLAG_KEYS) {
		const enabled = (flags[key] as { enabled?: unknown } | undefined)?.enabled;
		if (typeof enabled === 'boolean') values[key] = enabled;
	}
	return values;
}

/** Pro, Premium or Enterprise, whether from a subscription or an admin's override. */
function isOnPaidPlan(plan: PlanId | 'none'): boolean {
	return plan !== 'basic' && plan !== 'none';
}

/** 'none' when the plan can't be read; planOf answers Basic on its own failures, so this guards other subjects. */
async function planOrNone(subject: FlagSubject): Promise<PlanId | 'none'> {
	try {
		return await subject.plan();
	} catch {
		return 'none';
	}
}

export class FlagEvaluator {
	private readonly cache = new Map<string, { evaluation: FlagEvaluation; expiresAtMs: number }>();
	/**
	 * Subjects whose last answer from PostHog had billing on. Paid plans don't need it; it keeps an account PostHog
	 * targets without one on billing through a failure, in this isolate only.
	 */
	private readonly billed = new Set<string>();

	constructor(private readonly deps: FlagEvaluatorDeps) {}

	async evaluate(subject: FlagSubject): Promise<FlagEvaluation> {
		const config = this.deps.config;
		if (!config) return this.withOverrides({ values: defaultFlagValues(), source: 'off', inPostHog: [] });
		const cached = this.cache.get(subject.distinctId);
		if (cached && cached.expiresAtMs > this.deps.nowMs()) return this.withOverrides(cached.evaluation);
		// Read before PostHog is asked, so a failed answer still knows whether the account pays.
		const plan = await planOrNone(subject);
		const answered = await this.ask(config, subject.distinctId, plan);
		if (answered) this.rememberBilling(subject.distinctId, answered.billing === true);
		const billing = isOnPaidPlan(plan) || (answered ? answered.billing === true : this.billed.has(subject.distinctId));
		const evaluation: FlagEvaluation = answered
			? { values: { ...defaultFlagValues(), ...answered, billing }, source: 'posthog', inPostHog: FLAG_KEYS.filter((flag) => flag in answered) }
			: { values: { ...defaultFlagValues(), billing }, source: 'defaults', inPostHog: [] };
		this.remember(subject.distinctId, evaluation, answered ? FLAG_CACHE_MS : FLAG_FAILURE_CACHE_MS);
		return this.withOverrides(evaluation);
	}

	private async ask(config: PostHogConfig, distinctId: string, plan: PlanId | 'none'): Promise<Partial<FlagValues> | null> {
		try {
			const response = await this.deps.fetcher(FLAGS_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ api_key: config.projectKey, distinct_id: distinctId, person_properties: { plan } }),
				signal: AbortSignal.timeout(this.deps.timeoutMs ?? FLAG_TIMEOUT_MS),
			});
			return response.ok ? readFlagsAnswer(await response.json()) : null;
		} catch {
			return null;
		}
	}

	private remember(key: string, evaluation: FlagEvaluation, forMs: number): void {
		this.cache.delete(key);
		if (this.cache.size >= MAX_CACHED_SUBJECTS) {
			const oldest = this.cache.keys().next();
			if (!oldest.done) this.cache.delete(oldest.value);
		}
		this.cache.set(key, { evaluation, expiresAtMs: this.deps.nowMs() + forMs });
	}

	private rememberBilling(distinctId: string, on: boolean): void {
		this.billed.delete(distinctId);
		if (!on) return;
		if (this.billed.size >= MAX_BILLED_SUBJECTS) {
			const oldest = this.billed.values().next();
			if (!oldest.done) this.billed.delete(oldest.value);
		}
		this.billed.add(distinctId);
	}

	private withOverrides(evaluation: FlagEvaluation): FlagEvaluation {
		if (Object.keys(this.deps.overrides).length === 0) return evaluation;
		return { ...evaluation, values: { ...evaluation.values, ...this.deps.overrides } };
	}
}

let isolate: { projectKey: string | null; overrides: string; evaluator: FlagEvaluator } | null = null;

/** One evaluator per isolate, so its cache serves every request; rebuilt when the key or overrides change. */
function evaluatorFor(env: Env): FlagEvaluator {
	const config = posthogConfig(env);
	const projectKey = config?.projectKey ?? null;
	const overrides = env.ENVIRONMENT === 'prod' ? '' : (env.FEATURE_FLAG_OVERRIDES ?? '');
	if (!isolate || isolate.projectKey !== projectKey || isolate.overrides !== overrides) {
		isolate = {
			projectKey,
			overrides,
			evaluator: new FlagEvaluator({ config, fetcher: (input, init) => fetch(input, init), nowMs: Date.now, overrides: flagOverridesOf(env) }),
		};
	}
	return isolate.evaluator;
}

export async function flagsFor(env: Env, userId: string | null): Promise<FlagEvaluation> {
	let evaluation: FlagEvaluation;
	try {
		evaluation = await evaluatorFor(env).evaluate({ distinctId: userId ?? ANONYMOUS_FLAG_SUBJECT, plan: async () => (userId ? planOf(env, userId) : 'none') });
	} catch {
		evaluation = { values: { ...defaultFlagValues(), ...flagOverridesOf(env) }, source: 'defaults', inPostHog: [] };
	}
	// Billing is on when PostHog says so, when BILLING or BILLING_USER_IDS says so, or when the account's plan is paid
	// (Pro, Premium or Enterprise; the evaluator applies that on every answer and every failure). PostHog answering off,
	// or failing, never drops a paying seller.
	if (!evaluation.values.billing && isBillingOn(env, userId)) return { ...evaluation, values: { ...evaluation.values, billing: true } };
	return evaluation;
}

export async function isFlagOn(env: Env, key: FlagKey, userId: string | null): Promise<boolean> {
	return (await flagsFor(env, userId)).values[key];
}
