import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Loader } from '@cloudflare/kumo';
import { Checkbox } from '@/components/ui/checkbox';
import { useAcceptSellerTerms, useStripeConnectStatus, useStripeDashboardLink, useStripeOnboardingRedirect } from '@/hooks/use-payments';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE } from '@/lib/paid-listing-display';
import { PLATFORM_FEE_LABEL, SELLER_SETUP_MESSAGES, SELLER_TERMS_VERSION } from '@/api-types';

/** "Get paid with Stripe": agree to the selling terms, finish Stripe's setup, then open the Stripe dashboard. */
export function PayoutsCard() {
	const status = useStripeConnectStatus(true);
	const onboarding = useStripeOnboardingRedirect();
	const dashboard = useStripeDashboardLink();
	const acceptTerms = useAcceptSellerTerms();
	const [agreed, setAgreed] = useState(false);

	const openDashboard = () =>
		dashboard.mutate(undefined, {
			onSuccess: (link) => window.location.assign(link.url),
			onError: (error) => toast.error(error.message),
		});

	if (status.isLoading) return <Loader />;
	if (status.isError) {
		return (
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-sm text-kumo-subtle">{status.error.message}</p>
				<Button size="sm" variant="secondary" onClick={() => status.refetch()}>
					Try again
				</Button>
			</div>
		);
	}
	const data = status.data;
	if (!data?.configured) {
		return <p className="text-sm text-kumo-subtle">{PAYMENTS_NOT_CONFIGURED_MESSAGE}</p>;
	}
	const step = data.setupStep;
	const verifying = step === 'finish-stripe' && data.connected && data.detailsSubmitted;

	return (
		<div className="grid gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline">
			<div className="grid gap-0.5">
				<span className="text-sm font-medium text-kumo-default">Get paid with Stripe</span>
				<span className="text-sm text-kumo-subtle">
					Your stores and paid sites take payments through Stripe. For a paid site you receive the price minus Estori's {PLATFORM_FEE_LABEL} fee.
				</span>
				{verifying && <span className="text-sm text-kumo-subtle">Stripe is verifying your details.</span>}
			</div>
			{step === null ? (
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="success">Ready to take payments</Badge>
					<Button size="sm" variant="secondary" loading={dashboard.isPending} onClick={openDashboard}>
						Open Stripe dashboard
					</Button>
				</div>
			) : data.setupStep === 'accept-terms' ? (
				<div className="grid gap-2">
					<span className="text-sm text-kumo-default">{SELLER_SETUP_MESSAGES[data.setupStep]}</span>
					<label className="flex items-start gap-2 text-sm text-kumo-default">
						<Checkbox checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)} className="mt-0.5" />
						<span>
							I agree to the selling terms in the{' '}
							<a href="/terms" target="_blank" rel="noreferrer" className="underline">
								Terms of Service
							</a>
							, section 10, including how refunds, disputes and Stripe's account fees are paid.
						</span>
					</label>
					<div>
						<Button
							size="sm"
							variant="primary"
							disabled={!agreed}
							loading={acceptTerms.isPending || onboarding.isPending}
							onClick={() =>
								acceptTerms.mutate(SELLER_TERMS_VERSION, {
									onSuccess: () => onboarding.start(),
									onError: (error) => toast.error(error.message),
								})
							}
						>
							Agree and continue to Stripe
						</Button>
					</div>
				</div>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={verifying ? 'info' : 'warning'}>{verifying ? 'Waiting for Stripe' : SELLER_SETUP_MESSAGES[step]}</Badge>
					<Button size="sm" variant="primary" loading={onboarding.isPending} onClick={onboarding.start}>
						{data.connected ? 'Continue Stripe setup' : 'Connect Stripe'}
					</Button>
				</div>
			)}
		</div>
	);
}
