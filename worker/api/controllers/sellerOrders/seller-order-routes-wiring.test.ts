import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/sellerOrderRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

describe('seller order routes', () => {
	it('serve signed-in sellers their own orders, and are registered', () => {
		const routes = (sources['/worker/api/routes/sellerOrderRoutes.ts'] ?? '').split('\n');
		for (const route of ["app.get('/api/orders',", "app.get('/api/orders/:id',", "app.post('/api/orders/:id/shipment',"]) {
			expect(routes.find((line) => line.includes(route)), route).toContain('setAuthLevel(AuthConfig.authenticated)');
		}
		expect(sources['/worker/api/routes/index.ts']).toContain('setupSellerOrderRoutes(app)');
	});
});
