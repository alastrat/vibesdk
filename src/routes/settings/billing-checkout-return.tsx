import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Banner, Loader, buttonVariants } from '@cloudflare/kumo';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { BILLING_PATH } from '@/api-types';
import { pageTitle } from '@/brand';
import { CHECKOUT_FAILED_MESSAGE } from '@/hooks/use-billing';
import { recallCheckoutRequest } from '@/hooks/use-billing-checkout';
import { apiClient } from '@/lib/api-client';
import { msg, t } from '@/lib/i18n';
import { unwrap } from '@/lib/unwrap-response';
import { returnTargetOf } from './checkout-state';

const NOT_CHECKED_MESSAGE = msg("We couldn't check your payment. Look at your plan and credits on the billing page in a minute.");

/**
 * Where Stripe sends the seller after paying. It asks where the checkout stands and moves on: to billing, which
 * confirms a payment, or back to the checkout page when nothing was paid. Nothing is paid or recorded here.
 */
export default function BillingCheckoutReturnPage() {
	const location = useLocation();
	const navigate = useNavigate();
	const [notChecked, setNotChecked] = useState(false);

	useEffect(() => {
		const sessionId = new URLSearchParams(location.search).get('session_id');
		if (sessionId === null) {
			navigate(BILLING_PATH, { replace: true });
			return;
		}
		let current = true;
		const request = recallCheckoutRequest();
		unwrap(apiClient.getCheckoutStatus(sessionId), CHECKOUT_FAILED_MESSAGE).then(
			(status) => {
				if (current) navigate(returnTargetOf(status, request), { replace: true });
			},
			() => {
				if (!current) return;
				// Stripe only sends the seller here after the payment was sent, so billing waits for it when it knows what was bought.
				if (request) navigate(returnTargetOf({ state: 'processing', kind: request.kind }, request), { replace: true });
				else setNotChecked(true);
			},
		);
		return () => {
			current = false;
		};
	}, [location.search, navigate]);

	return (
		<div className="size-full">
			<title>{pageTitle(t('Checkout'))}</title>
			<div className="container mx-auto grid max-w-xl gap-6 px-4 py-16">
				{notChecked ? (
					<>
						<Banner variant="alert" icon={<WarningCircleIcon />} description={t(NOT_CHECKED_MESSAGE)} />
						<div>
							<Link to={BILLING_PATH} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
								{t('Back to billing')}
							</Link>
						</div>
					</>
				) : (
					<div className="grid justify-items-center gap-3">
						<Loader />
						<p className="text-sm text-kumo-subtle">{t('Confirming your payment…')}</p>
					</div>
				)}
			</div>
		</div>
	);
}
