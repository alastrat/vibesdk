import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/billingRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

/** Every seller route: its method, path and the controller method that answers it. */
const SELLER_ROUTES = [
	['get', '/api/billing', 'get'],
	['post', '/api/billing/checkout', 'checkout'],
	['post', '/api/billing/credits', 'credits'],
	['get', '/api/billing/checkout/terms', 'checkoutTerms'],
	['post', '/api/billing/checkout/consent', 'checkoutConsent'],
	['get', '/api/billing/checkout/status', 'checkoutStatus'],
	['post', '/api/billing/change-plan', 'changePlan'],
	['post', '/api/billing/cancel', 'cancel'],
	['post', '/api/billing/resume', 'resume'],
	['post', '/api/billing/card', 'cardSetup'],
	['post', '/api/billing/card/complete', 'cardComplete'],
	['post', '/api/billing/invoices/pay', 'payInvoice'],
	['get', '/api/billing/history', 'history'],
	['get', '/api/billing/invoices/:id/pdf', 'invoicePdf'],
] as const;

describe('billing routes', () => {
	it("are signed-in only, act on the caller's own account, and are registered", () => {
		const routes = source('/worker/api/routes/billingRoutes.ts');
		const sellerRoutes = routes.split('\n').filter((line) => line.includes('app.') && !line.includes("'/api/admin/"));
		const expected = SELLER_ROUTES.map(([method, path, handler]) => `app.${method}('${path}', setAuthLevel(AuthConfig.authenticated), adaptController(BillingController, BillingController.${handler}));`);
		expect(sellerRoutes.map((line) => line.trim())).toEqual(expected);
		expect(sellerRoutes.join('\n')).not.toContain(':userId');
		expect(source('/worker/api/routes/index.ts')).toContain('setupBillingRoutes(app);');
	});

	it("has no route to Stripe's billing portal", () => {
		const routes = source('/worker/api/routes/billingRoutes.ts');
		expect(routes).not.toMatch(/portal/i);
		expect(routes).not.toContain('/api/billing/portal');
	});

	it('keeps account billing changes to admins', () => {
		const routes = source('/worker/api/routes/billingRoutes.ts');
		for (const route of ["'/api/admin/users/:userId/billing'", "'/api/admin/users/:userId/plan'", "'/api/admin/users/:userId/credits'", "'/api/admin/users/:userId/stripe-customer'"]) {
			const start = routes.indexOf(route);
			expect(start, route).toBeGreaterThan(-1);
			expect(routes.slice(start, start + 160), route).toContain('setAuthLevel(AuthConfig.admin)');
		}
	});
});
