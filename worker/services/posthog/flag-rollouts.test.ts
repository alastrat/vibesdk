import { describe, expect, it, vi } from 'vitest';
import { flagRollouts, rolloutsFrom } from './flag-rollouts';

const list = {
	results: [
		{ key: 'billing', active: true, filters: { groups: [{ properties: [], rollout_percentage: 10 }] } },
		{ key: 'catalog-paused', active: true, filters: { groups: [{ properties: [], rollout_percentage: null }] } },
		{ key: 'signups-paused', active: false, filters: { groups: [{ properties: [], rollout_percentage: 100 }] } },
		{ key: 'store-drafts-paused', active: true, filters: { groups: [{ properties: [{ key: 'plan' }], rollout_percentage: 0 }, { properties: [], rollout_percentage: 25 }] } },
		{ key: 'not-ours', active: true, filters: { groups: [{ properties: [], rollout_percentage: 50 }] } },
	],
};

describe("flags' rollouts from PostHog", () => {
	it("reads each registry flag's largest rollout: no percentage means everyone, and a disabled flag is 0", () => {
		expect(rolloutsFrom(list)).toEqual({ billing: 10, 'catalog-paused': 100, 'signups-paused': 0, 'store-drafts-paused': 25 });
		expect(rolloutsFrom({ nope: true })).toEqual({});
	});

	it("asks PostHog's API with the personal key, for the project", async () => {
		const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(list));
		const env = { POSTHOG_PROJECT_KEY: 'phc_x', POSTHOG_PROJECT_ID: '675096', POSTHOG_PERSONAL_API_KEY: 'phx_key' } as unknown as Env;
		expect(await flagRollouts(env, fetcher)).toMatchObject({ billing: 10 });
		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(String(url)).toBe('https://us.posthog.com/api/projects/675096/feature_flags/?limit=200');
		expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer phx_key');
	});

	it('answers null without the personal key, asking nobody, and when PostHog fails', async () => {
		const fetcher = vi.fn<typeof fetch>();
		expect(await flagRollouts({ POSTHOG_PROJECT_KEY: 'phc_x', POSTHOG_PROJECT_ID: '675096' } as unknown as Env, fetcher)).toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
		const failing = async () => new Response('denied', { status: 403 });
		expect(await flagRollouts({ POSTHOG_PROJECT_KEY: 'phc_x', POSTHOG_PROJECT_ID: '675096', POSTHOG_PERSONAL_API_KEY: 'phx_key' } as unknown as Env, failing)).toBeNull();
	});
});
