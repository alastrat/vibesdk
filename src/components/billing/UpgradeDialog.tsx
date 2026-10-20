import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, buttonVariants, cn } from '@cloudflare/kumo';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BILLING_PATH, type PaidPlanId, type PlanLimitRefusal } from '@/api-types';
import { apiClient, ApiError } from '@/lib/api-client';
import { onPlanLimit } from '@/lib/plan-limit-events';
import { upgradeActionFor, upgradeTitleFor } from './upgrade-action';

const CHECKOUT_FAILED_MESSAGE = "Couldn't open the checkout. Try again in a moment.";

/** One plan-limit refusal: its title and message, and the next step it offers. */
export function UpgradeDialog({ refusal, onClose }: { refusal: PlanLimitRefusal; onClose: () => void }) {
	const navigate = useNavigate();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const action = upgradeActionFor(refusal);

	const checkout = async (plan: PaidPlanId) => {
		setPending(true);
		setError(null);
		try {
			const response = await apiClient.startPlanCheckout(plan);
			if (!response.success || !response.data) throw new Error(response.error?.message || CHECKOUT_FAILED_MESSAGE);
			window.location.href = response.data.url;
		} catch (failure) {
			setPending(false);
			// A plan already started, or a payment to fix first: the billing page explains what's next.
			if (failure instanceof ApiError && failure.status === 409) {
				onClose();
				navigate(BILLING_PATH);
				return;
			}
			setError(failure instanceof Error ? failure.message : CHECKOUT_FAILED_MESSAGE);
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{upgradeTitleFor(refusal)}</DialogTitle>
					<DialogDescription>{refusal.message}</DialogDescription>
				</DialogHeader>
				{error && <p className="text-sm text-kumo-danger">{error}</p>}
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={onClose} disabled={pending}>
						{action.kind === 'none' ? 'Close' : 'Not now'}
					</Button>
					{action.kind === 'checkout' && (
						<Button variant="primary" onClick={() => void checkout(action.plan)} loading={pending}>
							{action.label}
						</Button>
					)}
					{action.kind === 'link' && (
						<Link to={action.to} onClick={onClose} className={cn(buttonVariants({ variant: 'primary' }))}>
							{action.label}
						</Link>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** Shows the Upgrade dialog for the latest plan-limit refusal announced anywhere in the app. */
export function UpgradeDialogHost() {
	// Numbered, so a new refusal starts a fresh dialog rather than one left mid-checkout.
	const [shown, setShown] = useState<{ id: number; refusal: PlanLimitRefusal } | null>(null);

	useEffect(() => {
		let announced = 0;
		return onPlanLimit((refusal) => {
			announced += 1;
			setShown({ id: announced, refusal });
		});
	}, []);

	if (!shown) return null;
	return <UpgradeDialog key={shown.id} refusal={shown.refusal} onClose={() => setShown(null)} />;
}
