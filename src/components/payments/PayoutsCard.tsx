import { toast } from 'sonner';
import { Badge, Button, Loader } from '@cloudflare/kumo';
import { useStripeConnectStatus, useStripeDashboardLink, useStripeOnboardingRedirect } from '@/hooks/use-payments';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE } from '@/lib/paid-listing-display';
import { PLATFORM_FEE_PERCENT } from '@/api-types';

/** "Get paid with Stripe": connect or finish Stripe onboarding, then open the Stripe dashboard. */
export function PayoutsCard() {
	const status = useStripeConnectStatus(true);
	const onboarding = useStripeOnboardingRedirect();
	const dashboard = useStripeDashboardLink();

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
	const verifying = data.connected && data.detailsSubmitted && !data.transfersActive;

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline">
			<div className="grid gap-0.5">
				<span className="text-sm font-medium text-kumo-default">Get paid with Stripe</span>
				<span className="text-sm text-kumo-subtle">
					Buyers pay through Stripe. You receive the price minus Estori's {PLATFORM_FEE_PERCENT}% fee.
				</span>
				{verifying && <span className="text-sm text-kumo-subtle">Stripe is verifying your details.</span>}
			</div>
			{data.transfersActive ? (
				<div className="flex items-center gap-2">
					<Badge variant="success">Payouts active</Badge>
					<Button size="sm" variant="secondary" loading={dashboard.isPending} onClick={openDashboard}>
						Open Stripe dashboard
					</Button>
				</div>
			) : (
				<div className="flex items-center gap-2">
					{verifying ? (
						<Badge variant="info">Waiting for Stripe</Badge>
					) : (
						data.connected && <Badge variant="warning">Setup incomplete</Badge>
					)}
					<Button size="sm" variant="primary" loading={onboarding.isPending} onClick={onboarding.start}>
						{data.connected ? 'Continue Stripe setup' : 'Connect Stripe'}
					</Button>
				</div>
			)}
		</div>
	);
}
