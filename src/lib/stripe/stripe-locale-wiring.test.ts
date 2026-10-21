import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/hooks/use-billing-checkout.ts', '/src/hooks/use-billing-card.ts'], { query: '?raw', import: 'default', eager: true });

describe("Stripe's card form speaks the app's language", () => {
	it.each(['/src/hooks/use-billing-checkout.ts', '/src/hooks/use-billing-card.ts'])('is opened with the active language by %s', (path) => {
		const source = sources[path];
		expect(source).toContain('loadStripe(start.publishableKey, getLocale())');
		expect(source).not.toMatch(/loadStripe\(start\.publishableKey\)/);
	});
});
