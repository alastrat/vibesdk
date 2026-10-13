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

const sellerSources = import.meta.glob<string>(
	[
		'/src/components/payments/PayoutsCard.tsx',
		'/src/components/publishing/PublishDialog.tsx',
		'/src/components/publishing/PaidListingsList.tsx',
		'/src/routes/profile.tsx',
		'/src/routes/admin/reviews.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function sellerSource(path: string): string {
	const text = sellerSources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('getting paid', () => {
	it('connects Stripe from the profile and opens the dashboard once set up', () => {
		const card = sellerSource('/src/components/payments/PayoutsCard.tsx');
		expect(card).toContain('Connect Stripe');
		expect(card).toContain('Open Stripe dashboard');
		expect(card).toContain('window.location.assign(');
		expect(sellerSource('/src/routes/profile.tsx')).toContain('<PayoutsCard />');
	});

	it('asks for Stripe before a paid publish and states the fee', () => {
		const dialog = sellerSource('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain('Connect Stripe to sell this site');
		expect(dialog).toContain('PLATFORM_FEE_PERCENT');
		expect(dialog).not.toContain('test mode');
	});

	it('shows sellers their earnings and admins the sales and fees', () => {
		expect(sellerSource('/src/components/publishing/PaidListingsList.tsx')).toContain('listing.earningsCents');
		const reviews = sellerSource('/src/routes/admin/reviews.tsx');
		expect(reviews).toContain('useAdminSales()');
		expect(reviews).toContain('totalFeesCents');
	});
});
