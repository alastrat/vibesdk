import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/settings/index.tsx',
		'/src/routes/settings/billing.tsx',
		'/src/components/layout/app-layout.tsx',
		'/src/components/billing/PlanButton.tsx',
		'/src/hooks/use-billing.ts',
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
		expect(checkout).toContain('apiClient.startPlanCheckout(plan)');
	});
});
