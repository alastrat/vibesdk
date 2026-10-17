import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/liveStoreRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

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
});
