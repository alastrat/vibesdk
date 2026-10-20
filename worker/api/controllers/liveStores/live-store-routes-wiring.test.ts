import { describe, expect, it } from 'vitest';
import { NEW_CATALOG_PRODUCTS_ERROR } from '../../../../shared/types/billing';

const sources = import.meta.glob<string>(['/worker/api/routes/liveStoreRoutes.ts', '/worker/api/routes/index.ts', '/worker/api/controllers/liveStores/controller.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});
const spaceSources = import.meta.glob<string>('/space/src/space/store-manifest.ts', { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('live store routes', () => {
	it("keeps a store's address, publishing and domain to its owner", () => {
		const routes = source('/worker/api/routes/liveStoreRoutes.ts');
		for (const route of [
			"app.get('/api/stores/:id/live', setAuthLevel(AuthConfig.ownerOnly)",
			"app.post('/api/stores/:id/live/publish', setAuthLevel(AuthConfig.ownerOnly)",
			"app.post('/api/stores/:id/live/offline', setAuthLevel(AuthConfig.ownerOnly)",
			"app.post('/api/stores/:id/live/domain', setAuthLevel(AuthConfig.ownerOnly)",
			"app.post('/api/stores/:id/live/domain/check', setAuthLevel(AuthConfig.ownerOnly)",
			"app.delete('/api/stores/:id/live/domain', setAuthLevel(AuthConfig.ownerOnly)",
		]) {
			expect(routes, route).toContain(route);
		}
		expect(source('/worker/api/routes/index.ts')).toContain('setupLiveStoreRoutes(app)');
	});

	it('cancels a merge a crashed turn left behind before publishing, through the agent that knows whether one runs', () => {
		const controller = source('/worker/api/controllers/liveStores/controller.ts');
		const cancel = controller.indexOf('.cancelLeftoverMerge()');
		expect(cancel).toBeGreaterThan(-1);
		expect(cancel).toBeLessThan(controller.indexOf('space.publishDraft(draftId, { refuseNewCatalogProducts })'));
	});

	it('checks the live-store limit before publishing, and the domain limit before adding one', () => {
		const controller = source('/worker/api/controllers/liveStores/controller.ts');
		const publish = controller.slice(controller.indexOf('static async publish('), controller.indexOf('static async offline('));
		expect(publish.indexOf("assertWithinLimit(account, 'liveStores'")).toBeGreaterThan(-1);
		expect(publish.indexOf("assertWithinLimit(account, 'liveStores'")).toBeLessThan(publish.indexOf('space.publishDraft('));
		expect(publish).toContain('published.error === NEW_CATALOG_PRODUCTS_ERROR');
		const addDomain = controller.slice(controller.indexOf('static async addDomain('), controller.indexOf('static async checkDomain('));
		const check = addDomain.indexOf("assertWithinLimit(account, 'ownDomainsPerLiveStore', 0)");
		expect(check).toBeGreaterThan(-1);
		expect(check).toBeLessThan(addDomain.indexOf('addStoreDomain('));
	});

	it('mirrors the catalog refusal SpaceDO answers', () => {
		const space = Object.values(spaceSources)[0] ?? '';
		expect(space).toContain(`"${NEW_CATALOG_PRODUCTS_ERROR}"`);
	});

	it('takes a store offline through the flow that also expires its open checkouts', () => {
		const controller = source('/worker/api/controllers/liveStores/controller.ts');
		expect(controller).toContain('await takeStoreOffline({');
		expect(controller).toContain('openCheckouts: () => checkouts.openCheckoutsOfApp(appId)');
		expect(controller).not.toMatch(/\n\s+await new LiveStoreService\(env\)\.setOffline\(/);
	});
});
