import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/api/routes/publishingRoutes.ts',
		'/worker/api/routes/index.ts',
		'/worker/api/routes/appRoutes.ts',
		'/worker/api/controllers/publishing/controller.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('publishing routes', () => {
	const routes = source('/worker/api/routes/publishingRoutes.ts');
	const lines = routes.split('\n');

	it('puts every admin route behind the admin auth level', () => {
		const adminLines = lines.filter((line) => line.includes("'/api/admin/"));
		expect(adminLines).toHaveLength(8);
		for (const line of adminLines) expect(line).toContain('setAuthLevel(AuthConfig.admin)');
	});

	it('lets only the owner publish and manage a paid listing', () => {
		for (const path of [
			"'/api/apps/:id/visibility'",
			"'/api/apps/:id/publishing'",
			"'/api/apps/:id/paid-listing/versions'",
			"'/api/apps/:id/paid-listing/versions/:versionId/withdraw'",
		]) {
			const line = lines.find((candidate) => candidate.includes(path));
			expect(line).toContain('setAuthLevel(AuthConfig.ownerOnly)');
		}
	});

	it('keeps checkout and its confirmation behind sign-in', () => {
		for (const path of ["'/api/apps/:id/purchases'", "'/api/apps/:id/purchases/confirm'"]) {
			const line = lines.find((candidate) => candidate.includes(path));
			expect(line).toContain('setAuthLevel(AuthConfig.authenticated)');
		}
	});

	it('replaces the old visibility route and registers before the app routes', () => {
		expect(source('/worker/api/routes/appRoutes.ts')).not.toContain("'/:id/visibility'");
		const index = source('/worker/api/routes/index.ts');
		expect(index.indexOf('setupPublishingRoutes(app)')).toBeGreaterThan(-1);
		expect(index.indexOf('setupPublishingRoutes(app)')).toBeLessThan(index.indexOf('setupAppRoutes(app)'));
		expect(index).not.toContain('setupTemplateRoutes');
	});
});

describe('paid updates', () => {
	it('resubmit the approved price, never a rejected one', () => {
		const controller = source('/worker/api/controllers/publishing/controller.ts');
		expect(controller).toContain('const priceCents = paidUpdatePrice(listing, versions);');
		expect(controller).not.toContain('versions[0]?.priceCents');
	});
});

describe('publishing settings', () => {
	it('report whether the owner recorded consent to reuse', () => {
		const controller = source('/worker/api/controllers/publishing/controller.ts');
		expect(controller).toContain('hasReuseConsent: state.reuseConsentAt !== null');
	});
});

describe('Stripe calls', () => {
	const controller = source('/worker/api/controllers/publishing/controller.ts');
	const between = (from: string, to: string): string => controller.slice(controller.indexOf(from), controller.indexOf(to));

	it('answer 502 when publishing, because the payout check calls Stripe', () => {
		const publishing = between('static async updateVisibility(', 'static async getPublishing(');
		expect(publishing).toContain('error instanceof StripeApiError');
		expect(publishing).toContain('STRIPE_REQUEST_FAILED_MESSAGE, 502');
	});

	it('treat a seller whose Stripe account no longer exists as not ready', () => {
		const ready = between('private static async readySellerAccount(', 'private static async loadFacts(');
		const forget = ready.indexOf('accounts.forgetIfMissing(userId, () => stripe.retrieveAccount(stored.stripeAccountId))');
		expect(forget).toBeGreaterThan(-1);
		expect(ready.indexOf('if (!account) return null;', forget)).toBeGreaterThan(forget);
	});

	it('look up the seller for checkout only after every other rule allows the purchase', () => {
		const checkout = between('static async purchase(', 'static async confirmPurchase(');
		const cheapChecks = checkout.indexOf('checkoutDecision(checkoutInput)');
		expect(cheapChecks).toBeGreaterThan(-1);
		expect(checkout).toContain('sellerTransfersActive: true,');
		expect(checkout.indexOf('readySellerAccount(')).toBeGreaterThan(cheapChecks);
	});

	it('refresh the seller from Stripe on every checkout and let the decision refuse a seller who is not ready', () => {
		const checkout = between('static async purchase(', 'static async confirmPurchase(');
		const refresh = checkout.indexOf("readySellerAccount(env, listing.creatorUserId, 'always')");
		expect(refresh).toBeGreaterThan(-1);
		const sellerCheck = checkout.indexOf('checkoutDecision({ ...checkoutInput, sellerTransfersActive: sellerAccountId !== null })');
		expect(sellerCheck).toBeGreaterThan(refresh);
		expect(checkout.indexOf('stripe.createCheckoutSession(')).toBeGreaterThan(sellerCheck);
		expect(checkout).not.toContain('SELLER_NOT_READY_MESSAGE');
		expect(checkout).toContain('error instanceof StripeApiError');
		expect(checkout).toContain('STRIPE_REQUEST_FAILED_MESSAGE, 502');
	});

	it('trust a stored active seller when publishing, and ask Stripe only when it is not active', () => {
		expect(controller).toContain("readySellerAccount(env, userId, 'when-inactive')");
		const ready = between('private static async readySellerAccount(', 'private static async loadFacts(');
		expect(ready).toContain("refresh: 'always' | 'when-inactive'");
		expect(ready).toContain("if (refresh === 'when-inactive' && stored.transfersActive) return stored.stripeAccountId;");
	});
});
