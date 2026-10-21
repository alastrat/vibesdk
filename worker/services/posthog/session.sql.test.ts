/** Session telemetry on real SQL: client flags, and the analytics setting with GPC honored. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { AnalyticsPersonService } from '../../database/services/AnalyticsPersonService';
import { PostHogClient } from './client';
import type { PostHogConfig } from './config';
import { honorAnalyticsChoice, sessionTelemetry } from './session';

let db: D1Database;
const get = (headers: Record<string, string> = {}) => new Request('https://estori.app/api/auth/profile', { headers });

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['tel_1', 'tel_order', 'tel_open']) await insertUser(db, id);
});

describe('session telemetry', () => {
	it('carries the client flags, and analytics on, for a new user', async () => {
		expect(await sessionTelemetry(envWith(db, { ENVIRONMENT: 'dev' }), get(), 'tel_1')).toEqual({
			flags: {
				billing: false,
				'store-drafts-paused': false,
				'catalog-paused': false,
				'session-replay-paused': false,
				'store-publishing-paused': false,
				'custom-domains-paused': false,
				'store-translations-paused': false,
			},
			analyticsOptOut: false,
		});
	});

	it('stores a GPC signal as the opt-out, before anything is sent', async () => {
		const env = envWith(db, { ENVIRONMENT: 'dev' });
		expect((await sessionTelemetry(env, get({ 'Sec-GPC': '1' }), 'tel_1')).analyticsOptOut).toBe(true);
		expect(await new AnalyticsPersonService(env).preference('tel_1')).toEqual({ optedOut: true, source: 'gpc' });
	});

	it('keeps a choice made in settings', async () => {
		const env = envWith(db, { ENVIRONMENT: 'dev' });
		await new AnalyticsPersonService(env).setPreference('tel_1', true, 'settings', new Date());
		expect(await honorAnalyticsChoice(env, get(), 'tel_1')).toBe(true);
		expect(await new AnalyticsPersonService(env).preference('tel_1')).toEqual({ optedOut: true, source: 'settings' });
	});

	it('treats analytics as off when the setting cannot be read', async () => {
		const broken = envWith({ prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database, { ENVIRONMENT: 'dev' });
		expect(await honorAnalyticsChoice(broken, get(), 'tel_1')).toBe(true);
	});

	it('honors local flag overrides', async () => {
		const telemetry = await sessionTelemetry(envWith(db, { ENVIRONMENT: 'dev', FEATURE_FLAG_OVERRIDES: 'store-drafts-paused=on' }), get(), 'tel_1');
		expect(telemetry.flags['store-drafts-paused']).toBe(true);
	});
});

/**
 * A D1 whose UPDATE statements only start after a delay, so a write that isn't awaited would land after a later read.
 * Plain objects, not proxies of the binding: the database service instruments `prepare` and `bind` by assigning to them.
 */
function withSlowWrites(database: D1Database, delayMs: number): D1Database {
	const slowStatement = (statement: D1PreparedStatement, slow: boolean): D1PreparedStatement => {
		const pause = async () => {
			if (slow) await new Promise((resolve) => setTimeout(resolve, delayMs));
		};
		return {
			bind: (...values: unknown[]) => slowStatement(statement.bind(...values), slow),
			run: async () => { await pause(); return statement.run(); },
			all: async () => { await pause(); return statement.all(); },
			raw: async () => { await pause(); return statement.raw(); },
			first: async () => { await pause(); return statement.first(); },
		} as unknown as D1PreparedStatement;
	};
	return { prepare: (query: string) => slowStatement(database.prepare(query), /^\s*update\b/i.test(query)) } as unknown as D1Database;
}

const CONFIG: PostHogConfig = { projectKey: 'phc_test', projectId: null, environment: 'dev', release: null, host: 'localhost' };

/** A capture client over the real settings, sending to a list instead of PostHog. */
function clientOver(env: Env) {
	const sent: Array<{ event: string; distinct_id: string }> = [];
	const client = new PostHogClient({
		config: CONFIG,
		fetcher: async (_input, init) => {
			sent.push(...(JSON.parse(String(init?.body)) as { batch: typeof sent }).batch);
			return new Response('{}');
		},
		optedOut: (userIds) => new AnalyticsPersonService(env).optedOutAmong(userIds),
		keepAlive: () => undefined,
		now: () => new Date(),
	});
	return { client, sent };
}

describe('the GPC opt-out is stored before the request captures anything', () => {
	it("sends no person event for a request that carried GPC, even when the write is slow", async () => {
		const env = envWith(withSlowWrites(db, 25), { ENVIRONMENT: 'dev' });
		const { client, sent } = clientOver(env);
		await sessionTelemetry(env, get({ 'Sec-GPC': '1' }), 'tel_order');
		client.capture({ event: 'account_created', distinctId: 'tel_order', properties: {} });
		await client.flush();
		expect(sent).toEqual([]);
	});

	it('sends the same event for a request without it', async () => {
		const env = envWith(withSlowWrites(db, 25), { ENVIRONMENT: 'dev' });
		const { client, sent } = clientOver(env);
		await sessionTelemetry(env, get(), 'tel_open');
		client.capture({ event: 'account_created', distinctId: 'tel_open', properties: {} });
		await client.flush();
		expect(sent.map((event) => event.event)).toEqual(['account_created']);
	});
});
