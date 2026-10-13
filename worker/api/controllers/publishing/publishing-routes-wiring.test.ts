import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/api/routes/publishingRoutes.ts',
		'/worker/api/routes/index.ts',
		'/worker/api/routes/appRoutes.ts',
		'/worker/api/controllers/publishing/controller.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('publishing routes', () => {
	const routes = source('/worker/api/routes/publishingRoutes.ts');
	const lines = routes.split('\n');

	it('puts every admin route behind the admin auth level', () => {
		const adminLines = lines.filter((line) => line.includes("'/api/admin/"));
		expect(adminLines).toHaveLength(7);
		for (const line of adminLines) expect(line).toContain('setAuthLevel(AuthConfig.admin)');
	});

	it('lets only the owner publish and manage a paid listing', () => {
		for (const path of [
			"'/api/apps/:id/visibility'",
			"'/api/apps/:id/publishing'",
			"'/api/apps/:id/paid-listing/versions'",
			"'/api/apps/:id/paid-listing/versions/:versionId/withdraw'",
		]) {
			const line = lines.find((candidate) => candidate.includes(path));
			expect(line).toContain('setAuthLevel(AuthConfig.ownerOnly)');
		}
	});

	it('replaces the old visibility route and registers before the app routes', () => {
		expect(source('/worker/api/routes/appRoutes.ts')).not.toContain("'/:id/visibility'");
		const index = source('/worker/api/routes/index.ts');
		expect(index.indexOf('setupPublishingRoutes(app)')).toBeGreaterThan(-1);
		expect(index.indexOf('setupPublishingRoutes(app)')).toBeLessThan(index.indexOf('setupAppRoutes(app)'));
		expect(index).not.toContain('setupTemplateRoutes');
	});
});

describe('paid updates', () => {
	it('resubmit the approved price, never a rejected one', () => {
		const controller = source('/worker/api/controllers/publishing/controller.ts');
		expect(controller).toContain('const priceCents = paidUpdatePrice(listing, versions);');
		expect(controller).not.toContain('versions[0]?.priceCents');
	});
});
