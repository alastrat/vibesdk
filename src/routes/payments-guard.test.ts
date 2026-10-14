import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/publishing/UseSiteButton.tsx',
		'/src/hooks/use-payments.ts',
		'/src/hooks/use-publishing.ts',
		'/src/routes/app/index.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('paying for a site', () => {
	it('sends a buyer from the app page to the product page, which starts Stripe Checkout', () => {
		const button = source('/src/components/publishing/UseSiteButton.tsx');
		expect(button).toContain('navigate(`/discover/${app.id}`)');
		expect(button).not.toContain('useCreateSiteCheckout');
		expect(button).not.toContain('test mode');
	});

	it('confirms the return from Stripe once, from the app page that stays mounted', () => {
		const hook = source('/src/hooks/use-payments.ts');
		expect(hook).toContain('export function useConfirmCheckoutReturn(');
		expect(hook).toContain("searchParams.get('purchase') === 'success'");
		expect(hook).toContain("searchParams.get('session_id')");
		expect(hook).toContain('confirmedSession.current');
		expect(hook).toContain('mutateAsync(');
		expect(hook).toContain(".delete('purchase')");
		expect(hook).toContain(".delete('session_id')");
		expect(hook).toContain('replace: true');
		expect(source('/src/routes/app/index.tsx')).toContain('useConfirmCheckoutReturn(app');
	});

	it('no longer records purchases without payment', () => {
		expect(source('/src/hooks/use-publishing.ts')).not.toContain('usePurchaseSite');
		expect(source('/src/hooks/use-payments.ts')).toContain('confirmSitePurchase(');
	});

	it('refreshes Discover and the account lists after a purchase', () => {
		const hook = source('/src/hooks/use-payments.ts');
		expect(hook).toContain('queryKeys.apps.all');
		expect(hook).toContain('queryKeys.account.apps.all()');
		expect(hook).toContain('queryKeys.account.publishing.all()');
	});

	it('shares one unwrap between the publishing and payments hooks', () => {
		for (const path of ['/src/hooks/use-payments.ts', '/src/hooks/use-publishing.ts']) {
			const hook = source(path);
			expect(hook).toContain("from '@/lib/unwrap-response'");
			expect(hook).not.toContain('function unwrap');
		}
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
		expect(card).toContain('useStripeOnboardingRedirect()');
		expect(card).not.toContain('useStartStripeOnboarding');
		expect(sellerSource('/src/routes/profile.tsx')).toContain('<PayoutsCard />');
	});

	it('sends the seller to Stripe onboarding from one hook, with one error toast', () => {
		const hook = source('/src/hooks/use-payments.ts');
		expect(hook).toContain('export function useStripeOnboardingRedirect(');
		expect(hook).toContain('window.location.assign(link.url)');
		expect(hook).toContain('toast.error(error.message)');
		expect(sellerSource('/src/components/publishing/PublishDialog.tsx')).toContain('useStripeOnboardingRedirect()');
	});

	it('tells a seller whose details Stripe is still verifying', () => {
		const card = sellerSource('/src/components/payments/PayoutsCard.tsx');
		expect(card).toContain('data.detailsSubmitted');
		expect(card).toContain('Waiting for Stripe');
		expect(card).toContain('Stripe is verifying your details.');
		expect(card).toContain('Continue Stripe setup');
	});

	it('lets the seller retry a failed Stripe status', () => {
		expect(sellerSource('/src/components/payments/PayoutsCard.tsx')).toContain('status.refetch()');
	});

	it('shares one not-configured message', () => {
		for (const path of ['/src/components/payments/PayoutsCard.tsx', '/src/components/publishing/PublishDialog.tsx']) {
			const text = sellerSource(path);
			expect(text).toContain('PAYMENTS_NOT_CONFIGURED_MESSAGE');
			expect(text).not.toContain("Payments aren't set up");
		}
	});

	it('asks for Stripe before a paid publish and states the fee', () => {
		const dialog = sellerSource('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain('Connect Stripe to sell this site');
		expect(dialog).toContain('Estori keeps {PLATFORM_FEE_LABEL} of each');
		expect(sellerSource('/src/components/payments/PayoutsCard.tsx')).toContain("minus Estori's {PLATFORM_FEE_LABEL} fee");
		expect(dialog).not.toContain('test mode');
	});

	it('explains and recovers a Stripe status that is loading or failed on a paid publish', () => {
		const dialog = sellerSource('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain('payouts.isError');
		expect(dialog).toContain('payouts.error.message');
		expect(dialog).toContain('payouts.refetch()');
		expect(dialog).toContain('payouts.isPending');
		expect(dialog).toContain('Checking your Stripe account');
		expect(dialog).toContain('disabled={!consent || !sellerReady || !pageCopy.valid}');
	});

	it('shows sellers their earnings and admins the sales and fees', () => {
		expect(sellerSource('/src/components/publishing/PaidListingsList.tsx')).toContain('listing.earningsCents');
		const reviews = sellerSource('/src/routes/admin/reviews.tsx');
		expect(reviews).toContain('useAdminSales()');
		expect(reviews).toContain('totalFeesCents');
		expect(reviews).toContain("Couldn't load sales");
	});
});
