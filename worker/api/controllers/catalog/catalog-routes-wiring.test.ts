import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/catalogRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('catalog routes', () => {
	it('serves catalog images publicly and keeps catalog operations to admins', () => {
		const routes = source('/worker/api/routes/catalogRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/catalog/images/:productId/:file'"))).toContain('setAuthLevel(AuthConfig.public)');
		for (const line of routes.filter((candidate) => candidate.includes("'/api/admin/catalog/"))) expect(line).toContain('setAuthLevel(AuthConfig.admin)');
		expect(source('/worker/api/routes/index.ts')).toContain('setupCatalogRoutes(app)');
	});

	it('exposes the runner and sandbox moves to admins only', () => {
		const routes = source('/worker/api/routes/catalogRoutes.ts');
		for (const path of ["'/api/admin/catalog/orders/:id/runner'", "'/api/admin/catalog/orders/:id/sync'", "'/api/admin/catalog/orders/:id/retry'", "'/api/admin/catalog/orders/:id/sandbox'"]) {
			expect(routes.split('\n').find((line) => line.includes(path))).toContain('setAuthLevel(AuthConfig.admin)');
		}
	});

	it('lists catalog orders and shows one to admins only', () => {
		const routes = source('/worker/api/routes/catalogRoutes.ts').split('\n');
		for (const path of ["'/api/admin/catalog/orders'", "'/api/admin/catalog/orders/:id'"]) {
			const route = routes.find((line) => line.includes(`app.get(${path},`));
			expect(route, path).toContain('setAuthLevel(AuthConfig.admin)');
		}
	});

	it('shows the catalog to signed-in sellers', () => {
		const routes = source('/worker/api/routes/catalogRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/catalog/products'"))).toContain('setAuthLevel(AuthConfig.authenticated)');
	});
});
