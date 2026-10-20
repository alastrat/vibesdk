import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostHogClient, MAX_QUEUED_EVENTS } from './client';
import type { PostHogConfig } from './config';
import { keepAlive, runInRequestScope } from './request-scope';

const CONFIG: PostHogConfig = { projectKey: 'phc_test', projectId: '675096', environment: 'prod', release: 'ver-1', host: 'estori.app' };
const NOW = new Date('2026-10-19T12:00:00.000Z');

type SentBatch = { api_key: string; batch: Array<{ event: string; distinct_id: string; timestamp: string; properties: Record<string, unknown> }> };

function harness(options: {
	config?: PostHogConfig | null;
	optedOut?: (ids: readonly string[]) => Promise<ReadonlySet<string>>;
	respond?: (init: RequestInit | undefined) => Promise<Response>;
} = {}) {
	const requests: Array<{ url: string; body: SentBatch }> = [];
	const kept: Promise<unknown>[] = [];
	const lookedUp: string[][] = [];
	const client = new PostHogClient({
		config: options.config === undefined ? CONFIG : options.config,
		fetcher: async (input, init) => {
			requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as SentBatch });
			return options.respond ? options.respond(init) : new Response('{"status":1}', { status: 200 });
		},
		optedOut: async (ids) => {
			lookedUp.push([...ids]);
			return options.optedOut ? options.optedOut(ids) : new Set<string>();
		},
		keepAlive: (work) => {
			kept.push(work);
		},
		now: () => NOW,
		timeoutMs: 20,
	});
	return { client, requests, lookedUp, settle: () => Promise.all(kept) };
}

