import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_DISTINCT_ID } from '../../../shared/types/analytics-events';
import { CATALOG_REFRESH_CRON } from '../catalog/scheduler';
import { BATCH_URL } from './client';
import { HEARTBEAT_CRON, runHeartbeat, runHeartbeatChecks, type HeartbeatDeps } from './heartbeat';
import { runInRequestScope } from './request-scope';

function deps(overrides: Partial<HeartbeatDeps> = {}): HeartbeatDeps & { requests: Request[] } {
	const requests: Request[] = [];
	return {
		requests,
		fetchApp: async (request) => {
			requests.push(request);
			return new URL(request.url).pathname === '/api/health' ? Response.json({ status: 'ok' }) : new Response('<html>', { status: 200 });
		},
		queryDatabase: async () => undefined,
		newestLiveSlug: async () => 'northwind-tea',
		appOrigin: 'https://estori.app',
		storesDomain: 'estori.shop',
		stagingKey: null,
		nowMs: () => 0,
		timeoutMs: 20,
		...overrides,
	};
}

describe('the heartbeat checks', () => {
	it('checks the app, the database and the newest live store through the Worker itself', async () => {
		const run = deps();
		expect(await runHeartbeatChecks(run)).toEqual({ healthy: true, app_ok: true, database_ok: true, stores_ok: true, failed: [], duration_ms: 0 });
		expect(run.requests.map((request) => request.url)).toEqual(['https://estori.app/api/health', 'https://northwind-tea.estori.shop/']);
	});

	it('names each failing check: a 500, an unhealthy answer, a database error, a hang', async () => {
		const failing = await runHeartbeatChecks(
			deps({
				fetchApp: async (request) => (new URL(request.url).pathname === '/api/health' ? Response.json({ status: 'degraded' }) : new Response('down', { status: 502 })),
			}),
		);
		expect(failing).toMatchObject({ healthy: false, app_ok: false, database_ok: true, stores_ok: false, failed: ['app', 'stores'] });
		const broken = await runHeartbeatChecks(
			deps({
				queryDatabase: async () => {
					throw new Error('D1 unavailable');
				},
			}),
		);
		expect(broken).toMatchObject({ healthy: false, app_ok: true, database_ok: false, failed: ['database'] });
		const hanging = await runHeartbeatChecks(deps({ queryDatabase: () => new Promise(() => undefined) }));
		expect(hanging).toMatchObject({ healthy: false, database_ok: false, failed: ['database'] });
	});

	it('skips the store lookup when the database check failed, since it would read the same database', async () => {
		let looked = false;
		const result = await runHeartbeatChecks(
			deps({
				queryDatabase: async () => {
					throw new Error('D1 unavailable');
				},
				newestLiveSlug: async () => {
					looked = true;
					return 'northwind-tea';
				},
			}),
		);
		expect(looked).toBe(false);
		expect(result.stores_ok).toBeNull();
	});

	it('still answers when the store lookup hangs or throws, so the event is always sent', async () => {
		const hanging = await runHeartbeatChecks(deps({ newestLiveSlug: () => new Promise(() => undefined) }));
		expect(hanging).toMatchObject({ healthy: true, database_ok: true, stores_ok: null, failed: [] });
		// A throw before any promise exists, such as a service constructor failing.
		const throwing = await runHeartbeatChecks(
			deps({
				newestLiveSlug: () => {
					throw new Error('constructor failed');
				},
			}),
		);
		expect(throwing).toMatchObject({ healthy: true, database_ok: true, stores_ok: null, failed: [] });
	});

	it('gives each request a deadline and cancels the store page it does not read', async () => {
		let cancelled = false;
		const run = deps({
			fetchApp: async (request) => {
				run.requests.push(request);
				if (new URL(request.url).pathname === '/api/health') return Response.json({ status: 'ok' });
				return new Response(
					new ReadableStream({
						start: (controller) => controller.enqueue(new TextEncoder().encode('<html>')),
						cancel: () => {
							cancelled = true;
						},
					}),
					{ status: 200 },
				);
			},
		});
		expect((await runHeartbeatChecks(run)).stores_ok).toBe(true);
		await vi.waitFor(() => expect(cancelled).toBe(true));
		await vi.waitFor(() => expect(run.requests.every((request) => request.signal.aborted)).toBe(true));
	});

	it('skips the store check without a stores domain or a live store', async () => {
		expect((await runHeartbeatChecks(deps({ storesDomain: null }))).stores_ok).toBeNull();
		expect((await runHeartbeatChecks(deps({ newestLiveSlug: async () => null }))).stores_ok).toBeNull();
	});

	it("sends staging's key, so the gate lets the in-process checks through once staging has a project", async () => {
		const run = deps({ stagingKey: 'staging-key' });
		await runHeartbeatChecks(run);
		expect(run.requests.every((request) => request.headers.get('x-estori-staging-key') === 'staging-key')).toBe(true);
	});
});

