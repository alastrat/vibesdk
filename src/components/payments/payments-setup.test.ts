import { describe, expect, it } from 'vitest';
import { OWN_PRODUCTS_WEIGHTING } from '@/lib/plans';

const sources = import.meta.glob<string>(
	['/src/components/payments/PayoutsCard.tsx', '/src/components/payments/PaymentsSetupPrompt.tsx', '/src/components/payments/PayoutFrequency.tsx', '/src/components/payments/SellerLimits.tsx', '/src/hooks/use-payments.ts', '/src/routes/home.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('payments setup', () => {
	it('asks for the selling terms before Stripe, and names every next step', () => {
		const card = source('/src/components/payments/PayoutsCard.tsx');
		expect(card).toContain("data.setupStep === 'accept-terms'");
		expect(card).toContain('SELLER_SETUP_MESSAGES[data.setupStep]');
		expect(card).toContain('acceptTerms.mutate(SELLER_TERMS_VERSION');
		expect(card).toContain('I agree to the selling terms');
		expect(card).toContain('href="/terms"');
		expect(card).toContain('Ready to take payments');
	});

	it('records the agreement through the API and refreshes the status', () => {
		const hooks = source('/src/hooks/use-payments.ts');
		expect(hooks).toContain('export function useAcceptSellerTerms(');
		expect(hooks).toContain('apiClient.acceptSellerTerms(version)');
		expect(hooks).toContain('queryKeys.account.payments.status(');
	});

	it('offers setup on the home page until the seller can take payments, remembering the step they dismissed', () => {
		const prompt = source('/src/components/payments/PaymentsSetupPrompt.tsx');
		expect(prompt).toContain('SELLER_SETUP_PATH');
		expect(prompt).toContain("'estori:payments-setup-dismissed'");
		expect(prompt).toContain('try {');
		expect(prompt).toContain('setupPrompt(status.data, dismissed)');
		expect(prompt).toContain('window.localStorage.setItem(DISMISSED_KEY, prompt.key)');
		expect(prompt).not.toContain('status.data.connected');
		expect(source('/src/routes/home.tsx')).toContain('<PaymentsSetupPrompt />');
	});

	it('sends a seller to Stripe after agreeing only when Stripe still needs something', () => {
		const card = source('/src/components/payments/PayoutsCard.tsx');
		expect(card).toContain('if (status.setupStep !== null) onboarding.start();');
		expect(card).not.toContain('onSuccess: () => onboarding.start()');
	});

	it('keeps the Stripe dashboard for a seller whose details are in, whatever the store setup still needs', () => {
		const card = source('/src/components/payments/PayoutsCard.tsx');
		expect(card).toContain('const canOpenDashboard = data.connected && data.detailsSubmitted;');
		expect(card).toContain('{canOpenDashboard && (');
	});

	it('lets the seller pick how often they are paid, with the cost of each choice', () => {
		const frequency = source('/src/components/payments/PayoutFrequency.tsx');
		for (const label of ['Daily', 'Weekly', 'Monthly', 'a month in Stripe fees']) expect(frequency).toContain(label);
		expect(frequency).toContain('payoutCostEstimates');
		expect(source('/src/components/payments/PayoutsCard.tsx')).toContain('<PayoutFrequency');
	});

	it("shows the seller's level, their two limits with this week's use, and the way up", () => {
		const limits = source('/src/components/payments/SellerLimits.tsx');
		for (const text of ['Largest order', 'Weekly limit used', 'Payouts wait', 'completed orders', 'useSellerLimits(']) expect(limits).toContain(text);
		// The limit counts own products twice, so the card says so rather than calling the weighted total sales.
		expect(limits).toContain('{OWN_PRODUCTS_WEIGHTING}');
		expect(OWN_PRODUCTS_WEIGHTING).toContain('Your own products count twice');
		expect(limits).not.toContain('Sales this week');
		expect(source('/src/components/payments/PayoutsCard.tsx')).toContain('<SellerLimits />');
	});

	it("builds the fallback fee text from the seller's configured rates, not a copy of them", () => {
		const frequency = source('/src/components/payments/PayoutFrequency.tsx');
		expect(frequency).toContain('stripeFeesText(status.accountCosts)');
		expect(frequency).not.toContain('$2.00');
	});
});
