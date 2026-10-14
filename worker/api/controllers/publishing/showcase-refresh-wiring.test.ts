import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/routes/publishingRoutes.ts', '/worker/api/controllers/publishing/adminController.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('admin showcase refresh', () => {
	it('is an admin-only POST route', () => {
		expect(source('/worker/api/routes/publishingRoutes.ts')).toContain(
			"app.post('/api/admin/showcase-screenshots/refresh', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.refreshShowcaseScreenshots));",
		);
	});

	it('captures one batch of stores still missing an image and counts failures as still missing', () => {
		const controller = source('/worker/api/controllers/publishing/adminController.ts');
		const method = controller.slice(controller.indexOf('static async refreshShowcaseScreenshots('));
		expect(method).toContain('listAppsMissingShowcase(SHOWCASE_REFRESH_BATCH)');
		expect(method).toContain('runShowcaseRefresh(ids, (appId) => refreshShowcaseScreenshot(env, ReviewAdminController.logger, appId))');
		expect(method).toContain('remaining: remaining + failed');
	});
});
