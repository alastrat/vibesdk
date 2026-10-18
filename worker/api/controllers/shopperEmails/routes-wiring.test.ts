import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/shopperEmailRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('shopper email routes', () => {
	it("keeps a store's emails to its owner, and lists stores to any signed-in seller", () => {
		const routes = source('/worker/api/routes/shopperEmailRoutes.ts').split('\n').filter((line) => line.includes("'/api/"));
		const storeRoutes = routes.filter((line) => line.includes("'/api/stores/:id/"));
		expect(storeRoutes).toHaveLength(6);
		for (const line of storeRoutes) expect(line).toContain('setAuthLevel(AuthConfig.ownerOnly)');
		expect(routes.find((line) => line.includes("'/api/emails/stores'"))).toContain('setAuthLevel(AuthConfig.authenticated)');
		expect(source('/worker/api/routes/index.ts')).toContain('setupShopperEmailRoutes(app)');
	});
});
