import { describe, expect, it } from 'vitest';
import { CATALOG_REFRESH_CRON } from '../catalog/scheduler';
import { HEARTBEAT_CRON, runHeartbeat, runHeartbeatChecks, type HeartbeatDeps } from './heartbeat';

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
				queryDatabase: async () => {
					throw new Error('D1 unavailable');
				},
			}),
		);
		expect(failing).toMatchObject({ healthy: false, app_ok: false, database_ok: false, stores_ok: false, failed: ['app', 'database', 'stores'] });
		const hanging = await runHeartbeatChecks(deps({ queryDatabase: () => new Promise(() => undefined) }));
		expect(hanging).toMatchObject({ healthy: false, database_ok: false, failed: ['database'] });
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

const configs = import.meta.glob<string>(['/wrangler.estori.jsonc', '/wrangler.estori-staging.jsonc'], { query: '?raw', import: 'default', eager: true });

describe('the heartbeat cron', () => {
	it("is the catalog refresh's cron, which both Estori environments schedule, so a staging project only needs its token", () => {
		expect(HEARTBEAT_CRON).toBe(CATALOG_REFRESH_CRON);
		expect(Object.keys(configs)).toHaveLength(2);
		for (const [path, text] of Object.entries(configs)) expect(text, path).toContain(`"${HEARTBEAT_CRON}"`);
	});
});
