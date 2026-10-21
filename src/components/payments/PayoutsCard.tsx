import { t, T, useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Loader } from '@cloudflare/kumo';
import { Checkbox } from '@/components/ui/checkbox';
import { PayoutFrequency } from './PayoutFrequency';
import { SellerLimits } from './SellerLimits';
import { useAcceptSellerTerms, useStripeConnectStatus, useStripeDashboardLink, useStripeOnboardingRedirect } from '@/hooks/use-payments';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE } from '@/lib/paid-listing-display';
import { PLATFORM_FEE_LABEL, SELLER_SETUP_MESSAGES, SELLER_TERMS_VERSION } from '@/api-types';

/** "Get paid with Stripe": agree to the selling terms, finish Stripe's setup, then open the Stripe dashboard. */
export function PayoutsCard() {
	useI18n();
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
				<Button size="sm" variant="secondary" onClick={() => status.refetch()}>{t("Try again")}</Button>
			</div>
		);
	}
	const data = status.data;
	if (!data?.configured) {
		return <p className="text-sm text-kumo-subtle">{t(PAYMENTS_NOT_CONFIGURED_MESSAGE)}</p>;
	}
	const step = data.setupStep;
	const verifying = step === 'finish-stripe' && data.connected && data.detailsSubmitted;
	// The dashboard holds paid-site payouts too, so it stays open whatever the store setup still needs.
	const canOpenDashboard = data.connected && data.detailsSubmitted;
	// Everything at Stripe is in place: agreeing to the selling terms is the only step left.
	const stripeDone = data.detailsSubmitted && data.cardPaymentsActive && data.transfersActive && data.payoutsEnabled;

	return (
		<div className="grid gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline">
			<div className="grid gap-0.5">
				<span className="text-sm font-medium text-kumo-default">{t("Get paid with Stripe")}</span>
				<span className="text-sm text-kumo-subtle">{t("Your stores and paid sites take payments through Stripe. For a paid site you receive the price minus Estori's {fee} fee.", { fee: PLATFORM_FEE_LABEL })}</span>
				{verifying && <span className="text-sm text-kumo-subtle">{t("Stripe is verifying your details.")}</span>}
			</div>
			{canOpenDashboard && (
				<div className="flex flex-wrap items-center gap-2">
					{step === null ? (
						<Badge variant="success">{t("Ready to take payments")}</Badge>
					) : (
						data.transfersActive && <Badge variant="info">{t("Paid-site payouts active")}</Badge>
					)}
					<Button size="sm" variant="secondary" loading={dashboard.isPending} onClick={openDashboard}>{t("Open Stripe dashboard")}</Button>
				</div>
			)}
			{step === null && <PayoutFrequency status={data} />}
			{step === null && <SellerLimits />}
			{data.setupStep === 'accept-terms' ? (
				<div className="grid gap-2">
					<span className="text-sm text-kumo-default">{t(SELLER_SETUP_MESSAGES[data.setupStep])}</span>
					<label className="flex items-start gap-2 text-sm text-kumo-default">
						<Checkbox checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)} className="mt-0.5" />
						<T text="I agree to the selling terms in the <terms>Terms of Service</terms>, section 10, including how refunds, disputes and Stripe's account fees are paid." components={{ terms: (children) => <a href="/terms" target="_blank" rel="noreferrer" className="underline">{children}</a> }} />
					</label>
					<div>
						<Button
							size="sm"
							variant="primary"
							disabled={!agreed}
							loading={acceptTerms.isPending || onboarding.isPending}
							onClick={() =>
								acceptTerms.mutate(SELLER_TERMS_VERSION, {
									onSuccess: (status) => {
										if (status.setupStep !== null) onboarding.start();
									},
									onError: (error) => toast.error(error.message),
								})
							}
						>
							{stripeDone ? t("Agree") : t("Agree and continue to Stripe")}
						</Button>
					</div>
				</div>
			) : (
				step !== null && (
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant={verifying ? 'info' : 'warning'}>{verifying ? t("Waiting for Stripe") : t(SELLER_SETUP_MESSAGES[step])}</Badge>
						<Button size="sm" variant="primary" loading={onboarding.isPending} onClick={onboarding.start}>
							{data.connected ? t("Continue Stripe setup") : t("Connect Stripe")}
						</Button>
					</div>
				)
			)}
		</div>
	);
}
