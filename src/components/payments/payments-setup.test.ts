import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/components/payments/PayoutsCard.tsx', '/src/components/payments/PaymentsSetupPrompt.tsx', '/src/hooks/use-payments.ts', '/src/routes/home.tsx'],
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

	it('offers setup after sign-up on the home page, once, until the seller dismisses it', () => {
		const prompt = source('/src/components/payments/PaymentsSetupPrompt.tsx');
		expect(prompt).toContain('SELLER_SETUP_PATH');
		expect(prompt).toContain("'estori:payments-setup-dismissed'");
		expect(prompt).toContain('try {');
		expect(prompt).toContain('status.data.connected');
		expect(source('/src/routes/home.tsx')).toContain('<PaymentsSetupPrompt />');
	});
});
