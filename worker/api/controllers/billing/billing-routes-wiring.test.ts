import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/billingRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('billing routes', () => {
	it("are signed-in only, act on the caller's own account, and are registered", () => {
		const routes = source('/worker/api/routes/billingRoutes.ts');
		const sellerRoutes = routes.slice(0, routes.indexOf("'/api/admin/") === -1 ? routes.length : routes.indexOf("'/api/admin/"));
		for (const path of ["'/api/billing'", "'/api/billing/checkout'", "'/api/billing/change-plan'", "'/api/billing/cancel'", "'/api/billing/resume'", "'/api/billing/portal'", "'/api/billing/credits'"]) {
			const start = sellerRoutes.indexOf(path);
			expect(start, path).toBeGreaterThan(-1);
			expect(sellerRoutes.slice(start, start + 160), path).toContain('setAuthLevel(AuthConfig.authenticated)');
		}
		expect(sellerRoutes).not.toContain(':userId');
		expect(source('/worker/api/routes/index.ts')).toContain('setupBillingRoutes(app);');
	});
});
