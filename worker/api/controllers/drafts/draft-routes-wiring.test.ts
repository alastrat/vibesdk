import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/draftRoutes.ts', '/worker/api/routes/index.ts', '/worker/api/controllers/liveStores/controller.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('drafts routes', () => {
	it('are all owner-only and registered', () => {
		const routes = source('/worker/api/routes/draftRoutes.ts');
		for (const route of [
			"app.get('/api/stores/:id/drafts'",
			"app.post('/api/stores/:id/drafts'",
			"app.post('/api/stores/:id/drafts/:draftId/activate'",
			"app.patch('/api/stores/:id/drafts/:draftId'",
			"app.delete('/api/stores/:id/drafts/:draftId'",
		]) {
			expect(routes, route).toContain(route);
		}
		expect(routes.match(/setAuthLevel\(AuthConfig\.ownerOnly\)/g)).toHaveLength(5);
		expect(source('/worker/api/routes/index.ts')).toContain('setupDraftRoutes(app)');
	});

	it('publishes a draft through SpaceDO, which deploys it first when stale', () => {
		const live = source('/worker/api/controllers/liveStores/controller.ts');
		expect(live).toContain('space.publishDraft(draftId, { refuseNewCatalogProducts })');
		expect(live).not.toContain('publishLive()');
		expect(live).toContain('space?.getPublishContext()');
	});
});
