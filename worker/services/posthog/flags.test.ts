import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultFlagValues, type FlagKey, type FlagValues } from '../../../shared/types/feature-flags';
import { FlagEvaluator, flagOverridesOf, flagsFor, isFlagOn, parseFlagOverrides, type FlagSubject } from './flags';
import type { PostHogConfig } from './config';

const CONFIG: PostHogConfig = { projectKey: 'phc_test', projectId: '675096', environment: 'prod', release: null, host: 'estori.app' };
const USER: FlagSubject = { distinctId: 'user_1', plan: async () => 'basic' };
/** All 11 flags off; Task 1's test pins the registry. */
const OFF: FlagValues = defaultFlagValues();

function flagsAnswer(flags: Partial<Record<FlagKey, boolean>>, errorsWhileComputingFlags = false): Response {
	return Response.json({
		flags: Object.fromEntries(Object.entries(flags).map(([key, enabled]) => [key, { key, enabled, reason: { code: 'condition_match' }, metadata: { id: 1, version: 1 } }])),
		errorsWhileComputingFlags,
		requestId: 'req-1',
	});
}

function evaluator(respond: (init: RequestInit | undefined) => Promise<Response>, overrides: Partial<FlagValues> = {}) {
	let now = 0;
	const requests: Array<{ url: string; body: unknown }> = [];
	const flags = new FlagEvaluator({
		config: CONFIG,
		fetcher: async (input, init) => {
			requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
			return respond(init);
		},
		nowMs: () => now,
		overrides,
		timeoutMs: 20,
	});
	return { flags, requests, advance: (ms: number) => (now += ms) };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('server flag evaluation', () => {
	it('asks PostHog for the user, with the plan for targeting, and reads each registry flag', async () => {
		const { flags, requests } = evaluator(async () => flagsAnswer({ billing: true, 'catalog-paused': true }));
		const evaluation = await flags.evaluate(USER);
		expect(requests).toEqual([
			{ url: 'https://us.i.posthog.com/flags?v=2', body: { api_key: 'phc_test', distinct_id: 'user_1', person_properties: { plan: 'basic' } } },
		]);
		expect(evaluation).toEqual({ values: { ...OFF, billing: true, 'catalog-paused': true }, source: 'posthog', inPostHog: ['billing', 'catalog-paused'] });
	});

	it('reads a pause flag that PostHog leaves out, because it is disabled or deleted, as not paused', async () => {
		const { flags } = evaluator(async () => flagsAnswer({}));
		expect(await flags.evaluate(USER)).toEqual({ values: OFF, source: 'posthog', inPostHog: [] });
	});

	it('caches each user for 60 seconds, reading the plan only when it asks PostHog', async () => {
		let planReads = 0;
		const subject: FlagSubject = { distinctId: 'user_1', plan: async () => (planReads++, 'basic') };
		const { flags, requests, advance } = evaluator(async () => flagsAnswer({ billing: true }));
		await flags.evaluate(subject);
		await flags.evaluate(subject);
		expect([requests.length, planReads]).toEqual([1, 1]);
		await flags.evaluate({ distinctId: 'user_2', plan: async () => 'premium' });
		expect(requests).toHaveLength(2);
		advance(60_000);
		await flags.evaluate(subject);
		expect([requests.length, planReads]).toEqual([3, 2]);
	});

	it.each([
		['an error answer', async () => new Response('down', { status: 503 })],
		['a network failure', async () => Promise.reject(new Error('connection reset'))],
		['a quota-limited answer', async () => Response.json({ flags: {}, quotaLimited: ['feature_flags'], errorsWhileComputingFlags: false })],
		['an answer computed with errors', async () => flagsAnswer({ billing: true, 'catalog-paused': true }, true)],
		['an answer that is not JSON', async () => new Response('<html>', { status: 200 })],
	])('turns every flag off after %s, so nothing is paused or rolled out, and asks again after 10 seconds', async (_name, respond) => {
		const { flags, requests, advance } = evaluator(respond);
		expect(await flags.evaluate(USER)).toEqual({ values: OFF, source: 'defaults', inPostHog: [] });
		advance(9_999);
		await flags.evaluate(USER);
		expect(requests).toHaveLength(1);
		advance(1);
		await flags.evaluate(USER);
		expect(requests).toHaveLength(2);
	});

	it("keeps a user's last billing answer when PostHog then fails, so a paying seller stays on billing; pauses still go off", async () => {
		let respond: () => Promise<Response> = async () => flagsAnswer({ billing: true, 'catalog-paused': true });
		const { flags, advance } = evaluator(() => respond());
		await flags.evaluate(USER);
		advance(60_000);
		respond = async () => Promise.reject(new Error('PostHog down'));
		expect(await flags.evaluate(USER)).toEqual({ values: { ...OFF, billing: true }, source: 'defaults', inPostHog: [] });
		expect(await flags.evaluate({ distinctId: 'user_never_seen', plan: async () => 'basic' })).toEqual({ values: OFF, source: 'defaults', inPostHog: [] });
	});

	it('forgets billing once PostHog answers it off, or leaves it out', async () => {
		let respond: () => Promise<Response> = async () => flagsAnswer({ billing: true });
		const { flags, advance } = evaluator(() => respond());
		await flags.evaluate(USER);
		advance(60_000);
		respond = async () => flagsAnswer({});
		expect((await flags.evaluate(USER)).values.billing).toBe(false);
		advance(60_000);
		respond = async () => new Response('down', { status: 503 });
		expect((await flags.evaluate(USER)).values.billing).toBe(false);
	});

	it('answers within its timeout when PostHog hangs, so sign-in never waits on it', async () => {
		const { flags } = evaluator((init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
		const started = Date.now();
		expect((await flags.evaluate(USER)).source).toBe('defaults');
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	it('answers every flag off without a project token, as on staging and locally, asking nobody', async () => {
		const fetcher = vi.fn<typeof fetch>();
		const flags = new FlagEvaluator({ config: null, fetcher, nowMs: () => 0, overrides: {} });
		expect(await flags.evaluate(USER)).toEqual({ values: OFF, source: 'off', inPostHog: [] });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('lets overrides win over PostHog', async () => {
		const { flags } = evaluator(async () => flagsAnswer({ billing: false }), { billing: true, 'catalog-paused': true });
		expect((await flags.evaluate(USER)).values).toEqual({ ...OFF, billing: true, 'catalog-paused': true });
	});

	it('applies overrides without a project token too, which is how staging and local development pause something', async () => {
		const flags = new FlagEvaluator({ config: null, fetcher: vi.fn<typeof fetch>(), nowMs: () => 0, overrides: { 'ai-builds-paused': true } });
		expect(await flags.evaluate(USER)).toEqual({ values: { ...OFF, 'ai-builds-paused': true }, source: 'off', inPostHog: [] });
	});
});

describe('flag overrides', () => {
	it('reads on and off pairs, ignoring unknown keys and values', () => {
		expect(parseFlagOverrides('billing=on, catalog-paused=on,nope=on,store-drafts-paused=maybe,signups-paused=off,')).toEqual({
			billing: true,
			'catalog-paused': true,
			'signups-paused': false,
		});
		expect(parseFlagOverrides(undefined)).toEqual({});
	});

	it('applies outside production only', () => {
		expect(flagOverridesOf({ ENVIRONMENT: 'prod', FEATURE_FLAG_OVERRIDES: 'billing=on' })).toEqual({});
		expect(flagOverridesOf({ ENVIRONMENT: 'staging', FEATURE_FLAG_OVERRIDES: 'billing=on' })).toEqual({ billing: true });
		expect(flagOverridesOf({ ENVIRONMENT: 'dev', FEATURE_FLAG_OVERRIDES: 'ai-builds-paused=on' })).toEqual({ 'ai-builds-paused': true });
	});
});

describe('flags for a user or a visitor', () => {
	it("evaluates a signed-in user with their plan, and a visitor as the shared anonymous subject", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => flagsAnswer({ 'session-replay-paused': true }));
		vi.stubGlobal('fetch', fetchMock);
		const env = { POSTHOG_PROJECT_KEY: 'phc_flags_for', ENVIRONMENT: 'prod' } as unknown as Env;
		expect((await flagsFor(env, 'user_9')).values['session-replay-paused']).toBe(true);
		expect(await isFlagOn(env, 'session-replay-paused', null)).toBe(true);
		const subjects = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { distinct_id: string; person_properties: { plan: string } });
		// No billing tables in this env, so the user's plan falls back to Basic.
		expect(subjects.map((body) => [body.distinct_id, body.person_properties.plan])).toEqual([
			['user_9', 'basic'],
			['anonymous-visitor', 'none'],
		]);
	});
});

describe('the billing flag', () => {
	it("keeps billing's own switches: BILLING=on, or an account in BILLING_USER_IDS, whatever PostHog says", async () => {
		const noKey = { ENVIRONMENT: 'prod' };
		expect(await isFlagOn({ ...noKey, BILLING: 'on' } as unknown as Env, 'billing', 'user_1')).toBe(true);
		expect(await isFlagOn({ ...noKey, BILLING_USER_IDS: 'user_1, user_2' } as unknown as Env, 'billing', 'user_2')).toBe(true);
		expect(await isFlagOn({ ...noKey, BILLING_USER_IDS: 'user_1' } as unknown as Env, 'billing', 'user_3')).toBe(false);
		expect(await isFlagOn({ ...noKey, BILLING_USER_IDS: 'user_1' } as unknown as Env, 'billing', null)).toBe(false);
		vi.stubGlobal('fetch', vi.fn(async () => flagsAnswer({ billing: false })));
		expect(await isFlagOn({ POSTHOG_PROJECT_KEY: 'phc_billing_off', ENVIRONMENT: 'prod', BILLING: 'on' } as unknown as Env, 'billing', 'user_3')).toBe(true);
	});

	it('adds accounts PostHog targets, and never drops a paying seller when PostHog fails', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => flagsAnswer({ billing: true })));
		expect(await isFlagOn({ POSTHOG_PROJECT_KEY: 'phc_billing_on', ENVIRONMENT: 'prod' } as unknown as Env, 'billing', 'user_4')).toBe(true);
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('PostHog down'))));
		expect(await isFlagOn({ POSTHOG_PROJECT_KEY: 'phc_billing_down', ENVIRONMENT: 'prod', BILLING_USER_IDS: 'user_5' } as unknown as Env, 'billing', 'user_5')).toBe(true);
	});
});
