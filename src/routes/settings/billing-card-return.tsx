import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banner, Loader, buttonVariants } from '@cloudflare/kumo';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { BILLING_PATH } from '@/api-types';
import { pageTitle } from '@/brand';
import { BackToBilling } from '@/components/billing/BackToBilling';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { settlePayment } from '@/lib/stripe/next-action';
import { unwrap } from '@/lib/unwrap-response';
import { describePaymentResult } from './billing-view';
import { CARD_NOT_CHECKED_MESSAGE, cardPathOf, cardRefusalOf, returnTargetFor, sessionIdOfReturn } from './card-state';

type Working = 'saving' | 'confirming';

type Halted = { message: string; tryAgain: boolean };

const WORKING_TEXT: Record<Working, string> = { saving: 'Saving your card…', confirming: 'Confirming your payment…' };

/**
 * Where Stripe sends the seller after the card is saved. It makes the card the default, pays the failed renewal with it
 * when the seller asked to, finishes the bank's confirmation when the bank wants one, and goes back to billing with the
 * result. A payment that was declined stays here, because the seller has to read it and choose what to do.
 */
export default function BillingCardReturnPage() {
	const location = useLocation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [working, setWorking] = useState<Working>('saving');
	const [stopped, setStopped] = useState<Halted | null>(null);

	useEffect(() => {
		const sessionId = sessionIdOfReturn(location.search);
		if (sessionId === null) {
			navigate(BILLING_PATH, { replace: true });
			return;
		}
		let current = true;
		const finish = async () => {
			try {
				const result = await unwrap(apiClient.completeCardSetup(sessionId), CARD_NOT_CHECKED_MESSAGE);
				if (!current) return;
				if (result.state === 'requires_action') setWorking('confirming');
				const settled = await settlePayment(result);
				if (!current) return;
				void queryClient.invalidateQueries({ queryKey: queryKeys.billing() });
				const notice = describePaymentResult(settled);
				const target = returnTargetFor(settled);
				if (target === null) {
					setStopped({ message: notice.message, tryAgain: true });
					return;
				}
				toast.success(notice.message);
				navigate(target, { replace: true });
			} catch (failure) {
				if (current) setStopped({ message: cardRefusalOf(failure, CARD_NOT_CHECKED_MESSAGE).message, tryAgain: false });
			}
		};
		void finish();
		return () => {
			current = false;
		};
	}, [location.search, navigate, queryClient]);

	return (
		<div className="size-full">
			<title>{pageTitle('Card')}</title>
			<div className="container mx-auto grid max-w-xl gap-6 px-4 py-16">
				{stopped ? (
					<>
						<Banner variant="alert" icon={<WarningCircleIcon />} description={stopped.message} />
						<div className="flex flex-wrap items-center gap-2">
							{stopped.tryAgain && (
								<Link to={cardPathOf('pay')} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
									Try another card
								</Link>
							)}
							<BackToBilling />
						</div>
					</>
				) : (
					<div className="grid justify-items-center gap-3" role="status">
						<Loader />
						<p className="text-sm text-kumo-subtle">{WORKING_TEXT[working]}</p>
					</div>
				)}
			</div>
		</div>
	);
}