describe('the heartbeat without a project token', () => {
	it('checks nothing, as on staging and locally, where nothing would be sent', async () => {
		const requests: Request[] = [];
		await runHeartbeat(HEARTBEAT_CRON, { ENVIRONMENT: 'staging' } as unknown as Env, async (request) => {
			requests.push(request);
			return new Response('ok');
		});
		expect(requests).toEqual([]);
	});
});

describe('the heartbeat with a project token', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const env = {
		POSTHOG_PROJECT_KEY: 'phc_test',
		ENVIRONMENT: 'production',
		CUSTOM_DOMAIN: 'estori.app',
		DB: {
			prepare: () => ({
				first: async () => {
					throw new Error('D1 unavailable');
				},
			}),
		},
	} as unknown as Env;

	/** Runs the heartbeat in a request scope and waits for the send that scope keeps alive. */
	async function runAndSettle(cron: string): Promise<{ sent: { url: string; body: string }[]; appRequests: Request[] }> {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const sent: { url: string; body: string }[] = [];
		vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
			sent.push({ url: String(input), body: String(init?.body) });
			return new Response('{}');
		});
		const appRequests: Request[] = [];
		const pending: Promise<unknown>[] = [];
		await runInRequestScope({ waitUntil: (work) => void pending.push(work) }, () =>
			runHeartbeat(cron, env, async (request) => {
				appRequests.push(request);
				return new Response('down', { status: 503 });
			}),
		);
		await Promise.all(pending);
		return { sent, appRequests };
	}

	it('sends the event even when every check fails', async () => {
		const { sent } = await runAndSettle(HEARTBEAT_CRON);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(BATCH_URL);
		const batch = (JSON.parse(sent[0]?.body ?? '{}') as { batch: { event: string; distinct_id: string; properties: Record<string, unknown> }[] }).batch;
		expect(batch).toHaveLength(1);
		expect(batch[0]).toMatchObject({
			event: 'heartbeat',
			distinct_id: SYSTEM_DISTINCT_ID,
			properties: { healthy: false, app_ok: false, database_ok: false, stores_ok: null, failed: ['app', 'database'] },
		});
	});

	it('does nothing on any other cron', async () => {
		const { sent, appRequests } = await runAndSettle('5 * * * *');
		expect(sent).toEqual([]);
		expect(appRequests).toEqual([]);
	});
});

const configs = import.meta.glob<string>(['/wrangler.estori.jsonc', '/wrangler.estori-staging.jsonc'], { query: '?raw', import: 'default', eager: true });

describe('the heartbeat cron', () => {
	it("is the catalog refresh's cron, which both Estori environments schedule, so a staging project only needs its token", () => {
		expect(HEARTBEAT_CRON).toBe(CATALOG_REFRESH_CRON);
		expect(Object.keys(configs)).toHaveLength(2);
		for (const [path, text] of Object.entries(configs)) expect(text, path).toContain(`"${HEARTBEAT_CRON}"`);
	});
});
