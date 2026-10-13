import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/routes/paymentsRoutes.ts', '/worker/api/routes/index.ts', '/worker/app.ts', '/worker/api/controllers/payments/webhook.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('payments routes', () => {
	it('keeps seller onboarding behind sign-in and the webhook public', () => {
		const routes = source('/worker/api/routes/paymentsRoutes.ts').split('\n');
		for (const path of ["'/api/stripe/connect/onboarding'", "'/api/stripe/connect/status'", "'/api/stripe/connect/dashboard'"]) {
			expect(routes.find((line) => line.includes(path))).toContain('setAuthLevel(AuthConfig.authenticated)');
		}
		expect(routes.find((line) => line.includes("'/api/stripe/webhook'"))).toContain('setAuthLevel(AuthConfig.public)');
		expect(source('/worker/api/routes/index.ts')).toContain('setupPaymentsRoutes(app)');
	});

	it('exempts only the webhook from CSRF, because Stripe signs it instead', () => {
		expect(source('/worker/app.ts')).toContain("pathname === '/api/stripe/webhook'");
	});

	it('verifies the signature before reading the event', () => {
		const webhook = source('/worker/api/controllers/payments/webhook.ts');
		expect(webhook.indexOf('verifyStripeSignature(')).toBeGreaterThan(-1);
		expect(webhook.indexOf('verifyStripeSignature(')).toBeLessThan(webhook.indexOf('parseStripeEvent('));
	});
});
