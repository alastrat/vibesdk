import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/api/routes/paymentsRoutes.ts',
		'/worker/api/routes/index.ts',
		'/worker/app.ts',
		'/worker/api/controllers/payments/webhook.ts',
		'/worker/api/controllers/payments/connectController.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('payments routes', () => {
	it('takes the selling-terms agreement before Stripe, and reports the next setup step', () => {
		const routes = source('/worker/api/routes/paymentsRoutes.ts');
		expect(routes).toContain("app.post('/api/stripe/connect/terms', setAuthLevel(AuthConfig.authenticated)");
		const controller = source('/worker/api/controllers/payments/connectController.ts');
		expect(controller).toContain('Accept the selling terms first');
		expect(controller).toContain('setupStep: sellerSetupStep(readiness)');
	});

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

	it('routes disputes on store payments to the dispute handlers', () => {
		const webhook = source('/worker/api/controllers/payments/webhook.ts');
		expect(webhook).toContain("event.type === 'charge.dispute.created' || event.type === 'charge.dispute.funds_withdrawn' || event.type === 'charge.dispute.closed'");
		expect(webhook).toContain('handleDisputeOpened(deps, object)');
		expect(webhook).toContain('handleDisputeClosed(deps, object)');
	});

	it('verifies the signature before reading the event', () => {
		const webhook = source('/worker/api/controllers/payments/webhook.ts');
		expect(webhook.indexOf('verifyStripeSignature(')).toBeGreaterThan(-1);
		expect(webhook.indexOf('verifyStripeSignature(')).toBeLessThan(webhook.indexOf('parseStripeEvent('));
	});
});

describe('a stored Stripe account that Stripe no longer has', () => {
	const controller = source('/worker/api/controllers/payments/connectController.ts');
	const method = (name: string, next?: string): string =>
		controller.slice(controller.indexOf(`static async ${name}(`), next ? controller.indexOf(`static async ${next}(`) : undefined);

	it('reads as not connected in the status, not as the stale stored flags', () => {
		// getStatus and acceptSellerTerms both answer through loadStatus.
		expect(method('getStatus', 'acceptSellerTerms')).toContain('StripeConnectController.loadStatus(env, context.user!.id)');
		const status = method('loadStatus', 'getStatus');
		expect(status).toContain('accounts.forgetIfMissing(stored, (accountId) => stripe.retrieveAccount(accountId))');
		const missing = status.indexOf('if (!account)');
		expect(missing).toBeGreaterThan(status.indexOf('accounts.forgetIfMissing('));
		expect(status.indexOf('statusOf(null, termsAccepted, payouts)', missing)).toBeGreaterThan(missing);
		expect(status.indexOf('statusOf(null, termsAccepted, payouts)', missing)).toBeLessThan(status.indexOf('accountFlags(account)'));
	});

	it('is replaced by one fresh Express account when onboarding', () => {
		const onboarding = method('startOnboarding', 'getStatus');
		const forget = onboarding.indexOf('accounts.forgetIfMissing(stored, linkFor)');
		expect(forget).toBeGreaterThan(-1);
		expect(onboarding.match(/createExpressAccount\(/g)).toHaveLength(1);
		expect(onboarding.indexOf('createExpressAccount(')).toBeGreaterThan(forget);
	});

	it('sends the seller back to onboarding instead of opening the dashboard', () => {
		const dashboard = method('dashboardLink');
		const forget = dashboard.indexOf('accounts.forgetIfMissing(stored, (accountId) => stripe.createLoginLink(accountId))');
		expect(forget).toBeGreaterThan(-1);
		expect(dashboard.indexOf('FINISH_ONBOARDING_MESSAGE, 400', forget)).toBeGreaterThan(forget);
		expect(controller).toContain("const FINISH_ONBOARDING_MESSAGE = 'Finish Stripe onboarding first';");
	});
});
