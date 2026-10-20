import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/hooks/*.ts',
		'/src/routes/settings/*.ts',
		'/src/routes/settings/*.tsx',
		'/src/components/billing/*.tsx',
		'/src/components/billing/*.ts',
		'/src/lib/*.ts',
		'/src/lib/stripe/*.ts',
		'!/src/**/*.test.ts',
		'!/src/**/*.test.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

// Every source in the app, for the places that may load Stripe.js.
const app = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const PAGE = '/src/routes/settings/billing-card.tsx';
const RETURN = '/src/routes/settings/billing-card-return.tsx';
const HOOK = '/src/hooks/use-billing-card.ts';

describe("estori's own card page", () => {
	it('opens one setup session per start, each with its own Stripe instance, and gives the form ten seconds to load', () => {
		const hook = source(HOOK);
		expect(hook).toContain('apiClient.startCardSetup(mode)');
		expect(hook).toContain('loadWithin(loadStripe(');
		expect(hook).toContain('loadWithin(checkout.loadActions())');
		expect(hook).toContain('initCheckoutElementsSdk(');
		expect(hook).not.toContain('window.Stripe');
		expect(hook).toContain('payment?.destroy()');
		expect(hook).toContain('FORM_NOT_LOADED_MESSAGE');
	});

	it("reads the session's total on every change and on the first read, which Stripe.js requires before it confirms", () => {
		const hook = source(HOOK);
		expect(hook).toContain("checkout.on('change'");
		expect(hook).toContain('sessionStatusOf(session)');
		expect(hook).toContain('sessionStatusOf(loaded.actions.getSession())');
		expect(source('/src/lib/stripe/session.ts')).toContain('session.total?.total.amount');
	});

	it('goes straight to the return route when the session is already complete, instead of showing a form that cannot be used', () => {
		const hook = source(HOOK);
		expect(hook).toMatch(/if \(status === 'complete'\) \{\s*navigate\(cardReturnPathOf\(sessionId\), \{ replace: true \}\);\s*return;/);
	});

	it('presses save through one guarded call, so a double click confirms once and the button stays disabled until the result', () => {
		const hook = source(HOOK);
		expect(hook).toContain('singleFlight(');
		expect(hook).toContain('submitCard(');
		expect(hook).toContain('canSaveNow(current)');
		const page = source(PAGE);
		expect(page).toContain('disabled={!canSaveNow(state)}');
		expect(page).toContain('loading={state.saving}');
		expect(page).toContain('{saveLabelFor(mode)}');
	});

	it('carries the session on every answer that comes back later, and the hook sends it', () => {
		const hook = source(HOOK);
		expect(hook).toContain("type: 'sessionStatus', sessionId");
		expect(hook).toContain("type: 'saveOutcome', sessionId");
	});

	it('takes its mode from the address and says what each mode does', () => {
		const page = source(PAGE);
		expect(page).toContain('cardModeOf(location.search)');
		expect(page).toContain('useBillingCard(mode)');
		expect(source('/src/routes/settings/card-state.ts')).toContain("'Save card and pay'");
	});

	it('shows a refusal or a timeout in place of the form, each with a way back', () => {
		const page = source(PAGE);
		expect(page).toContain('CARD_EXPIRED_MESSAGE');
		expect(page).toContain("label: 'Start again'");
		expect(page).toContain("label: 'Try again'");
		expect(page).toContain('<Stopped ');
		expect(page).toContain('<BackToBilling />');
	});

	it('shares the stripe look, the stopped panel and the way back with the checkout page, with no local copies', () => {
		const checkout = source('/src/routes/settings/billing-checkout.tsx');
		const checkoutHook = source('/src/hooks/use-billing-checkout.ts');
		for (const text of [source(PAGE), checkout]) {
			expect(text).toContain("from '@/components/billing/BackToBilling'");
			expect(text).toContain("from '@/components/billing/Stopped'");
			expect(text).not.toMatch(/function (BackToBilling|Stopped)\(/);
		}
		for (const text of [source(HOOK), checkoutHook]) {
			expect(text).toContain('useStripeAppearance(sdk)');
			expect(text).not.toContain('getComputedStyle');
			expect(text).not.toContain('changeAppearance(');
		}
		for (const text of [source(HOOK), checkoutHook, source('/src/hooks/use-billing.ts')]) {
			expect(text).not.toMatch(/function (loadWithin|singleFlight)\(/);
		}
	});

	it('reads the session from the return address, finishes the card there, and goes back to billing with the result', () => {
		const back = source(RETURN);
		expect(back).toContain('sessionIdOfReturn(location.search)');
		expect(back).toContain('apiClient.completeCardSetup(sessionId)');
		expect(back).toContain('settlePayment(result)');
		expect(back).toContain('returnTargetFor(settled)');
		expect(back).toContain('toast.success(notice.message)');
		expect(back).toContain('navigate(BILLING_PATH, { replace: true })');
		expect(back).toContain('invalidateQueries({ queryKey: queryKeys.billing() })');
	});

	it('keeps a declined payment on the return page, with a way to try another card and a way back', () => {
		const back = source(RETURN);
		expect(back).toContain('if (target === null) {');
		expect(back).toContain("to={cardPathOf('pay')}");
		expect(back).toContain('<BackToBilling />');
	});

	it('keeps the card path and the return path the server knows', () => {
		const state = source('/src/routes/settings/card-state.ts');
		expect(state).toContain('export const CARD_PATH = `${BILLING_PATH}/card`;');
		expect(state).toContain('export const CARD_RETURN_PATH = `${CARD_PATH}/return`;');
	});
});

describe('stripe.js in the app', () => {
	it('opens both billing payment forms for cards only, with no Apple Pay, Google Pay or Link', () => {
		for (const hook of [HOOK, '/src/hooks/use-billing-checkout.ts']) {
			expect(source(hook), hook).toContain('checkout.createPaymentElement(CARD_ONLY_PAYMENT_ELEMENT)');
			expect(source(hook), hook).not.toContain('createPaymentElement()');
		}
		expect(source('/src/lib/stripe/stripe-js.ts')).toContain("wallets: { applePay: 'never', googlePay: 'never', link: 'never' }");
	});

	it('loads only where a payment is made: the checkout page, the card page and the confirmation of a payment', () => {
		const loaders = Object.entries(app)
			.filter(([path, text]) => path !== '/src/lib/stripe/stripe-js.ts' && /\bloadStripe\b/.test(text))
			.map(([path]) => path)
			.sort();
		expect(loaders).toEqual(['/src/hooks/use-billing-card.ts', '/src/hooks/use-billing-checkout.ts', '/src/lib/stripe/next-action.ts']);
	});

	it("confirms a payment the bank asked for with the answer's own key, in one new instance, and asks nothing of Stripe's pages", () => {
		const action = source('/src/lib/stripe/next-action.ts');
		expect(action).toContain('open(result.publishableKey)');
		expect(action).toContain('stripe.handleNextAction({ clientSecret: result.clientSecret })');
		expect(action).toContain('loadWithin(');
	});

	it('names no Stripe page or address anywhere in billing', () => {
		for (const [path, text] of Object.entries(sources)) {
			if (path.startsWith('/src/routes/settings/') || path.startsWith('/src/hooks/') || path.startsWith('/src/components/billing/')) expect(text, path).not.toContain('stripe.com');
		}
	});
});
