import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/components/publishing/UseSiteButton.tsx', '/src/hooks/use-payments.ts', '/src/hooks/use-publishing.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('paying for a site', () => {
	it('sends the buyer to Stripe Checkout and confirms on return', () => {
		const button = source('/src/components/publishing/UseSiteButton.tsx');
		expect(button).toContain('window.location.assign(result.checkoutUrl)');
		expect(button).toContain("searchParams.get('purchase') === 'success'");
		expect(button).toContain("searchParams.get('session_id')");
		expect(button).toContain('Secure checkout with Stripe');
		expect(button).not.toContain('test mode');
	});

	it('no longer records purchases without payment', () => {
		expect(source('/src/hooks/use-publishing.ts')).not.toContain('usePurchaseSite');
		expect(source('/src/hooks/use-payments.ts')).toContain('confirmSitePurchase(');
	});
});
