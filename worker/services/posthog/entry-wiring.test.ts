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
});
