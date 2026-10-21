import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_DISTINCT_ID } from '../../../shared/types/analytics-events';
import { analyticsOver, serverAnalytics } from './analytics';
import type { CaptureInput } from './client';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('typed server analytics', () => {
	it('sends a catalog event, with person properties as $set and $set_once', () => {
		const captured: CaptureInput[] = [];
		analyticsOver({ capture: (input) => captured.push(input) }).capture(
			'account_created',
			'user_1',
			{ method: 'google' },
			{ set: { plan: 'basic', has_live_store: false }, setOnce: { signup_date: '2026-10-19' } },
		);
		expect(captured).toEqual([
			{
				event: 'account_created',
				distinctId: 'user_1',
				personless: false,
				properties: { method: 'google', $set: { plan: 'basic', has_live_store: false }, $set_once: { signup_date: '2026-10-19' } },
			},
		]);
	});

	it("marks a build's credits as the only fields kept for someone who opted out", () => {
		const captured: CaptureInput[] = [];
		const build = { app_id: 'app_1', model: 'm', first_build: true, outcome: 'completed', steps: 3, credits_used: 8.4, duration_ms: 50 } as const;
		const analytics = analyticsOver({ capture: (input) => captured.push(input) });
		analytics.capture('build_finished', 'user_1', build);
		analytics.capture('signed_in', 'user_1', { method: 'password' });
		expect(captured.map((input) => input.anonymousCost)).toEqual([{ credits_used: 8.4 }, undefined]);
	});

	it('sends system events without a person profile', () => {
		const captured: CaptureInput[] = [];
		analyticsOver({ capture: (input) => captured.push(input) }).capture('heartbeat', SYSTEM_DISTINCT_ID, {
			healthy: true,
			app_ok: true,
			database_ok: true,
			stores_ok: null,
			failed: [],
			duration_ms: 12,
		});
		expect(captured[0]).toMatchObject({ event: 'heartbeat', distinctId: 'estori-system', personless: true });
	});

	it('sends nothing without a project key', async () => {
		const fetchMock = vi.fn(async () => new Response('{}'));
		vi.stubGlobal('fetch', fetchMock);
		serverAnalytics({ ENVIRONMENT: 'dev' } as unknown as Env).capture('email_confirmed', 'user_1', {});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
