import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/routes/limitsRoutes.ts', '/worker/api/controllers/limits/controller.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('public plan limits', () => {
	it('is public and rate limited like the other public endpoints', () => {
		const routes = source('/worker/api/routes/limitsRoutes.ts');
		const start = routes.indexOf("'/api/limits/plan'");
		expect(start).toBeGreaterThan(-1);
		expect(routes.slice(start, start + 200)).toContain('setAuthLevel(AuthConfig.public)');
		const controller = source('/worker/api/controllers/limits/controller.ts');
		expect(controller).toContain('enforcePublicAppsRateLimit(');
		expect(controller).toContain('publicPlanFromSettings(context.config.security.rateLimit)');
	});
});
