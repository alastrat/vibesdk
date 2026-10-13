import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/controllers/appView/controller.ts', '/worker/api/controllers/apps/controller.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('app details for reuse', () => {
	const view = source('/worker/api/controllers/appView/controller.ts');

	it('reads the deployed commit with the other agent facts', () => {
		expect(view).toContain('agentStub.getDeployedCommit()');
	});

	it('decides what the viewer can do with the shared reuse rule', () => {
		expect(view).toContain('reuseDecision({');
		expect(view).toContain('startedFrom:');
		expect(view).toContain('canModerate');
		expect(view).not.toContain('fromTemplate');
	});

	it('maps the source app through the view that hides unavailable sources', () => {
		expect(view).toContain('toStartedFromView(');
	});

	it('withholds the source from viewers who may not read it, reading the listing once', () => {
		expect(view).toContain('canReadSource({');
		expect(view).toContain('agentSummary: codeVisible ? agentSummary : null');
		expect(view.match(/getListingByApp\(/g)).toHaveLength(1);
		expect(view.match(/hasPurchase\(/g)).toHaveLength(1);
	});

	it('records a deploy the app row has not seen yet', () => {
		expect(view).toContain("ctx.waitUntil(appService.updateApp(appResult.id, { lastDeployedAt: new Date() }))");
	});
});

describe('Discover listing', () => {
	it('parses and passes the Discover filters', () => {
		const apps = source('/worker/api/controllers/apps/controller.ts');
		expect(apps).toContain('parseDiscoverFilters(url.searchParams)');
		expect(apps).toContain('discover: discover.value');
	});
});
