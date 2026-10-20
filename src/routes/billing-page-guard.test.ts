import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/settings/index.tsx',
		'/src/routes/settings/billing.tsx',
		'/src/components/layout/app-layout.tsx',
		'/src/components/billing/PlanButton.tsx',
		'/src/components/billing/BillingBanner.tsx',
		'/src/components/billing/UpgradeDialog.tsx',
		'/src/hooks/use-billing.ts',
		'/src/lib/api-client.ts',
		'/src/routes/settings/billing-view.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the billing page', () => {
	it('is a signed-in page in the app, linked from settings only when billing is on', () => {
		const routes = source('/src/routes.tsx');
		const appRoutes = routes.slice(routes.indexOf('Component: AppShell'), routes.indexOf('Component: PublicShell'));
		expect(appRoutes).toContain("path: 'settings/billing'");
		expect(appRoutes.slice(appRoutes.indexOf("path: 'settings/billing'"), appRoutes.indexOf("path: 'settings/billing'") + 200)).toContain('<ProtectedRoute>');
		const settings = source('/src/routes/settings/index.tsx');
		expect(settings).toContain('billing.data?.enabled &&');
		expect(settings).toContain('to={BILLING_PATH}');
	});

	it('waits for the webhook after a checkout, every 2 seconds for up to 30', () => {
		const page = source('/src/routes/settings/billing.tsx');
		expect(page).toContain('refetchInterval: confirming ? CONFIRM_POLL_MS : false');
		expect(page).toContain('CONFIRM_TIMEOUT_MS');
		expect(page).toContain('Confirming your payment…');
		expect(page).toContain('Your payment is being confirmed. Refresh in a minute.');
		expect(page).toContain('id="extra-credits"');
	});

	it('keeps asking after a plan change until the page shows it, within the same bounds', () => {
		const page = source('/src/routes/settings/billing.tsx');
		expect(page).toContain("setWaiting({ kind: 'change', action })");
		expect(page).toContain('showsChange(waiting.action, view)');
	});

	it("opens a plan's next step from a link followed on the billing page itself, not only on arrival", () => {
		const page = source('/src/routes/settings/billing.tsx');
		const effect = page.slice(page.indexOf('const plan = requestedPlanOf(location.search);'));
		expect(effect.slice(0, 600)).toContain('[location.pathname, location.search, location.hash, navigate]');
		expect(page).not.toContain('useState(() => {');
	});

	it('shows the banner on every app page, and sends signed-out buyers to sign up, then back to their plan', () => {
		expect(source('/src/components/layout/app-layout.tsx')).toContain('<BillingBanner />');
		expect(source('/src/components/billing/PlanButton.tsx')).toContain('usePlanCheckout()');
		// The checkout itself is a hook, so the billing page starts it the same way as the button.
		const checkout = source('/src/hooks/use-billing.ts');
		expect(checkout).toContain('setIntendedUrl(`${BILLING_PATH}?plan=${plan}`)');
		expect(checkout).toContain("navigate('/signup')");
	});

	it("takes a plan or an amount of extra credits to Estori's own checkout page, which opens the session itself", () => {
		const hooks = source('/src/hooks/use-billing.ts');
		expect(hooks).toContain('const CHECKOUT_PATH = `${BILLING_PATH}/checkout`;');
		expect(hooks).toContain('navigate(`${CHECKOUT_PATH}?plan=${plan}`)');
		expect(hooks).toContain('navigate(`${CHECKOUT_PATH}?credits=${credits}`)');
		expect(hooks).not.toContain('window.location');
		expect(hooks).not.toContain('apiClient.startPlanCheckout');
		expect(hooks).not.toContain('apiClient.buyCredits');
		expect(source('/src/routes/settings/billing.tsx')).not.toContain('window.location');
		const dialog = source('/src/components/billing/UpgradeDialog.tsx');
		expect(dialog).toContain('usePlanCheckout()');
		expect(dialog).not.toContain('window.location');
		expect(dialog).not.toContain('apiClient');
	});

	it("has no way into Stripe's billing portal", () => {
		for (const path of ['/src/routes/settings/billing.tsx', '/src/routes/settings/billing-view.ts', '/src/components/billing/BillingBanner.tsx', '/src/hooks/use-billing.ts', '/src/lib/api-client.ts']) {
			expect(source(path), path).not.toMatch(/portal/i);
		}
		expect(source('/src/routes/settings/billing.tsx')).not.toContain('Manage billing');
	});
});

describe('the billing calls of the API client', () => {
	const client = source('/src/lib/api-client.ts');
	const billing = client.slice(client.indexOf('async getBilling('), client.indexOf('async getSellerLimits('));

	it('reaches each billing route through the one request that sends the CSRF token with a write', () => {
		for (const call of [
			"this.request<CheckoutClientStart>('/api/billing/checkout', { method: 'POST', body })",
			"this.request<CheckoutClientStart>('/api/billing/credits', { method: 'POST', body })",
			'this.request<CheckoutTermsView>(`/api/billing/checkout/terms?${new URLSearchParams({ session_id: sessionId })}`)',
			"this.request<{ recorded: true }>('/api/billing/checkout/consent', { method: 'POST', body })",
			'this.request<CheckoutStatusView>(`/api/billing/checkout/status?${new URLSearchParams({ session_id: sessionId })}`)',
			"this.request<CardSetupStart>('/api/billing/card', { method: 'POST', body: { mode } })",
			"this.request<InvoicePaymentResult>('/api/billing/card/complete', { method: 'POST', body: { sessionId } })",
			"this.request<InvoicePaymentResult>('/api/billing/invoices/pay', { method: 'POST' })",
			"this.request<InvoiceView[]>('/api/billing/history')",
		]) {
			expect(billing, call).toContain(call);
		}
		expect(billing).not.toContain('fetch(');
	});

	it("gives an invoice's PDF as a path on Estori for a link, never Stripe's address", () => {
		expect(billing).toContain('invoicePdfUrl(invoiceId: string): string {');
		expect(billing).toContain('return `${this.baseUrl}/api/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`;');
		expect(billing).not.toContain('stripe.com');
	});
});
