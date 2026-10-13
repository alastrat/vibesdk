import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/api/routes/sitePageRoutes.ts',
		'/worker/api/routes/index.ts',
		'/worker/api/controllers/sitePage/controller.ts',
		'/worker/api/controllers/appView/controller.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('product page routes', () => {
	it('serves the page and its approved screenshots to anyone', () => {
		const routes = source('/worker/api/routes/sitePageRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/discover/:appId'"))).toContain('setAuthLevel(AuthConfig.public)');
		expect(routes.find((line) => line.includes("'/api/discover/:appId/screenshots/:kind'"))).toContain(
			'setAuthLevel(AuthConfig.public)',
		);
		expect(source('/worker/api/routes/index.ts')).toContain('setupSitePageRoutes(app)');
	});

	it('rate limits the page, records a visit and never returns source code', () => {
		const controller = source('/worker/api/controllers/sitePage/controller.ts');
		expect(controller).toContain('enforcePublicAppsRateLimit(');
		expect(controller).toContain('recordVisit(');
		expect(controller).not.toContain('getSummary(');
		expect(controller).not.toContain('agentSummary');
		expect(source('/worker/api/controllers/appView/controller.ts')).toContain('recordVisit(');
	});
});
