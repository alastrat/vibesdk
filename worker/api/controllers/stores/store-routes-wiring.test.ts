import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/storeRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('store routes', () => {
	it("keeps a store's orders to its owner", () => {
		const routes = source('/worker/api/routes/storeRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/stores/:id/orders'"))).toContain('setAuthLevel(AuthConfig.ownerOnly)');
		expect(source('/worker/api/routes/index.ts')).toContain('setupStoreRoutes(app)');
	});

	it("lets only the store's owner refund its orders", () => {
		const routes = source('/worker/api/routes/storeRoutes.ts');
		expect(routes).toContain("app.post('/api/stores/:id/orders/:orderId/refunds', setAuthLevel(AuthConfig.ownerOnly)");
	});
});
