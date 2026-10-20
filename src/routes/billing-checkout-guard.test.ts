import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/hooks/*.ts',
		'/src/routes/settings/*.ts',
		'/src/routes/settings/*.tsx',
		'/src/components/billing/*.tsx',
		'/src/components/billing/*.ts',
		'!/src/**/*.test.ts',
		'!/src/**/*.test.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const PAGE = '/src/routes/settings/billing-checkout.tsx';
const RETURN = '/src/routes/settings/billing-checkout-return.tsx';
const HOOK = '/src/hooks/use-billing-checkout.ts';
const STATE = '/src/routes/settings/checkout-state.ts';

describe("estori's own checkout page", () => {
	it('never sends the browser to an address in use-billing', () => {
		const hooks = source('/src/hooks/use-billing.ts');
		expect(hooks).not.toContain('window.location.href');
		expect(hooks).not.toContain('window.location');
	});

	it("shows the consent sentence the server wrote for the session, never one it builds itself, and links the Terms", () => {
		const page = source(PAGE);
		expect(page).toContain('consentPartsOf(');
		expect(page).toContain('terms.view.consentText');
		expect(page).toContain('terms.view.buttonText');
		expect(page).toContain('href="/terms"');
		for (const builder of ['subscriptionConsentText', 'renewalTermsPhrase', 'subscribeButtonText']) {
			for (const path of [PAGE, HOOK, STATE]) expect(source(path), `${builder} in ${path}`).not.toContain(builder);
		}
	});

	it('shows the order from the server and the amount Stripe reports, so the page and the charge cannot disagree', () => {
		const page = source(PAGE);
		expect(page).toContain('state.order');
		expect(page).toContain('dueTodayLabel(');
		expect(source(HOOK)).toContain('total.total.amount');
	});

	it('names no Stripe page or address anywhere in billing', () => {
		for (const [path, text] of Object.entries(sources)) {
			if (path.startsWith('/src/routes/settings/') || path.startsWith('/src/hooks/')) expect(text, path).not.toContain('stripe.com');
		}
	});

	it('is a signed-in page next to the billing page, with its return route', () => {
		const routes = source('/src/routes.tsx');
		const appRoutes = routes.slice(routes.indexOf('Component: AppShell'), routes.indexOf('Component: PublicShell'));
		for (const path of ['settings/billing/checkout', 'settings/billing/checkout/return']) {
			const at = appRoutes.indexOf(`path: '${path}'`);
			expect(at, path).toBeGreaterThan(-1);
			expect(appRoutes.slice(at, at + 200), path).toContain('<ProtectedRoute>');
		}
		expect(appRoutes.indexOf("path: 'settings/billing'")).toBeLessThan(appRoutes.indexOf("path: 'settings/billing/checkout'"));
	});

	it('opens one session per start, each with its own Stripe instance, and gives the form ten seconds to load', () => {
		const hook = source(HOOK);
		expect(hook).toContain('loadWithin(loadStripe(');
		expect(hook).toContain('loadWithin(checkout.loadActions())');
		expect(hook).toContain('initCheckoutElementsSdk(');
		expect(hook).not.toContain('window.Stripe');
		expect(hook).toContain('payment?.destroy()');
	});

	it('reads the total in the session change, which Stripe.js requires before it confirms', () => {
		const hook = source(HOOK);
		expect(hook).toContain("checkout.on('change'");
		expect(hook).toContain('session.total.total.amount');
		expect(hook).toContain('actions.getSession()');
	});

	it('presses pay through one guarded call, so a double click records one consent and confirms once', () => {
		const hook = source(HOOK);
		expect(hook).toContain('singleFlight(');
		expect(hook).toContain('submitPayment(');
		expect(hook).toContain('recordCheckoutConsent(');
		expect(hook).toContain('TERMS_VERSION');
		const page = source(PAGE);
		expect(page).toContain('!canPayNow(state)');
		expect(page).toContain('loading={state.paying}');
	});

	it('uses the plain failure for a start that failed, and the pure module for what a refusal means', () => {
		const hook = source(HOOK);
		expect(hook).toContain('CHECKOUT_FAILED_MESSAGE');
		expect(hook).toContain('startRefusalOf(');
		expect(hook).toContain('FORM_NOT_LOADED_MESSAGE');
	});

	it('re-applies the look when the theme switches', () => {
		const hook = source(HOOK);
		expect(hook).toContain('changeAppearance(');
		expect(hook).toContain('BILLING_APPEARANCE_TOKENS');
		expect(hook).toContain('getComputedStyle(document.documentElement)');
	});

	it('returns to billing with the plain path, and reads the status with the return route', () => {
		const page = source(PAGE);
		expect(page).toContain('to={BILLING_PATH}');
		const back = source(RETURN);
		expect(back).toContain('getCheckoutStatus(');
		expect(back).toContain('returnTargetOf(');
		expect(back).toContain("get('session_id')");
	});

	it('keeps the two paths to the checkout page the same', () => {
		expect(source('/src/hooks/use-billing.ts')).toContain('const CHECKOUT_PATH = `${BILLING_PATH}/checkout`;');
		expect(source(STATE)).toContain('export const CHECKOUT_PATH = `${BILLING_PATH}/checkout`;');
	});

	it('waits for the payment the way billing always has, keyed by the confirm mark', () => {
		const view = source('/src/routes/settings/billing-view.ts');
		expect(view).toContain("params.get('confirm')");
		expect(view).not.toContain("'success'");
	});
});
