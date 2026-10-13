import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/api/routes/sitePageRoutes.ts',
		'/worker/api/routes/index.ts',
		'/worker/api/controllers/sitePage/controller.ts',
		'/worker/api/controllers/appView/controller.ts',
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/core/behaviors/base.ts',
		'/worker/agents/core/codingAgent.ts',
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

	it('signs the creator thumbnails so the images load', () => {
		expect(source('/worker/api/controllers/sitePage/controller.ts')).toContain('enrichUrls(');
	});

	it('previews through the anonymous public preview and never mints an owner-bearing source', () => {
		const controller = source('/worker/api/controllers/sitePage/controller.ts');
		expect(controller).toContain('getPublicPreviewURL(');
		expect(controller).toContain('getDeployedCommit(');
		expect(controller).not.toContain('getTemplateSource(');
	});
});

describe('public preview subject', () => {
	it('signs the public preview with the anonymous subject, and every other preview with the owner', () => {
		const think = source('/worker/agents/core/behaviors/think.ts');
		expect(think).toContain('getBrowserPreviewURL(previewVersionOverride?: number, subject?: string)');
		expect(think).toContain('userId: subject ?? this.state.metadata.userId');
		expect(think).toContain('getBrowserPreviewURL(undefined, PUBLIC_PREVIEW_SUBJECT)');
	});

	it('exposes the public preview from the coding agent to its behavior, and the base behavior has none', () => {
		expect(source('/worker/agents/core/codingAgent.ts')).toContain('this.behavior.getPublicPreviewURL()');
		expect(source('/worker/agents/core/behaviors/base.ts')).toMatch(/getPublicPreviewURL\(\): Promise<string \| null> \{\s*return null;/);
	});
});
