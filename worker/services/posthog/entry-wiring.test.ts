import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/index.ts'], { query: '?raw', import: 'default', eager: true });
const index = sources['/worker/index.ts'] ?? '';

describe('the Worker entry and the request scope', () => {
	it('runs every request in the scope, so analytics sends after the response', () => {
		expect(index).toContain('runInRequestScope(ctx, ');
		expect(index).toContain('handleFetch(request, env, ctx)');
	});

	it('runs the scheduled work in the scope too', () => {
		const scheduled = index.slice(index.indexOf('async scheduled('));
		expect(scheduled.indexOf('runInRequestScope(ctx, ')).toBeLessThan(scheduled.indexOf('runCatalogSchedule('));
	});

	it("keeps every scheduled run, billing's included, inside the scope", () => {
		const scheduled = index.slice(index.indexOf('async scheduled('));
		const scope = scheduled.indexOf('runInRequestScope(ctx, ');
		expect(scope).toBeGreaterThanOrEqual(0);
		for (const run of [
			'ctx.waitUntil(runCatalogSchedule(controller.cron, env))',
			'ctx.waitUntil(runStorePaymentsSchedule(controller.cron, env))',
			'ctx.waitUntil(runLiveStoresSchedule(controller.cron, env))',
			'ctx.waitUntil(runShopperEmailSchedule(controller.cron, env))',
			'ctx.waitUntil(runBillingSchedule(controller.cron, env))',
		]) {
			expect(scheduled.indexOf(run), run).toBeGreaterThan(scope);
		}
	});

	it('runs the heartbeat from the cron, checking the app through its own fetch handler', () => {
		expect(index).toContain('ctx.waitUntil(runHeartbeat(controller.cron, env, (request) => worker.fetch(request, env, ctx)));');
	});

	it('sends /ingest to PostHog before the public site, on the main domain only', () => {
		const main = index.slice(index.indexOf('if (isMainDomainRequest) {'));
		expect(main.indexOf('if (isIngestPath(pathname))')).toBeGreaterThan(-1);
		expect(main.indexOf('if (isIngestPath(pathname))')).toBeLessThan(main.indexOf('return servePublicSite('));
		expect(index).toContain('return proxyPostHog(request, env);');
	});

	it('logs a request error no handler caught, then rethrows it', () => {
		const fetchHandler = index.slice(index.indexOf('fetch(request: Request, env: Env, ctx: ExecutionContext)'));
		expect(fetchHandler).toContain("logger.error('Unhandled request error'");
		expect(fetchHandler).toContain('throw error;');
	});

	it("registers PostHog's error reporter with the logger, which can't import it", () => {
		expect(index).toContain('setErrorReporter(reportServerError);');
		expect(index).toContain("from './services/posthog/server-errors'");
	});
});