let warned: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the PostHog capture client', () => {
	it('sends events captured together as one batch, after the response, with the environment, release and host', async () => {
		const { client, requests, settle } = harness();
		client.capture({ event: 'store_published', distinctId: 'user_1', properties: { app_id: 'app_1' } });
		client.capture({ event: 'store_unpublished', distinctId: 'user_1', properties: { app_id: 'app_2' } });
		expect(requests).toHaveLength(0);
		await settle();
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe('https://us.i.posthog.com/batch/');
		expect(requests[0].body.api_key).toBe('phc_test');
		expect(requests[0].body.batch.map((event) => event.event)).toEqual(['store_published', 'store_unpublished']);
		expect(requests[0].body.batch[0]).toEqual({
			event: 'store_published',
			distinct_id: 'user_1',
			timestamp: '2026-10-19T12:00:00.000Z',
			properties: { app_id: 'app_1', environment: 'prod', release: 'ver-1', $host: 'estori.app', $lib: 'estori-worker', $geoip_disable: true },
		});
	});

	it('sends nothing without a project key', async () => {
		const { client, requests, settle } = harness({ config: null });
		client.capture({ event: 'email_confirmed', distinctId: 'user_1', properties: {} });
		await settle();
		await client.flush();
		expect(requests).toEqual([]);
	});

	it('drops the events of people who turned analytics off', async () => {
		const { client, requests, lookedUp, settle } = harness({ optedOut: async () => new Set(['user_2']) });
		client.capture({ event: 'signed_in', distinctId: 'user_1', properties: { method: 'password' } });
		client.capture({ event: 'signed_in', distinctId: 'user_2', properties: { method: 'google' } });
		client.capture({ event: 'signed_in', distinctId: 'user_1', properties: { method: 'password' } });
		await settle();
		expect(lookedUp).toEqual([['user_1', 'user_2']]);
		expect(requests[0].body.batch.map((event) => event.distinct_id)).toEqual(['user_1', 'user_1']);
	});

	it("still counts an opted-out person's build credits, under the opted-out id, with no person and nothing else", async () => {
		const { client, requests, settle } = harness({ optedOut: async () => new Set(['user_2']) });
		const build = { app_id: 'app_9', model: 'm', first_build: false, outcome: 'completed', steps: 4, credits_used: 12, duration_ms: 900, $set: { plan: 'basic' } };
		client.capture({ event: 'build_finished', distinctId: 'user_2', properties: build, anonymousCost: { credits_used: 12 } });
		client.capture({ event: 'build_finished', distinctId: 'user_1', properties: build, anonymousCost: { credits_used: 12 } });
		await settle();
		expect(requests[0].body.batch.map((event) => [event.distinct_id, event.properties])).toEqual([
			['opted-out', { credits_used: 12, environment: 'prod', release: 'ver-1', $host: 'estori.app', $lib: 'estori-worker', $geoip_disable: true, $process_person_profile: false }],
			['user_1', { ...build, environment: 'prod', release: 'ver-1', $host: 'estori.app', $lib: 'estori-worker', $geoip_disable: true }],
		]);
	});

	it('treats everyone as opted out when the setting cannot be read: cost fields only, and system events as usual', async () => {
		const { client, requests, settle } = harness({ optedOut: async () => Promise.reject(new Error('D1 down')) });
		client.capture({ event: 'signed_in', distinctId: 'user_1', properties: { method: 'password' } });
		client.capture({ event: 'build_finished', distinctId: 'user_1', properties: { credits_used: 7, app_id: 'app_1' }, anonymousCost: { credits_used: 7 } });
		client.capture({ event: 'heartbeat', distinctId: 'estori-system', properties: { healthy: true }, personless: true });
		await settle();
		expect(requests[0].body.batch.map((event) => [event.event, event.distinct_id])).toEqual([
			['build_finished', 'opted-out'],
			['heartbeat', 'estori-system'],
		]);
		expect(requests[0].body.batch[0].properties).not.toHaveProperty('app_id');
		expect(requests[0].body.batch[1]).toMatchObject({ properties: { $process_person_profile: false } });
	});

	it("never geolocates the Worker's own address, so a person's country stays the one their browser sent", async () => {
		const { client, requests, settle } = harness({ optedOut: async () => new Set(['user_2']) });
		client.capture({ event: 'signed_in', distinctId: 'user_1', properties: { method: 'password' } });
		client.capture({ event: 'build_finished', distinctId: 'user_2', properties: { credits_used: 3 }, anonymousCost: { credits_used: 3 } });
		client.capture({ event: 'heartbeat', distinctId: 'estori-system', properties: { healthy: true }, personless: true });
		await settle();
		expect(requests[0].body.batch.map((event) => [event.distinct_id, event.properties.$geoip_disable])).toEqual([
			['user_1', true],
			['opted-out', true],
			['estori-system', true],
		]);
	});

	it('never looks system events up', async () => {
		const { client, lookedUp, settle } = harness();
		client.capture({ event: '$exception', distinctId: 'estori-system', properties: {}, personless: true });
		await settle();
		expect(lookedUp).toEqual([]);
	});

	it.each([
		['an error answer', async () => new Response('busy', { status: 503 })],
		['a network failure', async () => Promise.reject(new Error('connection reset'))],
		[
			'a hang',
			(init: RequestInit | undefined) =>
				new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
		],
	])('never throws after %s', async (_name, respond) => {
		const { client, settle } = harness({ respond });
		client.capture({ event: 'email_confirmed', distinctId: 'user_1', properties: {} });
		await expect(settle()).resolves.toBeDefined();
		expect(warned).toHaveBeenCalledTimes(1);
	});

	it('never throws when waitUntil refuses the work, and a later batch still sends', async () => {
		const sent: SentBatch[] = [];
		const kept: Promise<unknown>[] = [];
		const client = new PostHogClient({
			config: CONFIG,
			fetcher: async (_input, init) => {
				sent.push(JSON.parse(String(init?.body)) as SentBatch);
				return new Response('{"status":1}', { status: 200 });
			},
			optedOut: async () => new Set<string>(),
			keepAlive,
			now: () => NOW,
		});
		let calls = 0;
		const waitUntil = (work: Promise<unknown>) => {
			calls += 1;
			if (calls === 1) throw new Error('waitUntil after the response');
			kept.push(work);
		};
		await runInRequestScope({ waitUntil }, async () => {
			expect(() => client.capture({ event: 'email_confirmed', distinctId: 'user_1', properties: {} })).not.toThrow();
			await new Promise((resolve) => setTimeout(resolve, 0));
			client.capture({ event: 'signed_in', distinctId: 'user_1', properties: { method: 'password' } });
		});
		await Promise.all(kept);
		expect(kept).toHaveLength(1);
		expect(sent.map((body) => body.batch.map((event) => event.event))).toEqual([['email_confirmed'], ['signed_in']]);
		expect(warned).toHaveBeenCalledTimes(1);
	});

	it('holds at most 100 unsent events, so a runaway loop cannot grow without bound', async () => {
		const { client, requests, settle } = harness();
		for (let i = 0; i < MAX_QUEUED_EVENTS + 50; i++) client.capture({ event: 'email_confirmed', distinctId: `user_${i}`, properties: {} });
		await settle();
		expect(requests[0].body.batch).toHaveLength(MAX_QUEUED_EVENTS);
	});
});
